"""
Reproduce the report's published results against the deployed artefacts.

Checks are made against the report's own result files in
`data/report_reference/` rather than against numbers transcribed by hand, so
this catches drift in the pipeline *and* in the reconstruction of it.

    python verify_against_report.py [--real-data DIR]

Exit code is non-zero if any check fails.
"""
from __future__ import annotations

import argparse
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR / "pipeline"))

from pipeline import cdse_simulator as sim                    # noqa: E402
from pipeline.deploy import ThermometerService                # noqa: E402
from pipeline.train_forward_models import (CURATED_FEATURES,   # noqa: E402
                                           TARGET_COLUMN, TEST_SPLIT)
from pipeline.xrd_io import parse_xrd_bytes                   # noqa: E402

REFERENCE_DIR = BASE_DIR / "data" / "report_reference"
DEFAULT_REAL_DATA = Path(
    r"E:\Bachelor AI\2526_sem2\PSM\Dataset\CdSe XRD Annealing different temp"
    r"\CdSe XRD Annealing different temp"
)

KNOWN_UNREPRODUCIBLE: set[str] = set()

# Five of the seven models are deterministic given the data and reproduce
# metrics.csv to every recorded digit, so they are held to a tight tolerance.
# Two carry run-to-run variance that the report does not pin down:
#   MLP  - random weight initialisation; seeds span MAE 11.69-11.86 against
#          the published 11.97.
#   GPR  - the identity of the 500-point subsample is not recorded, and the
#          draw moves MAE over 11.5-12.7 around the published 12.36.
# Both get a band wide enough to cover the observed spread.
MAE_TOLERANCE = 0.05
STOCHASTIC_MAE_TOLERANCE = {"MLP": 0.40, "GPR": 0.90}

failures: list[str] = []


def check(name: str, passed: bool, detail: str, *, warn_only: bool = False) -> None:
    tag = "WARN" if (warn_only and not passed) else ("PASS" if passed else "FAIL")
    print(f"  [{tag}] {name}: {detail}")
    if not passed and not warn_only:
        failures.append(name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--real-data", type=Path, default=DEFAULT_REAL_DATA)
    args = parser.parse_args()
    warnings.simplefilter("ignore")

    print("\n1. Service construction")
    service = ThermometerService()
    check("forward models loaded", len(service.models) >= 7,
          f"{len(service.models)}: {sorted(service.models)}")
    check("inverse model loaded", service.inverse_model is not None,
          "Inverse_ML.joblib" if service.inverse_model else "missing")
    check("OOD threshold ~5.81", abs(service.ood.threshold - 5.81) < 0.30,
          f"{service.ood.threshold:.4f} (report Section 4.4.3: 5.81)")

    print("\n2. Feature order matches the report's own result files")
    # The header of the inverse-prediction tables records the fit order. A
    # permutation is invisible to the OOD threshold (Mahalanobis is invariant
    # under it) and to any self-trained benchmark, so this is the only direct
    # check available.
    header = pd.read_csv(REFERENCE_DIR / "inverse_ml_predictions.csv", nrows=0)
    expected = tuple(c for c in header.columns if c != "T")
    check("CURATED_FEATURES order", tuple(CURATED_FEATURES) == expected,
          "matches inverse_ml_predictions.csv"
          if tuple(CURATED_FEATURES) == expected
          else f"expected {expected}, got {tuple(CURATED_FEATURES)}")

    print("\n3. Forward benchmark vs metrics.csv (report Section 5.2.1)")
    from sklearn.metrics import mean_absolute_error, r2_score
    reference = pd.read_csv(REFERENCE_DIR / "metrics.csv").set_index("model")
    df = pd.read_csv(ThermometerService.DEFAULT_TRAINING_DATA)
    test = df[df["split"] == TEST_SPLIT].dropna(subset=list(CURATED_FEATURES))
    X_test = test[list(CURATED_FEATURES)].values
    y_test = test[TARGET_COLUMN].values

    for name in sorted(service.models):
        if name not in reference.index:
            continue
        pred = service.models[name].predict(X_test)
        mae = mean_absolute_error(y_test, pred)
        r2 = r2_score(y_test, pred)
        want_mae = float(reference.loc[name, "MAE"])
        want_r2 = float(reference.loc[name, "R2"])
        tol = STOCHASTIC_MAE_TOLERANCE.get(name, MAE_TOLERANCE)
        ok = abs(mae - want_mae) < tol and abs(r2 - want_r2) < 0.002
        note = "" if name not in STOCHASTIC_MAE_TOLERANCE else "  [seed-sensitive]"
        check(f"{name}", ok,
              f"MAE {mae:8.4f} (report {want_mae:8.4f})   "
              f"R2 {r2:.7f} (report {want_r2:.7f}){note}",
              warn_only=name in KNOWN_UNREPRODUCIBLE)

    # The UI shows GPR's interval as a confidence figure, so a plausible mean
    # prediction is not enough - the spread has to be right too. A GP that has
    # settled into a poor optimum stays accurate-looking while reporting an
    # interval several times too tight.
    gpr_ref = pd.read_csv(REFERENCE_DIR / "predictions.csv")
    gpr_ref = gpr_ref[gpr_ref["model"] == "GPR"]
    if "GPR" in service.models and not gpr_ref.empty:
        pipeline = service.models["GPR"]
        _, std = pipeline.named_steps["model"].predict(
            pipeline.named_steps["scaler"].transform(X_test), return_std=True)
        want = float(gpr_ref["T_std"].mean())
        got = float(std.mean())
        check("GPR uncertainty calibration", abs(got - want) < 2.0,
              f"mean sigma {got:.2f} degC (report {want:.2f})")

    print("\n4. Inverse model vs inverse_ml_predictions.csv (Section 4.4.2)")
    if service.inverse_model is not None:
        ref_ml = pd.read_csv(REFERENCE_DIR / "inverse_ml_predictions.csv")
        positions = [c for c in CURATED_FEATURES if c.startswith("peak_pos_")]
        worst = 0.0
        for _, row in ref_ml.iterrows():
            got = service.expected_signature(float(row["T"]))
            worst = max(worst, max(abs(got[c] - row[c]) for c in positions))
        # Retrained inverse, so agreement is statistical rather than exact;
        # the report's own tolerance on peak positions is 0.005 deg.
        check("peak positions track the reference inverse", worst < 0.05,
              f"worst deviation {worst:.4f} deg across 76 temperatures")

    print("\n5. Physics inverse vs inverse_physics_predictions.csv")
    ref_phys = pd.read_csv(REFERENCE_DIR / "inverse_physics_predictions.csv")
    hkl_of = {"peak_pos_100": (1, 0, 0), "peak_pos_002": (0, 0, 2),
              "peak_pos_101": (1, 0, 1), "peak_pos_110": (1, 1, 0),
              "peak_pos_103": (1, 0, 3), "peak_pos_112": (1, 1, 2)}
    worst = 0.0
    for _, row in ref_phys.iterrows():
        a, c = sim.lattice_parameters_at_T(float(row["T"]))
        for col, hkl in hkl_of.items():
            got = sim.bragg_2theta(sim.d_spacing_wurtzite(*hkl, a, c))
            worst = max(worst, abs(got - row[col]))
    check("simulator reproduces the analytic inverse", worst < 1e-6,
          f"worst deviation {worst:.2e} deg")

    print("\n6. In-distribution positive control")
    tt, ii = sim.simulate_pattern(250.0, sim.HIGH_SNR_CONFIG,
                                  rng=np.random.default_rng(123))
    result = service.predict(tt, ii, model_name="RandomForest")
    check("simulated 250 degC accepted", result["status"] in ("ok", "degraded"),
          f"status={result['status']}, d={result['ood_distance']}")
    check("simulated 250 degC accurate", abs(result["T_predicted"] - 250.0) < 25.0,
          f"predicted {result['T_predicted']} degC")

    print("\n7. Real as-deposited samples must be refused (Section 5.2.3)")
    scans = sorted(args.real_data.glob("CdSeA_*.txt")) if args.real_data.is_dir() else []
    if not scans:
        check("real samples found", False, f"no CdSeA_*.txt under {args.real_data}")
    for path in scans:
        tt, ii = parse_xrd_bytes(path.read_bytes())
        res = service.predict(tt, ii, model_name="RandomForest")
        check(f"{path.name} refused", res["status"] == "out_of_distribution",
              f"Mahalanobis d={res['ood_distance']} (report: 190-240)")

    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED: {', '.join(failures)}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
