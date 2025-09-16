#!/usr/bin/env python3
"""
CSV → JSON subtitle converter

Converts CSV with columns: Start Time, End Time, Text (and optional Layer ID)
into a JSON file matching the schema:

{
  "subtitles": [
    {"line": 1, "in": 0.00, "out": 2.40, "text": "Hello world."},
    ...
  ]
}

Timecodes can be one of:
- HH:MM:SS:FF (frames, requires fps)
- HH:MM:SS[.ms]
- SS[.ms]

Usage:
  python3 csv_to_subtitles_json.py input.csv output.json --fps 25
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


def parse_timecode(value: str, fps: float) -> float:
    """Parse a timecode string into seconds as float.

    Supported formats:
      - HH:MM:SS:FF (frames)
      - HH:MM:SS[.ms]
      - SS[.ms]

    Accepts both ':' and ';' as separators for drop-frame friendly inputs.
    """
    if value is None:
        raise ValueError("Timecode value is None")
    tc = value.strip()
    if not tc:
        raise ValueError("Empty timecode")

    # Normalize separators
    tc = tc.replace(";", ":")

    # Fast path: plain seconds
    # Accept numbers like 12, 12.5, 12,500 with comma decimal
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
    elif len(parts) == 3:
        hh, mm, ss = parts
        h = int(hh)
        m = int(mm)
        s = float(ss)
        return float(h * 3600 + m * 60 + s)
    elif len(parts) == 2:
        # Interpret as MM:SS[.ms]
        mm, ss = parts
        m = int(mm)
        s = float(ss)
        return float(m * 60 + s)
    else:
        raise ValueError(f"Unsupported timecode format: {value}")


def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except Exception:
        return default


def detect_columns(headers: List[str]) -> Tuple[str, str, str]:
    """Map CSV headers to canonical names (start, end, text).

    We match case-insensitively and ignore non-alphanumerics.
    """
    norm = {re.sub(r"[^a-z]", "", h.lower()): h for h in headers}

    # Common possibilities
    start_key = None
    for key in ("starttime", "start", "in", "inpoint"):
        if key in norm:
            start_key = norm[key]
            break

    end_key = None
    for key in ("endtime", "end", "out", "outpoint"):
        if key in norm:
            end_key = norm[key]
            break

    text_key = None
    for key in ("text", "subtitle", "caption", "line"):
        if key in norm:
            text_key = norm[key]
            break

    if not (start_key and end_key and text_key):
        missing = [k for k, v in {"start": start_key, "end": end_key, "text": text_key}.items() if not v]
        raise KeyError(f"Missing required column(s): {', '.join(missing)}. Found headers: {headers}")

    return start_key, end_key, text_key


def read_rows(
    path: str,
    encoding: str = "utf-8-sig",
) -> Iterable[Dict[str, str]]:
    with open(path, "r", encoding=encoding, newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV appears to have no header row.")
        for row in reader:
            yield row


def convert_csv_to_json(
    input_csv: str,
    fps: float = 25.0,
    start_line_index: int = 1,
    round_ndigits: Optional[int] = 2,
    times_as_string: bool = False,
    strip_text: bool = True,
    skip_empty_text: bool = True,
    encoding: str = "utf-8-sig",
) -> Dict[str, Any]:
    """Convert CSV to the target JSON structure.

    Returns the JSON-serializable dict.
    """
    rows = list(read_rows(input_csv, encoding=encoding))
    if not rows:
        return {"subtitles": []}

    start_col, end_col, text_col = detect_columns(list(rows[0].keys()))

    def fmt_time(val: float) -> Any:
        if round_ndigits is not None:
            val = round(val, round_ndigits)
        if times_as_string:
            if round_ndigits is None:
                # Default to 2 places when stringifying without round
                return f"{val:.2f}"
            return f"{val:.{round_ndigits}f}"
        return float(val)

    out_items: List[Dict[str, Any]] = []
    line_no = start_line_index
    for r in rows:
        text_raw = r.get(text_col, "")
        text = text_raw.strip() if strip_text and isinstance(text_raw, str) else text_raw

        if skip_empty_text and (text is None or str(text).strip() == ""):
            continue

        try:
            tin = parse_timecode(str(r.get(start_col, "")).strip(), fps)
            tout = parse_timecode(str(r.get(end_col, "")).strip(), fps)
        except Exception as e:
            raise ValueError(f"Failed to parse timecodes for row {r}: {e}")

        item = {
            "line": line_no,
            "in": fmt_time(tin),
            "out": fmt_time(tout),
            "text": text,
        }
        out_items.append(item)
        line_no += 1

    return {"subtitles": out_items}


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Convert subtitle CSV to JSON")
    p.add_argument("input", help="Path to input CSV file")
    p.add_argument("output", help="Path to output JSON file")
    p.add_argument("--fps", type=float, default=25.0, help="Frames per second for HH:MM:SS:FF timecodes (default: 25)")
    p.add_argument("--start-line", type=int, default=1, help="Starting line index in output (default: 1)")
    p.add_argument("--round", dest="round_digits", type=int, default=2, help="Round seconds to N digits (default: 2; use -1 to disable)")
    p.add_argument("--times-as-string", action="store_true", help="Write time values as strings (keeps trailing zeros)")
    p.add_argument("--no-strip-text", action="store_true", help="Do not strip whitespace from text cells")
    p.add_argument("--keep-empty-text", action="store_true", help="Keep rows where text is empty/whitespace")
    p.add_argument("--encoding", default="utf-8-sig", help="CSV file encoding (default: utf-8-sig)")

    args = p.parse_args(argv)

    round_ndigits: Optional[int]
    if args.round_digits is not None and args.round_digits >= 0:
        round_ndigits = args.round_digits
    else:
        round_ndigits = None

    data = convert_csv_to_json(
        input_csv=args.input,
        fps=args.fps,
        start_line_index=args.start_line,
        round_ndigits=round_ndigits,
        times_as_string=args.times_as_string,
        strip_text=not args.no_strip_text,
        skip_empty_text=not args.keep_empty_text,
        encoding=args.encoding,
    )

    # Ensure destination folder exists
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
