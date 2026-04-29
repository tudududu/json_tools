from __future__ import annotations

import re

FRAME_TC_RE = re.compile(r"^\d{2}:\d{2}:\d{2}:\d{2}$")
MS_TC_RE = re.compile(r"^\d{2}:\d{2}:\d{2}[,.]\d{3}$")


def format_time_frames(seconds: float, fps: float) -> str:
    """Format time as HH:MM:SS:FF using nearest-frame rounding."""
    if fps <= 0:
        raise ValueError("fps must be > 0 for frames output")
    sec_int = int(seconds)
    frac = seconds - sec_int
    frames = int(round(frac * fps))
    if frames >= int(fps):
        sec_int += 1
        frames -= int(fps)
    h = sec_int // 3600
    rem = sec_int % 3600
    m = rem // 60
    s = rem % 60
    return f"{h:02d}:{m:02d}:{s:02d}:{frames:02d}"


def format_time_ms(seconds: float) -> str:
    """Format time as HH:MM:SS,SSS with millisecond rounding."""
    sec_int = int(seconds)
    frac = seconds - sec_int
    ms = int(round(frac * 1000))
    if ms >= 1000:
        sec_int += 1
        ms -= 1000
    h = sec_int // 3600
    rem = sec_int % 3600
    m = rem // 60
    s = rem % 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def resolve_output_type(out_path: str, explicit_output_type: str | None) -> str:
    """Resolve output container from explicit flag or file extension."""
    if explicit_output_type:
        return explicit_output_type
    if out_path.lower().endswith(".xlsx"):
        return "xlsx"
    return "csv"
