from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
import uvicorn
import os

app = FastAPI()

origins = [
    "http://localhost:5173",
    "https://cdse-xray-diffraction-thermometry.onrender.com", 
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Initialize variables as None to avoid NameError
model_fwd = None
model_inv = None

# 2. Dynamic path handling
# This looks for the models in the same folder as this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model_fwd_path = os.path.join(BASE_DIR, "model_fwd.joblib")
model_inv_path = os.path.join(BASE_DIR, "model_inv.joblib")

try:
    if os.path.exists(model_fwd_path) and os.path.exists(model_inv_path):
        model_fwd = joblib.load(model_fwd_path)
        model_inv = joblib.load(model_inv_path)
        print("✅ AI Models loaded successfully from:", BASE_DIR)
    else:
        print(f"❌ ERROR: Model files not found in {BASE_DIR}")
        print("Check if model_fwd.joblib and model_inv.joblib are in the same folder as main.py")
except Exception as e:
    print(f"❌ ERROR loading models: {e}")


class ForwardInput(BaseModel):
    pos: float
    intensity: float
    fwhm: float


class InverseInput(BaseModel):
    temp: float


@app.post("/predict")
def predict_temp(data: ForwardInput):
    # 3. Safety Check: If models didn't load, don't try to use them
    if model_fwd is None:
        raise HTTPException(status_code=503, detail="AI Model not loaded on server")

    ref_rt = 25.64
    shift = data.pos - ref_rt
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
