from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
import numpy as np
import uvicorn
import os

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://cdse-xray-diffraction-thermometry.onrender.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Initialize model variables as None
model_fwd = None
model_inv = None
fwhm_estimator = None

# 2. Dynamic path handling
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model_fwd_path = os.path.join(BASE_DIR, "model_fwd.joblib")
model_inv_path = os.path.join(BASE_DIR, "model_inv.joblib")
fwhm_model_path = os.path.join(BASE_DIR, "fwhm_estimator_rf_final.joblib")

# Reference Room Temperature Position for Peak_Shift calculation
RT_PEAK_REF = 25.64

try:
    # Load Forward & Inverse Models
    if os.path.exists(model_fwd_path) and os.path.exists(model_inv_path):
        model_fwd = joblib.load(model_fwd_path)
        model_inv = joblib.load(model_inv_path)
        print("✅ Primary AI Models loaded successfully.")

    # FIX: Load the FWHM Estimator model file (not just the path string)
    if os.path.exists(fwhm_model_path):
        fwhm_estimator = joblib.load(fwhm_model_path)
        print("✅ FWHM Estimator loaded successfully.")
    else:
        print(f"❌ ERROR: FWHM model not found in {BASE_DIR}")

except Exception as e:
    print(f"❌ ERROR loading models: {e}")


class ForwardInput(BaseModel):
    pos: float
    intensity: float
    fwhm: float


class InverseInput(BaseModel):
    temp: float


class FWHMInput(BaseModel):
    pos: float
    intensity: float


@app.post("/predict")
def predict_temp(data: ForwardInput):
    if model_fwd is None:
        raise HTTPException(status_code=503, detail="AI Model not loaded on server")

    shift = data.pos - RT_PEAK_REF
    input_df = pd.DataFrame([[data.pos, data.intensity, data.fwhm, shift]],
                            columns=["Peak_Position", "Peak_Intensity", "FWHM", "Peak_Shift"])

    prediction = model_fwd.predict(input_df)[0]
    return {"temperature": float(prediction)}


@app.post("/simulate")
def simulate_xrd(data: InverseInput):
    if model_inv is None:
        raise HTTPException(status_code=503, detail="AI Model not loaded on server")

    input_df = pd.DataFrame([[data.temp]], columns=["Temperature"])
    physics = model_inv.predict(input_df)[0]
    return {
        "pos": float(physics[0]),
        "fwhm": float(physics[1]),
        "intensity": float(physics[2]),
    }


@app.post("/estimate-fwhm")
async def predict_fwhm(data: FWHMInput):
    if fwhm_estimator is None:
        raise HTTPException(status_code=503, detail="FWHM Estimator not loaded on server")

    # Calculate Peak_Shift to match the training features
    peak_shift = data.pos - RT_PEAK_REF

    # Prepare features in the exact order: [Position, Intensity, Shift]
    # Using 2D array for the scikit-learn predict method
    features = np.array([[data.pos, data.intensity, peak_shift]])

    # Predict the FWHM based on the optimized Random Forest baseline
    prediction = fwhm_estimator.predict(features)[0]

    return {
        "fwhm": float(prediction),
        "peak_shift": float(peak_shift),
        "status": "success"
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)