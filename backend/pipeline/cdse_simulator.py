"""
Wurtzite CdSe XRD Pattern Simulator
====================================

Physics-based forward model that generates synthetic Cu-Kα XRD patterns for
wurtzite CdSe thin films as a function of temperature.

Physical effects included:
  1. Bragg's law: 2θ(hkl, a, c, λ)
  2. Anisotropic thermal expansion: a(T), c(T) with separate α_a, α_c
  3. Debye-Waller factor: I(T) = I₀ · exp(-2M(T)) per peak
  4. Caglioti instrumental broadening: β²(2θ) = U tan²θ + V tan θ + W
  5. Size + strain broadening via Williamson-Hall: β·cos θ = Kλ/D + 4ε·sin θ
  6. Pseudo-Voigt peak profiles: η·Lorentzian + (1-η)·Gaussian
  7. Amorphous substrate + linear background
  8. Poisson counting noise

References:
  - Caglioti, Paoletti, Ricci (1958): peak-profile function
  - Williamson & Hall (1953): size-strain decomposition
  - Reeber & Powell (1988): thermal expansion of II-VI semiconductors
  - Zakharov et al. (1994): CdSe lattice parameters (a=4.299 Å, c=7.010 Å)
"""

from __future__ import annotations
import numpy as np
from dataclasses import dataclass, field
from typing import Tuple


# -----------------------------------------------------------------------------
# Physical constants and CdSe reference values
# -----------------------------------------------------------------------------

CU_KALPHA = 1.5418  # Å (weighted Kα1/Kα2 average)

# Wurtzite CdSe at room temperature (zinc-blende polymorph exists but wurtzite
# is more common in thin films per our literature review)
A0_CDSE = 4.299  # Å, in-plane lattice parameter
C0_CDSE = 7.010  # Å, out-of-plane lattice parameter
T0_REF = 298.15  # K, reference temperature (25 °C)

# Thermal expansion coefficients for wurtzite CdSe
# Sources report α_a ≈ 4–5×10⁻⁶ /K, α_c ≈ 2–3×10⁻⁶ /K at room T.
# Above the Debye temperature these are roughly T-independent.
ALPHA_A = 4.5e-6  # /K, in-plane
ALPHA_C = 2.8e-6  # /K, out-of-plane

# Wurtzite CdSe reflections: list of (h, k, l, relative_intensity_at_RT)
# Relative intensities from ICSD pattern match. The (002) and (101) are
# strongest; (103) and (112) are commonly observed in thin films.
WURTZITE_REFLECTIONS = [
    (1, 0, 0, 0.75),   # (100)
    (0, 0, 2, 0.70),   # (002)
    (1, 0, 1, 1.00),   # (101) - strongest
    (1, 0, 2, 0.35),   # (102)
    (1, 1, 0, 0.60),   # (110)
    (1, 0, 3, 0.55),   # (103)
    (2, 0, 0, 0.15),   # (200)
    (1, 1, 2, 0.50),   # (112)
    (2, 0, 1, 0.25),   # (201)
    (0, 0, 4, 0.10),   # (004)
    (2, 0, 2, 0.15),   # (202)
    (1, 0, 4, 0.20),   # (104)
    (2, 0, 3, 0.15),   # (203)
    (2, 1, 0, 0.20),   # (210)
]


# -----------------------------------------------------------------------------
# Physics functions
# -----------------------------------------------------------------------------

def lattice_parameters_at_T(T_celsius: float) -> Tuple[float, float]:
    """Anisotropic thermal expansion for wurtzite CdSe.

    a(T) = a₀ [1 + α_a (T - T_ref)]
    c(T) = c₀ [1 + α_c (T - T_ref)]

    Valid above Debye temperature (~180 K for CdSe), so good for 25–400 °C.
    """
    T_kelvin = T_celsius + 273.15
    dT = T_kelvin - T0_REF
    a = A0_CDSE * (1.0 + ALPHA_A * dT)
    c = C0_CDSE * (1.0 + ALPHA_C * dT)
    return a, c


def d_spacing_wurtzite(h: int, k: int, l: int, a: float, c: float) -> float:
    """Wurtzite d-spacing formula.

    1/d² = (4/3)·(h² + hk + k²)/a²  +  l²/c²
    """
    inv_d2 = (4.0 / 3.0) * (h * h + h * k + k * k) / (a * a) + (l * l) / (c * c)
    return 1.0 / np.sqrt(inv_d2)


def bragg_2theta(d: float, wavelength: float = CU_KALPHA) -> float:
    """Bragg's law: λ = 2d sin θ → 2θ in degrees."""
    sin_theta = wavelength / (2.0 * d)
    if sin_theta >= 1.0:
        return np.nan  # not observable
    return 2.0 * np.degrees(np.arcsin(sin_theta))


def debye_waller_factor(two_theta_deg: float, T_celsius: float,
                        wavelength: float = CU_KALPHA) -> float:
    """Debye-Waller intensity reduction: I(T) = I₀ exp(-2M).

    2M = (8π²/λ²) · ⟨u²(T)⟩ · sin²θ

    Above the Debye temperature, ⟨u²(T)⟩ is approximately linear in T:
        ⟨u²(T)⟩ ≈ ⟨u²(T_ref)⟩ · (T / T_ref)

    For CdSe ⟨u²⟩ ≈ 0.016 Å² at 300 K (Reeber & Powell values).
    """
    T_kelvin = T_celsius + 273.15
    u2_ref = 0.016  # Å² at 300 K
    u2_T = u2_ref * (T_kelvin / 300.0)
    theta_rad = np.radians(two_theta_deg / 2.0)
    sin2_theta = np.sin(theta_rad) ** 2
    M = (8.0 * np.pi ** 2) * u2_T * sin2_theta / (wavelength ** 2)
    # Factor of 2 is already in the "2M" convention
    return float(np.exp(-M))


def caglioti_fwhm(two_theta_deg: float, U: float, V: float, W: float) -> float:
    """Caglioti instrumental FWHM: β² = U tan²θ + V tan θ + W.

    All terms in deg². Returns FWHM in degrees.
    """
    theta_rad = np.radians(two_theta_deg / 2.0)
    tan_theta = np.tan(theta_rad)
    beta_sq = U * tan_theta ** 2 + V * tan_theta + W
    return float(np.sqrt(max(beta_sq, 1e-6)))


def williamson_hall_fwhm(two_theta_deg: float, D_nm: float, strain: float,
                         wavelength: float = CU_KALPHA,
                         K: float = 0.9) -> float:
    """Microstructural FWHM contribution from size and strain.

    β_hkl · cos θ = Kλ/D + 4ε · sin θ

    Returns FWHM contribution in degrees. D in nm, strain dimensionless.
    """
    theta_rad = np.radians(two_theta_deg / 2.0)
    cos_theta = np.cos(theta_rad)
    sin_theta = np.sin(theta_rad)
    # Convert D from nm to Å to match wavelength units
    D_angstrom = D_nm * 10.0
    # β (in radians) = Kλ/(D cos θ) + 4ε tan θ
    beta_rad = K * wavelength / (D_angstrom * cos_theta) + 4.0 * strain * sin_theta / cos_theta
    return float(np.degrees(beta_rad))


def pseudo_voigt(two_theta: np.ndarray, center: float, fwhm: float,
                 eta: float = 0.5) -> np.ndarray:
    """Pseudo-Voigt peak profile: η·Lorentzian + (1-η)·Gaussian, both
    normalized to unit peak height.

    eta ∈ [0, 1]; 0 = pure Gaussian, 1 = pure Lorentzian.
    """
    x = two_theta - center
    # Gaussian with FWHM
    sigma = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    gauss = np.exp(-0.5 * (x / sigma) ** 2)
    # Lorentzian with FWHM
    gamma = fwhm / 2.0
    lorentz = 1.0 / (1.0 + (x / gamma) ** 2)
    return eta * lorentz + (1.0 - eta) * gauss


# -----------------------------------------------------------------------------
# Full pattern simulator
# -----------------------------------------------------------------------------

@dataclass
class SimulatorConfig:
    """All adjustable parameters for the simulator."""
    # Scan geometry
    two_theta_min: float = 20.0
    two_theta_max: float = 80.0
    step: float = 0.02

    # Crystallite microstructure (can be varied to augment data)
    crystallite_size_nm: float = 25.0  # D in Williamson-Hall
    microstrain: float = 0.002          # ε in Williamson-Hall
    eta_pseudo_voigt: float = 0.5       # mixing parameter

    # Instrumental broadening (Caglioti; typical lab diffractometer)
    caglioti_U: float = 0.005
    caglioti_V: float = -0.002
    caglioti_W: float = 0.010

    # Overall peak-height scale (counts)
    scale: float = 10000.0

    # Background
    bg_level: float = 40.0           # flat background (counts)
    bg_slope: float = -0.3           # linear drift (counts per degree)
    bg_amorphous_amp: float = 80.0   # broad amorphous hump (counts)
    bg_amorphous_center: float = 22.0
    bg_amorphous_fwhm: float = 8.0

    # Noise
    poisson_noise: bool = True

    # Peak-position jitter (simulates instrument alignment variation)
    position_jitter_deg: float = 0.0  # σ; 0 = off

    # Intensity jitter per peak (simulates preferred orientation variation)
    intensity_jitter_frac: float = 0.0  # fractional σ; 0 = off


@dataclass
class AugmentationRanges:
    """Ranges for randomized simulator parameters during training-data generation.

    Each pattern drawn from these ranges is a physically plausible variation
    of wurtzite CdSe — different crystallite size, different texture,
    different substrate contribution — but the underlying temperature
    signal is preserved. This is the 'physics-informed augmentation' from
    the proposal.
    """
    # Microstructural variation
    size_nm_range: Tuple[float, float] = (10.0, 50.0)
    microstrain_range: Tuple[float, float] = (0.0005, 0.005)

    # Preferred orientation (per-peak intensity jitter)
    intensity_jitter_frac: float = 0.15   # up to 15% per peak

    # Amorphous background variation (substrate contribution)
    bg_amorphous_amp_range: Tuple[float, float] = (40.0, 150.0)
    bg_amorphous_center_range: Tuple[float, float] = (20.0, 25.0)
    bg_amorphous_fwhm_range: Tuple[float, float] = (5.0, 12.0)
    bg_level_range: Tuple[float, float] = (20.0, 70.0)

    # Instrumental alignment jitter
    position_jitter_deg: float = 0.005

    # Overall scale variation (different sample thicknesses / exposure)
    scale_range: Tuple[float, float] = (5000.0, 15000.0)


# Presets for signal-to-noise scenarios
HIGH_SNR_CONFIG = SimulatorConfig(scale=10000.0, poisson_noise=True)
LOW_SNR_CONFIG = SimulatorConfig(
    scale=300.0,                  # ~30x weaker peaks, matches real data
    bg_level=100.0,               # higher background
    bg_amorphous_amp=80.0,
    crystallite_size_nm=8.0,      # small crystallites → broader peaks
    microstrain=0.008,            # high strain → more broadening
    poisson_noise=True,
)


def sample_augmented_config(base: SimulatorConfig,
                            aug: AugmentationRanges,
                            rng: np.random.Generator) -> SimulatorConfig:
    """Draw one randomized config for training-data generation."""
    # Start from a copy of base
    cfg = SimulatorConfig(**{f: getattr(base, f) for f in base.__dataclass_fields__})
    cfg.crystallite_size_nm = rng.uniform(*aug.size_nm_range)
    cfg.microstrain = rng.uniform(*aug.microstrain_range)
    cfg.bg_amorphous_amp = rng.uniform(*aug.bg_amorphous_amp_range)
    cfg.bg_amorphous_center = rng.uniform(*aug.bg_amorphous_center_range)
    cfg.bg_amorphous_fwhm = rng.uniform(*aug.bg_amorphous_fwhm_range)
    cfg.bg_level = rng.uniform(*aug.bg_level_range)
    cfg.scale = rng.uniform(*aug.scale_range)
    cfg.intensity_jitter_frac = aug.intensity_jitter_frac
    cfg.position_jitter_deg = aug.position_jitter_deg
    return cfg


def simulate_pattern(T_celsius: float,
                     config: SimulatorConfig | None = None,
                     rng: np.random.Generator | None = None
                     ) -> Tuple[np.ndarray, np.ndarray]:
    """Generate a synthetic wurtzite CdSe XRD pattern at temperature T.

    Returns (two_theta, intensity) arrays.
    """
    if config is None:
        config = SimulatorConfig()
    if rng is None:
        rng = np.random.default_rng()

    # 2θ grid
    two_theta = np.arange(config.two_theta_min,
                          config.two_theta_max + config.step / 2.0,
                          config.step)

    # Lattice parameters at this T
    a, c = lattice_parameters_at_T(T_celsius)

    # Build pattern: start with background
    intensity = np.full_like(two_theta, config.bg_level, dtype=float)
    intensity += config.bg_slope * (two_theta - config.two_theta_min)
    # Amorphous hump (broad Gaussian)
    amorph_sigma = config.bg_amorphous_fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    intensity += config.bg_amorphous_amp * np.exp(
        -0.5 * ((two_theta - config.bg_amorphous_center) / amorph_sigma) ** 2
    )

    # Add each Bragg peak
    for (h, k, l, rel_I) in WURTZITE_REFLECTIONS:
        d = d_spacing_wurtzite(h, k, l, a, c)
        tt = bragg_2theta(d)
        if np.isnan(tt) or tt < config.two_theta_min or tt > config.two_theta_max:
            continue

        # Optional peak-position jitter (instrument alignment variation)
        if config.position_jitter_deg > 0.0:
            tt = tt + rng.normal(0.0, config.position_jitter_deg)

        # Intensity: base × Debye-Waller × optional jitter
        dw = debye_waller_factor(tt, T_celsius)
        peak_I = config.scale * rel_I * dw
        if config.intensity_jitter_frac > 0.0:
            peak_I *= max(0.0, 1.0 + rng.normal(0.0, config.intensity_jitter_frac))

        # FWHM: instrumental + microstructural (added in quadrature)
        fwhm_inst = caglioti_fwhm(tt, config.caglioti_U, config.caglioti_V, config.caglioti_W)
        fwhm_micro = williamson_hall_fwhm(tt, config.crystallite_size_nm, config.microstrain)
        fwhm = np.sqrt(fwhm_inst ** 2 + fwhm_micro ** 2)

        # Add peak to pattern
        profile = pseudo_voigt(two_theta, tt, fwhm, config.eta_pseudo_voigt)
        intensity += peak_I * profile

    # Poisson counting noise
    if config.poisson_noise:
        intensity = np.maximum(intensity, 0.0)
        intensity = rng.poisson(intensity).astype(float)

    return two_theta, intensity


# -----------------------------------------------------------------------------
# Smoke test
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import matplotlib.pyplot as plt

    # Show expected peak positions at RT
    print("Wurtzite CdSe reference peak positions at 25 °C:")
    print(f"  {'(hkl)':<8}{'d (Å)':<10}{'2θ (deg)':<12}{'rel I':<8}")
    a, c = lattice_parameters_at_T(25.0)
    print(f"  a = {a:.4f} Å, c = {c:.4f} Å")
    for (h, k, l, rel_I) in WURTZITE_REFLECTIONS:
        d = d_spacing_wurtzite(h, k, l, a, c)
        tt = bragg_2theta(d)
        if 20 <= tt <= 80:
            print(f"  ({h}{k}{l})   {d:<10.4f}{tt:<12.3f}{rel_I:<8.2f}")

    # ------------------------------------------------------------------
    # Figure 1: Clean baseline at 5 temperatures (same config each)
    # ------------------------------------------------------------------
    temps = [25, 100, 200, 300, 400]
    fig, axes = plt.subplots(2, 1, figsize=(12, 9))
    colors = plt.cm.plasma(np.linspace(0, 0.9, len(temps)))

    for T, color in zip(temps, colors):
        tt, I = simulate_pattern(T, HIGH_SNR_CONFIG,
                                  rng=np.random.default_rng(hash(("clean", T)) & 0xffff))
        axes[0].plot(tt, I, label=f"{T} °C", color=color, lw=0.8, alpha=0.85)
        mask = (tt >= 23) & (tt <= 30)
        axes[1].plot(tt[mask], I[mask], label=f"{T} °C", color=color, lw=1.0)

    axes[0].set_xlabel("2θ (deg)"); axes[0].set_ylabel("Intensity (counts)")
    axes[0].set_title("Clean simulated wurtzite CdSe (high SNR, fixed microstructure)")
    axes[0].legend(fontsize=9); axes[0].grid(alpha=0.3)
    axes[1].set_xlabel("2θ (deg)"); axes[1].set_ylabel("Intensity (counts)")
    axes[1].set_title("Zoom: main triplet (100)/(002)/(101)")
    axes[1].legend(fontsize=9); axes[1].grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig("/home/claude/analysis/sim_clean.png", dpi=110)
    plt.close()

    # ------------------------------------------------------------------
    # Figure 2: Augmented — 6 patterns at 200 °C, all with varied
    # microstructure and background. Temperature is held constant so
    # you can see pure augmentation variance.
    # ------------------------------------------------------------------
    aug = AugmentationRanges()
    rng = np.random.default_rng(0)
    fig, ax = plt.subplots(figsize=(12, 6))
    for i in range(6):
        cfg = sample_augmented_config(HIGH_SNR_CONFIG, aug, rng)
        tt, I = simulate_pattern(200.0, cfg, rng=rng)
        ax.plot(tt, I, lw=0.7, alpha=0.7,
                label=f"D={cfg.crystallite_size_nm:.0f} nm, "
                      f"ε={cfg.microstrain*1000:.1f}e-3")
    ax.set_xlabel("2θ (deg)"); ax.set_ylabel("Intensity (counts)")
    ax.set_title("Augmented patterns at 200 °C "
                 "(varied crystallite size, strain, texture, background)")
    ax.legend(fontsize=8, ncol=2); ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig("/home/claude/analysis/sim_augmented.png", dpi=110)
    plt.close()

    # ------------------------------------------------------------------
    # Figure 3: Low-SNR preset vs clean baseline at same 5 temperatures
    # This is the "realistic" simulation mode that parallels your real data.
    # ------------------------------------------------------------------
    fig, axes = plt.subplots(2, 1, figsize=(12, 9))
    for T, color in zip(temps, colors):
        tt, I = simulate_pattern(T, LOW_SNR_CONFIG,
                                  rng=np.random.default_rng(hash(("lowsnr", T)) & 0xffff))
        axes[0].plot(tt, I, label=f"{T} °C", color=color, lw=0.6, alpha=0.85)
        mask = (tt >= 23) & (tt <= 30)
        axes[1].plot(tt[mask], I[mask], label=f"{T} °C", color=color, lw=0.9)
    axes[0].set_xlabel("2θ (deg)"); axes[0].set_ylabel("Intensity (counts)")
    axes[0].set_title("Low-SNR simulated patterns (parallels real-data quality)")
    axes[0].legend(fontsize=9); axes[0].grid(alpha=0.3)
    axes[1].set_xlabel("2θ (deg)"); axes[1].set_ylabel("Intensity (counts)")
    axes[1].set_title("Zoom: main triplet — peaks are now closer to noise floor")
    axes[1].legend(fontsize=9); axes[1].grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig("/home/claude/analysis/sim_lowsnr.png", dpi=110)
    plt.close()

    print("\nSaved three figures in /home/claude/analysis/:")
    print("  sim_clean.png     — high-SNR baseline, 5 temperatures")
    print("  sim_augmented.png — 6 patterns at 200°C with randomized microstructure")
    print("  sim_lowsnr.png    — low-SNR preset parallel to real data")
