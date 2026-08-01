"""
CdSe XRD Thermometry — web API.

Thin HTTP layer over `pipeline.deploy.ThermometerService`. The user uploads the
2-column scan their diffractometer already exports; the service extracts the
13-feature signature, runs the Mahalanobis out-of-distribution check, and either
returns a temperature or explains why it will not.

Nothing here decides whether a prediction is trustworthy — that judgement lives
in the service, and this layer only forwards it.
"""
from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR / "pipeline"))

from pipeline import cdse_simulator as sim               # noqa: E402
from pipeline.deploy import ThermometerService           # noqa: E402
from pipeline.feature_extractor import TARGET_PEAKS      # noqa: E402
from pipeline.xrd_io import XRDParseError, parse_xrd_bytes  # noqa: E402
from pipeline.train_forward_models import CURATED_FEATURES  # noqa: E402

# Operating envelope, from report Section 5.3.3 and the deployment README.
TEMP_MIN_C = 25.0
TEMP_MAX_C = 400.0
SCAN_GEOMETRY = "Cu-K-alpha, 20-80 deg 2theta, step 0.02 deg"
DEFAULT_MODEL = "RandomForest"

# Caglioti U,V,W for instrumental broadening. These are the simulator's values;
# a real diffractometer should be calibrated against a NIST SRM 660 LaB6
# standard and the result set here (report Section 6.4, limitation 4).
# Set XRD_CAGLIOTI_UVW="U,V,W", or "none" to skip deconvolution entirely.
def _caglioti_from_env() -> Optional[tuple]:
    raw = os.environ.get("XRD_CAGLIOTI_UVW", "").strip().lower()
    if raw in ("none", "off"):
        return None
    if raw:
        try:
            u, v, w = (float(x) for x in raw.split(","))
            return (u, v, w)
        except ValueError:
            print(f"[warn] Ignoring malformed XRD_CAGLIOTI_UVW={raw!r}")
    return (0.005, -0.002, 0.010)


# Populated at startup. `service` stays None if the artefacts are missing, so
# the app still serves /health and can say exactly what is wrong.
service: Optional[ThermometerService] = None
startup_error: Optional[str] = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Build the service once. Construction loads 8 models and fits the OOD
    detector (3-5 s); doing it per request would be unusable."""
    global service, startup_error
    try:
        service = ThermometerService(caglioti_UVW=_caglioti_from_env())
        print(f"Loaded {len(service.models)} models: {sorted(service.models)}")
        print(f"OOD threshold (Mahalanobis): {service.ood.threshold:.2f}")
        if service.inverse_model is None:
            print("[warn] Inverse_ML.joblib missing — the explorer tab will "
                  "fall back to the physics simulator only.")
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim via /health
        startup_error = str(exc)
        print(f"[error] Thermometry service unavailable: {exc}")
    yield


app = FastAPI(title="CdSe XRD Thermometry", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://cdse-xray-diffraction-thermometry.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_service() -> ThermometerService:
    if service is None:
        raise HTTPException(
            status_code=503,
            detail=f"Thermometry service unavailable: {startup_error}",
        )
    return service


# -----------------------------------------------------------------------------
# Health
# -----------------------------------------------------------------------------

@app.get("/health")
def health() -> Dict[str, Any]:
    """What the UI needs to describe the system honestly before any upload."""
    if service is None:
        return {
            "ready": False,
            "error": startup_error,
            "models": [],
            "hint": "Place the trained .joblib artefacts in backend/models/ "
                    "(RandomForest, GradientBoosting, SVR, KNN, MLP, "
                    "DecisionTree, GPR, Inverse_ML), or run "
                    "`python -m pipeline.train_forward_models` from backend/.",
        }
    return {
        "ready": True,
        "models": sorted(service.models),
        "default_model": DEFAULT_MODEL,
        "uncertainty_model": "GPR",
        # GPR reproduces both the accuracy and the spread recorded in the
        # report's predictions.csv (mean sigma 13.3 degC against 13.0), so the
        # interval it reports is meaningful. verify_against_report.py checks
        # the calibration, not just the mean prediction.
        "uncertainty_validated": True,
        "has_inverse_model": service.inverse_model is not None,
        "ood_threshold": round(float(service.ood.threshold), 2),
        "n_features": len(service.feature_names),
        "feature_names": list(service.feature_names),
        "temperature_range_c": [TEMP_MIN_C, TEMP_MAX_C],
        "scan_geometry": SCAN_GEOMETRY,
        "caglioti_UVW": service.caglioti_UVW,
    }


# -----------------------------------------------------------------------------
# Analyse uploaded scans  (A -> B: signature -> temperature)
# -----------------------------------------------------------------------------

@app.post("/analyze")
async def analyze(files: List[UploadFile] = File(...),
                  model_name: str = DEFAULT_MODEL) -> Dict[str, Any]:
    """Predict temperature for each uploaded scan.

    One entry per input file, in the order uploaded. A file that cannot be
    parsed yields a status of "error" rather than vanishing from the results —
    silent skipping was the previous behaviour and it left users guessing.
    """
    svc = _require_service()
    if model_name not in svc.models:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model {model_name!r}. Available: {sorted(svc.models)}",
        )

    results: List[Dict[str, Any]] = []
    for upload in files:
        entry: Dict[str, Any] = {"filename": upload.filename}
        try:
            two_theta, intensity = parse_xrd_bytes(await upload.read())
        except XRDParseError as exc:
            results.append({**entry, "status": "error", "status_detail": str(exc),
                            "T_predicted": None, "T_uncertainty": None,
                            "features": None, "quality_report": None,
                            "ood_distance": None})
            continue

        result = svc.predict(two_theta, intensity, model_name=model_name)

        # The service computes a temperature before it knows the sample is out
        # of distribution. Report Section 4.4.3 is explicit that no prediction
        # is returned in that case, so withhold it here rather than relying on
        # the client to hide it — an API that still emits the number has not
        # really implemented the safeguard.
        if result["status"] == "out_of_distribution":
            result["T_predicted"] = None
            result["T_uncertainty"] = None

        result["scan"] = {
            "n_points": int(two_theta.size),
            "two_theta_min": round(float(two_theta.min()), 3),
            "two_theta_max": round(float(two_theta.max()), 3),
            "step": round(float(np.median(np.diff(two_theta))), 4),
            # Downsampled for plotting; the model saw the full array.
            "preview": _downsample(two_theta, intensity),
        }
        results.append({**entry, **result})

    return {
        "results": results,
        "model_used": model_name,
        "ood_threshold": round(float(svc.ood.threshold), 2),
    }


def _downsample(two_theta: np.ndarray, intensity: np.ndarray,
                target: int = 900) -> List[Dict[str, float]]:
    """Thin a scan for display, keeping the local maximum of each bin so that
    narrow peaks survive (plain striding would drop them)."""
    n = two_theta.size
    if n <= target:
        idx = np.arange(n)
    else:
        bins = np.array_split(np.arange(n), target)
        idx = np.array([b[int(np.argmax(intensity[b]))] for b in bins])
    return [{"twoTheta": round(float(two_theta[i]), 4),
             "intensity": round(float(intensity[i]), 2)} for i in idx]


# -----------------------------------------------------------------------------
# Signature explorer  (B -> A: temperature -> expected signature)
# -----------------------------------------------------------------------------

class SignatureRequest(BaseModel):
    temp: float = Field(..., ge=TEMP_MIN_C, le=TEMP_MAX_C)
    crystallite_size_nm: float = Field(25.0, ge=10.0, le=50.0)
    microstrain: float = Field(0.002, ge=0.0005, le=0.005)


@app.post("/simulate-signature")
def simulate_signature(req: SignatureRequest) -> Dict[str, Any]:
    """The reverse direction of the bidirectional design (report Section 4.4.2).

    Returns both branches so the UI can show them together:

    * `peaks`   — the six target reflections derived analytically from the
      physics model (lattice expansion, Debye-Waller, Caglioti, Williamson-Hall).
      The frontend synthesises the curve from these.
    * `ml_features` — the same signature as predicted by the trained inverse
      model. Agreement between the two is the report's central validation claim.
    """
    svc = _require_service()
    a, c = sim.lattice_parameters_at_T(req.temp)
    rel_intensity = {(h, k, l): rel for h, k, l, rel in sim.WURTZITE_REFLECTIONS}

    peaks: List[Dict[str, Any]] = []
    for hkl, _target, _window in TARGET_PEAKS:
        h, k, l = hkl
        two_theta = sim.bragg_2theta(sim.d_spacing_wurtzite(h, k, l, a, c))
        if not np.isfinite(two_theta):
            continue
        # Total FWHM: instrumental and microstructural broadening add in
        # quadrature, matching how simulate_pattern builds a peak.
        fwhm_micro = sim.williamson_hall_fwhm(
            two_theta, req.crystallite_size_nm, req.microstrain)
        fwhm_instr = sim.caglioti_fwhm(two_theta, 0.005, -0.002, 0.010)
        peaks.append({
            "hkl": f"({h}{k}{l})",
            "position": round(float(two_theta), 4),
            "fwhm": round(float(np.hypot(fwhm_micro, fwhm_instr)), 4),
            "height": round(float(rel_intensity[hkl]
                                  * sim.debye_waller_factor(two_theta, req.temp)), 4),
        })

    response: Dict[str, Any] = {
        "temperature": req.temp,
        "lattice": {"a": round(float(a), 4), "c": round(float(c), 4),
                    "volume": round(float(a * a * c * np.sin(np.radians(60.0))), 4)},
        "peaks": peaks,
        "two_theta_range": [sim.SimulatorConfig.two_theta_min,
                            sim.SimulatorConfig.two_theta_max],
        "ml_features": None,
    }
    if svc.inverse_model is not None:
        response["ml_features"] = {
            k: round(v, 4) for k, v in svc.expected_signature(req.temp).items()
        }
    return response


# -----------------------------------------------------------------------------
# Reference data for the inspector tab
# -----------------------------------------------------------------------------

@app.get("/training-stats")
def training_stats() -> Dict[str, Any]:
    """Per-feature training mean and standard deviation.

    The inspector shows an extracted signature against these, which is how a
    user sees *which* features pushed a scan out of distribution.
    """
    svc = _require_service()
    return {
        "features": [
            {"name": name,
             "mean": round(float(svc.feature_means[name]), 4),
             "std": round(float(svc.feature_stds[name]), 4)}
            for name in CURATED_FEATURES
        ],
        "ood_threshold": round(float(svc.ood.threshold), 2),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
