const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

/** Status returned per scan. Drives everything the UI is allowed to show. */
export type AnalysisStatus = 'ok' | 'degraded' | 'out_of_distribution' | 'error';

export interface QualityReport {
  n_peaks_fitted: number;
  wh_r2: number | null;
  degraded_fits: string[];
}

export interface ScanPoint {
  twoTheta: number;
  intensity: number;
}

export interface ScanMeta {
  n_points: number;
  two_theta_min: number;
  two_theta_max: number;
  step: number;
  preview: ScanPoint[];
}

export interface AnalysisResult {
  filename: string;
  status: AnalysisStatus;
  status_detail: string;
  T_predicted: number | null;
  T_uncertainty: number | null;
  features: Record<string, number | null> | null;
  quality_report: QualityReport | null;
  ood_distance: number | null;
  any_feature_imputed?: boolean;
  scan?: ScanMeta;
}

export interface Health {
  ready: boolean;
  error?: string;
  hint?: string;
  models: string[];
  default_model?: string;
  uncertainty_model?: string;
  /** False when the uncertainty model is a reconstruction that misses the
   *  published benchmark, so its intervals must not be presented as validated. */
  uncertainty_validated?: boolean;
  has_inverse_model?: boolean;
  ood_threshold?: number;
  n_features?: number;
  feature_names?: string[];
  temperature_range_c?: [number, number];
  scan_geometry?: string;
  caglioti_UVW?: [number, number, number] | null;
}

export interface SignaturePeak {
  hkl: string;
  position: number;
  fwhm: number;
  height: number;
}

export interface SignatureResponse {
  temperature: number;
  lattice: { a: number; c: number; volume: number };
  peaks: SignaturePeak[];
  two_theta_range: [number, number];
  ml_features: Record<string, number> | null;
}

export interface TrainingStats {
  features: { name: string; mean: number; std: number }[];
  ood_threshold: number;
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // Response wasn't JSON; the status line is the best we have.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function fetchHealth(): Promise<Health> {
  return unwrap<Health>(await fetch(`${BASE_URL}/health`));
}

export async function analyzeScans(
  files: File[],
  modelName: string,
): Promise<{ results: AnalysisResult[]; model_used: string; ood_threshold: number }> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  const url = `${BASE_URL}/analyze?model_name=${encodeURIComponent(modelName)}`;
  return unwrap(await fetch(url, { method: 'POST', body: form }));
}

export async function fetchSignature(
  temp: number,
  crystalliteSizeNm: number,
  microstrain: number,
): Promise<SignatureResponse> {
  return unwrap<SignatureResponse>(
    await fetch(`${BASE_URL}/simulate-signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temp,
        crystallite_size_nm: crystalliteSizeNm,
        microstrain,
      }),
    }),
  );
}

export async function fetchTrainingStats(): Promise<TrainingStats> {
  return unwrap<TrainingStats>(await fetch(`${BASE_URL}/training-stats`));
}
