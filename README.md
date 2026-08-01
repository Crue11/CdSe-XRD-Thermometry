# CdSe X-Ray Diffraction Thermometry

Predicts the temperature of a CdSe thin film from its XRD scan, and refuses to
guess when the scan falls outside the range it was trained for.

You upload the 2-column file your diffractometer already exports. The backend
extracts a 13-feature signature from the six wurtzite reflections, checks that
signature against the training distribution, and returns either a temperature or
an explanation of why it withheld one. There is nothing to tune by hand.

This is the deployment front end for the framework described in
*Machine Learning-Based XRD Signature Analysis for Temperature Prediction of
CdSe Thin Films* (Universiti Teknikal Malaysia Melaka, 2026).

## Running it

Backend (Python 3.11+):

```bash
pip install -r requirements.txt
```

```bash
cd backend && python -m uvicorn main:app --reload --port 8000
```

Frontend:

```bash
npm install && npm run dev
```

The dev server reads `VITE_API_URL` from `.env`, defaulting to
`http://localhost:8000`.

If you have no scan to hand, the Analyser tab offers two example patterns from
`public/samples/`. They come from the forward physics simulator at 150 °C and
320 °C — two of the report's held-out test temperatures — and are labelled as
simulated throughout, because they are not laboratory measurements and should
never be presented as evidence of real-world accuracy.

## What the backend needs

```
backend/
├── main.py                  # HTTP layer
├── verify_against_report.py # reproduces the report's headline numbers
├── pipeline/                # vendored research code
│   ├── deploy.py            # ThermometerService: the public API
│   ├── feature_extractor.py # 2θ/intensity -> 13 features
│   ├── cdse_simulator.py    # forward physics model
│   ├── train_forward_models.py
│   └── xrd_io.py            # scan file parsing
├── models/                  # 7 forward models + Inverse_ML (.joblib)
└── data/
    └── cdse_simulated_dataset.csv   # required at runtime, not just for training
```

The dataset CSV is not optional: the out-of-distribution detector is fitted from
its `train_clean` and `train_aug` rows every time the service starts.

If `backend/models/` is empty, the app still runs and `/health` reports exactly
what is missing. To rebuild the models:

```bash
cd backend && python -m pipeline.train_forward_models
```

## Status codes

Every analysed scan comes back with one of four statuses.

| Status | Meaning | What the UI shows |
|---|---|---|
| `ok` | In-distribution, cleanly extracted | Temperature, plus ± if the model is GPR |
| `degraded` | In-distribution but peak fitting needed fallbacks | Temperature with a warning |
| `out_of_distribution` | Signature is far from the training manifold | **No temperature.** Red banner and the reason |
| `error` | File could not be parsed as a scan | The parse error |

`out_of_distribution` is the safeguard working. The API nulls the temperature
out on that status rather than leaving it to the client to hide.

## When a prediction is possible

Three conditions, from Section 5.3.3 of the report:

1. The film must be crystallised enough to resolve at least three wurtzite
   reflections above the noise floor — the (100)/(002)/(101) triplet at 23–28°
   is sufficient.
2. The scan must be taken **in-situ, at the target temperature**, not ex-situ
   after the sample has cooled.
3. Scan geometry must match the simulator: Cu-Kα, 20–80° 2θ, step 0.02°.

Predictions are valid over 25–400 °C only.

The five as-deposited `CdSeA_*.txt` samples from the collaborating laboratory
fail conditions 1 and 2, and the system correctly refuses all five. That is the
intended behaviour and the clearest demonstration that the safeguard is real.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Models loaded, OOD threshold, operating envelope |
| `POST /analyze` | Multipart upload of one or more scans → per-file result |
| `POST /simulate-signature` | Temperature → expected signature (the reverse direction) |
| `GET /training-stats` | Per-feature training mean and standard deviation |

## Verification

```bash
cd backend && python verify_against_report.py
```

Checks are made against the report's own published result files, vendored in
`backend/data/report_reference/` (`metrics.csv`, the two inverse-prediction
tables, and the per-pattern `predictions.csv`), rather than against numbers
copied out by hand.

Five of the seven forward models reproduce `metrics.csv` to every recorded
digit — RandomForest at MAE 11.386957 / R² 0.9831650, plus DecisionTree,
GradientBoosting, KNN and SVR. RandomForest also reproduces the report's
per-pattern predictions in `predictions.csv` exactly, to 0.0 °C on all 100
held-out patterns. The physics simulator reproduces the analytic inverse table
to 1.4e-14 degrees. The OOD threshold comes out at 5.813, and all five real
as-deposited samples are refused.

Two models carry run-to-run variance the report does not pin down, so their
checks allow a band:

- **MLP** — 11.86 °C against 11.97. Random weight initialisation; a sweep over
  seeds and iteration budgets spans 11.69–11.86.
- **GPR** — 12.38 °C against 12.36, with mean predictive σ of 13.3 °C against
  the 13.0 in `predictions.csv`. The identity of the 500-point subsample is not
  recorded and the draw moves MAE over roughly 11.5–12.7; the shipped artefact
  uses the draw closest to the published metrics
  (`GPR_SUBSAMPLE_SEED` in `train_forward_models.py`).

  The GPR kernel deserves a note. `metrics.csv` records only `alpha=1e-4`, and
  the report describes the kernel as Matérn-5/2. Taken literally that leaves
  the marginal-likelihood optimiser in a poor local optimum — MAE 17.8 °C with
  a predictive σ near 2 °C, which looks precise and is not. Seeding the noise
  term at `WhiteKernel(1e-2)` converges to the intended solution. Because the
  UI presents σ as a confidence interval, the verifier checks the calibration
  and not just the mean prediction.

### Feature order

`CURATED_FEATURES` must match the order the models were fitted in, which is the
physics-grouped order in the header of `inverse_ml_predictions.csv` — not the
|r|-sorted order that Table 4.3 presents. A permutation is undetectable by the
usual checks: Mahalanobis distance is invariant under it, and a model trained
and queried through the same wrong order stays self-consistent. RandomForest is
what pins it down, matching `metrics.csv` exactly in the correct order and
giving 11.3059 in the wrong one. The verification script checks the order
directly against the reference header.

Note also that the tree models are deliberately **not** wrapped in a
`StandardScaler`. Scaling a tree is nearly a no-op, but sklearn's splitter
treats values closer than 1e-7 as identical, so standardising features whose
raw spread is far from unity moves that boundary and shifts the tree. Scaled
trees miss `metrics.csv`; unscaled ones match it.

## Instrument calibration

`XRD_CAGLIOTI_UVW` sets the Caglioti U,V,W used to deconvolve instrumental
broadening (default `0.005,-0.002,0.010`, the simulator's values); set it to
`none` to skip deconvolution. Note that it affects only the Williamson-Hall
diagnostics — none of the 13 curated features depend on it — so it changes the
quality report, not the predicted temperature.
