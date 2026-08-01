"""
Deployment Wrapper for the XRD Thermometry Web System
======================================================

One-stop API for the web backend. Bundles the feature extractor, all
trained models, and an out-of-distribution (OOD) sanity check.

Usage from the web backend
--------------------------
    from deploy import ThermometerService

    service = ThermometerService()  # loads all 7 models + training stats

    result = service.predict(
        two_theta=[...],       # array of 2θ angles in degrees
        intensity=[...],       # matching intensity array
        model_name="RandomForest",   # any of the 7 trained models
    )
    # result = {
    #     "T_predicted": 152.3,
    #     "T_uncertainty": 25.6,      # ±°C (from GPR if requested, else None)
    #     "status": "ok" | "degraded" | "out_of_distribution",
    #     "status_detail": "...",
    #     "features": {...},          # extracted features, for transparency
    #     "quality_report": {...}     # extraction diagnostics
    # }

OOD detection
-------------
Before handing features to the chosen model, we compute a Mahalanobis
distance against the training-data feature distribution. If the input
lies beyond a calibrated threshold, the service returns status =
"out_of_distribution" and refuses to predict a specific T.

This matters for real samples (like the five experimental files in this
project) whose XRD patterns don't correspond to a well-crystallized
wurtzite CdSe film — any temperature prediction would be meaningless
and potentially misleading to a materials scientist.

Threshold calibration uses the 99th percentile of Mahalanobis distance
on the training data. Samples beyond this are flagged.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
import json
import warnings

import joblib
import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent))
from feature_extractor import extract_features, CU_KALPHA
from train_forward_models import CURATED_FEATURES


# -----------------------------------------------------------------------------
# OOD detection via Mahalanobis distance
# -----------------------------------------------------------------------------

class OODDetector:
    """Calibrated Mahalanobis-distance flag. Fit on training features;
    at inference time, samples with distance beyond threshold are OOD."""

    def __init__(self):
        self.mean: Optional[np.ndarray] = None
        self.inv_cov: Optional[np.ndarray] = None
        self.threshold: Optional[float] = None

    def fit(self, X: np.ndarray, percentile: float = 99.0):
        self.mean = X.mean(axis=0)
        cov = np.cov(X, rowvar=False)
        # Ridge regularisation in case features are near-collinear
        cov += 1e-6 * np.eye(cov.shape[0])
        self.inv_cov = np.linalg.pinv(cov)
        dists = self._mahalanobis(X)
        self.threshold = float(np.percentile(dists, percentile))
        return self

    def _mahalanobis(self, X: np.ndarray) -> np.ndarray:
        diff = X - self.mean
        # d² = (x-μ)ᵀ Σ⁻¹ (x-μ)
        d2 = np.einsum("ij,jk,ik->i", diff, self.inv_cov, diff)
        return np.sqrt(np.maximum(d2, 0.0))

    def score(self, x: np.ndarray) -> float:
        return float(self._mahalanobis(x.reshape(1, -1))[0])

    def is_ood(self, x: np.ndarray) -> Tuple[bool, float]:
        d = self.score(x)
        return d > self.threshold, d


# -----------------------------------------------------------------------------
# Main service
# -----------------------------------------------------------------------------

class ThermometerService:
    """Wraps the full inference pipeline: feature extraction → OOD check →
    model prediction → uncertainty estimation."""

    AVAILABLE_MODELS = ("DecisionTree", "RandomForest", "GradientBoosting",
                        "SVR", "KNN", "MLP", "GPR")

    # backend/pipeline/deploy.py -> backend/
    BACKEND_DIR = Path(__file__).resolve().parent.parent
    DEFAULT_MODELS_DIR = BACKEND_DIR / "models"
    DEFAULT_TRAINING_DATA = BACKEND_DIR / "data" / "cdse_simulated_dataset.csv"

    def __init__(self,
                 models_dir: str | Path = DEFAULT_MODELS_DIR,
                 training_data_path: str | Path = DEFAULT_TRAINING_DATA,
                 caglioti_UVW: Optional[Tuple[float, float, float]] = (0.005, -0.002, 0.010)):
        self.models_dir = Path(models_dir)
        self.caglioti_UVW = caglioti_UVW
        self.feature_names: List[str] = list(CURATED_FEATURES)

        # Load all models
        self.models: Dict[str, Any] = {}
        for name in self.AVAILABLE_MODELS:
            path = self.models_dir / f"{name}.joblib"
            if path.exists():
                self.models[name] = joblib.load(path)
        if not self.models:
            raise RuntimeError(f"No trained models found in {self.models_dir}")
        self._check_feature_agreement()

        # Optional inverse model (T -> feature vector), used by the explorer UI
        inverse_path = self.models_dir / "Inverse_ML.joblib"
        self.inverse_model = joblib.load(inverse_path) if inverse_path.exists() else None

        # Fit OOD detector on training-feature distribution
        train_df = pd.read_csv(training_data_path)
        train_df = train_df[train_df["split"].isin(["train_clean", "train_aug"])]
        train_df = train_df.dropna(subset=self.feature_names)
        X_train = train_df[self.feature_names].values

        self.feature_means = train_df[self.feature_names].mean().to_dict()
        self.feature_stds = train_df[self.feature_names].std().to_dict()
        self.ood = OODDetector().fit(X_train, percentile=99.0)

        # For GPR uncertainty conversion we need σ → °C; it's already in °C
        # because T was the training label in native units.

    def _check_feature_agreement(self) -> None:
        """Fail loudly if a loaded model disagrees with CURATED_FEATURES.

        The inference vector is rebuilt from CURATED_FEATURES on every call, so
        a model fitted on a different set — or the same set in a different
        order — returns plausible-looking numbers that are simply wrong. That
        is far worse than not starting, hence the hard failure here.
        """
        expected = list(self.feature_names)
        for name, model in self.models.items():
            est = model.named_steps["model"] if hasattr(model, "named_steps") else model
            names_in = getattr(est, "feature_names_in_", None)
            if names_in is not None and list(names_in) != expected:
                raise RuntimeError(
                    f"Model {name!r} was fitted on a different feature vector than "
                    f"CURATED_FEATURES.\n  model:    {list(names_in)}\n"
                    f"  expected: {expected}\n"
                    "Restore the train_forward_models.py that matches these artefacts."
                )
            n_in = getattr(est, "n_features_in_", None)
            if n_in is not None and n_in != len(expected):
                raise RuntimeError(
                    f"Model {name!r} expects {n_in} features but CURATED_FEATURES "
                    f"defines {len(expected)}. The artefacts and this module are "
                    "from different training runs."
                )

    def expected_signature(self, T_celsius: float) -> Dict[str, float]:
        """Reverse direction (B->A): temperature -> expected feature vector.

        Wraps the Inverse_ML MultiOutputRegressor of report Section 4.4.2.
        """
        if self.inverse_model is None:
            raise RuntimeError("Inverse_ML.joblib not found in models directory.")
        values = self.inverse_model.predict(np.array([[float(T_celsius)]]))[0]
        return {name: float(v) for name, v in zip(self.feature_names, values)}

    def predict(self,
                two_theta: np.ndarray,
                intensity: np.ndarray,
                model_name: str = "RandomForest") -> Dict[str, Any]:
        """Predict T from a raw XRD pattern.

        Parameters
        ----------
        two_theta, intensity : array-like
            Matching arrays in degrees and counts.
        model_name : which trained model to use.

        Returns
        -------
        result : dict with keys
            T_predicted, T_uncertainty, status, status_detail,
            features, quality_report, ood_distance.
        """
        if model_name not in self.models:
            return {
                "T_predicted": None,
                "T_uncertainty": None,
                "status": "error",
                "status_detail": f"Unknown model {model_name!r}. "
                                 f"Available: {sorted(self.models)}",
                "features": None,
                "quality_report": None,
                "ood_distance": None,
            }

        two_theta = np.asarray(two_theta, dtype=float)
        intensity = np.asarray(intensity, dtype=float)
        if two_theta.shape != intensity.shape or len(two_theta) < 100:
            return {
                "T_predicted": None,
                "T_uncertainty": None,
                "status": "error",
                "status_detail": "Invalid input arrays (mismatched or too short).",
                "features": None,
                "quality_report": None,
                "ood_distance": None,
            }

        # Step 1: feature extraction
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            feats, quality = extract_features(two_theta, intensity,
                                              caglioti_UVW=self.caglioti_UVW)
        feature_vec = np.array([feats.get(f, np.nan) for f in self.feature_names])

        # Step 2: impute any NaNs with training-set means (so OOD + model work)
        nan_mask = np.isnan(feature_vec)
        if nan_mask.any():
            for i, f in enumerate(self.feature_names):
                if np.isnan(feature_vec[i]):
                    feature_vec[i] = self.feature_means[f]

        # Step 3: OOD check
        is_ood, ood_d = self.ood.is_ood(feature_vec)

        # Step 4: model inference
        X = feature_vec.reshape(1, -1)
        model = self.models[model_name]
        if model_name == "GPR":
            gpr = model.named_steps["model"]
            X_scaled = model.named_steps["scaler"].transform(X)
            T_pred, T_std = gpr.predict(X_scaled, return_std=True)
            T_pred = float(T_pred[0])
            T_uncertainty = float(1.96 * T_std[0])  # 95% half-width
        else:
            T_pred = float(model.predict(X)[0])
            T_uncertainty = None

        # Step 5: build status
        # Reliability heuristic:
        #   - OOD takes priority over everything
        #   - "degraded" means the peak extraction itself had issues
        #     (fallbacks, poor W-H AND few fits). W-H R² being low on
        #     clean large-crystallite samples is normal and should not
        #     trigger "degraded" alone.
        n_fallbacks = sum(1 for s in quality.degraded_fits
                           if "fallback" in s or "no_candidate" in s)
        extraction_degraded = (quality.n_peaks_fitted < 5) or (n_fallbacks >= 2)

        if is_ood:
            status = "out_of_distribution"
            status_detail = (
                f"Feature vector lies outside the training distribution "
                f"(Mahalanobis distance = {ood_d:.2f}, "
                f"threshold = {self.ood.threshold:.2f}). "
                "The pattern likely does not correspond to a well-"
                "crystallized wurtzite CdSe sample. The predicted "
                "temperature should not be trusted."
            )
        elif extraction_degraded:
            status = "degraded"
            status_detail = (
                f"Peak extraction had issues: "
                f"{quality.n_peaks_fitted}/6 peaks fitted, "
                f"{n_fallbacks} fallback(s). "
                "Prediction provided but treat with caution."
            )
        else:
            status = "ok"
            status_detail = "Prediction computed on an in-distribution pattern."

        return {
            "T_predicted": round(T_pred, 2),
            "T_uncertainty": round(T_uncertainty, 2) if T_uncertainty is not None else None,
            "status": status,
            "status_detail": status_detail,
            "features": {k: (round(float(v), 4) if np.isfinite(v) else None)
                         for k, v in feats.items()},
            "quality_report": {
                "n_peaks_fitted": quality.n_peaks_fitted,
                "wh_r2": None if not np.isfinite(quality.wh_r2) else round(float(quality.wh_r2), 3),
                "degraded_fits": quality.degraded_fits,
            },
            "ood_distance": round(float(ood_d), 2),
            "any_feature_imputed": bool(nan_mask.any()),
        }


# -----------------------------------------------------------------------------
# Smoke test
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import io
    from cdse_simulator import (HIGH_SNR_CONFIG, LOW_SNR_CONFIG,
                                 simulate_pattern, AugmentationRanges,
                                 sample_augmented_config)

    svc = ThermometerService()
    print(f"Loaded {len(svc.models)} models: {sorted(svc.models)}")
    print(f"OOD threshold (Mahalanobis distance): {svc.ood.threshold:.2f}")
    print()

    # -------- Test 1: in-distribution simulated at 250 °C --------
    print("=" * 72)
    print("Test 1: simulated clean pattern at 250 °C — should be OK")
    print("=" * 72)
    tt, I = simulate_pattern(250.0, HIGH_SNR_CONFIG,
                              rng=np.random.default_rng(123))
    for m in ["RandomForest", "GPR", "SVR"]:
        res = svc.predict(tt, I, model_name=m)
        print(f"  [{m:>18}] T_pred = {res['T_predicted']:.1f} °C  "
              f"(unc = {res['T_uncertainty']})  status = {res['status']}  "
              f"d = {res['ood_distance']}")

    # -------- Test 2: augmented low-SNR at 180 °C --------
    print()
    print("=" * 72)
    print("Test 2: low-SNR augmented pattern at 180 °C — may be degraded")
    print("=" * 72)
    aug = AugmentationRanges()
    cfg = sample_augmented_config(LOW_SNR_CONFIG, aug, np.random.default_rng(77))
    tt, I = simulate_pattern(180.0, cfg, rng=np.random.default_rng(88))
    res = svc.predict(tt, I, model_name="RandomForest")
    print(f"  T_pred = {res['T_predicted']:.1f} °C  status = {res['status']}")
    print(f"  detail: {res['status_detail']}")

    # -------- Test 3: real experimental pattern — expect OOD --------
    print()
    print("=" * 72)
    print("Test 3: real experimental pattern (CdSeA_200, assumed 200 °C)")
    print("=" * 72)
    with open("/mnt/project/CdSeA_200.txt") as f:
        lines = f.readlines()
    start = next(i for i, l in enumerate(lines) if "<2Theta>" in l) + 1
    data = np.loadtxt(io.StringIO("".join(lines[start:])))
    tt, I = data[:, 0], data[:, 1]
    # Real data: unknown instrument; pass UVW=None
    svc_real = ThermometerService(caglioti_UVW=None)
    for m in ["RandomForest", "GPR"]:
        res = svc_real.predict(tt, I, model_name=m)
        print(f"  [{m:>13}] T_pred = {res['T_predicted']:.1f} °C  "
              f"status = {res['status']}")
        print(f"       detail: {res['status_detail']}")
