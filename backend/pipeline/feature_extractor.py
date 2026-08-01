"""
Feature Extractor for Wurtzite CdSe XRD Patterns
=================================================

Converts raw (2θ, intensity) arrays into physics-informed features:

  Per-peak features:
    - peak_pos_XXX     : fitted 2θ position (deg)
    - peak_fwhm_XXX    : fitted FWHM (deg)
    - peak_height_XXX  : fitted peak height (counts above background)
    - peak_eta_XXX     : Pseudo-Voigt mixing (0=Gaussian, 1=Lorentzian)

  Derived crystallographic features:
    - a_param          : in-plane lattice parameter (Å) from (100)
    - c_param          : out-of-plane lattice parameter (Å) from (002)
    - unit_cell_volume : a² c sin(60°) (Å³)

  Williamson-Hall features (from all visible peaks):
    - wh_size_nm       : crystallite size D
    - wh_strain        : microstrain ε
    - wh_r2            : fit quality of the W-H line

  Intensity ratios (texture sensitivity):
    - ratio_002_100    : I(002)/I(100) -- c-axis vs a-axis texture
    - ratio_101_002    : I(101)/I(002) -- sensitive to preferred orientation

Design notes
------------
1. We fit six peaks by default: the main triplet (100)/(002)/(101) which
   sits in the 23°–28° window, plus three higher-angle peaks
   (110)/(103)/(112) which span 42°–50°. The higher-angle peaks are
   essential for a meaningful Williamson-Hall fit (broad 4·sinθ range).

2. Fitting strategy:
     a) scipy.signal.find_peaks to locate candidates
     b) fit Pseudo-Voigt to each candidate with scipy.optimize.curve_fit
     c) if curve_fit fails / diverges / gives unphysical values, fall back
        to the find_peaks position and peak_widths FWHM.
   This gives precision when data is clean, robustness when it isn't.

3. Lattice parameters use only (100) → a, and (002) → c. These are the
   "pure" reflections (one non-zero index along each axis), so the
   inversion is direct. Mixed-index peaks like (101) depend on both.

4. A QualityReport is returned alongside features so the web system can
   decide whether to trust the prediction.
"""

from __future__ import annotations
import numpy as np
from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, Any, List, Tuple
from scipy.signal import find_peaks, peak_widths
from scipy.optimize import curve_fit


# -----------------------------------------------------------------------------
# Target peaks for wurtzite CdSe feature extraction
# -----------------------------------------------------------------------------

# Each entry: hkl tuple, nominal 2θ at RT (deg), search half-window (deg)
TARGET_PEAKS = [
    ((1, 0, 0), 23.900, 0.8),
    ((0, 0, 2), 25.411, 0.8),
    ((1, 0, 1), 27.119, 0.8),
    ((1, 1, 0), 42.034, 1.0),
    ((1, 0, 3), 45.848, 1.0),
    ((1, 1, 2), 49.759, 1.0),
]

CU_KALPHA = 1.5418  # Å


# -----------------------------------------------------------------------------
# Peak-profile fitting
# -----------------------------------------------------------------------------

def pseudo_voigt_plus_linear(x: np.ndarray,
                              amp: float, center: float, fwhm: float,
                              eta: float, bg0: float, bg1: float) -> np.ndarray:
    """Pseudo-Voigt peak + local linear background."""
    fwhm = max(fwhm, 1e-4)
    eta = float(np.clip(eta, 0.0, 1.0))
    sigma = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    gamma = fwhm / 2.0
    gauss = np.exp(-0.5 * ((x - center) / sigma) ** 2)
    lorentz = 1.0 / (1.0 + ((x - center) / gamma) ** 2)
    return amp * (eta * lorentz + (1.0 - eta) * gauss) + bg0 + bg1 * (x - center)


@dataclass
class PeakFit:
    hkl: Tuple[int, int, int]
    position: float          # deg
    fwhm: float              # deg
    height: float            # counts above local background
    eta: float               # Pseudo-Voigt mixing
    position_stderr: float   # deg, from covariance matrix
    fit_method: str          # "curve_fit" or "find_peaks_fallback"
    success: bool            # True if fit converged and values are physical


def _find_peak_candidate(two_theta: np.ndarray, intensity: np.ndarray,
                          target_2t: float, window: float
                          ) -> Optional[Tuple[int, float]]:
    """Locate a peak in a window around target_2t. Returns (index, height)
    of the highest local maximum, or None if no candidate is found."""
    mask = (two_theta >= target_2t - window) & (two_theta <= target_2t + window)
    if not mask.any():
        return None
    idx_local = np.where(mask)[0]
    # Background estimate: median of extreme 20% of window
    bg_estimate = np.percentile(intensity[idx_local], 25)
    # Require peak prominence above noise floor
    min_prom = max(3.0 * np.sqrt(max(bg_estimate, 1.0)), 5.0)

    peaks, props = find_peaks(
        intensity[idx_local],
        prominence=min_prom,
        distance=5,
    )
    if len(peaks) == 0:
        return None
    # Pick the highest peak in the window
    best = peaks[np.argmax(props["prominences"])]
    global_idx = idx_local[best]
    return global_idx, float(intensity[global_idx] - bg_estimate)


def fit_single_peak(two_theta: np.ndarray, intensity: np.ndarray,
                    hkl: Tuple[int, int, int],
                    target_2t: float, window: float) -> PeakFit:
    """Fit a Pseudo-Voigt + linear background to a single peak.

    Falls back to find_peaks + peak_widths if curve_fit fails or produces
    unphysical parameters.
    """
    cand = _find_peak_candidate(two_theta, intensity, target_2t, window)
    if cand is None:
        return PeakFit(
            hkl=hkl, position=np.nan, fwhm=np.nan, height=np.nan, eta=np.nan,
            position_stderr=np.nan, fit_method="no_candidate", success=False,
        )
    idx0, height_guess = cand
    center_guess = float(two_theta[idx0])

    # Isolate a fitting window
    mask = (two_theta >= center_guess - window) & (two_theta <= center_guess + window)
    x_fit = two_theta[mask]
    y_fit = intensity[mask]
    if len(x_fit) < 8:
        return PeakFit(
            hkl=hkl, position=center_guess, fwhm=np.nan, height=float(height_guess),
            eta=np.nan, position_stderr=np.nan, fit_method="too_few_points",
            success=False,
        )

    # Initial guess & bounds for curve_fit
    # FWHM guess from find_peaks peak_widths
    try:
        local_peak_idx = int(np.argmax(y_fit))
        widths = peak_widths(y_fit, [local_peak_idx], rel_height=0.5)
        step = float(x_fit[1] - x_fit[0])
        fwhm_guess = max(float(widths[0][0]) * step, 0.05)
    except Exception:
        fwhm_guess = 0.15

    bg_guess = float(np.percentile(y_fit, 25))
    amp_guess = max(float(y_fit.max() - bg_guess), 1.0)

    p0 = [amp_guess, center_guess, fwhm_guess, 0.5, bg_guess, 0.0]
    lower = [0.0, center_guess - window / 2.0, 0.02, 0.0,
             -np.inf, -np.inf]
    upper = [10.0 * amp_guess + 1.0, center_guess + window / 2.0, 2.0 * window,
             1.0, np.inf, np.inf]

    try:
        popt, pcov = curve_fit(
            pseudo_voigt_plus_linear, x_fit, y_fit,
            p0=p0, bounds=(lower, upper), maxfev=5000,
        )
        amp, center, fwhm, eta, _, _ = popt
        # Parameter uncertainty from covariance
        try:
            perr = np.sqrt(np.diag(pcov))
            pos_stderr = float(perr[1])
        except Exception:
            pos_stderr = np.nan

        # Sanity-check the fit
        physical = (
            amp > 0.0 and
            fwhm > 0.02 and fwhm < 2.0 * window and
            abs(center - center_guess) < window and
            0.0 <= eta <= 1.0
        )
        if physical:
            return PeakFit(
                hkl=hkl, position=float(center), fwhm=float(fwhm),
                height=float(amp), eta=float(eta),
                position_stderr=pos_stderr, fit_method="curve_fit", success=True,
            )
    except Exception:
        pass

    # Fallback: find_peaks position + peak_widths FWHM
    try:
        widths = peak_widths(intensity, [idx0], rel_height=0.5)
        step = float(two_theta[1] - two_theta[0])
        fwhm_fb = float(widths[0][0]) * step
        return PeakFit(
            hkl=hkl, position=center_guess, fwhm=fwhm_fb,
            height=float(height_guess), eta=0.5,
            position_stderr=step,   # conservative: one step size
            fit_method="find_peaks_fallback", success=True,
        )
    except Exception:
        return PeakFit(
            hkl=hkl, position=center_guess, fwhm=np.nan,
            height=float(height_guess), eta=np.nan,
            position_stderr=np.nan, fit_method="fallback_failed", success=False,
        )


# -----------------------------------------------------------------------------
# Crystallographic quantities
# -----------------------------------------------------------------------------

def lattice_params_from_peaks(peaks: Dict[Tuple[int, int, int], PeakFit],
                              wavelength: float = CU_KALPHA
                              ) -> Tuple[float, float]:
    """Extract wurtzite a, c from (100) and (002) positions via Bragg inversion.

    For (100): 1/d² = (4/3)/a²  →  a = 2d/√3
    For (002): 1/d² = 4/c²      →  c = 2·d
    """
    a = np.nan
    c = np.nan
    fit100 = peaks.get((1, 0, 0))
    if fit100 and fit100.success and np.isfinite(fit100.position):
        theta_rad = np.radians(fit100.position / 2.0)
        d_100 = wavelength / (2.0 * np.sin(theta_rad))
        a = d_100 * 2.0 / np.sqrt(3.0)

    fit002 = peaks.get((0, 0, 2))
    if fit002 and fit002.success and np.isfinite(fit002.position):
        theta_rad = np.radians(fit002.position / 2.0)
        d_002 = wavelength / (2.0 * np.sin(theta_rad))
        c = d_002 * 2.0

    return float(a), float(c)


def williamson_hall_fit(peaks: Dict[Tuple[int, int, int], PeakFit],
                        wavelength: float = CU_KALPHA,
                        K: float = 0.9,
                        caglioti_UVW: Optional[Tuple[float, float, float]] = None
                        ) -> Tuple[float, float, float]:
    """Fit β·cos θ = Kλ/D + 4ε·sin θ on all successful peaks.

    If caglioti_UVW = (U, V, W) is provided, the measured FWHM is
    deconvolved from instrumental broadening before fitting:
        β_sample² = β_measured² − β_instrument²(θ)

    Returns (D_nm, strain, r_squared). D is NaN if not enough peaks.
    """
    xs, ys = [], []
    for fit in peaks.values():
        if not fit.success or not np.isfinite(fit.fwhm) or fit.fwhm <= 0:
            continue
        theta_rad = np.radians(fit.position / 2.0)

        # Deconvolve instrumental broadening if UVW supplied
        beta_measured = fit.fwhm  # deg
        if caglioti_UVW is not None:
            U, V, W = caglioti_UVW
            tan_t = np.tan(theta_rad)
            beta_inst_sq = U * tan_t ** 2 + V * tan_t + W  # deg²
            beta_sample_sq = beta_measured ** 2 - max(beta_inst_sq, 0.0)
            if beta_sample_sq <= 0:
                continue  # broadening is purely instrumental; skip this point
            beta_deg = np.sqrt(beta_sample_sq)
        else:
            beta_deg = beta_measured

        beta_rad = np.radians(beta_deg)
        xs.append(4.0 * np.sin(theta_rad))
        ys.append(beta_rad * np.cos(theta_rad))

    if len(xs) < 3:
        return np.nan, np.nan, np.nan

    xs = np.array(xs)
    ys = np.array(ys)
    try:
        slope, intercept = np.polyfit(xs, ys, 1)
    except Exception:
        return np.nan, np.nan, np.nan

    y_pred = slope * xs + intercept
    ss_res = float(np.sum((ys - y_pred) ** 2))
    ss_tot = float(np.sum((ys - ys.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else np.nan

    strain = float(slope)
    if intercept > 0:
        D_angstrom = K * wavelength / intercept
        D_nm = D_angstrom / 10.0
    else:
        D_nm = np.nan

    return D_nm, strain, r2


# -----------------------------------------------------------------------------
# Top-level feature extractor
# -----------------------------------------------------------------------------

@dataclass
class QualityReport:
    n_peaks_found: int
    n_peaks_fitted: int
    wh_r2: float
    degraded_fits: List[str] = field(default_factory=list)

    @property
    def is_reliable(self) -> bool:
        """Heuristic: at least 4 successful fits, W-H R² > 0.8."""
        return (self.n_peaks_fitted >= 4 and
                np.isfinite(self.wh_r2) and self.wh_r2 > 0.8)


def extract_features(two_theta: np.ndarray, intensity: np.ndarray,
                     wavelength: float = CU_KALPHA,
                     target_peaks: Optional[List] = None,
                     caglioti_UVW: Optional[Tuple[float, float, float]] = None
                     ) -> Tuple[Dict[str, float], QualityReport]:
    """Full feature extraction pipeline.

    Parameters
    ----------
    caglioti_UVW : (U, V, W) or None
        If supplied, instrumental broadening is deconvolved before
        Williamson-Hall analysis. Should match the diffractometer used.
        For this project we pass the Caglioti parameters from the
        simulator so W-H recovers true sample-only size & strain.

    Returns
    -------
    features : dict
        Flat dict ready for DataFrame construction or ML input.
    quality : QualityReport
        Diagnostics about the extraction.
    """
    if target_peaks is None:
        target_peaks = TARGET_PEAKS

    peaks: Dict[Tuple[int, int, int], PeakFit] = {}
    degraded: List[str] = []
    n_found = 0
    for hkl, target_2t, window in target_peaks:
        fit = fit_single_peak(two_theta, intensity, hkl, target_2t, window)
        peaks[hkl] = fit
        if fit.fit_method != "no_candidate":
            n_found += 1
        if fit.fit_method == "find_peaks_fallback":
            degraded.append(f"{''.join(map(str, hkl))}: fallback")
        elif fit.fit_method in ("no_candidate", "fallback_failed", "too_few_points"):
            degraded.append(f"{''.join(map(str, hkl))}: {fit.fit_method}")

    # Crystallographic derivations
    a, c = lattice_params_from_peaks(peaks, wavelength)
    if np.isfinite(a) and np.isfinite(c):
        unit_cell_volume = a * a * c * np.sin(np.radians(60.0))
    else:
        unit_cell_volume = np.nan

    # Williamson-Hall (with optional instrumental deconvolution)
    D_nm, strain, wh_r2 = williamson_hall_fit(peaks, wavelength,
                                               caglioti_UVW=caglioti_UVW)

    # Build flat feature dict
    features: Dict[str, float] = {}
    for (hkl, fit) in peaks.items():
        tag = "".join(map(str, hkl))
        features[f"peak_pos_{tag}"] = fit.position
        features[f"peak_fwhm_{tag}"] = fit.fwhm
        features[f"peak_height_{tag}"] = fit.height
        features[f"peak_eta_{tag}"] = fit.eta

    features["a_param"] = a
    features["c_param"] = c
    features["unit_cell_volume"] = unit_cell_volume
    features["wh_size_nm"] = D_nm
    features["wh_strain"] = strain
    features["wh_r2"] = wh_r2

    # Intensity ratios (texture-sensitive)
    h_100 = features["peak_height_100"]
    h_002 = features["peak_height_002"]
    h_101 = features["peak_height_101"]
    features["ratio_002_100"] = h_002 / h_100 if h_100 and h_100 > 0 else np.nan
    features["ratio_101_002"] = h_101 / h_002 if h_002 and h_002 > 0 else np.nan

    n_fitted = sum(1 for f in peaks.values() if f.success)
    quality = QualityReport(
        n_peaks_found=n_found,
        n_peaks_fitted=n_fitted,
        wh_r2=wh_r2,
        degraded_fits=degraded,
    )
    return features, quality


# -----------------------------------------------------------------------------
# Smoke test
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from cdse_simulator import (simulate_pattern, HIGH_SNR_CONFIG, LOW_SNR_CONFIG,
                                 AugmentationRanges, sample_augmented_config)

    # Caglioti UVW of the simulator (used for deconvolution during W-H).
    # On real data, these would be measured once from a LaB6 standard.
    UVW_SIM = (HIGH_SNR_CONFIG.caglioti_U,
               HIGH_SNR_CONFIG.caglioti_V,
               HIGH_SNR_CONFIG.caglioti_W)

    temps = [25, 100, 200, 300, 400]

    print("=" * 78)
    print("Test 1: Extraction on CLEAN simulated patterns (with UVW deconvolution)")
    print("=" * 78)
    rng = np.random.default_rng(42)
    for T in temps:
        tt, I = simulate_pattern(T, HIGH_SNR_CONFIG,
                                  rng=np.random.default_rng(hash(("clean", T)) & 0xffff))
        feats, qual = extract_features(tt, I, caglioti_UVW=UVW_SIM)
        print(f"\nT = {T} °C  (peaks: {qual.n_peaks_fitted}/6 fitted, "
              f"W-H R²={qual.wh_r2:.3f})")
        print(f"  a = {feats['a_param']:.4f} Å,  c = {feats['c_param']:.4f} Å,  "
              f"V = {feats['unit_cell_volume']:.3f} Å³")
        print(f"  W-H: D = {feats['wh_size_nm']:.1f} nm, ε = {feats['wh_strain']:.4f}")
        print(f"  (100) pos = {feats['peak_pos_100']:.4f}, "
              f"(002) pos = {feats['peak_pos_002']:.4f}, "
              f"(101) pos = {feats['peak_pos_101']:.4f}")

    print()
    print("=" * 78)
    print("Test 2: Extraction on AUGMENTED patterns (200 °C, 6 draws)")
    print("Should recover injected D and ε values when R² is good")
    print("=" * 78)
    aug = AugmentationRanges()
    for i in range(6):
        cfg = sample_augmented_config(HIGH_SNR_CONFIG, aug, rng)
        tt, I = simulate_pattern(200.0, cfg, rng=rng)
        feats, qual = extract_features(tt, I, caglioti_UVW=UVW_SIM)
        print(f"  Draw {i+1}: true D={cfg.crystallite_size_nm:5.1f}, "
              f"ε={cfg.microstrain:.4f} | "
              f"recovered D={feats['wh_size_nm']:5.1f} nm, "
              f"ε={feats['wh_strain']:.4f}, R²={feats['wh_r2']:.3f}")

    print()
    print("=" * 78)
    print("Test 3: Extraction on LOW-SNR patterns (mimics real-data quality)")
    print("=" * 78)
    for T in temps:
        tt, I = simulate_pattern(T, LOW_SNR_CONFIG,
                                  rng=np.random.default_rng(hash(("low", T)) & 0xffff))
        feats, qual = extract_features(tt, I, caglioti_UVW=UVW_SIM)
        reliable = "OK" if qual.is_reliable else "DEGRADED"
        print(f"T={T:4d} °C  [{reliable}]  fit {qual.n_peaks_fitted}/6, "
              f"W-H R²={qual.wh_r2:.3f}, D={feats['wh_size_nm']:.1f} nm, "
              f"ε={feats['wh_strain']:.4f}")

    print()
    print("=" * 78)
    print("Test 4: Extraction on REAL experimental files (no UVW — unknown instrument)")
    print("=" * 78)
    import io
    files = {'RT':25,'100':100,'200':200,'300':300,'400':400}
    for lbl, T in files.items():
        path = f'/mnt/project/CdSeA_{lbl}.txt'
        with open(path) as f:
            lines = f.readlines()
        start = next(i for i,l in enumerate(lines) if "<2Theta>" in l) + 1
        data = np.loadtxt(io.StringIO("".join(lines[start:])))
        tt, I = data[:,0], data[:,1]
        # For real data the real instrument's UVW is unknown; we skip deconvolution
        feats, qual = extract_features(tt, I, caglioti_UVW=None)
        reliable = "OK" if qual.is_reliable else "DEGRADED"
        print(f"T (assumed) = {T:4d} °C  [{reliable}]  fit {qual.n_peaks_fitted}/6, "
              f"W-H R²={qual.wh_r2:.3f}")
        if qual.degraded_fits:
            print(f"    degraded: {qual.degraded_fits}")
        print(f"    (002) pos = {feats['peak_pos_002']:.4f},  "
              f"a = {feats['a_param']:.4f} Å,  c = {feats['c_param']:.4f} Å")
