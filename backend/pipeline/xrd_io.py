"""Reading 2-column XRD scans as exported by lab diffractometers.

The user-facing input to the whole system is one of these files, so parsing has
to cope with real exports rather than an idealised two-column CSV.
"""
from __future__ import annotations

from typing import List, Tuple

import numpy as np

# Tried in order. Shimadzu/Rigaku ASCII dumps are usually latin-1; some
# lab tools re-save as UTF-16 with a BOM.
ENCODINGS = ("utf-8-sig", "utf-16", "latin-1")

# The literal column header that marks the start of the data block.
DATA_MARKER = "<2theta>"

# How many consecutive numeric rows must follow a line before we believe it is
# the true start of the data block.
_RUN_LENGTH = 20


class XRDParseError(ValueError):
    """Raised when a file holds no recognisable 2-column scan."""


def decode(raw: bytes) -> str:
    for encoding in ENCODINGS:
        try:
            text = raw.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
        # A mis-guessed encoding usually shows up as interleaved NULs.
        if "\x00" not in text:
            return text
    return raw.decode("latin-1", errors="replace")


def _row_values(line: str) -> List[float]:
    """Parse a line as whitespace- or comma-separated floats, else []."""
    parts = line.replace(",", " ").split()
    if len(parts) < 2:
        return []
    values = []
    for part in parts[:2]:
        try:
            values.append(float(part))
        except ValueError:
            return []
    return values


def _find_data_start(lines: List[str]) -> int:
    """Index of the first data row.

    Prefer the explicit `<2Theta>` column header. Matching on a bare "2theta"
    substring is not safe: these files carry a `drive axis = Theta-2Theta`
    line in the measurement-condition block, well above the real data.
    """
    for i, line in enumerate(lines):
        if DATA_MARKER in line.lower().replace(" ", ""):
            return i + 1

    # No marker: take the first sustained run of numeric rows, which skips
    # stray numbers in the metadata header (voltage, slit widths, and so on).
    for i in range(len(lines)):
        if all(_row_values(lines[j]) for j in range(i, min(i + _RUN_LENGTH, len(lines)))):
            return i
    raise XRDParseError(
        "No 2-column numeric data found. Expected a diffractometer ASCII "
        "export with a <2Theta> column header, or a plain 2-column file of "
        "2theta (deg) and intensity (counts)."
    )


def parse_xrd_text(text: str) -> Tuple[np.ndarray, np.ndarray]:
    """Return (two_theta, intensity) from a scan file's text.

    Raises XRDParseError if the file holds no usable scan.
    """
    lines = text.splitlines()
    start = _find_data_start(lines)

    two_theta: List[float] = []
    intensity: List[float] = []
    for line in lines[start:]:
        if not line.strip():
            continue
        values = _row_values(line)
        if not values:
            # Trailing metadata block; the scan itself is over.
            break
        two_theta.append(values[0])
        intensity.append(values[1])

    if len(two_theta) < 100:
        raise XRDParseError(
            f"Only {len(two_theta)} data points found; a usable scan needs at "
            "least 100. Check that the file is a full 2theta scan and not an "
            "excerpt or a peak list."
        )

    return np.asarray(two_theta, dtype=float), np.asarray(intensity, dtype=float)


def parse_xrd_bytes(raw: bytes) -> Tuple[np.ndarray, np.ndarray]:
    return parse_xrd_text(decode(raw))
