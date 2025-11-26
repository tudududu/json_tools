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
  python3 csv_to_json.py input.csv output.json --fps 25
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import copy
import hashlib
from datetime import datetime
import subprocess
import sys
import platform
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
    merge_disclaimer_02: bool = True,
    cast_metadata: bool = False,
    join_claim: bool = False,
    prefer_local_claim_disclaimer: bool = True,
    test_mode: bool = False,
    claims_as_objects: bool = False,
    no_orientation: bool = False,
    country_variant_index: Optional[int] = None,
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
        # Support duplicate country codes for orientation (landscape/portrait)
        country_occurrences: Dict[str, List[int]] = {}
        countries_unique: List[str] = []
        # Count how many orientation pairs (variants) exist per country (pairs of columns)
        country_variant_counts: Dict[str, int] = {}
        for idx, code in country_cols:
            country_occurrences.setdefault(code, []).append(idx)
            if code not in countries_unique:
                countries_unique.append(code)
        for c in countries_unique:
            occ = country_occurrences.get(c, [])
            # group into pairs (landscape, portrait)
            country_variant_counts[c] = max(1, (len(occ) + 1) // 2)
        countries = countries_unique
        # Map country -> {orientation: column_index or None}
        country_orientation_cols: Dict[str, Dict[str, Optional[int]]] = {}
        for c in countries_unique:
            occ = country_occurrences.get(c, [])
            # Select which pair to use based on variant index (default 0)
            vi = country_variant_index or 0
            land = occ[2 * vi] if len(occ) > 2 * vi else (occ[0] if occ else None)
            port = occ[2 * vi + 1] if len(occ) > 2 * vi + 1 else (occ[1] if len(occ) > 1 else None)
            country_orientation_cols[c] = {"landscape": land, "portrait": port}
        if verbose:
            print(f"Unified schema detected. Countries: {countries} (orientation column mapping: {country_orientation_cols})")

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
        # Per-country overrides for certain meta_global keys (currently jobNumber)
        job_number_per_country: Dict[str, str] = {}
        # Per-country language mapping from meta_global language row
        language_per_country: Dict[str, str] = {}
        videos: Dict[str, Dict[str, Any]] = {}
        video_order: List[str] = []
        # Per-video, per-country meta_local overrides for certain keys (e.g., disclaimer_flag, disclaimer_02_flag, subtitle_flag, super_A_flag)
        per_video_meta_local_country: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # Per-country global flags (from meta_global) that can propagate to per-video metadata when meta_local empty
        global_flag_values_per_country: Dict[str, Dict[str, str]] = {}
        # Multi-row meta_global mappings keyed by a sub-key (duration) -> default value
        logo_anim_flag_by_duration: Dict[str, str] = {}
        # Per-country overrides for logo_anim_flag: duration -> {country: value}
        logo_anim_flag_per_country: Dict[str, Dict[str, str]] = {}
        # Intermediate containers before splitting per country
        claims_rows: List[Dict[str, Any]] = []  # global claim rows
        per_video_claim_rows: Dict[str, List[Dict[str, Any]]] = {}
        disc_rows_raw: List[Dict[str, Any]] = []  # global disclaimer rows
        per_video_disc_rows_raw: Dict[str, List[Dict[str, Any]]] = {}
        disc_02_rows_raw: List[Dict[str, Any]] = []  # global disclaimer_02 rows
        per_video_disc_02_rows_raw: Dict[str, List[Dict[str, Any]]] = {}
        # Logo rows (global text + per-video timings)
        logo_rows_raw: List[Dict[str, Any]] = []
        per_video_logo_rows_raw: Dict[str, List[Dict[str, Any]]] = {}
        # endFrame rows (per-video timings; optional text columns similar to logo)
        endframe_rows_raw: List[Dict[str, Any]] = []
        per_video_endframe_rows_raw: Dict[str, List[Dict[str, Any]]] = {}
        # subs_rows reserved for future use (not needed currently)

        auto_claim_line = 1
        auto_disc_line = 1
        auto_disc_02_line = 1
        auto_logo_line = 1
        auto_claim_line_per_video: Dict[str, int] = {}
        auto_disc_line_per_video: Dict[str, int] = {}
        auto_disc_02_line_per_video: Dict[str, int] = {}
        auto_logo_line_per_video: Dict[str, int] = {}
        auto_endframe_line = 1
        auto_endframe_line_per_video: Dict[str, int] = {}
        auto_sub_line_per_video: Dict[str, int] = {}
        auto_super_a_line_per_video: Dict[str, int] = {}

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

            # Gather per-country texts for both orientations (portrait optional)
            texts: Dict[str, str] = {}
            texts_portrait: Dict[str, str] = {}
            for c in countries:
                land_idx = country_orientation_cols[c]["landscape"]
                port_idx = country_orientation_cols[c]["portrait"]
                land_val = r[land_idx].replace("\r", "").strip() if land_idx is not None and land_idx < len(r) else ""
                port_val = r[port_idx].replace("\r", "").strip() if port_idx is not None and port_idx < len(r) else ""
                texts[c] = land_val
                texts_portrait[c] = port_val

            # Propagation for ALL scope on textual rows (claim/disclaimer/sub)
            if country_scope_val == "ALL":
                # Propagate separately for each orientation
                base_land = next((texts[c] for c in countries if texts[c]), "")
                base_port = next((texts_portrait[c] for c in countries if texts_portrait[c]), "")
                if base_land:
                    for c in countries:
                        if not texts[c]:
                            texts[c] = base_land
                if base_port:
                    for c in countries:
                        if not texts_portrait[c]:
                            texts_portrait[c] = base_port

            # Metadata rows
            if rt in ("meta_global", "meta-global"):
                if not key_name:
                    continue
                # Special handling for per-country jobNumber overrides:
                if key_name == "jobNumber":
                    # Precedence rules (CSV to JSON 39):
                    # 1. Use a country-specific jobNumber value if any (from landscape/portrait text cells)
                    # 2. Else use the metadata cell value (global fallback) for that country
                    # 3. Else explicitly set empty string so key is still emitted later
                    for c in countries:
                        per_country_val = (texts.get(c, "") or texts_portrait.get(c, "")).strip()
                        if per_country_val:
                            job_number_per_country[c] = per_country_val
                        else:
                            # Will fill from metadata cell (same for all) or empty after loop
                            job_number_per_country.setdefault(c, None)  # placeholder
                    # Apply metadata cell fallback for any country still unset / None
                    if metadata_cell_val:
                        for c in countries:
                            if job_number_per_country.get(c) in (None, ""):
                                job_number_per_country[c] = metadata_cell_val
                    # Final pass: ensure sentinel value 'noJobNumber' for any remaining None so key is always present
                    for c in countries:
                        if job_number_per_country.get(c) is None:
                            job_number_per_country[c] = "noJobNumber"
                    # Do not store a single global jobNumber in global_meta; it will be injected per country later.
                    continue
                # Per-country flag keys (disclaimer_flag / disclaimer_02_flag / subtitle_flag / super_A_flag) now can appear as meta_global.
                # Capture per-country values so they can act as defaults for per-video metadata flags.
                if key_name in ("disclaimer_flag", "disclaimer_02_flag", "subtitle_flag", "super_A_flag"):
                    for c in countries:
                        per_val = (texts.get(c, "") or texts_portrait.get(c, "") or metadata_cell_val).strip()
                        if per_val:
                            bucket = global_flag_values_per_country.setdefault(c, {})
                            bucket[key_name] = per_val
                    # Do not store as a single shared global_meta value; flags are per-country.
                    continue
                # Per-country language value for metadataGlobal.language (CSV to JSON 167)
                if key_name == "language":
                    for ctry in countries:
                        # Prefer portrait > landscape > metadata cell; if none present, set empty string
                        val = (texts_portrait.get(ctry, "") or texts.get(ctry, "") or metadata_cell_val or "").strip()
                        language_per_country[ctry] = val
                    # Do not store a single shared language in global_meta; injected per-country later
                    continue
                # Special multi-row meta_global: logo_anim_flag
                # Rows supply: key=logo_anim_flag, country_scope column used as a 'duration' sub-key, metadata column (or per-country columns) as value.
                # Precedence rules for value derivation per row:
                #   1. Per-country portrait cell overrides per-country landscape
                #   2. Per-country landscape overrides metadata (ALL) cell
                #   For the aggregated global mapping, we use the ALL/metadata value if present; per-country specific differences are not aggregated (design choice for simplicity).
                if key_name == "logo_anim_flag":
                    duration_subkey = (country_scope_val or "").strip()
                    if not duration_subkey:
                        continue
                    default_val = (metadata_cell_val or "").strip()
                    # Build per-country values with precedence portrait > landscape > default
                    for ctry in countries:
                        per_val = (texts_portrait.get(ctry, "") or texts.get(ctry, "") or default_val).strip()
                        if per_val:
                            logo_anim_flag_per_country.setdefault(duration_subkey, {})[ctry] = per_val
                    # Derive default if still empty: fallback to first per-country captured value
                    if not default_val and duration_subkey in logo_anim_flag_per_country:
                        default_val = next(iter(logo_anim_flag_per_country[duration_subkey].values()), "")
                    if default_val:
                        logo_anim_flag_by_duration[duration_subkey] = default_val
                    continue
                # Generic meta_global: pick first non-empty per-country value else metadata column
                country_val = next((texts[c] for c in countries if texts[c]), "")
                value = country_val or metadata_cell_val
                if value != "":
                    global_meta[key_name] = value
                continue
            if rt in ("meta_local", "meta-local"):
                if not key_name or not video_id:
                    continue
                if video_id not in videos:
                    videos[video_id] = {"metadata": {}, "sub_rows": [], "super_a_rows": []}
                    video_order.append(video_id)
                key_lower = key_name.lower()
                # Special per-country meta_local keys: collect values per country instead of a single shared one
                if key_lower in {"disclaimer_flag", "disclaimer_02_flag", "subtitle_flag", "super_a_flag", "logo_anim_flag"}:
                    if video_id not in per_video_meta_local_country:
                        per_video_meta_local_country[video_id] = {}
                    # For each country, pick per-country landscape/portrait cell (first non-empty among them)
                    for c in countries:
                        val = (texts.get(c, "") or texts_portrait.get(c, "")).strip()
                        if not val and metadata_cell_val:
                            # Fallback if metadata cell provided (legacy style)
                            val = metadata_cell_val.strip()
                        if val:
                            bucket = per_video_meta_local_country[video_id].setdefault(c, {})
                            bucket[key_name] = val
                    # Do not store shared value in videos[video_id]["metadata"] for these keys
                else:
                    country_val = next((texts[c] for c in countries if texts[c]), "")
                    value = country_val or metadata_cell_val
                    if value != "":
                        videos[video_id]["metadata"][key_name] = value
                continue

            # Claim rows (each row independent)
            if rt == "claim":
                if video_id:
                    if video_id not in per_video_claim_rows:
                        per_video_claim_rows[video_id] = []
                    if video_id not in auto_claim_line_per_video:
                        auto_claim_line_per_video[video_id] = 1
                    if line_num is None:
                        line_num = auto_claim_line_per_video[video_id]
                        auto_claim_line_per_video[video_id] += 1
                    per_video_claim_rows[video_id].append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                else:
                    if line_num is None:
                        line_num = auto_claim_line
                        auto_claim_line += 1
                    claims_rows.append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                continue

            # Disclaimer rows (will merge later)
            if rt == "disclaimer":
                if video_id:
                    if video_id not in per_video_disc_rows_raw:
                        per_video_disc_rows_raw[video_id] = []
                    if video_id not in auto_disc_line_per_video:
                        auto_disc_line_per_video[video_id] = 1
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_disc_line_per_video[video_id]
                    if line_num is None:
                        line_num = auto_disc_line_per_video[video_id]
                    else:
                        auto_disc_line_per_video[video_id] = line_num
                    per_video_disc_rows_raw[video_id].append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                else:
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
                        "texts_portrait": texts_portrait,
                    })
                continue

            # Disclaimer_02 rows (will merge later)
            if rt == "disclaimer_02":
                if video_id:
                    if video_id not in per_video_disc_02_rows_raw:
                        per_video_disc_02_rows_raw[video_id] = []
                    if video_id not in auto_disc_02_line_per_video:
                        auto_disc_02_line_per_video[video_id] = 1
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_disc_02_line_per_video[video_id]
                    if line_num is None:
                        line_num = auto_disc_02_line_per_video[video_id]
                    else:
                        auto_disc_02_line_per_video[video_id] = line_num
                    per_video_disc_02_rows_raw[video_id].append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                else:
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_disc_02_line
                    if line_num is None:
                        # Continuation lines inherit previous line
                        line_num = auto_disc_02_line
                    else:
                        auto_disc_02_line = line_num
                    disc_02_rows_raw.append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                continue

            # Logo rows (timed per-video, text defined globally)
            if rt == "logo":
                if video_id:
                    if video_id not in per_video_logo_rows_raw:
                        per_video_logo_rows_raw[video_id] = []
                    if video_id not in auto_logo_line_per_video:
                        auto_logo_line_per_video[video_id] = 1
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_logo_line_per_video[video_id]
                    if line_num is None:
                        line_num = auto_logo_line_per_video[video_id]
                    else:
                        auto_logo_line_per_video[video_id] = line_num
                    per_video_logo_rows_raw[video_id].append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                else:
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_logo_line
                    if line_num is None:
                        line_num = auto_logo_line
                    else:
                        auto_logo_line = line_num
                    logo_rows_raw.append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                continue

            # endFrame rows (timed per-video, optional text like logo)
            if rt == "endframe" or rt == "end_frame":
                if video_id:
                    if video_id not in per_video_endframe_rows_raw:
                        per_video_endframe_rows_raw[video_id] = []
                    if video_id not in auto_endframe_line_per_video:
                        auto_endframe_line_per_video[video_id] = 1
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_endframe_line_per_video[video_id]
                    if line_num is None:
                        line_num = auto_endframe_line_per_video[video_id]
                    else:
                        auto_endframe_line_per_video[video_id] = line_num
                    per_video_endframe_rows_raw[video_id].append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                else:
                    if line_num is None and (start_tc is not None or end_tc is not None):
                        line_num = auto_endframe_line
                    if line_num is None:
                        line_num = auto_endframe_line
                    else:
                        auto_endframe_line = line_num
                    endframe_rows_raw.append({
                        "line": line_num,
                        "start": start_tc,
                        "end": end_tc,
                        "texts": texts,
                        "texts_portrait": texts_portrait,
                    })
                continue

            # Subtitle rows
            if rt == "sub":
                if not video_id:
                    # Skip if no video id
                    continue
                if video_id not in videos:
                    videos[video_id] = {"metadata": {}, "sub_rows": [], "super_a_rows": []}
                    video_order.append(video_id)
                if video_id not in auto_sub_line_per_video:
                    auto_sub_line_per_video[video_id] = start_line_index
                if line_num is None:
                    line_num = auto_sub_line_per_video[video_id]
                    auto_sub_line_per_video[video_id] += 1
                else:
                    # Explicit line number provided; sync counter for next auto line
                    auto_sub_line_per_video[video_id] = line_num + 1
                videos[video_id]["sub_rows"].append({
                    "line": line_num,
                    "start": start_tc,
                    "end": end_tc,
                    "texts": texts,
                    "texts_portrait": texts_portrait,
                })
                continue

            # Super_A rows (follows subtitle pattern exactly)
            if rt == "super_a":
                if not video_id:
                    # Skip if no video id
                    continue
                if video_id not in videos:
                    videos[video_id] = {"metadata": {}, "sub_rows": [], "super_a_rows": []}
                    video_order.append(video_id)
                if video_id not in auto_super_a_line_per_video:
                    auto_super_a_line_per_video[video_id] = start_line_index
                if line_num is None:
                    line_num = auto_super_a_line_per_video[video_id]
                    auto_super_a_line_per_video[video_id] += 1
                else:
                    # Explicit line number provided; sync counter for next auto line
                    auto_super_a_line_per_video[video_id] = line_num + 1
                videos[video_id]["super_a_rows"].append({
                    "line": line_num,
                    "start": start_tc,
                    "end": end_tc,
                    "texts": texts,
                    "texts_portrait": texts_portrait,
                })
                continue

            # Unknown record type ignored
            continue

        # Before merging blocks, finalize multi-row overview mappings
        if logo_anim_flag_by_duration and "logo_anim_flag" not in global_meta:
            overview: Dict[str, Any] = {}
            for dur, def_val in sorted(logo_anim_flag_by_duration.items(), key=lambda x: (len(x[0]), x[0])):
                per_map = logo_anim_flag_per_country.get(dur, {})
                # If every country maps to same value as default, emit simple string for backward compatibility
                unique_vals = set(per_map.values()) if per_map else set()
                if per_map and (len(unique_vals) > 1 or (unique_vals and list(unique_vals)[0] != def_val)):
                    # Build nested object with _default plus explicit country entries
                    nested = {"_default": def_val}
                    # Stable country ordering
                    for cc in sorted(per_map.keys()):
                        nested[cc] = per_map[cc]
                    overview[dur] = nested
                else:
                    overview[dur] = def_val
            global_meta["logo_anim_flag"] = overview

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
                        # Preserve both landscape and portrait per-country texts
                        "texts": {c: row["texts"][c] for c in countries},
                        "texts_portrait": {c: row.get("texts_portrait", {}).get(c, "") for c in countries},
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
                            "texts_portrait": {c: row.get("texts_portrait", {}).get(c, "") for c in countries},
                        }
                    else:
                        for c in countries:
                            extra = row["texts"][c]
                            if extra:
                                if current_block["texts"][c]:
                                    current_block["texts"][c] += "\n" + extra
                                else:
                                    current_block["texts"][c] = extra
                            extra_p = row.get("texts_portrait", {}).get(c, "")
                            if extra_p:
                                if current_block.get("texts_portrait", {}).get(c, ""):
                                    current_block["texts_portrait"][c] += "\n" + extra_p
                                else:
                                    current_block["texts_portrait"][c] = extra_p
            if current_block:
                disclaimers_rows_merged.append(current_block)
        else:
            disclaimers_rows_merged = disc_rows_raw

        # Merge disclaimer_02 rows into blocks
        disclaimers_02_rows_merged: List[Dict[str, Any]] = []
        if merge_disclaimer_02:
            current_block: Optional[Dict[str, Any]] = None
            for row in disc_02_rows_raw:
                if row["start"] is not None and row["end"] is not None:
                    # Start a new block
                    if current_block:
                        disclaimers_02_rows_merged.append(current_block)
                    current_block = {
                        "line": row["line"],
                        "start": row["start"],
                        "end": row["end"],
                        # Preserve both landscape and portrait per-country texts
                        "texts": {c: row["texts"][c] for c in countries},
                        "texts_portrait": {c: row.get("texts_portrait", {}).get(c, "") for c in countries},
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
                            "texts_portrait": {c: row.get("texts_portrait", {}).get(c, "") for c in countries},
                        }
                    else:
                        for c in countries:
                            extra = row["texts"][c]
                            if extra:
                                if current_block["texts"][c]:
                                    current_block["texts"][c] += "\n" + extra
                                else:
                                    current_block["texts"][c] = extra
                            extra_p = row.get("texts_portrait", {}).get(c, "")
                            if extra_p:
                                if current_block.get("texts_portrait", {}).get(c, ""):
                                    current_block["texts_portrait"][c] += "\n" + extra_p
                                else:
                                    current_block["texts_portrait"][c] = extra_p
            if current_block:
                disclaimers_02_rows_merged.append(current_block)
        else:
            disclaimers_02_rows_merged = disc_02_rows_raw

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
                        # Handle portrait text
                        t_p = row.get("texts_portrait", {}).get(c, "")
                        if t_p:
                            if prev.get("texts_portrait", {}).get(c, ""):
                                prev["texts_portrait"][c] += "\n" + t_p
                            else:
                                if "texts_portrait" not in prev:
                                    prev["texts_portrait"] = {}
                                prev["texts_portrait"][c] = t_p
                else:
                    if prev:
                        merged.append(prev)
                    prev = row
            if prev:
                merged.append(prev)
            vdata["sub_rows"] = merged

        # Merge super_A rows with same line (per video) if enabled
        for vid, vdata in videos.items():
            if not merge_subtitles:  # Use same merge flag as subtitles
                continue
            merged: List[Dict[str, Any]] = []
            prev: Optional[Dict[str, Any]] = None
            for row in vdata.get("super_a_rows", []):
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
                        # Handle portrait text
                        t_p = row.get("texts_portrait", {}).get(c, "")
                        if t_p:
                            if prev.get("texts_portrait", {}).get(c, ""):
                                prev["texts_portrait"][c] += "\n" + t_p
                            else:
                                if "texts_portrait" not in prev:
                                    prev["texts_portrait"] = {}
                                prev["texts_portrait"][c] = t_p
                else:
                    if prev:
                        merged.append(prev)
                    prev = row
            if prev:
                merged.append(prev)
            vdata["super_a_rows"] = merged

        # Deduplicate non-contiguous duplicate subtitle & super_A rows by (line,start,end)
        for vid, vdata in videos.items():
            # Subtitles
            if vdata.get("sub_rows"):
                grouped_sub: Dict[Tuple[int, Optional[float], Optional[float]], Dict[str, Any]] = {}
                order_sub: List[Tuple[int, Optional[float], Optional[float]]] = []
                for row in vdata["sub_rows"]:
                    key = (row["line"], row["start"], row["end"])
                    if key not in grouped_sub:
                        grouped_sub[key] = {
                            "line": row["line"],
                            "start": row["start"],
                            "end": row["end"],
                            "texts": {c: row["texts"].get(c, "") for c in countries},
                            "texts_portrait": {c: row.get("texts_portrait", {}).get(c, "") for c in countries},
                        }
                        order_sub.append(key)
                    else:
                        for c in countries:
                            extra_l = row["texts"].get(c, "")
                            if extra_l:
                                existing = grouped_sub[key]["texts"][c]
                                # Append only if different and not already present as a full line
                                if not existing:
                                    grouped_sub[key]["texts"][c] = extra_l
                                else:
                                    # Split existing by newline to check duplication
                                    if extra_l not in existing.split("\n"):
                                        grouped_sub[key]["texts"][c] += "\n" + extra_l
                            extra_p = row.get("texts_portrait", {}).get(c, "")
                            if extra_p:
                                existing_p = grouped_sub[key]["texts_portrait"][c]
                                if not existing_p:
                                    grouped_sub[key]["texts_portrait"][c] = extra_p
                                else:
                                    if extra_p not in existing_p.split("\n"):
                                        grouped_sub[key]["texts_portrait"][c] += "\n" + extra_p
                vdata["sub_rows"] = [grouped_sub[k] for k in order_sub]
            # super_A
            if vdata.get("super_a_rows"):
                grouped_sa: Dict[Tuple[int, Optional[float], Optional[float]], Dict[str, Any]] = {}
                order_sa: List[Tuple[int, Optional[float], Optional[float]]] = []
                for row in vdata["super_a_rows"]:
                    key = (row["line"], row["start"], row["end"])
                    if key not in grouped_sa:
                        grouped_sa[key] = {
                            "line": row["line"],
                            "start": row["start"],
                            "end": row["end"],
                            "texts": {c: row["texts"].get(c, "") for c in countries},
                            "texts_portrait": {c: row.get("texts_portrait", {}).get(c, "") for c in countries},
                        }
                        order_sa.append(key)
                    else:
                        for c in countries:
                            extra_l = row["texts"].get(c, "")
                            if extra_l:
                                existing = grouped_sa[key]["texts"][c]
                                if not existing:
                                    grouped_sa[key]["texts"][c] = extra_l
                                else:
                                    if extra_l not in existing.split("\n"):
                                        grouped_sa[key]["texts"][c] += "\n" + extra_l
                            extra_p = row.get("texts_portrait", {}).get(c, "")
                            if extra_p:
                                existing_p = grouped_sa[key]["texts_portrait"][c]
                                if not existing_p:
                                    grouped_sa[key]["texts_portrait"][c] = extra_p
                                else:
                                    if extra_p not in existing_p.split("\n"):
                                        grouped_sa[key]["texts_portrait"][c] += "\n" + extra_p
                vdata["super_a_rows"] = [grouped_sa[k] for k in order_sa]

        # Optional join of claim rows by identical timing (global)
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

        # Optional join for per-video claim rows
        if join_claim and per_video_claim_rows:
            for vid, rows_list in list(per_video_claim_rows.items()):
                grouped: Dict[Tuple[Optional[float], Optional[float]], Dict[str, Any]] = {}
                for row in rows_list:
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
                new_rows: List[Dict[str, Any]] = []
                ln = 1
                for key, data in grouped.items():
                    new_rows.append({
                        "line": ln,
                        "start": data["start"],
                        "end": data["end"],
                        "texts": data["texts"],
                    })
                    ln += 1
                per_video_claim_rows[vid] = new_rows

        # Build multi structure similar to earlier _multi output
        by_country: Dict[str, Any] = {}
        for c in countries:
            # Build orientation-specific top-level arrays
            claim_landscape: List[str] = []
            claim_portrait: List[str] = []
            for row in claims_rows:
                txt_l = (row["texts"].get(c, "") or "").strip()
                txt_p = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                # If portrait empty mirror later; only append landscape if not empty (unless keeping empty forbidden)
                if txt_l or not skip_empty_text:
                    claim_landscape.append(txt_l)
                if txt_p:
                    claim_portrait.append(txt_p)
            # Mirror landscape into portrait if portrait missing or shorter
            if not claim_portrait and claim_landscape:
                claim_portrait = claim_landscape.copy()
            elif claim_portrait and len(claim_portrait) < len(claim_landscape):
                # Extend portrait with landscape fallbacks
                for i in range(len(claim_portrait), len(claim_landscape)):
                    claim_portrait.append(claim_landscape[i])

            disc_landscape: List[str] = []
            disc_portrait: List[str] = []
            for row in disclaimers_rows_merged:
                txt_l = (row["texts"].get(c, "") or "").strip()
                txt_p = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                if txt_l or not skip_empty_text:
                    disc_landscape.append(txt_l)
                if txt_p:
                    disc_portrait.append(txt_p)
            if not disc_landscape:
                disc_landscape = [""]
            if not disc_portrait and disc_landscape:
                disc_portrait = disc_landscape.copy()

            disc_02_landscape: List[str] = []
            disc_02_portrait: List[str] = []
            for row in disclaimers_02_rows_merged:
                txt_l = (row["texts"].get(c, "") or "").strip()
                txt_p = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                if txt_l or not skip_empty_text:
                    disc_02_landscape.append(txt_l)
                if txt_p:
                    disc_02_portrait.append(txt_p)
            if not disc_02_landscape:
                disc_02_landscape = [""]
            if not disc_02_portrait and disc_02_landscape:
                disc_02_portrait = disc_02_landscape.copy()

            logo_landscape: List[str] = []
            logo_portrait: List[str] = []
            for row in logo_rows_raw:
                txt_l = (row["texts"].get(c, "") or "").strip()
                txt_p = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                if txt_l or not skip_empty_text:
                    logo_landscape.append(txt_l)
                if txt_p:
                    logo_portrait.append(txt_p)
            if not logo_portrait and logo_landscape:
                logo_portrait = logo_landscape.copy()

            # Videos (create landscape + portrait objects always, mirroring when portrait empty)
            videos_list: List[Dict[str, Any]] = []
            for vid in video_order:
                vdata = videos[vid]
                subs_land: List[Dict[str, Any]] = []
                subs_port: List[Dict[str, Any]] = []
                for srow in vdata.get("sub_rows", []):
                    txt_l = (srow["texts"].get(c, "") or "").strip()
                    txt_p = (srow.get("texts_portrait", {}).get(c, "") or "").strip()
                    # Skip subtitle if landscape text empty and skipping empties
                    if skip_empty_text and not txt_l:
                        continue
                    if srow["start"] is None or srow["end"] is None:
                        continue
                    subs_land.append({
                        "line": srow["line"],
                        "in": fmt_time(srow["start"]),
                        "out": fmt_time(srow["end"]),
                        "text": txt_l,
                    })
                    # Portrait: use portrait text if provided else mirror landscape
                    txt_port_final = txt_p if txt_p else txt_l
                    subs_port.append({
                        "line": srow["line"],
                        "in": fmt_time(srow["start"]),
                        "out": fmt_time(srow["end"]),
                        "text": txt_port_final,
                    })
                # Super_A processing (follows subtitle pattern exactly)
                super_a_land: List[Dict[str, Any]] = []
                super_a_port: List[Dict[str, Any]] = []
                for sarow in vdata.get("super_a_rows", []):
                    txt_l = (sarow["texts"].get(c, "") or "").strip()
                    txt_p = (sarow.get("texts_portrait", {}).get(c, "") or "").strip()
                    # Skip super_A if landscape text empty and skipping empties
                    if skip_empty_text and not txt_l:
                        continue
                    if sarow["start"] is None or sarow["end"] is None:
                        continue
                    super_a_land.append({
                        "line": sarow["line"],
                        "in": fmt_time(sarow["start"]),
                        "out": fmt_time(sarow["end"]),
                        "text": txt_l,
                    })
                    # Portrait: use portrait text if provided else mirror landscape
                    txt_port_final = txt_p if txt_p else txt_l
                    super_a_port.append({
                        "line": sarow["line"],
                        "in": fmt_time(sarow["start"]),
                        "out": fmt_time(sarow["end"]),
                        "text": txt_port_final,
                    })
                base_meta = vdata.get("metadata", {}).copy()
                # Inject logo_anim_flag per video based on its duration (string match)
                if logo_anim_flag_by_duration:
                    dur_key = str(base_meta.get("duration", "")).strip()
                    if dur_key and dur_key in logo_anim_flag_by_duration:
                        if "logo_anim_flag" not in base_meta:
                            # Pick per-country override if present
                            per_map = logo_anim_flag_per_country.get(dur_key, {})
                            country_specific = per_map.get(c)
                            value_to_use = country_specific if country_specific else logo_anim_flag_by_duration[dur_key]
                            base_meta["logo_anim_flag"] = value_to_use
                # Inject per-country meta_local overrides (disclaimer_flag, disclaimer_02_flag, subtitle_flag, super_A_flag) if present
                # Precedence: meta_local value (if present) > meta_global per-country flag value > nothing
                # First apply global per-country flags as defaults
                if c in global_flag_values_per_country:
                    for mk, mv in global_flag_values_per_country[c].items():
                        if mk not in base_meta:  # don't overwrite any existing regular metadata key
                            base_meta.setdefault(mk, mv)
                # Then apply per-video overrides (which may overwrite the global defaults if provided)
                if vid in per_video_meta_local_country and c in per_video_meta_local_country[vid]:
                    for mk, mv in per_video_meta_local_country[vid][c].items():
                        base_meta[mk] = mv
                land_meta = base_meta.copy()
                land_meta["orientation"] = "landscape"
                port_meta = base_meta.copy()
                port_meta["orientation"] = "portrait"
                videos_list.append({
                    "videoId": f"{vid}_landscape",
                    "metadata": land_meta,
                    "subtitles": subs_land,
                    "super_A": super_a_land,
                })
                videos_list.append({
                    "videoId": f"{vid}_portrait",
                    "metadata": port_meta,
                    "subtitles": subs_port,
                    "super_A": super_a_port,
                })

            # Attach per-video claim/disclaimer with timings and choose text (prefer local if requested)
            # Build quick maps for global texts by timing key
            def timing_key(r: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
                return (r.get("start"), r.get("end"))

            global_claim_map_land = {timing_key(r): (r["texts"].get(c, "") or "").strip() for r in claims_rows}
            global_claim_map_port = {timing_key(r): (r.get("texts_portrait", {}).get(c, "") or "").strip() for r in claims_rows}
            # For disclaimers, order matters but often it's one block; use index-based fallback too
            global_disc_land = [(r.get("texts", {}).get(c, "") or "").strip() for r in disclaimers_rows_merged]
            global_disc_port = [(r.get("texts_portrait", {}).get(c, "") or "").strip() for r in disclaimers_rows_merged]
            # For disclaimer_02, same as disclaimer
            global_disc_02_land = [(r.get("texts", {}).get(c, "") or "").strip() for r in disclaimers_02_rows_merged]
            global_disc_02_port = [(r.get("texts_portrait", {}).get(c, "") or "").strip() for r in disclaimers_02_rows_merged]
            # For logos, typically one line; use index-based fallback as well
            global_logo_land = [(r.get("texts", {}).get(c, "") or "").strip() for r in logo_rows_raw]
            global_logo_port = [(r.get("texts_portrait", {}).get(c, "") or "").strip() for r in logo_rows_raw]
            # For endFrame (if any global rows), mirror logo behavior
            global_endframe_land = [(r.get("texts", {}).get(c, "") or "").strip() for r in endframe_rows_raw]
            global_endframe_port = [(r.get("texts_portrait", {}).get(c, "") or "").strip() for r in endframe_rows_raw]

            # Prepare per-video merged disclaimers
            per_video_disc_merged: Dict[str, List[Dict[str, Any]]] = {}
            for vid, rows_raw in per_video_disc_rows_raw.items():
                merged: List[Dict[str, Any]] = []
                if merge_disclaimer:
                    current_block: Optional[Dict[str, Any]] = None
                    for row in rows_raw:
                        if row["start"] is not None and row["end"] is not None:
                            if current_block:
                                merged.append(current_block)
                            current_block = {
                                "line": row["line"],
                                "start": row["start"],
                                "end": row["end"],
                                "texts": {cc: row["texts"][cc] for cc in countries},
                                "texts_portrait": {cc: row.get("texts_portrait", {}).get(cc, "") for cc in countries},
                            }
                        else:
                            if not current_block:
                                current_block = {
                                    "line": row["line"],
                                    "start": row["start"],
                                    "end": row["end"],
                                    "texts": {cc: row["texts"][cc] for cc in countries},
                                    "texts_portrait": {cc: row.get("texts_portrait", {}).get(cc, "") for cc in countries},
                                }
                            else:
                                for cc in countries:
                                    extra = row["texts"][cc]
                                    if extra:
                                        if current_block["texts"][cc]:
                                            current_block["texts"][cc] += "\n" + extra
                                        else:
                                            current_block["texts"][cc] = extra
                                    extra_p = row.get("texts_portrait", {}).get(cc, "")
                                    if extra_p:
                                        if current_block.get("texts_portrait", {}).get(cc, ""):
                                            current_block["texts_portrait"][cc] += "\n" + extra_p
                                        else:
                                            current_block["texts_portrait"][cc] = extra_p
                    if current_block:
                        merged.append(current_block)
                else:
                    merged = rows_raw
                per_video_disc_merged[vid] = merged

            # Prepare per-video merged disclaimer_02
            per_video_disc_02_merged: Dict[str, List[Dict[str, Any]]] = {}
            for vid, rows_raw in per_video_disc_02_rows_raw.items():
                merged: List[Dict[str, Any]] = []
                if merge_disclaimer_02:
                    current_block: Optional[Dict[str, Any]] = None
                    for row in rows_raw:
                        if row["start"] is not None and row["end"] is not None:
                            if current_block:
                                merged.append(current_block)
                            current_block = {
                                "line": row["line"],
                                "start": row["start"],
                                "end": row["end"],
                                "texts": {cc: row["texts"][cc] for cc in countries},
                                "texts_portrait": {cc: row.get("texts_portrait", {}).get(cc, "") for cc in countries},
                            }
                        else:
                            if not current_block:
                                current_block = {
                                    "line": row["line"],
                                    "start": row["start"],
                                    "end": row["end"],
                                    "texts": {cc: row["texts"][cc] for cc in countries},
                                    "texts_portrait": {cc: row.get("texts_portrait", {}).get(cc, "") for cc in countries},
                                }
                            else:
                                for cc in countries:
                                    extra = row["texts"][cc]
                                    if extra:
                                        if current_block["texts"][cc]:
                                            current_block["texts"][cc] += "\n" + extra
                                        else:
                                            current_block["texts"][cc] = extra
                                    extra_p = row.get("texts_portrait", {}).get(cc, "")
                                    if extra_p:
                                        if current_block.get("texts_portrait", {}).get(cc, ""):
                                            current_block["texts_portrait"][cc] += "\n" + extra_p
                                        else:
                                            current_block["texts_portrait"][cc] = extra_p
                    if current_block:
                        merged.append(current_block)
                else:
                    merged = rows_raw
                per_video_disc_02_merged[vid] = merged

            # Now fill claim/disclaimer in each video object
            for vobj in videos_list:
                vid_full = vobj["videoId"]
                orientation = "portrait" if vid_full.endswith("_portrait") else "landscape"
                # Pick appropriate global maps
                global_claim_map = global_claim_map_port if orientation == "portrait" else global_claim_map_land
                global_disc_texts = global_disc_port if orientation == "portrait" else global_disc_land
                global_disc_02_texts = global_disc_02_port if orientation == "portrait" else global_disc_02_land
                global_logo_texts = global_logo_port if orientation == "portrait" else global_logo_land
                # Claims source rows
                src_claims = per_video_claim_rows.get(vid_full.rsplit("_", 1)[0]) or claims_rows
                claim_items: List[Dict[str, Any]] = []
                # Top-level claim text arrays for current orientation (to support index fallback)
                claim_texts_global = claim_portrait if orientation == "portrait" else claim_landscape
                for idx, row in enumerate(src_claims):
                    txt_local = ( (row.get("texts_portrait", {}) if orientation == "portrait" else row.get("texts", {})).get(c, "") or "").strip()
                    # Portrait local fallback to landscape local when override flag enabled
                    if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                        alt_land_local = (row.get("texts", {}).get(c, "") or "").strip()
                        if alt_land_local:
                            txt_local = alt_land_local
                    txt_global_timing = global_claim_map.get(timing_key(row), "")
                    txt_global_index = (
                        claim_texts_global[idx]
                        if idx < len(claim_texts_global)
                        else (claim_texts_global[0] if claim_texts_global else "")
                    )
                    if txt_local:
                        text_value = txt_local
                    else:
                        text_value = txt_global_timing or txt_global_index or txt_local
                    if test_mode and text_value:
                        text_value = f"{vid_full}_{text_value}"
                    entry = {"line": row.get("line", idx + 1), "text": text_value}
                    if row.get("start") is not None and row.get("end") is not None:
                        entry["in"] = fmt_time(row["start"])
                        entry["out"] = fmt_time(row["end"])
                    claim_items.append(entry)
                if len(claim_items) == 1:
                    base = claim_items[0]
                    text2 = (
                        claim_texts_global[1]
                        if len(claim_texts_global) >= 2
                        else (claim_texts_global[0] if claim_texts_global else base.get("text", ""))
                    )
                    if test_mode and text2 and not str(text2).startswith(f"{vid_full}_"):
                        text2 = f"{vid_full}_{text2}"
                    second = {"line": 2, "text": text2}
                    if "in" in base:
                        second["in"] = base["in"]
                    if "out" in base:
                        second["out"] = base["out"]
                    claim_items.append(second)
                vobj["claim"] = claim_items
                if claims_as_objects:
                    for i, item in enumerate(claim_items, start=1):
                        vobj[f"claim_{i:02d}"] = [item]
                    del vobj["claim"]
                # Disclaimers
                src_discs = per_video_disc_merged.get(vid_full.rsplit("_",1)[0]) or disclaimers_rows_merged
                disc_items: List[Dict[str, Any]] = []
                for i, row in enumerate(src_discs):
                    if orientation == "portrait":
                        txt_local = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                    else:
                        txt_local = (row.get("texts", {}).get(c, "") or "").strip()
                    # Portrait local fallback to landscape local disclaimer when override flag enabled
                    if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                        alt_land_local = (row.get("texts", {}).get(c, "") or "").strip()
                        if alt_land_local:
                            txt_local = alt_land_local
                    txt_global = global_disc_texts[i] if i < len(global_disc_texts) else (global_disc_texts[0] if global_disc_texts else "")
                    # If portrait and both local/global portrait empty, mirror landscape global text for same index
                    if orientation == "portrait" and not txt_local and not txt_global:
                        if i < len(global_disc_land):
                            txt_global = global_disc_land[i]
                    text_value = txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
                    if test_mode and text_value:
                        text_value = f"{vid_full}_{text_value}"
                    entry = {"line": row.get("line", i + 1), "text": text_value}
                    if row.get("start") is not None and row.get("end") is not None:
                        entry["in"] = fmt_time(row["start"])
                        entry["out"] = fmt_time(row["end"])
                    else:
                        entry["in"] = None
                        entry["out"] = None
                    disc_items.append(entry)
                vobj["disclaimer"] = disc_items
                # Disclaimer_02
                src_discs_02 = per_video_disc_02_merged.get(vid_full.rsplit("_",1)[0]) or disclaimers_02_rows_merged
                disc_02_items: List[Dict[str, Any]] = []
                for i, row in enumerate(src_discs_02):
                    if orientation == "portrait":
                        txt_local = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                    else:
                        txt_local = (row.get("texts", {}).get(c, "") or "").strip()
                    # Portrait local fallback to landscape local disclaimer_02 when override flag enabled
                    if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                        alt_land_local = (row.get("texts", {}).get(c, "") or "").strip()
                        if alt_land_local:
                            txt_local = alt_land_local
                    txt_global = global_disc_02_texts[i] if i < len(global_disc_02_texts) else (global_disc_02_texts[0] if global_disc_02_texts else "")
                    # If portrait and both local/global portrait empty, mirror landscape global text for same index
                    if orientation == "portrait" and not txt_local and not txt_global:
                        if i < len(global_disc_02_land):
                            txt_global = global_disc_02_land[i]
                    text_value = txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
                    if test_mode and text_value:
                        text_value = f"{vid_full}_{text_value}"
                    entry = {"line": row.get("line", i + 1), "text": text_value}
                    if row.get("start") is not None and row.get("end") is not None:
                        entry["in"] = fmt_time(row["start"])
                        entry["out"] = fmt_time(row["end"])
                    else:
                        entry["in"] = None
                        entry["out"] = None
                    disc_02_items.append(entry)
                vobj["disclaimer_02"] = disc_02_items
                # Logo
                src_logos = per_video_logo_rows_raw.get(vid_full.rsplit("_",1)[0]) or logo_rows_raw
                logo_items: List[Dict[str, Any]] = []
                for i, row in enumerate(src_logos):
                    if orientation == "portrait":
                        txt_local = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                    else:
                        txt_local = (row.get("texts", {}).get(c, "") or "").strip()
                    # Portrait local fallback to landscape local logo when override flag enabled
                    if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                        alt_land_local = (row.get("texts", {}).get(c, "") or "").strip()
                        if alt_land_local:
                            txt_local = alt_land_local
                    txt_global = global_logo_texts[i] if i < len(global_logo_texts) else (global_logo_texts[0] if global_logo_texts else "")
                    if orientation == "portrait" and not txt_local and not txt_global:
                        if i < len(global_logo_land):
                            txt_global = global_logo_land[i]
                    text_value = txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
                    if test_mode and text_value:
                        text_value = f"{vid_full}_{text_value}"
                    entry = {"line": row.get("line", i + 1), "text": text_value}
                    if row.get("start") is not None and row.get("end") is not None:
                        entry["in"] = fmt_time(row["start"])
                        entry["out"] = fmt_time(row["end"])
                    else:
                        entry["in"] = None
                        entry["out"] = None
                    logo_items.append(entry)
                vobj["logo"] = logo_items

                # endFrame (same shape as logo items)
                src_end = per_video_endframe_rows_raw.get(vid_full.rsplit("_",1)[0]) or endframe_rows_raw
                end_items: List[Dict[str, Any]] = []
                for i, row in enumerate(src_end):
                    if orientation == "portrait":
                        txt_local = (row.get("texts_portrait", {}).get(c, "") or "").strip()
                    else:
                        txt_local = (row.get("texts", {}).get(c, "") or "").strip()
                    # Portrait local fallback to landscape local endFrame when override flag enabled
                    if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                        alt_land_local = (row.get("texts", {}).get(c, "") or "").strip()
                        if alt_land_local:
                            txt_local = alt_land_local
                    txt_global = (
                        global_endframe_port[i] if orientation == "portrait" else global_endframe_land[i]
                    ) if i < (len(global_endframe_port) if orientation == "portrait" else len(global_endframe_land)) else (
                        (global_endframe_port[0] if orientation == "portrait" else global_endframe_land[0]) if (global_endframe_port if orientation == "portrait" else global_endframe_land) else ""
                    )
                    if orientation == "portrait" and not txt_local and not txt_global:
                        if i < len(global_endframe_land):
                            txt_global = global_endframe_land[i]
                    text_value = txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
                    if test_mode and text_value:
                        text_value = f"{vid_full}_{text_value}"
                    entry = {"line": row.get("line", i + 1), "text": text_value}
                    if row.get("start") is not None and row.get("end") is not None:
                        entry["in"] = fmt_time(row["start"])
                        entry["out"] = fmt_time(row["end"])
                    else:
                        entry["in"] = None
                        entry["out"] = None
                    end_items.append(entry)
                vobj["endFrame"] = end_items

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
            # Fallback injection if earlier embedding missed
            if logo_anim_flag_by_duration and "logo_anim_flag" not in gm_cast:
                # Fallback apply same overview logic (should already exist)
                overview_fallback: Dict[str, Any] = {}
                for dur, def_val in sorted(logo_anim_flag_by_duration.items(), key=lambda x: (len(x[0]), x[0])):
                    per_map_fb = logo_anim_flag_per_country.get(dur, {})
                    unique_vals_fb = set(per_map_fb.values()) if per_map_fb else set()
                    if per_map_fb and (len(unique_vals_fb) > 1 or (unique_vals_fb and list(unique_vals_fb)[0] != def_val)):
                        nested_fb = {"_default": def_val}
                        for cc in sorted(per_map_fb.keys()):
                            nested_fb[cc] = per_map_fb[cc]
                        overview_fallback[dur] = nested_fb
                    else:
                        overview_fallback[dur] = def_val
                gm_cast["logo_anim_flag"] = overview_fallback
            # Inject per-country jobNumber override if present
            # Always add jobNumber key (even if empty) using precedence already resolved during meta_global parsing
            if c in job_number_per_country:
                gm_cast["jobNumber"] = job_number_per_country[c]
            else:
                gm_cast.setdefault("jobNumber", "noJobNumber")
            # Inject per-country language (empty string when not provided in input)
            gm_cast["language"] = language_per_country.get(c, "")
            # Remove orientation key from global metadata (orientation now structural)
            gm_cast.pop("orientation", None)

            vlist_cast = []
            for vobj in videos_list:
                meta_cast = {k: maybe_cast(v) for k, v in vobj["metadata"].items()}
                base = {
                    "videoId": vobj["videoId"],
                    "metadata": meta_cast,
                    "subtitles": vobj["subtitles"],
                    "super_A": vobj.get("super_A", []),
                    "disclaimer": vobj.get("disclaimer", []),
                    "disclaimer_02": vobj.get("disclaimer_02", []),
                    "logo": vobj.get("logo", []),
                    "endFrame": vobj.get("endFrame", []),
                }
                if claims_as_objects:
                    # Copy any claim_XX fields from vobj into the output
                    for k, val in vobj.items():
                        if isinstance(k, str) and k.startswith("claim_"):
                            base[k] = val
                else:
                    base["claim"] = vobj.get("claim", [])
                vlist_cast.append(base)

            # Embed schemaVersion & country inside metadataGlobal (do not duplicate at top-level)
            if "schemaVersion" not in gm_cast:
                gm_cast["schemaVersion"] = schema_version
            if "country" not in gm_cast:
                gm_cast["country"] = c
            if no_orientation:
                payload = {
                    "metadataGlobal": gm_cast,
                    "claim": claim_landscape,
                    "disclaimer": disc_landscape if disc_landscape else [""],
                    "disclaimer_02": disc_02_landscape if disc_02_landscape else [""],
                    "logo": logo_landscape,
                    "videos": vlist_cast,
                }
            else:
                payload = {
                    "metadataGlobal": gm_cast,
                    "claim": {"landscape": claim_landscape, "portrait": claim_portrait},
                    "disclaimer": {"landscape": disc_landscape, "portrait": disc_portrait},
                    "disclaimer_02": {"landscape": disc_02_landscape, "portrait": disc_02_portrait},
                    "logo": {"landscape": logo_landscape, "portrait": logo_portrait},
                    "videos": vlist_cast,
                }
            by_country[c] = payload

        # Multi output
        return {"_multi": True, "countries": countries, "byCountry": by_country, "_countryVariantCount": country_variant_counts}

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
            per_country[c] = {"subtitles": [], "claim": [], "disclaimer": [], "disclaimer_02": [], "metadata": {}}
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
                        per_country[val] = per_country.pop(ccode, {"subtitles": [], "claim": [], "disclaimer": [], "disclaimer_02": [], "metadata": {}})
                    ccode = val
                if key_norm.lower() != "country":
                    per_country[ccode]["metadata"][key_norm] = val
            continue

        # Subtitle-like sections
        if current_section in ("subtitles", "claim", "disclaimer", "disclaimer_02"):
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
            per_country["default"] = {"subtitles": [], "claim": [], "disclaimer": [], "disclaimer_02": [], "metadata": {}}

    # If only one country requested, and matches original return shape
    if len(country_codes) == 1:
        c = country_codes[0]
        return {
            "subtitles": per_country[c]["subtitles"],
            "claim": per_country[c]["claim"],
            "disclaimer": per_country[c]["disclaimer"],
            "disclaimer_02": per_country[c]["disclaimer_02"],
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
    p.add_argument("--no-orientation", action="store_true", help="Emit legacy non-orientation shape: flat claim/disclaimer/logo arrays and single videoId (landscape only)")
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
    p.add_argument("--schema-version", default="v2", help="Schema version tag to use if not supplied via meta_global 'schemaVersion' row (default v2)")
    p.add_argument("--no-merge-subtitles", action="store_true", help="Disable merging of multi-line subtitles with same line number")
    p.add_argument("--merge-disclaimer", action="store_false", help="Disable merging of multi-line disclaimer continuation lines")
    p.add_argument("--merge-disclaimer-02", action="store_false", help="Disable merging of multi-line disclaimer_02 continuation lines")
    p.add_argument("--cast-metadata", action="store_true", help="Attempt numeric casting of metadata values (int/float detection)")
    p.add_argument("--join-claim", action="store_true", help="Join multiple claim rows with same timing into one block (newline separated)")
    p.add_argument("--prefer-local-claim-disclaimer", action="store_false", dest="prefer_local_claim_disclaimer", help="(Deprecated name) Disable per-video local claim/disclaimer override (default: enabled)")
    p.add_argument("--no-local-claim-override", action="store_false", dest="prefer_local_claim_disclaimer", help="Alias: disable per-video local claim/disclaimer override (default: enabled)")
    p.add_argument("--test-mode", action="store_true", help="Prefix per-video claim/disclaimer/disclaimer_02 text with '<videoId>_' for testing")
    p.add_argument("--claims-as-objects", action="store_true", help="In each video, output claims as claim_01, claim_02, ... objects instead of a single 'claim' array")
    p.add_argument("--validate-only", action="store_true", help="Parse and validate input; do not write output files")
    p.add_argument("--dry-run", action="store_true", help="List discovered countries/videos without writing JSON")
    p.add_argument(
        "--required-global-keys",
        default="briefVersion,fps",
        help="Comma-separated list of required keys that must appear in metadataGlobal (default: briefVersion,fps). Empty string to disable.",
    )
    p.add_argument("--missing-keys-warn", action="store_true", help="Treat missing required global metadata keys as warnings (do not fail validation)")
    p.add_argument("--validation-report", default=None, help="Write a JSON validation report to this path during --validate-only or --dry-run")
    p.add_argument("--auto-output", action="store_true", help="Derive output name from input base (adds _{country} when splitting)")
    p.add_argument("--output-dir", default=None, help="Directory for auto-derived outputs (default: input file directory)")
    p.add_argument("--split-by-country", action="store_true", help="When multiple Text columns exist, write one JSON per country using output pattern")
    p.add_argument("--country-column", type=int, default=None, help="1-based index among Text columns to select when not splitting")
    p.add_argument("--output-pattern", default=None, help="Pattern for outputs; use {country}. Applies to split mode and to single-country exports with --country-column. If omitted, infer from output path by inserting _{country} before extension.")
    p.add_argument("--country-variant-index", type=int, default=None, help=(
        "Select which duplicated country column pair (variant) to use (0-based). When omitted, first pair is used."
    ))
    p.add_argument("--sample", action="store_true", help="Also write a truncated preview JSON alongside each output (adds _sample before extension)")
    p.add_argument("--converter-version", default="auto", help=(
        "Converter build/version tag. If set to 'auto' (default) or left as 'dev', the tool will attempt to derive a version automatically in this order: "
        "1) CONVERTER_VERSION env var, 2) first heading in CHANGELOG.md, 3) latest git tag, 4) '0.0.0+<shortcommit>', else 'dev'."
    ))
    p.add_argument("--no-generation-meta", action="store_true", help="Disable injection of generation metadata (generatedAt, inputSha256, converterVersion, etc.)")
    p.add_argument("--no-logo-anim-overview", action="store_true", help="Do not embed aggregated logo_anim_flag mapping object in metadataGlobal (CSV to JSON 47)")

    args = p.parse_args(argv)

    # Auto-derive converter version when user leaves default (auto/dev/empty)
    def _auto_version() -> str:
        # 1) Environment variable override
        env_val = os.getenv("CONVERTER_VERSION")
        if env_val and env_val.strip():
            return env_val.strip()
        # 2) CHANGELOG first heading (semantic-ish token at start of line after '#')
        #    Prefer repo root CHANGELOG.md, then fallback to ./python/readMe/CHANGELOG.md
        try:
            repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            py_dir = os.path.dirname(os.path.abspath(__file__))
            changelog_candidates = [
                os.path.join(repo_root, "CHANGELOG.md"),
                os.path.join(py_dir, "readMe", "CHANGELOG.md"),
            ]
            for changelog_path in changelog_candidates:
                if os.path.isfile(changelog_path):
                    with open(changelog_path, "r", encoding="utf-8") as chf:
                        for line in chf:
                            l = line.strip()
                            if l.startswith('#'):
                                # Extract first token after '#'
                                heading = l.lstrip('#').strip()
                                # Common forms: "1.3.1 - 2025-09-29" or "[1.3.1]" etc.
                                m = re.match(r"\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.]+)?)", heading)
                                if m:
                                    return m.group(1)
                                # Fallback: take first contiguous non-space chunk
                                token = heading.split()[0]
                                if re.match(r"v?[0-9]+\.[0-9]+(\.[0-9]+)?", token):
                                    return token.lstrip('v')
                                break
        except Exception:
            pass
        # 3) Latest git tag
        try:
            import subprocess  # local import to avoid cost when unused
            tag = subprocess.check_output(['git','describe','--tags','--abbrev=0'], stderr=subprocess.DEVNULL).decode('utf-8').strip()
            if tag:
                # Normalize leading 'v'
                return tag[1:] if tag.startswith('v') else tag
        except Exception:
            pass
        # 4) Short commit hash appended to 0.0.0+
        try:
            import subprocess
            sc = subprocess.check_output(['git','rev-parse','--short','HEAD'], stderr=subprocess.DEVNULL).decode('utf-8').strip()
            if sc:
                return f"0.0.0+{sc}"
        except Exception:
            pass
        return "dev"

    if args.converter_version in ("auto", "dev", "", None):  # type: ignore[arg-type]
        try:
            args.converter_version = _auto_version()
        except Exception:
            # Leave as 'dev' if anything unexpected occurs
            args.converter_version = "dev"

    if args.auto_output:
        in_base = os.path.splitext(os.path.basename(args.input))[0]
        out_dir = args.output_dir or os.path.dirname(os.path.abspath(args.input)) or os.getcwd()
        # Auto-output now supports single-country {country} expansion when --country-column provided
        if args.split_by_country or ("{country}" in (args.output or "")) or args.output_pattern or args.country_column:
            args.output = os.path.join(out_dir, f"{in_base}_{{country}}.json")
        else:
            args.output = os.path.join(out_dir, f"{in_base}.json")

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
        merge_disclaimer=not args.merge_disclaimer,
        merge_disclaimer_02=not args.merge_disclaimer_02,
        cast_metadata=args.cast_metadata,
        join_claim=args.join_claim,
        prefer_local_claim_disclaimer=args.prefer_local_claim_disclaimer,
        test_mode=args.test_mode,
        claims_as_objects=args.claims_as_objects,
        no_orientation=args.no_orientation,
        country_variant_index=args.country_variant_index,
    )

    # Optionally strip overview if disabled flag set
    if args.no_logo_anim_overview and isinstance(data, dict):
        def _strip(obj: Dict[str, Any]):
            mg = obj.get("metadataGlobal") or obj.get("metadata")
            if isinstance(mg, dict) and "logo_anim_flag" in mg:
                del mg["logo_anim_flag"]
        if data.get("_multi"):
            for _c, node in (data.get("byCountry") or {}).items():
                if isinstance(node, dict):
                    _strip(node)
        else:
            _strip(data)

    # Inject generation timestamp & checksum (before validation so they appear in output / sample)
    def _inject_generation_metadata(obj: Dict[str, Any]):
        try:
            # Compute SHA256 of input CSV once
            h = hashlib.sha256()
            with open(args.input, 'rb') as f_in:
                for chunk in iter(lambda: f_in.read(8192), b''):
                    h.update(chunk)
            checksum = h.hexdigest()
        except Exception:
            checksum = ""
        # Use timezone-aware UTC timestamp (utcnow is deprecated in upcoming Python versions)
        try:
            # Python 3.11+ provides datetime.UTC
            utc_now = datetime.now(datetime.UTC)  # type: ignore[attr-defined]
        except AttributeError:  # Fallback for older Python versions
            from datetime import timezone
            utc_now = datetime.now(timezone.utc)
        # Normalize to Z suffix and drop microseconds for stability
        timestamp = utc_now.replace(microsecond=0).isoformat().replace("+00:00", "Z")

        # Attempt to resolve git commit (best-effort, cached)
        git_commit: Optional[str] = None
        try:
            git_commit = subprocess.check_output([
                'git','rev-parse','--short','HEAD'
            ], stderr=subprocess.DEVNULL).decode('utf-8').strip() or None
        except Exception:
            git_commit = None

        # Environment / toolchain metadata
        py_version = sys.version.split()[0]
        impl = platform.python_implementation()
        platform_str = platform.platform()
        # Parse CHANGELOG.md for last change id (first markdown heading or first line containing a version/commit)
        last_change_id: Optional[str] = None
        # Look for CHANGELOG near this script (python/) or in readMe fallback
        try:
            py_dir = os.path.dirname(os.path.abspath(__file__))
            changelog_candidates = [
                os.path.join(py_dir, 'CHANGELOG.md'),
                os.path.join(py_dir, 'readMe', 'CHANGELOG.md'),
            ]
            for changelog_path in changelog_candidates:
                if os.path.isfile(changelog_path):
                    with open(changelog_path, 'r', encoding='utf-8') as chf:
                        for line in chf:
                            l = line.strip()
                            if l.startswith('#'):
                                # e.g., '# 1.3.0 - 2025-09-29' or '# [1.3.0]'
                                last_change_id = l.lstrip('#').strip()
                                break
                            if l and ('202' in l or '20' in l) and any(c.isdigit() for c in l):
                                last_change_id = l
                                break
                        if last_change_id:
                            break
        except Exception:
            last_change_id = None

        def _augment_payload(pld: Dict[str, Any]):
            if "metadataGlobal" in pld and isinstance(pld.get("metadataGlobal"), dict):
                mg = pld["metadataGlobal"]
                mg["generatedAt"] = timestamp
                mg["inputSha256"] = checksum
                mg.setdefault("inputFileName", os.path.basename(args.input))
                mg["converterVersion"] = args.converter_version
                if git_commit and "converterCommit" not in mg:
                    mg["converterCommit"] = git_commit
                # Environment/toolchain
                mg.setdefault("pythonVersion", py_version)
                mg.setdefault("pythonImplementation", impl)
                mg.setdefault("platform", platform_str)
                if last_change_id and "lastChangeId" not in mg:
                    mg["lastChangeId"] = last_change_id
            elif "metadata" in pld and isinstance(pld.get("metadata"), dict):  # simple/legacy single output shape
                mg = pld["metadata"]
                mg["generatedAt"] = timestamp
                mg["inputSha256"] = checksum
                mg.setdefault("inputFileName", os.path.basename(args.input))
                mg["converterVersion"] = args.converter_version
                if git_commit and "converterCommit" not in mg:
                    mg["converterCommit"] = git_commit
                mg.setdefault("pythonVersion", py_version)
                mg.setdefault("pythonImplementation", impl)
                mg.setdefault("platform", platform_str)
                if last_change_id and "lastChangeId" not in mg:
                    mg["lastChangeId"] = last_change_id

        # Multi-country wrapper
        if isinstance(obj, dict) and obj.get("_multi") and isinstance(obj.get("byCountry"), dict):
            for _c, p in obj.get("byCountry", {}).items():
                if isinstance(p, dict):
                    _augment_payload(p)
        else:
            if isinstance(obj, dict):
                _augment_payload(obj)

    # Only inject when we are actually writing outputs (skip validate-only / dry-run)
    if (not args.no_generation_meta) and (not getattr(args, 'validate_only', False)) and (not getattr(args, 'dry_run', False)):
        _inject_generation_metadata(data)

    # Basic validation helper
    def _validate_structure(obj: Dict[str, Any]) -> Dict[str, List[str]]:
        errs: List[str] = []
        warnings: List[str] = []
        # Determine required global keys from CLI
        raw_keys = args.required_global_keys.strip()
        if raw_keys in ("", '""', "none", "off", "disable", "disabled"):
            required_global_keys = []
        else:
            # Split, strip surrounding quotes, drop empties
            parts = []
            for segment in raw_keys.split(","):
                seg = segment.strip().strip('"').strip("'")
                if seg:
                    parts.append(seg)
            required_global_keys = parts
        # Legacy/simple structure
        if any(k in obj for k in ("subtitles", "claim", "disclaimer", "disclaimer_02")) and "videos" not in obj:
            for arr_name in ("subtitles", "claim", "disclaimer", "disclaimer_02"):
                arr = obj.get(arr_name)
                if arr is None:
                    continue
                if not isinstance(arr, list):
                    errs.append(f"{arr_name} is not a list")
                    continue
                prev_out: Optional[float] = None
                for i, item in enumerate(arr):
                    if not isinstance(item, dict):
                        errs.append(f"{arr_name}[{i}] not an object")
                        continue
                    tin = item.get("in")
                    tout = item.get("out")
                    try:
                        if tin is not None and tout is not None:
                            ftin = float(tin)
                            ftout = float(tout)
                            if ftin > ftout:
                                errs.append(f"{arr_name}[{i}] in > out ({tin} > {tout})")
                            if prev_out is not None and ftin < prev_out:
                                errs.append(f"{arr_name}[{i}] overlaps previous (start {ftin} < prev end {prev_out})")
                            prev_out = ftout
                    except Exception:
                        pass
            return {"errors": errs, "warnings": warnings}

        # Unified per-country per-video shape (orientation-aware unless --no-orientation)
        if args.no_orientation:
            # Expect legacy flat arrays for claim/disclaimer/disclaimer_02/logo
            for nm in ("claim", "disclaimer", "disclaimer_02", "logo"):
                val = obj.get(nm)
                if val is not None and not isinstance(val, list):
                    errs.append(f"{nm} must be a list in --no-orientation mode")
            # Continue with video checks but skip orientation object validation
        else:
            # Orientation top-level objects validation
            def _validate_orientation_array(name: str, val: Any):
                if val is None:
                    return
                if not isinstance(val, dict):
                    errs.append(f"{name} must be an object with landscape/portrait keys")
                    return
                for key in ("landscape", "portrait"):
                    if key not in val:
                        errs.append(f"{name}.{key} missing")
                for key in ("landscape", "portrait"):
                    arr = val.get(key)
                    if arr is None:
                        continue
                    if not isinstance(arr, list):
                        errs.append(f"{name}.{key} not a list")
                    else:
                        # Basic element type check
                        for i, elem in enumerate(arr):
                            if not isinstance(elem, str):
                                errs.append(f"{name}.{key}[{i}] not a string")
                # Mirroring rule: if portrait empty but landscape not, should be mirrored equal length
                if isinstance(val.get("landscape"), list) and isinstance(val.get("portrait"), list):
                    land = val["landscape"]
                    port = val["portrait"]
                    if land and not port:
                        warnings.append(f"{name}: portrait empty while landscape has data (expected mirror)")
                    if land and port and len(port) != len(land):
                        warnings.append(f"{name}: landscape/portrait length mismatch {len(land)}!={len(port)}")

            _validate_orientation_array("claim", obj.get("claim"))
            _validate_orientation_array("disclaimer", obj.get("disclaimer"))
            _validate_orientation_array("disclaimer_02", obj.get("disclaimer_02"))
            _validate_orientation_array("logo", obj.get("logo"))
        # Required global metadata keys if any metadata present (configurable)
        gm = obj.get("metadataGlobal", {})
        if gm and isinstance(gm, dict) and required_global_keys:
            for k in required_global_keys:
                if k not in gm:
                    if args.missing_keys_warn:
                        warnings.append(f"metadataGlobal missing required key '{k}'")
                    else:
                        errs.append(f"metadataGlobal missing required key '{k}'")

        videos = obj.get("videos")
        if videos is not None:
            if not isinstance(videos, list):
                errs.append("videos is not a list")
            else:
                for v_index, v in enumerate(videos):
                    if not isinstance(v, dict):
                        errs.append(f"videos[{v_index}] not an object")
                        continue
                    vid = v.get("videoId")
                    if isinstance(vid, str):
                        if not (vid.endswith("_landscape") or vid.endswith("_portrait")):
                            warnings.append(f"videos[{v_index}].videoId missing orientation suffix")
                    meta = v.get("metadata", {})
                    if isinstance(meta, dict):
                        orient = meta.get("orientation")
                        if isinstance(vid, str) and (vid.endswith("_landscape") or vid.endswith("_portrait")):
                            expected = "landscape" if vid.endswith("_landscape") else "portrait"
                            if orient != expected:
                                errs.append(f"videos[{v_index}].metadata.orientation '{orient}' != expected '{expected}'")
                        # Orientation key should exist for duplicated videos
                        if "orientation" not in meta:
                            warnings.append(f"videos[{v_index}].metadata missing orientation")
                    subs = v.get("subtitles")
                    if subs is None:
                        continue
                    if not isinstance(subs, list):
                        errs.append(f"videos[{v_index}].subtitles not a list")
                        continue
                    prev_out: Optional[float] = None
                    for si, s in enumerate(subs):
                        if not isinstance(s, dict):
                            errs.append(f"videos[{v_index}].subtitles[{si}] not an object")
                            continue
                        tin = s.get("in")
                        tout = s.get("out")
                        try:
                            if tin is not None and tout is not None:
                                ftin = float(tin)
                                ftout = float(tout)
                                if ftin > ftout:
                                    errs.append(f"videos[{v_index}].subtitles[{si}] in > out ({tin} > {tout})")
                                if prev_out is not None and ftin < prev_out:
                                    errs.append(
                                        f"videos[{v_index}].subtitles[{si}] overlaps previous (start {ftin} < prev end {prev_out})"
                                    )
                                prev_out = ftout
                        except Exception:
                            pass
        return {"errors": errs, "warnings": warnings}
    def write_json(path: str, payload: Dict[str, Any]):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    # Create truncated preview of a payload without mutating original
    def make_sample(payload: Dict[str, Any]) -> Dict[str, Any]:
        SAMPLE_LIMITS = {
            "claim": 2,
            "disclaimer": 1,
            "disclaimer_02": 1,
            "logo": 1,
            "videos": 2,
            "subtitles": 5,
            "video_claim": 2,  # per-video claim array length
        }
        def _truncate_top_arrays(obj: Dict[str, Any]):
            out = obj
            if "claim" in out and isinstance(out["claim"], list):
                out["claim"] = out["claim"][:SAMPLE_LIMITS["claim"]]
            if "disclaimer" in out and isinstance(out["disclaimer"], list):
                out["disclaimer"] = out["disclaimer"][:SAMPLE_LIMITS["disclaimer"]]
            if "disclaimer_02" in out and isinstance(out["disclaimer_02"], list):
                out["disclaimer_02"] = out["disclaimer_02"][:SAMPLE_LIMITS["disclaimer_02"]]
            if "logo" in out and isinstance(out["logo"], list):
                out["logo"] = out["logo"][:SAMPLE_LIMITS["logo"]]
            # Orientation-aware objects
            for key in ("claim", "disclaimer", "disclaimer_02", "logo"):
                val = out.get(key)
                if isinstance(val, dict):
                    for orient in ("landscape", "portrait"):
                        arr = val.get(orient)
                        if isinstance(arr, list):
                            limit = SAMPLE_LIMITS["claim"] if key == "claim" else SAMPLE_LIMITS["disclaimer"] if key == "disclaimer" else SAMPLE_LIMITS["disclaimer_02"] if key == "disclaimer_02" else SAMPLE_LIMITS["logo"]
                            val[orient] = arr[:limit]
            return out
        sample = copy.deepcopy(payload)
        # Unified per-country wrapper (we only sample the per-country payloads)
        if sample.get("_multi") and isinstance(sample.get("byCountry"), dict):
            for c, pld in sample.get("byCountry", {}).items():
                sample["byCountry"][c] = make_sample(pld)  # recursive call on each per-country payload
            # Also maybe truncate list of countries
            countries = sample.get("countries")
            if isinstance(countries, list):
                sample["countries"] = countries[:3]
            return sample
        # Per-country payload or legacy/simple shape
        sample = _truncate_top_arrays(sample)
        # Videos
        vids = sample.get("videos")
        if isinstance(vids, list):
            vids_trunc = []
            for v in vids[:SAMPLE_LIMITS["videos"]]:
                v2 = copy.deepcopy(v)
                subs = v2.get("subtitles")
                if isinstance(subs, list):
                    v2["subtitles"] = subs[:SAMPLE_LIMITS["subtitles"]]
                # Claim array
                if "claim" in v2 and isinstance(v2["claim"], list):
                    v2["claim"] = v2["claim"][:SAMPLE_LIMITS["video_claim"]]
                # claim_XX objects (claims-as-objects mode) -> keep only first two by sorted key
                claim_keys = sorted([k for k in v2.keys() if k.startswith("claim_")])
                for ck in claim_keys[SAMPLE_LIMITS["video_claim"]:]:
                    del v2[ck]
                vids_trunc.append(v2)
            sample["videos"] = vids_trunc
        # Simple single-structure legacy (subtitles only)
        if "subtitles" in sample and isinstance(sample["subtitles"], list):
            sample["subtitles"] = sample["subtitles"][:SAMPLE_LIMITS["subtitles"]]
        return sample

    def derive_sample_path(path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}_sample{ext or '.json'}"

    if isinstance(data, dict) and data.get("_multi"):
        countries: List[str] = data.get("countries", [])
        by_country: Dict[str, Any] = data.get("byCountry", {})
        if args.validate_only or args.dry_run:
            all_errors: List[str] = []
            all_warnings: List[str] = []
            reports: List[Dict[str, Any]] = []
            print(f"Discovered countries ({len(countries)}): {countries}")
            for c in countries:
                payload = by_country.get(c, {})
                res = _validate_structure(payload)
                vids_objs = [v for v in payload.get("videos", []) if isinstance(v, dict)]
                vids = [v.get("videoId") for v in vids_objs]
                subtitle_count = sum(len(v.get("subtitles", [])) for v in vids_objs)
                print(
                    f"  {c}: videos={len(vids)} subtitleLines={subtitle_count} claimLines={len(payload.get('claim', []))} disclaimerLines={len(payload.get('disclaimer', []))} disclaimer_02Lines={len(payload.get('disclaimer_02', []))} logoLines={len(payload.get('logo', []))}"
                )
                all_errors.extend([f"{c}: {e}" for e in res["errors"]])
                all_warnings.extend([f"{c}: {w}" for w in res["warnings"]])
                reports.append({
                    "country": c,
                    "errors": res["errors"],
                    "warnings": res["warnings"],
                    "videos": [
                        {"videoId": v.get("videoId"), "subtitleCount": len(v.get("subtitles", []))} for v in vids_objs
                    ],
                    "claimLines": len(payload.get("claim", [])),
                    "disclaimerLines": len(payload.get("disclaimer", [])),
                    "disclaimer_02Lines": len(payload.get("disclaimer_02", [])),
                    "logoLines": len(payload.get("logo", [])),
                })
            if all_warnings:
                print("Validation warnings:")
                for w in all_warnings:
                    print(f"  - {w}")
            if all_errors:
                print("Validation errors:")
                for e in all_errors:
                    print(f"  - {e}")
            # optional report
            if args.validation_report:
                report_obj = {
                    "input": os.path.abspath(args.input),
                    "mode": "validate-only" if args.validate_only else "dry-run",
                    "countries": reports,
                    "summary": {
                        "errors": len(all_errors),
                        "warnings": len(all_warnings),
                    },
                }
                try:
                    os.makedirs(os.path.dirname(os.path.abspath(args.validation_report)), exist_ok=True)
                    with open(args.validation_report, "w", encoding="utf-8") as rf:
                        json.dump(report_obj, rf, ensure_ascii=False, indent=2)
                except Exception as ex:
                    print(f"Failed to write validation report: {ex}")
            if args.validate_only:
                exit_code = 0
                if all_errors and not args.missing_keys_warn:
                    exit_code = 1
                print(
                    "Validation complete (no files written)." + (
                        " Errors found." if exit_code == 1 else " OK (warnings only)." if all_warnings else " OK."
                    )
                )
                return exit_code
            if args.dry_run:
                print("Dry run complete (no files written).")
                return 0
        # Split branch only when explicitly splitting; otherwise handle single-country templating separately
        if args.split_by_country:
            pattern = args.output_pattern or args.output
            # If pattern lacks {country}, inject before extension
            if "{country}" not in pattern:
                root, ext = os.path.splitext(pattern)
                pattern = f"{root}_{{country}}{ext}"
            # Variant counts per country (if provided by convert)
            variant_counts: Dict[str, int] = data.get("_countryVariantCount", {}) if isinstance(data, dict) else {}
            for c in countries:
                count = max(1, int(variant_counts.get(c, 1)))
                for vi in range(count):
                    if vi == 0:
                        payload = by_country.get(c, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}})
                    else:
                        # Re-convert selecting alternate variant pair
                        alt = convert_csv_to_json(
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
                            verbose=False,
                            schema_version=args.schema_version,
                            merge_subtitles=not args.no_merge_subtitles,
                            merge_disclaimer=not args.merge_disclaimer,
                            merge_disclaimer_02=not args.merge_disclaimer_02,
                            cast_metadata=args.cast_metadata,
                            join_claim=args.join_claim,
                            prefer_local_claim_disclaimer=args.prefer_local_claim_disclaimer,
                            test_mode=args.test_mode,
                            claims_as_objects=args.claims_as_objects,
                            no_orientation=args.no_orientation,
                            country_variant_index=vi,
                        )
                        # Inject generation metadata for alternate variant payloads as well
                        if not args.no_generation_meta:
                            try:
                                _inject_generation_metadata(alt)  # type: ignore[arg-type]
                            except Exception:
                                pass
                        payload = (alt.get("byCountry", {}) if isinstance(alt, dict) else {}).get(c, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}})
                    # Per-country export: reduce logo_anim_flag overview to only this country's values
                    mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
                    if isinstance(mg, dict) and "logo_anim_flag" in mg:
                        overview = mg["logo_anim_flag"]
                        if isinstance(overview, dict):
                            trimmed: Dict[str, Any] = {}
                            for dur, val in overview.items():
                                if isinstance(val, dict) and "_default" in val:
                                    # Pick country-specific if exists; else fallback to _default
                                    country_val = val.get(c, val.get("_default"))
                                    trimmed[dur] = country_val
                                else:
                                    # Simple scalar applies to all countries; keep as-is
                                    trimmed[dur] = val
                            mg["logo_anim_flag"] = trimmed
                    # Include language ISO in filename token when present
                    lang = ""
                    if isinstance(mg, dict):
                        try:
                            lang = str(mg.get("language") or "").strip()
                        except Exception:
                            lang = ""
                    country_token = f"{c}_{lang}" if lang else c
                    out_path = pattern.replace("{country}", country_token)
                    if args.verbose:
                        print(f"Writing {out_path}")
                    write_json(out_path, payload)
                    if args.sample:
                        sample_path = derive_sample_path(out_path)
                        write_json(sample_path, make_sample(payload))
        else:
            # Single output selection: choose requested column or the last
            csel = None
            if args.country_column and 1 <= args.country_column <= len(countries):
                csel = countries[args.country_column - 1]
            else:
                csel = countries[-1]
            payload = by_country.get(csel, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}})
            # Also trim overview for single selected country (same logic as split loop)
            mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
            if isinstance(mg, dict) and "logo_anim_flag" in mg:
                overview = mg["logo_anim_flag"]
                if isinstance(overview, dict):
                    trimmed: Dict[str, Any] = {}
                    for dur, val in overview.items():
                        if isinstance(val, dict) and "_default" in val:
                            country_val = val.get(csel, val.get("_default"))
                            trimmed[dur] = country_val
                        else:
                            trimmed[dur] = val
                    mg["logo_anim_flag"] = trimmed
            # Support {country} templating for single-country output (auto-output or explicit pattern containing {country})
            out_path_single = args.output
            # Expand {country} if present in output or pattern (single-country mode)
            if "{country}" in (out_path_single or ""):
                # Use language suffix when present in payload metadataGlobal
                lang_sel = ""
                if isinstance(mg, dict):
                    try:
                        lang_sel = str(mg.get("language") or "").strip()
                    except Exception:
                        lang_sel = ""
                token = f"{csel}_{lang_sel}" if lang_sel else csel
                out_path_single = out_path_single.replace("{country}", token)
            elif args.output_pattern:
                root_pattern = args.output_pattern
                if "{country}" not in root_pattern:
                    rroot, rext = os.path.splitext(root_pattern)
                    root_pattern = f"{rroot}_{{country}}{rext}"
                # Likewise include language suffix when present
                lang_sel = ""
                if isinstance(mg, dict):
                    try:
                        lang_sel = str(mg.get("language") or "").strip()
                    except Exception:
                        lang_sel = ""
                token = f"{csel}_{lang_sel}" if lang_sel else csel
                out_path_single = root_pattern.replace("{country}", token)
            if args.verbose:
                print(f"Writing {out_path_single} (selected country: {csel})")
            write_json(out_path_single, payload)
            if args.sample:
                sample_path = derive_sample_path(out_path_single)
                write_json(sample_path, make_sample(payload))
    else:
        if args.validate_only or args.dry_run:
            res = _validate_structure(data)
            errors = res["errors"]
            warnings = res["warnings"]
            print("Parsed single-structure JSON (legacy/simple mode).")
            if warnings:
                print("Validation warnings:")
                for w in warnings:
                    print(f"  - {w}")
            if errors:
                print("Validation errors:")
                for e in errors:
                    print(f"  - {e}")
            if args.validation_report:
                report_obj = {
                    "input": os.path.abspath(args.input),
                    "legacy": True,
                    "mode": "validate-only" if args.validate_only else "dry-run",
                    "errors": errors,
                    "warnings": warnings,
                }
                try:
                    os.makedirs(os.path.dirname(os.path.abspath(args.validation_report)), exist_ok=True)
                    with open(args.validation_report, "w", encoding="utf-8") as rf:
                        json.dump(report_obj, rf, ensure_ascii=False, indent=2)
                except Exception as ex:
                    print(f"Failed to write validation report: {ex}")
            if args.validate_only:
                exit_code = 0 if (not errors or args.missing_keys_warn) else 1
                print(
                    "Validation complete (no file written)." + (
                        " Errors found." if exit_code == 1 else " OK (warnings only)." if warnings else " OK."
                    )
                )
                return exit_code
            if args.dry_run:
                print("Dry run complete (no file written).")
                return 0
        write_json(args.output, data)
        if args.sample and not (args.validate_only or args.dry_run):
            sample_path = derive_sample_path(args.output)
            write_json(sample_path, make_sample(data))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
