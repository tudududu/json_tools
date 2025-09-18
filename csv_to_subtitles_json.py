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


def _normalize_header_map(headers: List[str]) -> Dict[str, str]:
    return {re.sub(r"[^a-z]", "", h.lower()): h for h in headers}


def _resolve_column(
    headers: List[str],
    override: Optional[str],
    candidates: Tuple[str, ...],
) -> Optional[str]:
    # If user provided override
    if override:
        # If numeric, treat as 1-based index
        if override.isdigit():
            idx = int(override) - 1
            if 0 <= idx < len(headers):
                return headers[idx]
            else:
                raise IndexError(f"Column index {override} out of range 1..{len(headers)}")
        # Else, match by case-insensitive exact header
        for h in headers:
            if h.lower().strip() == override.lower().strip():
                return h
        # Or by normalized form
        norm = _normalize_header_map(headers)
        key = re.sub(r"[^a-z]", "", override.lower())
        if key in norm:
            return norm[key]
        raise KeyError(f"Override column '{override}' not found in headers {headers}")

    # Auto-detect by candidates
    norm = _normalize_header_map(headers)
    for key in candidates:
        if key in norm:
            return norm[key]
    return None


def detect_columns(headers: List[str], start_override: Optional[str] = None, end_override: Optional[str] = None, text_override: Optional[str] = None) -> Tuple[str, str, str]:
    """Map CSV headers to canonical names (start, end, text).

    We match case-insensitively and ignore non-alphanumerics.
    """
    start_key = _resolve_column(headers, start_override, ("starttime", "start", "in", "inpoint"))
    end_key = _resolve_column(headers, end_override, ("endtime", "end", "out", "outpoint"))
    text_key = _resolve_column(headers, text_override, ("text", "subtitle", "caption", "line"))

    if not (start_key and end_key and text_key):
        missing = [k for k, v in {"start": start_key, "end": end_key, "text": text_key}.items() if not v]
        raise KeyError(f"Missing required column(s): {', '.join(missing)}. Found headers: {headers}")

    return start_key, end_key, text_key


def _sniff_delimiter(sample: str, preferred: Optional[str] = None) -> str:
    """Detect a delimiter using csv.Sniffer with sensible fallbacks."""
    # If user provided explicit single-character delimiter, honor it
    if preferred and len(preferred) == 1:
        return preferred

    sniff_candidates = [",", ";", "\t", "|"]
    # User provided a named delimiter like 'comma', 'semicolon', 'tab', 'pipe'
    if preferred and len(preferred) > 1:
        name = preferred.lower()
        mapping = {
            "comma": ",",
            ",": ",",
            "semicolon": ";",
            ";": ";",
            "tab": "\t",
            "\t": "\t",
            "pipe": "|",
            "|": "|",
            "auto": None,
        }
        mapped = mapping.get(name)
        if mapped:
            if mapped is None:
                # continue to sniff
                pass
            else:
                return mapped

    try:
        sniffer = csv.Sniffer()
        dialect = sniffer.sniff(sample, delimiters="".join(sniff_candidates))
        return dialect.delimiter
    except Exception:
        # Heuristic fallback: pick the most frequent of candidates
        counts = {d: sample.count(d) for d in sniff_candidates}
        best = max(counts, key=lambda k: counts[k])
        if counts[best] == 0:
            return ","  # default
        return best


def _read_table(
    path: str,
    encoding: str = "utf-8-sig",
    delimiter: Optional[str] = None,
) -> Tuple[List[str], List[List[str]], str]:
    """Read CSV preserving duplicate column names. Returns (headers, rows, delimiter)."""
    with open(path, "r", encoding=encoding, newline="") as f:
        sample = f.read(8192)
        f.seek(0)
        delim = _sniff_delimiter(sample, preferred=delimiter)
        reader = csv.reader(f, delimiter=delim)
        try:
            headers = next(reader)
        except StopIteration:
            raise ValueError("CSV appears to be empty.")
        rows = [list(r) for r in reader]
        return headers, rows, delim


def convert_csv_to_json(
    input_csv: str,
    fps: float = 25.0,
    start_line_index: int = 1,
    round_ndigits: Optional[int] = 2,
    times_as_string: bool = False,
    strip_text: bool = True,
    skip_empty_text: bool = True,
    encoding: str = "utf-8-sig",
    delimiter: Optional[str] = None,
    start_col: Optional[str] = None,
    end_col: Optional[str] = None,
    text_col: Optional[str] = None,
    verbose: bool = False,
    schema_version: str = "v1",
    merge_subtitles: bool = True,
    merge_disclaimer: bool = True,
    cast_metadata: bool = False,
    join_claim: bool = False,
) -> Dict[str, Any]:
    """Convert CSV to JSON. Supports two modes:

    1) Simple mode (original): columns Start Time, End Time, Text (optional line) → {"subtitles": [...]}.
    2) Sectioned mode (Excel export): first column marks section (subtitles/claim/disclaimer/metadata),
       columns include line, Start Time, End Time, and one or more Text columns (per-country). Metadata rows
       provide key/value pairs; a row with key 'country' defines per-country codes.
    """
    headers, rows, delim = _read_table(input_csv, encoding=encoding, delimiter=delimiter)
    if verbose:
        print(f"Detected delimiter: {repr(delim)} | Headers: {headers}")
    if not rows:
        return {"subtitles": []}

    lower_headers = [h.strip().lower() for h in headers]

    # --------------------------------------------------
    # Unified schema path (record_type present)
    # --------------------------------------------------
    if "record_type" in lower_headers:
        # Column indices
        idx_record_type = lower_headers.index("record_type")
        idx_video_id = lower_headers.index("video_id") if "video_id" in lower_headers else None
        idx_line = lower_headers.index("line") if "line" in lower_headers else None
        idx_start = lower_headers.index("start") if "start" in lower_headers else None
        idx_end = lower_headers.index("end") if "end" in lower_headers else None
        idx_key = lower_headers.index("key") if "key" in lower_headers else None
        idx_is_global = lower_headers.index("is_global") if "is_global" in lower_headers else None
        idx_country_scope = lower_headers.index("country_scope") if "country_scope" in lower_headers else None
        idx_metadata_val = lower_headers.index("metadata") if "metadata" in lower_headers else None

        # Country columns: all columns after metadata value column (if present) else after country_scope
        country_start_idx = None
        if idx_metadata_val is not None:
            country_start_idx = idx_metadata_val + 1
        elif idx_country_scope is not None:
            country_start_idx = idx_country_scope + 1
        else:
            country_start_idx = max([c for c in [idx_end, idx_key] if c is not None] or [0]) + 1

        country_cols = []
        for i in range(country_start_idx, len(headers)):
            code = headers[i].strip()
            if not code:
                continue
            country_cols.append((i, code))
        countries = [c for _, c in country_cols]
        if verbose:
            print(f"Unified schema detected. Countries: {countries}")

        def parse_time_optional(val: str) -> Optional[float]:
            v = (val or "").strip()
            if not v:
                return None
            try:
                return parse_timecode(v, fps)
            except Exception:
                return None

        def fmt_time(val: Optional[float]) -> Any:
            if val is None:
                return None
            if round_ndigits is not None:
                val = round(val, round_ndigits)
            if times_as_string:
                if round_ndigits is None:
                    return f"{val:.2f}"
                return f"{val:.{round_ndigits}f}"
            return float(val)

        global_meta: Dict[str, Any] = {}
        videos: Dict[str, Dict[str, Any]] = {}
        video_order: List[str] = []
        # Intermediate containers before splitting per country
        claims_rows: List[Dict[str, Any]] = []  # each: {line,start,end,texts:{code:text}}
        disc_rows_raw: List[Dict[str, Any]] = []  # raw disclaimer rows
        subs_rows: Dict[str, List[Dict[str, Any]]] = {}  # video_id -> list of rows {line,start,end,texts}

        auto_claim_line = 1
        auto_disc_line = 1
        auto_sub_line_per_video: Dict[str, int] = {}

        for r in rows:
            if len(r) < len(headers):
                r = r + [""] * (len(headers) - len(r))
            rt = r[idx_record_type].strip().lower() if r[idx_record_type] else ""
            if not rt:
                continue

            video_id = r[idx_video_id].strip() if (idx_video_id is not None and r[idx_video_id]) else ""
            line_raw = r[idx_line].strip() if (idx_line is not None and r[idx_line]) else ""
            try:
                line_num = int(line_raw) if line_raw else None
            except Exception:
                line_num = None
            start_tc = parse_time_optional(r[idx_start]) if idx_start is not None else None
            end_tc = parse_time_optional(r[idx_end]) if idx_end is not None else None

            key_name = r[idx_key].strip() if (idx_key is not None and r[idx_key]) else ""
            country_scope_val = r[idx_country_scope].strip().upper() if (idx_country_scope is not None and r[idx_country_scope]) else ""
            metadata_cell_val = r[idx_metadata_val].strip() if (idx_metadata_val is not None and r[idx_metadata_val]) else ""

            # Gather per-country texts
            texts: Dict[str, str] = {}
            for ci, code in country_cols:
                val = r[ci].replace("\r", "").strip()
                texts[code] = val

            # Propagation for ALL scope on textual rows (claim/disclaimer/sub)
            if country_scope_val == "ALL":
                # Determine base text (first non-empty)
                base_text = next((texts[c] for c in countries if texts[c]), "")
                if base_text:
                    for c in countries:
                        if not texts[c]:
                            texts[c] = base_text

            # Metadata rows
            if rt in ("meta_global", "meta-global"):
                if not key_name:
                    continue
                # If any country-specific value exists use first; otherwise metadata column
                country_val = next((texts[c] for c in countries if texts[c]), "")
                value = country_val or metadata_cell_val
                if value != "":
                    global_meta[key_name] = value
                continue
            if rt in ("meta_local", "meta-local"):
                if not key_name or not video_id:
                    continue
                if video_id not in videos:
                    videos[video_id] = {"metadata": {}, "sub_rows": []}
                    video_order.append(video_id)
                country_val = next((texts[c] for c in countries if texts[c]), "")
                value = country_val or metadata_cell_val
                if value != "":
                    videos[video_id]["metadata"][key_name] = value
                continue

            # Claim rows (each row independent)
            if rt == "claim":
                if line_num is None:
                    line_num = auto_claim_line
                    auto_claim_line += 1
                claims_rows.append({
                    "line": line_num,
                    "start": start_tc,
                    "end": end_tc,
                    "texts": texts,
                })
                continue

            # Disclaimer rows (will merge later)
            if rt == "disclaimer":
                if line_num is None and (start_tc is not None or end_tc is not None):
                    line_num = auto_disc_line
                if line_num is None:
                    # Continuation lines inherit previous line
                    line_num = auto_disc_line
                else:
                    auto_disc_line = line_num
                disc_rows_raw.append({
                    "line": line_num,
                    "start": start_tc,
                    "end": end_tc,
                    "texts": texts,
                })
                continue

            # Subtitle rows
            if rt == "sub":
                if not video_id:
                    # Skip if no video id
                    continue
                if video_id not in videos:
                    videos[video_id] = {"metadata": {}, "sub_rows": []}
                    video_order.append(video_id)
                if video_id not in auto_sub_line_per_video:
                    auto_sub_line_per_video[video_id] = start_line_index
                if line_num is None:
                    line_num = auto_sub_line_per_video[video_id]
                    auto_sub_line_per_video[video_id] += 1
                videos[video_id]["sub_rows"].append({
                    "line": line_num,
                    "start": start_tc,
                    "end": end_tc,
                    "texts": texts,
                })
                continue

            # Unknown record type ignored
            continue

    # Merge disclaimer rows into blocks
        disclaimers_rows_merged: List[Dict[str, Any]] = []
        if merge_disclaimer:
            current_block: Optional[Dict[str, Any]] = None
            for row in disc_rows_raw:
                if row["start"] is not None and row["end"] is not None:
                    # Start a new block
                    if current_block:
                        disclaimers_rows_merged.append(current_block)
                    current_block = {
                        "line": row["line"],
                        "start": row["start"],
                        "end": row["end"],
                        "texts": {c: row["texts"][c] for c in countries},
                    }
                else:
                    # Continuation lines
                    if not current_block:
                        # No base block; skip or create untimed block
                        current_block = {
                            "line": row["line"],
                            "start": row["start"],
                            "end": row["end"],
                            "texts": {c: row["texts"][c] for c in countries},
                        }
                    else:
                        for c in countries:
                            extra = row["texts"][c]
                            if extra:
                                if current_block["texts"][c]:
                                    current_block["texts"][c] += "\n" + extra
                                else:
                                    current_block["texts"][c] = extra
            if current_block:
                disclaimers_rows_merged.append(current_block)
        else:
            disclaimers_rows_merged = disc_rows_raw

        # Merge subtitle rows with same line (per video) if enabled
        for vid, vdata in videos.items():
            if not merge_subtitles:
                continue
            merged: List[Dict[str, Any]] = []
            prev: Optional[Dict[str, Any]] = None
            for row in vdata.get("sub_rows", []):
                if prev and row["line"] == prev["line"] and (
                    (row["start"] is None and row["end"] is None) or (
                        row["start"] == prev["start"] and row["end"] == prev["end"]
                    )
                ):
                    # Continuation
                    for c in countries:
                        t = row["texts"][c]
                        if t:
                            if prev["texts"][c]:
                                prev["texts"][c] += "\n" + t
                            else:
                                prev["texts"][c] = t
                else:
                    if prev:
                        merged.append(prev)
                    prev = row
            if prev:
                merged.append(prev)
            vdata["sub_rows"] = merged

        # Optional join of claim rows by identical timing
        if join_claim and claims_rows:
            grouped: Dict[Tuple[Optional[float], Optional[float]], Dict[str, Any]] = {}
            for row in claims_rows:
                key = (row["start"], row["end"]) if (row["start"] is not None and row["end"] is not None) else (None, None)
                if key not in grouped:
                    grouped[key] = {
                        "start": row["start"],
                        "end": row["end"],
                        "texts": {c: row["texts"].get(c, "") for c in countries},
                    }
                else:
                    for c in countries:
                        t = row["texts"].get(c, "")
                        if t:
                            if grouped[key]["texts"][c]:
                                grouped[key]["texts"][c] += "\n" + t
                            else:
                                grouped[key]["texts"][c] = t
            # Convert back to claims_rows-like list with synthetic line numbers
            new_claims: List[Dict[str, Any]] = []
            ln = 1
            for key, data in grouped.items():
                new_claims.append({
                    "line": ln,
                    "start": data["start"],
                    "end": data["end"],
                    "texts": data["texts"],
                })
                ln += 1
            claims_rows = new_claims

        # Build multi structure similar to earlier _multi output
        by_country: Dict[str, Any] = {}
        for c in countries:
            # Claims
            claim_list = []
            for row in claims_rows:
                txt = row["texts"].get(c, "").strip()
                if skip_empty_text and not txt:
                    continue
                entry = {"line": row["line"], "text": txt}
                if row["start"] is not None and row["end"] is not None:
                    entry["in"] = fmt_time(row["start"])
                    entry["out"] = fmt_time(row["end"])
                claim_list.append(entry)

            # Disclaimers
            disc_list = []
            for row in disclaimers_rows_merged:
                txt = row["texts"].get(c, "").strip()
                if skip_empty_text and not txt:
                    continue
                entry = {"line": row["line"], "text": txt}
                if row["start"] is not None and row["end"] is not None:
                    entry["in"] = fmt_time(row["start"])
                    entry["out"] = fmt_time(row["end"])
                disc_list.append(entry)

            # Videos
            videos_list = []
            for vid in video_order:
                vdata = videos[vid]
                subs = []
                for srow in vdata.get("sub_rows", []):
                    txt = srow["texts"].get(c, "").strip()
                    if skip_empty_text and not txt:
                        continue
                    if srow["start"] is None or srow["end"] is None:
                        # Skip invalid timing rows for subtitles
                        continue
                    subs.append({
                        "line": srow["line"],
                        "in": fmt_time(srow["start"]),
                        "out": fmt_time(srow["end"]),
                        "text": txt,
                    })
                videos_list.append({
                    "videoId": vid,
                    "metadata": vdata.get("metadata", {}).copy(),
                    "subtitles": subs,
                })

            # Cast metadata values if requested
            def maybe_cast(value: Any) -> Any:
                if not cast_metadata:
                    return value
                if isinstance(value, str):
                    v = value.strip()
                    if re.fullmatch(r"[-+]?[0-9]+", v):
                        try:
                            return int(v)
                        except Exception:
                            return value
                    if re.fullmatch(r"[-+]?[0-9]*\.[0-9]+", v):
                        try:
                            return float(v)
                        except Exception:
                            return value
                return value

            gm_cast = {k: maybe_cast(v) for k, v in global_meta.copy().items()}

            vlist_cast = []
            for vobj in videos_list:
                meta_cast = {k: maybe_cast(v) for k, v in vobj["metadata"].items()}
                vlist_cast.append({
                    "videoId": vobj["videoId"],
                    "metadata": meta_cast,
                    "subtitles": vobj["subtitles"],
                })

            payload = {
                "schemaVersion": schema_version,
                "country": c,
                "metadataGlobal": gm_cast,
                "claim": claim_list,
                "disclaimer": disc_list,
                "videos": vlist_cast,
            }
            by_country[c] = payload

        # Multi output
        return {"_multi": True, "countries": countries, "byCountry": by_country}

    # Normalize headers for index lookup, preserving duplicates
    norm_headers = [re.sub(r"[^a-z]", "", (h or "").lower()) for h in headers]

    # Try to locate columns
    def find_col(names: Tuple[str, ...]) -> Optional[int]:
        for i, nh in enumerate(norm_headers):
            if nh in names:
                return i
        return None

    idx_line = find_col(("line",))
    idx_start = find_col(("starttime", "start", "in", "inpoint"))
    idx_end = find_col(("endtime", "end", "out", "outpoint"))

    # Text columns: may be multiple duplicates named 'text'
    text_cols = [i for i, nh in enumerate(norm_headers) if nh == "text"]

    # If we failed to find essentials, fall back to old DictReader logic for simple CSVs
    simple_mode = (find_col(("starttime", "start", "in", "inpoint")) is not None) and (len(text_cols) <= 1) and (headers[0].strip().lower() not in ("subtitles", "claim", "disclaimer", "metadata"))
    if simple_mode:
        # Reuse old path via DictReader for compatibility
        # Build fieldnames → use first row as headers directly
        # Create dict rows
        dict_rows = []
        for r in rows:
            d = {headers[i]: (r[i] if i < len(r) else "") for i in range(len(headers))}
            dict_rows.append(d)
        start_name, end_name, text_name = detect_columns(headers, start_override=start_col, end_override=end_col, text_override=text_col)

        def fmt_time(val: float) -> Any:
            if round_ndigits is not None:
                val = round(val, round_ndigits)
            if times_as_string:
                if round_ndigits is None:
                    return f"{val:.2f}"
                return f"{val:.{round_ndigits}f}"
            return float(val)

        out_items: List[Dict[str, Any]] = []
        line_no = start_line_index
        for d in dict_rows:
            text_val = d.get(text_name, "")
            text = text_val.strip() if strip_text and isinstance(text_val, str) else text_val
            if skip_empty_text and (text is None or str(text).strip() == ""):
                continue
            try:
                tin = parse_timecode(str(d.get(start_name, "")).strip(), fps)
                tout = parse_timecode(str(d.get(end_name, "")).strip(), fps)
            except Exception as e:
                raise ValueError(f"Failed to parse timecodes for row {d}: {e}")
            item = {"line": line_no, "in": fmt_time(tin), "out": fmt_time(tout), "text": text}
            out_items.append(item)
            line_no += 1
        return {"subtitles": out_items}

    # Sectioned mode
    # Identify section marker column: assume first column if its header looks like a known section or any non-core column
    idx_section = 0 if headers and headers[0] else 0

    # Determine which columns are text columns; if none, but we have a 'text_col' override, try to resolve by index
    if not text_cols:
        if text_col and text_col.isdigit():
            text_cols = [int(text_col) - 1]
        else:
            # Default to last column
            text_cols = [len(headers) - 1]

    # Per-country containers
    country_codes: List[str] = []
    per_country: Dict[str, Dict[str, Any]] = {}

    def ensure_country(idx: int, code: Optional[str] = None) -> str:
        nonlocal country_codes
        if idx >= len(country_codes):
            # Extend with placeholders
            for k in range(len(country_codes), idx + 1):
                country_codes.append(code or f"col{k - (len(text_cols) - len(country_codes)) + 1}")
        c = country_codes[idx]
        if c not in per_country:
            per_country[c] = {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}}
        return c

    def fmt_time(val: float) -> Any:
        if round_ndigits is not None:
            val = round(val, round_ndigits)
        if times_as_string:
            if round_ndigits is None:
                return f"{val:.2f}"
            return f"{val:.{round_ndigits}f}"
        return float(val)

    current_section = (headers[0] or "subtitles").strip().lower()
    auto_line = start_line_index
    for r in rows:
        # Pad row
        if len(r) < len(headers):
            r = r + [""] * (len(headers) - len(r))

        # Section switch if column 0 has a value
        if r[idx_section].strip():
            current_section = r[idx_section].strip().lower()

        if current_section == "metadata":
            # Key is placed in the column just before first text column in examples (e.g., column 4 when text starts at 5)
            key_col = min(text_cols) - 1 if min(text_cols) > 0 else 0
            key_raw = r[key_col].strip() if key_col < len(r) else ""
            if not key_raw:
                continue
            key_norm = key_raw.strip()
            # Values per country align with text columns
            for ti, tcol in enumerate(text_cols):
                val = r[tcol].strip() if tcol < len(r) else ""
                code = None
                if key_norm.lower() == "country":
                    code = val or None
                ccode = ensure_country(ti, code)
                # If this row defines country codes, update them
                if key_norm.lower() == "country" and val:
                    country_codes[ti] = val
                    # Ensure bucket name matches code
                    if ccode != val:
                        # Move bucket if previously created with placeholder
                        per_country[val] = per_country.pop(ccode, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}})
                    ccode = val
                if key_norm.lower() != "country":
                    per_country[ccode]["metadata"][key_norm] = val
            continue

        # Subtitle-like sections
        if current_section in ("subtitles", "claim", "disclaimer"):
            # Line index
            if idx_line is not None and idx_line < len(r) and str(r[idx_line]).strip():
                try:
                    line_no_val = int(str(r[idx_line]).strip())
                except Exception:
                    line_no_val = auto_line
            else:
                line_no_val = auto_line

            # Timecodes
            try:
                tin = parse_timecode(str(r[idx_start]).strip() if idx_start is not None else "", fps)
                tout = parse_timecode(str(r[idx_end]).strip() if idx_end is not None else "", fps)
            except Exception:
                # If times are missing in a non-data marker row (e.g., metadata), skip
                continue

            # Per-country texts
            for ti, tcol in enumerate(text_cols):
                text_val = r[tcol] if tcol < len(r) else ""
                text_val = text_val.strip() if strip_text and isinstance(text_val, str) else text_val
                if skip_empty_text and (text_val is None or str(text_val).strip() == ""):
                    continue
                ccode = ensure_country(ti)
                item = {"line": line_no_val, "in": fmt_time(tin), "out": fmt_time(tout), "text": text_val}
                per_country[ccode][current_section].append(item)

            auto_line += 1
            continue

        # Unknown section → ignore
        continue

    # If no country codes were provided, ensure at least one default
    if not country_codes:
        country_codes = ["default"]
        if "default" not in per_country:
            per_country["default"] = {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}}

    # If only one country requested, and matches original return shape
    if len(country_codes) == 1:
        c = country_codes[0]
        return {
            "subtitles": per_country[c]["subtitles"],
            "claim": per_country[c]["claim"],
            "disclaimer": per_country[c]["disclaimer"],
            "metadata": per_country[c]["metadata"],
        }

    # Multiple countries → return combined structure containing per-country data (for CLI split to handle)
    return {
        "_multi": True,
        "countries": country_codes,
        "byCountry": per_country,
    }


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
    p.add_argument(
        "--delimiter",
        default="auto",
        help=(
            "CSV delimiter. One of: auto (default), comma, semicolon, tab, pipe, or a single character. "
            "If auto, the script will sniff among , ; TAB |"
        ),
    )
    p.add_argument("--start-col", help="Override Start column by name or 1-based index", default=None)
    p.add_argument("--end-col", help="Override End column by name or 1-based index", default=None)
    p.add_argument("--text-col", help="Override Text column by name or 1-based index", default=None)
    p.add_argument("--verbose", action="store_true", help="Print detected delimiter and headers")
    p.add_argument("--schema-version", default="v2", help="Schema version tag to embed in unified output (default v2)")
    p.add_argument("--no-merge-subtitles", action="store_true", help="Disable merging of multi-line subtitles with same line number")
    p.add_argument("--no-merge-disclaimer", action="store_true", help="Disable merging of multi-line disclaimer continuation lines")
    p.add_argument("--cast-metadata", action="store_true", help="Attempt numeric casting of metadata values (int/float detection)")
    p.add_argument("--join-claim", action="store_true", help="Join multiple claim rows with same timing into one block (newline separated)")
    p.add_argument("--validate-only", action="store_true", help="Parse and validate input; do not write output files")
    p.add_argument("--dry-run", action="store_true", help="List discovered countries/videos without writing JSON")
    p.add_argument("--split-by-country", action="store_true", help="When multiple Text columns exist, write one JSON per country using output pattern")
    p.add_argument("--country-column", type=int, default=None, help="1-based index among Text columns to select when not splitting")
    p.add_argument("--output-pattern", default=None, help="Pattern for split outputs; use {country}. If omitted, infer from output path by inserting _{country} before extension.")

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
        delimiter=args.delimiter,
        start_col=args.start_col,
        end_col=args.end_col,
        text_col=args.text_col,
        verbose=args.verbose,
        schema_version=args.schema_version,
        merge_subtitles=not args.no_merge_subtitles,
        merge_disclaimer=not args.no_merge_disclaimer,
        cast_metadata=args.cast_metadata,
        join_claim=args.join_claim,
    )

    # Basic validation helper
    def _validate_structure(obj: Dict[str, Any]) -> List[str]:
        errs: List[str] = []
        for arr_name in ("subtitles", "claim", "disclaimer"):
            arr = obj.get(arr_name)
            if arr is None:
                continue
            if not isinstance(arr, list):
                errs.append(f"{arr_name} is not a list")
                continue
            for i, item in enumerate(arr):
                if not isinstance(item, dict):
                    errs.append(f"{arr_name}[{i}] not an object")
                    continue
                tin = item.get("in")
                tout = item.get("out")
                try:
                    if tin is not None and tout is not None and float(tin) > float(tout):
                        errs.append(f"{arr_name}[{i}] in > out ({tin} > {tout})")
                except Exception:
                    pass
        return errs
    def write_json(path: str, payload: Dict[str, Any]):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    if isinstance(data, dict) and data.get("_multi"):
        countries: List[str] = data.get("countries", [])
        by_country: Dict[str, Any] = data.get("byCountry", {})
        if args.validate_only or args.dry_run:
            errors_total: List[str] = []
            for c in countries:
                payload = by_country.get(c, {})
                errors_total.extend([f"{c}: {e}" for e in _validate_structure(payload)])
            print(f"Discovered countries ({len(countries)}): {countries}")
            for c in countries:
                payload = by_country.get(c, {})
                vids = [v.get("videoId") for v in payload.get("videos", []) if isinstance(v, dict)]
                print(
                    f"  {c}: videos={len(vids)} subtitleLines={len(payload.get('subtitles', []))} claimLines={len(payload.get('claim', []))} disclaimerLines={len(payload.get('disclaimer', []))}"
                )
            if errors_total:
                print("Validation errors:")
                for e in errors_total:
                    print(f"  - {e}")
            if args.validate_only:
                print("Validation complete (no files written)." + (" Errors found." if errors_total else " OK."))
                return 1 if errors_total else 0
            if args.dry_run:
                print("Dry run complete (no files written).")
                return 0
        if args.split_by_country or ("{country}" in (args.output or "")) or args.output_pattern:
            pattern = args.output_pattern or args.output
            # If pattern lacks {country}, inject before extension
            if "{country}" not in pattern:
                root, ext = os.path.splitext(pattern)
                pattern = f"{root}_{{country}}{ext}"
            for c in countries:
                payload = by_country.get(c, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}})
                out_path = pattern.replace("{country}", c)
                if args.verbose:
                    print(f"Writing {out_path}")
                write_json(out_path, payload)
        else:
            # Single output selection: choose requested column or the last
            csel = None
            if args.country_column and 1 <= args.country_column <= len(countries):
                csel = countries[args.country_column - 1]
            else:
                csel = countries[-1]
            payload = by_country.get(csel, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}})
            if args.verbose:
                print(f"Writing {args.output} (selected country: {csel})")
            write_json(args.output, payload)
    else:
        if args.validate_only or args.dry_run:
            errors = _validate_structure(data)
            print("Parsed single-structure JSON (legacy/simple mode).")
            if errors:
                print("Validation errors:")
                for e in errors:
                    print(f"  - {e}")
            if args.validate_only:
                print("Validation complete (no file written)." + (" Errors found." if errors else " OK."))
                return 1 if errors else 0
            if args.dry_run:
                print("Dry run complete (no file written).")
                return 0
        write_json(args.output, data)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
