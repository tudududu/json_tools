from __future__ import annotations

import re
from typing import List, Tuple

from .timecode import format_time_frames, format_time_ms

HEADER = ["Start Time", "End Time", "Text"]

_TIME_RE = re.compile(
    r"^(?P<h1>\d{2}):(?P<m1>\d{2}):(?P<s1>\d{2})[,.](?P<ms1>\d{3})\s*-->\s*"
    r"(?P<h2>\d{2}):(?P<m2>\d{2}):(?P<s2>\d{2})[,.](?P<ms2>\d{3})\s*$"
)


def parse_srt(lines: List[str]) -> List[Tuple[float, float, str]]:
    """Parse SRT lines into a list of (start_seconds, end_seconds, text)."""
    records: List[Tuple[float, float, str]] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip("\r\n")
        m = _TIME_RE.match(line)
        if not m:
            i += 1
            continue
        h1 = int(m.group("h1"))
        m1 = int(m.group("m1"))
        s1 = int(m.group("s1"))
        ms1 = int(m.group("ms1"))
        h2 = int(m.group("h2"))
        m2 = int(m.group("m2"))
        s2 = int(m.group("s2"))
        ms2 = int(m.group("ms2"))
        start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000.0
        end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0

        i += 1
        text_lines: List[str] = []
        while i < n:
            lt = lines[i].rstrip("\r\n")
            if lt.strip() == "":
                break
            text_lines.append(lt)
            i += 1
        while i < n and lines[i].strip() == "":
            i += 1
        text = "\n".join(text_lines)
        records.append((start, end, text))
    return records


def records_to_rows(
    records: List[Tuple[float, float, str]], fps: float, out_format: str
) -> List[List[str]]:
    rows: List[List[str]] = []
    for start, end, text in records:
        if out_format == "frames":
            start_str = format_time_frames(start, fps)
            end_str = format_time_frames(end, fps)
        elif out_format == "ms":
            start_str = format_time_ms(start)
            end_str = format_time_ms(end)
        else:
            raise ValueError("out_format must be 'frames' or 'ms'")
        rows.append([start_str, end_str, text])
    return rows
