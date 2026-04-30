import re
from typing import Any


def parse_timecode(value: str, fps: float) -> float:
    if value is None:
        raise ValueError("Timecode value is None")
    tc = value.strip()
    if not tc:
        raise ValueError("Empty timecode")

    tc = tc.replace(";", ":")

    plain_sec_match = re.fullmatch(r"\d+(?:[\.,]\d+)?", tc)
    if plain_sec_match:
        return float(tc.replace(",", "."))

    parts = tc.split(":")
    if len(parts) == 4:
        hh, mm, ss, ff = parts
        h = int(hh)
        m = int(mm)
        s = int(ss)
        frames = int(ff)
        if fps <= 0:
            raise ValueError("fps must be > 0 for HH:MM:SS:FF parsing")
        total = h * 3600 + m * 60 + s + frames / fps
        return float(total)
    if len(parts) == 3:
        hh, mm, ss = parts
        h = int(hh)
        m = int(mm)
        s = float(ss)
        return float(h * 3600 + m * 60 + s)
    if len(parts) == 2:
        mm, ss = parts
        m = int(mm)
        s = float(ss)
        return float(m * 60 + s)
    raise ValueError(f"Unsupported timecode format: {value}")


def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except Exception:
        return default
