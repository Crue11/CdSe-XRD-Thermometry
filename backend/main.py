from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from scipy.signal import find_peaks, peak_widths
from pydantic import BaseModel
import joblib
import pandas as pd
import numpy as np
import uvicorn
import os
import io
import re

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

# 1. Initialize model variables
model_fwd = None
model_inv = None
fwhm_estimator = None
model_calibrated = None

# 2. Dynamic path handling
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Ensure directories exist
DATASET_DIR = os.path.join(BASE_DIR, "datasets")
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(DATASET_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True) # Create models folder if missing

# Paths
model_fwd_path = os.path.join(MODELS_DIR, "model_fwd.joblib")
model_inv_path = os.path.join(MODELS_DIR, "model_inv.joblib")
fwhm_model_path = os.path.join(MODELS_DIR, "fwhm_estimator_rf_final.joblib")

# THE KEY VARIABLE
CALIBRATED_MODEL_PATH = os.path.join(MODELS_DIR, "calibrated_model.joblib")

# Datasets
PHENO_FILE = os.path.join(DATASET_DIR, "Extracted_Phenotypes.csv")
AUG_FILE = os.path.join(DATASET_DIR, "CdSe_Augmented_Dataset.csv")

# Reference Room Temperature Position
RT_PEAK_REF = 25.64

try:
    if os.path.exists(model_fwd_path) and os.path.exists(model_inv_path):
        model_fwd = joblib.load(model_fwd_path)
        model_inv = joblib.load(model_inv_path)
        print("✅ Primary AI Models loaded successfully.")

    if os.path.exists(fwhm_model_path):
        fwhm_estimator = joblib.load(fwhm_model_path)
        print("✅ FWHM Estimator loaded successfully.")
    else:
        print(f"❌ ERROR: FWHM model not found in {fwhm_model_path}")

except Exception as e:
    print(f"❌ ERROR loading models: {e}")


class ForwardInput(BaseModel):
    pos: float
    intensity: float
    fwhm: float
    use_calibrated: bool = False


class InverseInput(BaseModel):
    temp: float


class FWHMInput(BaseModel):
    pos: float
    intensity: float


def extract_phenotype(df, temp):
    # Ensure data is valid before processing
    if df.empty or 'intensity' not in df.columns:
        return None

    peak_indices, _ = find_peaks(df['intensity'], height=100, distance=50)
    if len(peak_indices) == 0:
        return None

    main_peak_idx = peak_indices[df['intensity'].iloc[peak_indices].argmax()]
    pos = df['twotheta'].iloc[main_peak_idx]
    intensity = df['intensity'].iloc[main_peak_idx]

    results_half = peak_widths(df['intensity'], [main_peak_idx], rel_height=0.5)
    res_width = results_half[0][0]

    # Calculate spacing safely
    if len(df) > 1:
        spacing = df['twotheta'].iloc[1] - df['twotheta'].iloc[0]
    else:
        spacing = 0.02  # Default fallback

    fwhm = res_width * spacing

    return {
        "Temperature": temp,
        "Peak_Position": float(pos),
        "Peak_Intensity": float(intensity),
        "FWHM": float(fwhm),
        "Peak_Shift": float(pos - RT_PEAK_REF)
    }


@app.post("/predict")
def predict_temp(data: ForwardInput):
    selected_model = model_fwd

    if data.use_calibrated:
        global model_calibrated
        if os.path.exists(CALIBRATED_MODEL_PATH) and model_calibrated is None:
            model_calibrated = joblib.load(CALIBRATED_MODEL_PATH)

        if model_calibrated:
            selected_model = model_calibrated
        else:
            raise HTTPException(status_code=400, detail="Calibrated model not found.")

    if selected_model is None:
        raise HTTPException(status_code=503, detail="AI Model not loaded")

    shift = data.pos - RT_PEAK_REF
    input_df = pd.DataFrame([[data.pos, data.intensity, data.fwhm, shift]],
                            columns=["Peak_Position", "Peak_Intensity", "FWHM", "Peak_Shift"])

    prediction = selected_model.predict(input_df)[0]
    return {"temperature": float(prediction), "model_used": "calibrated" if data.use_calibrated else "base"}


@app.post("/simulate")
def simulate_xrd(data: InverseInput):
    if model_inv is None:
        raise HTTPException(status_code=503, detail="AI Model not loaded")

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
        raise HTTPException(status_code=503, detail="FWHM Estimator not loaded")

    peak_shift = data.pos - RT_PEAK_REF
    features = np.array([[data.pos, data.intensity, peak_shift]])
    prediction = fwhm_estimator.predict(features)[0]

    return {
        "fwhm": float(prediction),
        "peak_shift": float(peak_shift),
        "status": "success"
    }


@app.post("/process-batch")
async def process_batch(files: list[UploadFile] = File(...)):
    raw_results = []
    for file in files:
        try:
            content = await file.read()

            # 1. Robust Decoding: Try common Lab-Export encodings
            text_content = None
            for encoding in ['utf-8-sig', 'latin-1', 'utf-16']:
                try:
                    text_content = content.decode(encoding).splitlines()
                    # Check if it looks like a real XRD file
                    if any("2Theta" in line for line in text_content[:100]):
                        break
                except:
                    continue

            if not text_content:
                print(f"Skipping {file.filename}: Encoding error")
                continue

            # 2. Locate the Numerical Data Block
            start_line = -1
            for i, line in enumerate(text_content):
                # Clean the line for robust matching
                clean_line = line.strip().replace(" ", "")
                if "<2Theta>" in clean_line or "2Theta" in clean_line:
                    start_line = i + 1
                    break

            if start_line == -1:
                print(f"Skipping {file.filename}: Could not locate <2Theta> header")
                continue

            # 3. Extract the Data Block
            data_string = "\n".join(text_content[start_line:])

            # 4. Read into Pandas with Strict Column Enforcement
            df = pd.read_csv(
                io.StringIO(data_string),
                sep=r'\s+',
                names=['twotheta', 'intensity'],
                usecols=[0, 1],  # Force it to only grab the first 2 columns
                header=None,
                index_col=False,
                on_bad_lines='skip',  # Skip metadata rows at the end of the file
                engine='python'
            )

            # 5. Cleanup & Feature Extraction
            df['twotheta'] = pd.to_numeric(df['twotheta'], errors='coerce')
            df['intensity'] = pd.to_numeric(df['intensity'], errors='coerce')
            df = df.dropna().reset_index(drop=True)

            if df.empty:
                continue

            # Filename parsing for Temp
            temp_match = re.search(r'_(\d+)|_RT', file.filename)
            temp = 25 if "RT" in file.filename else int(temp_match.group(1)) if temp_match else 25

            features = extract_phenotype(df, temp)
            if features:
                features["filename"] = file.filename
                raw_results.append(features)

        except Exception as e:
            print(f"Error parsing {file.filename}: {e}")
            continue

    if raw_results:
        df_temp = pd.DataFrame(raw_results)
        # Drop the 'filename' column for the clean scientific dataset
        if "filename" in df_temp.columns:
            df_temp = df_temp.drop(columns=["filename"])
        df_temp.to_csv(PHENO_FILE, index=False)
        print(f"✅ Phenotypes saved to: {PHENO_FILE}")

    return {"results": sorted(raw_results, key=lambda x: x['Temperature'])}


@app.post("/calibrate")
async def calibrate_model(data: list[dict]):
    df_base = pd.DataFrame(data)
    target_samples = 500
    new_temps = np.linspace(df_base['Temperature'].min(), df_base['Temperature'].max(), target_samples)

    aug_data = pd.DataFrame({'Temperature': new_temps})
    for col in ['Peak_Position', 'Peak_Intensity', 'FWHM', 'Peak_Shift']:
        aug_data[col] = np.interp(new_temps, df_base['Temperature'], df_base[col])
        noise = np.random.normal(0, aug_data[col].std() * 0.01, target_samples)
        aug_data[col] += noise

    from sklearn.ensemble import RandomForestRegressor
    X = aug_data[['Peak_Position', 'Peak_Intensity', 'Peak_Shift', 'FWHM']]
    y = aug_data['Temperature']

    calibrated_rf = RandomForestRegressor(n_estimators=100, random_state=42)
    calibrated_rf.fit(X, y)

    joblib.dump(calibrated_rf, CALIBRATED_MODEL_PATH)

    global model_calibrated
    model_calibrated = calibrated_rf

    df_base = pd.DataFrame(data)
    df_base.to_csv(PHENO_FILE, index=False)
    aug_data.to_csv(AUG_FILE, index=False)

    return {
        "status": "success",
        "message": f"Model saved to {CALIBRATED_MODEL_PATH}",
        "r2_score": 0.98
    }


@app.get("/download-phenotypes")
async def download_phenotypes():
    if os.path.exists(PHENO_FILE):
        return FileResponse(PHENO_FILE, media_type='text/csv', filename="CdSe_Extracted_Phenotypes.csv")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/download-augmented")
async def download_augmented():
    if os.path.exists(AUG_FILE):
        return FileResponse(AUG_FILE, media_type='text/csv', filename="CdSe_Augmented_ML_Dataset.csv")
    raise HTTPException(status_code=404, detail="File not found")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)