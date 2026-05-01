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
  python3 json_converter.py input.csv output.json --fps 25
"""

from __future__ import annotations

import argparse
import json
import os
import re
import copy
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple, cast

from python.core.columns import (
    _normalize_header_map as _core_normalize_header_map,
    _resolve_column as _core_resolve_column,
    detect_columns as _core_detect_columns,
)
from python.core.generation_metadata import (
    inject_generation_metadata as _core_inject_generation_metadata,
)
from python.core.output_paths import (
    ensure_country_placeholder as _core_ensure_country_placeholder,
    resolve_country_output_path as _core_resolve_country_output_path,
    resolve_single_country_output_path as _core_resolve_single_country_output_path,
    trim_logo_anim_flag_for_country as _core_trim_logo_anim_flag_for_country,
)
from python.core.table_reader import (
    _read_table as _core_read_table,
    _sniff_delimiter as _core_sniff_delimiter,
)
from python.core.sectioned_mode import convert_sectioned_mode as _core_convert_sectioned_mode
from python.core.simple_mode import convert_simple_mode as _core_convert_simple_mode
from python.core.timecode import (
    parse_timecode as _core_parse_timecode,
    safe_int as _core_safe_int,
)
from python.core.unified_processors import (
    UnifiedState,
    build_unified_multi_country_output as _core_build_unified_multi_country_output,
    collect_country_texts as _core_collect_country_texts,
    join_claim_rows_by_timing as _core_join_claim_rows_by_timing,
    join_claim_rows_by_timing_per_video as _core_join_claim_rows_by_timing_per_video,
    merge_and_dedup_video_rows as _core_merge_and_dedup_video_rows,
    merge_disclaimer_blocks as _core_merge_disclaimer_blocks,
    normalize_controller_record as _core_normalize_controller_record,
    process_claim_row as _core_process_claim_row,
    process_controller_row as _core_process_controller_row,
    process_disclaimer_row as _core_process_disclaimer_row,
    process_endframe_row as _core_process_endframe_row,
    process_meta_global_row as _core_process_meta_global_row,
    process_meta_local_row as _core_process_meta_local_row,
    process_logo_row as _core_process_logo_row,
    process_sub_row as _core_process_sub_row,
    process_super_a_row as _core_process_super_a_row,
    process_super_b_row as _core_process_super_b_row,
    propagate_all_scope_texts as _core_propagate_all_scope_texts,
)


def _resolve_tools_path(module_name: str) -> str:
    meipass = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and isinstance(meipass, str):
        bundled_path = os.path.join(meipass, "python", "tools", f"{module_name}.py")
        if os.path.exists(bundled_path):
            return bundled_path
        alt_bundled_path = os.path.join(meipass, "tools", f"{module_name}.py")
        if os.path.exists(alt_bundled_path):
            return alt_bundled_path
        return bundled_path
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "tools", f"{module_name}.py"
    )


# Optional media injection support (CSV → JSON media tool)
try:
    from python.tools.media_converter import (
        read_csv as media_read_csv,
        group_by_country_language as media_group_by_country_language,
        convert_rows as media_convert_rows,
    )
except Exception:
    # Fallback: load from local tools path when executed as a script from within the package directory
    try:
        import importlib.util as _ilu

        _tools_path = _resolve_tools_path("media_converter")
        _spec = _ilu.spec_from_file_location("_media_converter", _tools_path)
        if _spec and _spec.loader:
            _mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)  # type: ignore[arg-type]
            media_read_csv = getattr(_mod, "read_csv", None)
            media_group_by_country_language = getattr(
                _mod, "group_by_country_language", None
            )
            media_convert_rows = getattr(_mod, "convert_rows", None)
        else:
            media_read_csv = None  # type: ignore[assignment]
            media_group_by_country_language = None  # type: ignore[assignment]
            media_convert_rows = None  # type: ignore[assignment]
    except Exception:
        media_read_csv = None  # type: ignore[assignment]
        media_group_by_country_language = None  # type: ignore[assignment]
        media_convert_rows = None  # type: ignore[assignment]

# Optional addLayers injection support (XLSX -> LAYER_NAME_CONFIG)
try:
    from python.tools.config_converter import (
        convert_workbook as layercfg_convert_workbook,
    )
except Exception:
    try:
        import importlib.util as _ilu

        _tools_path = _resolve_tools_path("config_converter")
        _spec = _ilu.spec_from_file_location("_config_converter", _tools_path)
        if _spec and _spec.loader:
            _mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)  # type: ignore[arg-type]
            layercfg_convert_workbook = getattr(_mod, "convert_workbook", None)
        else:
            layercfg_convert_workbook = None  # type: ignore[assignment]
    except Exception:
        layercfg_convert_workbook = None  # type: ignore[assignment]


def parse_timecode(value: str, fps: float) -> float:
    return _core_parse_timecode(value, fps)


def safe_int(val: Any, default: int = 0) -> int:
    return _core_safe_int(val, default)


def _normalize_header_map(headers: List[str]) -> Dict[str, str]:
    return _core_normalize_header_map(headers)


def _resolve_column(
    headers: List[str],
    override: Optional[str],
    candidates: Tuple[str, ...],
) -> Optional[str]:
    return _core_resolve_column(headers, override, candidates)


def detect_columns(
    headers: List[str],
    start_override: Optional[str] = None,
    end_override: Optional[str] = None,
    text_override: Optional[str] = None,
) -> Tuple[str, str, str]:
    return _core_detect_columns(
        headers,
        start_override=start_override,
        end_override=end_override,
        text_override=text_override,
    )


def _sniff_delimiter(sample: str, preferred: Optional[str] = None) -> str:
    return _core_sniff_delimiter(sample, preferred)


def _read_table(
    path: str,
    encoding: str = "utf-8-sig",
    delimiter: Optional[str] = None,
    xlsx_sheet: Optional[str] = None,
) -> Tuple[List[str], List[List[str]], str]:
    return _core_read_table(
        path,
        encoding=encoding,
        delimiter=delimiter,
        xlsx_sheet=xlsx_sheet,
    )


def convert_csv_to_json(
    input_csv: str,
    fps: Optional[float] = None,
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
    flags_overview_object_always: bool = False,
    xlsx_sheet: Optional[str] = None,
    controller_always_emit: bool = False,
) -> Dict[str, Any]:
    """Convert CSV to JSON. Supports two modes:

    1) Simple mode (original): columns Start Time, End Time, Text (optional line) → {"subtitles": [...]}.
    2) Sectioned mode (Excel export): first column marks section (subtitles/claim/disclaimer/metadata),
       columns include line, Start Time, End Time, and one or more Text columns (per-country). Metadata rows
       provide key/value pairs; a row with key 'country' defines per-country codes.
    """
    headers, rows, delim = _read_table(
        input_csv, encoding=encoding, delimiter=delimiter, xlsx_sheet=xlsx_sheet
    )
    if verbose:
        print(f"Detected delimiter: {repr(delim)} | Headers: {headers}")
    if not rows:
        return {"subtitles": []}

    lower_headers = [h.strip().lower() for h in headers]
    # Effective FPS precedence:
    # 1) Explicit function/CLI override (`fps` argument)
    # 2) `meta_global` key `fps` from unified-schema input data
    # 3) Fallback default 25.0
    effective_fps = float(fps) if fps is not None else 25.0

    # --------------------------------------------------
    # Unified schema path (record_type present)
    # --------------------------------------------------
    if "record_type" in lower_headers:
        # Column indices
        idx_record_type = lower_headers.index("record_type")
        idx_video_id = (
            lower_headers.index("video_id") if "video_id" in lower_headers else None
        )
        idx_line = lower_headers.index("line") if "line" in lower_headers else None
        idx_start = lower_headers.index("start") if "start" in lower_headers else None
        idx_end = lower_headers.index("end") if "end" in lower_headers else None
        idx_key = lower_headers.index("key") if "key" in lower_headers else None
        idx_target_duration = (
            lower_headers.index("target_duration")
            if "target_duration" in lower_headers
            else None
        )
        # idx_is_global = lower_headers.index("is_global") if "is_global" in lower_headers else None
        idx_country_scope = (
            lower_headers.index("country_scope")
            if "country_scope" in lower_headers
            else None
        )
        idx_metadata_val = (
            lower_headers.index("metadata") if "metadata" in lower_headers else None
        )

        # Country columns: all columns after metadata value column (if present) else after country_scope
        country_start_idx = None
        if idx_metadata_val is not None:
            country_start_idx = idx_metadata_val + 1
        elif idx_country_scope is not None:
            country_start_idx = idx_country_scope + 1
        else:
            country_start_idx = (
                max([c for c in [idx_end, idx_key] if c is not None] or [0]) + 1
            )

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
            port = (
                occ[2 * vi + 1]
                if len(occ) > 2 * vi + 1
                else (occ[1] if len(occ) > 1 else None)
            )
            country_orientation_cols[c] = {"landscape": land, "portrait": port}
        if verbose:
            print(
                f"Unified schema detected. Countries: {countries} (orientation column mapping: {country_orientation_cols})"
            )

        def _parse_positive_fps(raw_value: Any) -> Optional[float]:
            token = str(raw_value).strip() if raw_value is not None else ""
            if not token:
                return None
            try:
                parsed = float(token)
            except (TypeError, ValueError):
                return None
            return parsed if parsed > 0 else None

        def _resolve_fps_from_meta_global() -> Optional[float]:
            if idx_key is None:
                return None
            for row in rows:
                normalized_row = row
                if len(normalized_row) < len(headers):
                    normalized_row = normalized_row + [""] * (
                        len(headers) - len(normalized_row)
                    )
                rt_value = (
                    normalized_row[idx_record_type].strip().lower()
                    if idx_record_type < len(normalized_row)
                    and normalized_row[idx_record_type]
                    else ""
                )
                if rt_value not in ("meta_global", "meta-global"):
                    continue
                key_value = (
                    normalized_row[idx_key].strip().lower()
                    if idx_key < len(normalized_row) and normalized_row[idx_key]
                    else ""
                )
                if key_value != "fps":
                    continue

                # Prefer canonical metadata cell first.
                if idx_metadata_val is not None and idx_metadata_val < len(
                    normalized_row
                ):
                    parsed_meta = _parse_positive_fps(normalized_row[idx_metadata_val])
                    if parsed_meta is not None:
                        return parsed_meta

                # Then try country text columns (first valid wins).
                for col_idx in range(country_start_idx, len(headers)):
                    if col_idx >= len(normalized_row):
                        continue
                    parsed_country = _parse_positive_fps(normalized_row[col_idx])
                    if parsed_country is not None:
                        return parsed_country
            return None

        if fps is None:
            resolved_fps = _resolve_fps_from_meta_global()
            if resolved_fps is not None:
                effective_fps = resolved_fps
                if verbose:
                    print(f"Using fps from input meta_global: {effective_fps}")
            elif verbose:
                print("No valid meta_global fps found; using fallback fps=25.0")
        elif verbose:
            print(f"Using explicit fps override: {effective_fps}")

        def parse_time_optional(val: str) -> Optional[float]:
            v = (val or "").strip()
            if not v:
                return None
            try:
                return parse_timecode(v, effective_fps)
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

        unified_state = UnifiedState()
        global_meta = unified_state.global_meta
        # Per-country overrides for certain meta_global keys (currently jobNumber)
        job_number_per_country = unified_state.job_number_per_country
        # Per-country language mapping from meta_global language row
        language_per_country = unified_state.language_per_country
        videos = unified_state.videos
        video_order = unified_state.video_order
        # Per-video, per-country meta_local overrides for flag keys (auto-detected by *_flag suffix)
        per_video_meta_local_country = unified_state.per_video_meta_local_country
        # Global default flags per country (meta_global rows without target_duration)
        global_flag_defaults_per_country = unified_state.global_flag_defaults_per_country
        # Global targeted flags per country (meta_global rows with target_duration)
        global_flag_targeted_per_country = unified_state.global_flag_targeted_per_country
        # All globally detected flags (for metadataGlobal overview emission)
        global_flags_seen = unified_state.global_flags_seen
        # Intermediate containers before splitting per country
        claims_rows = unified_state.claims_rows
        per_video_claim_rows = unified_state.per_video_claim_rows
        disc_rows_raw = unified_state.disc_rows_raw
        per_video_disc_rows_raw = unified_state.per_video_disc_rows_raw
        disc_02_rows_raw = unified_state.disc_02_rows_raw
        per_video_disc_02_rows_raw = unified_state.per_video_disc_02_rows_raw
        # Logo rows (global text + per-video timings)
        logo_rows_raw = unified_state.logo_rows_raw
        per_video_logo_rows_raw = unified_state.per_video_logo_rows_raw
        # endFrame rows (per-video timings; optional text columns similar to logo)
        endframe_rows_raw = unified_state.endframe_rows_raw
        per_video_endframe_rows_raw = unified_state.per_video_endframe_rows_raw
        # Controller timed keys (scalable): controller_01 .. controller_NN
        controller_rows_raw = unified_state.controller_rows_raw
        per_video_controller_rows_raw = unified_state.per_video_controller_rows_raw
        controller_keys_seen = unified_state.controller_keys_seen
        # subs_rows reserved for future use (not needed currently)

        auto_claim_line = unified_state.auto_claim_line
        auto_disc_line = unified_state.auto_disc_line
        auto_disc_02_line = unified_state.auto_disc_02_line
        auto_logo_line = unified_state.auto_logo_line
        auto_claim_line_per_video = unified_state.auto_claim_line_per_video
        auto_disc_line_per_video = unified_state.auto_disc_line_per_video
        auto_disc_02_line_per_video = unified_state.auto_disc_02_line_per_video
        auto_logo_line_per_video = unified_state.auto_logo_line_per_video
        auto_endframe_line = unified_state.auto_endframe_line
        auto_endframe_line_per_video = unified_state.auto_endframe_line_per_video
        auto_controller_line_per_key = unified_state.auto_controller_line_per_key
        auto_controller_line_per_video_per_key = (
            unified_state.auto_controller_line_per_video_per_key
        )
        auto_sub_line_per_video = unified_state.auto_sub_line_per_video
        auto_super_a_line_per_video = unified_state.auto_super_a_line_per_video
        auto_super_b_line_per_video = unified_state.auto_super_b_line_per_video
        for r in rows:
            if len(r) < len(headers):
                r = r + [""] * (len(headers) - len(r))
            rt = r[idx_record_type].strip().lower() if r[idx_record_type] else ""
            if not rt:
                continue

            video_id = (
                r[idx_video_id].strip()
                if (idx_video_id is not None and r[idx_video_id])
                else ""
            )
            line_raw = (
                r[idx_line].strip() if (idx_line is not None and r[idx_line]) else ""
            )
            try:
                line_num = int(line_raw) if line_raw else None
            except Exception:
                line_num = None
            start_tc = (
                parse_time_optional(r[idx_start]) if idx_start is not None else None
            )
            end_tc = parse_time_optional(r[idx_end]) if idx_end is not None else None

            key_name = (
                r[idx_key].strip() if (idx_key is not None and r[idx_key]) else ""
            )
            target_duration_val = (
                r[idx_target_duration].strip()
                if (idx_target_duration is not None and r[idx_target_duration])
                else ""
            )
            country_scope_raw = (
                r[idx_country_scope].strip()
                if (idx_country_scope is not None and r[idx_country_scope])
                else ""
            )
            country_scope_val = country_scope_raw.upper()
            metadata_cell_val = (
                r[idx_metadata_val].strip()
                if (idx_metadata_val is not None and r[idx_metadata_val])
                else ""
            )

            texts, texts_portrait = _core_collect_country_texts(
                row=r,
                countries=countries,
                country_orientation_cols=country_orientation_cols,
            )
            _core_propagate_all_scope_texts(
                country_scope_val=country_scope_val,
                texts=texts,
                texts_portrait=texts_portrait,
                countries=countries,
            )

            # Metadata rows
            if rt in ("meta_global", "meta-global"):
                if _core_process_meta_global_row(
                    state=unified_state,
                    key_name=key_name,
                    countries=countries,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    metadata_cell_val=metadata_cell_val,
                    target_duration_val=target_duration_val,
                    country_scope_raw=country_scope_raw,
                ):
                    continue
            if rt in ("meta_local", "meta-local"):
                if _core_process_meta_local_row(
                    state=unified_state,
                    key_name=key_name,
                    video_id=video_id,
                    countries=countries,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    metadata_cell_val=metadata_cell_val,
                ):
                    continue

            # Claim rows (each row independent)
            if rt == "claim":
                if _core_process_claim_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                ):
                    auto_claim_line = unified_state.auto_claim_line
                continue

            # Disclaimer rows (will merge later)
            if rt == "disclaimer":
                if _core_process_disclaimer_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    is_disclaimer_02=False,
                ):
                    auto_disc_line = unified_state.auto_disc_line
                continue

            # Disclaimer_02 rows (will merge later)
            if rt == "disclaimer_02":
                if _core_process_disclaimer_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    is_disclaimer_02=True,
                ):
                    auto_disc_02_line = unified_state.auto_disc_02_line
                continue

            # Logo rows (timed per-video, text defined globally)
            if rt == "logo":
                if _core_process_logo_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                ):
                    auto_logo_line = unified_state.auto_logo_line
                continue

            # endFrame rows (timed per-video, optional text like logo)
            if rt == "endframe" or rt == "end_frame":
                if _core_process_endframe_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                ):
                    auto_endframe_line = unified_state.auto_endframe_line
                continue

            # Subtitle rows
            if rt == "sub":
                _core_process_sub_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    start_line_index=start_line_index,
                )
                continue

            # Super_A rows (follows subtitle pattern exactly)
            if rt == "super_a":
                _core_process_super_a_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    start_line_index=start_line_index,
                )
                continue

            # Super_B rows (follows super_A pattern exactly)
            if rt == "super_b":
                _core_process_super_b_row(
                    state=unified_state,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    start_line_index=start_line_index,
                )
                continue

            # Controller timed rows (scalable): controller_01 .. controller_NN
            controller_key = _core_normalize_controller_record(rt)
            if controller_key:
                _core_process_controller_row(
                    state=unified_state,
                    controller_key=controller_key,
                    video_id=video_id,
                    line_num=line_num,
                    start_tc=start_tc,
                    end_tc=end_tc,
                    texts=texts,
                    texts_portrait=texts_portrait,
                    start_line_index=start_line_index,
                )
                continue

            # Unknown record type ignored
            continue

        # Merge disclaimer rows into blocks
        disclaimers_rows_merged = _core_merge_disclaimer_blocks(
            rows_raw=disc_rows_raw,
            countries=countries,
            merge_enabled=merge_disclaimer,
        )

        # Merge disclaimer_02 rows into blocks
        disclaimers_02_rows_merged = _core_merge_disclaimer_blocks(
            rows_raw=disc_02_rows_raw,
            countries=countries,
            merge_enabled=merge_disclaimer_02,
        )

        # Merge contiguous subtitle/super rows and deduplicate non-contiguous repeats.
        _core_merge_and_dedup_video_rows(
            videos=videos,
            countries=countries,
            merge_subtitles=merge_subtitles,
        )

        # Optional join of claim rows by identical timing.
        if join_claim and claims_rows:
            claims_rows = _core_join_claim_rows_by_timing(
                claims_rows=claims_rows,
                countries=countries,
            )

        # Optional join for per-video claim rows.
        if join_claim and per_video_claim_rows:
            per_video_claim_rows = _core_join_claim_rows_by_timing_per_video(
                per_video_claim_rows=per_video_claim_rows,
                countries=countries,
            )

        return _core_build_unified_multi_country_output(
            countries=countries,
            country_variant_counts=country_variant_counts,
            controller_keys_seen=controller_keys_seen,
            claims_rows=claims_rows,
            disclaimers_rows_merged=disclaimers_rows_merged,
            disclaimers_02_rows_merged=disclaimers_02_rows_merged,
            logo_rows_raw=logo_rows_raw,
            controller_rows_raw=controller_rows_raw,
            video_order=video_order,
            videos=videos,
            global_flag_defaults_per_country=global_flag_defaults_per_country,
            global_flag_targeted_per_country=global_flag_targeted_per_country,
            per_video_meta_local_country=per_video_meta_local_country,
            skip_empty_text=skip_empty_text,
            fmt_time=fmt_time,
            per_video_claim_rows=per_video_claim_rows,
            per_video_disc_rows_raw=per_video_disc_rows_raw,
            merge_disclaimer=merge_disclaimer,
            per_video_disc_02_rows_raw=per_video_disc_02_rows_raw,
            merge_disclaimer_02=merge_disclaimer_02,
            per_video_logo_rows_raw=per_video_logo_rows_raw,
            endframe_rows_raw=endframe_rows_raw,
            per_video_endframe_rows_raw=per_video_endframe_rows_raw,
            per_video_controller_rows_raw=per_video_controller_rows_raw,
            prefer_local_claim_disclaimer=prefer_local_claim_disclaimer,
            test_mode=test_mode,
            claims_as_objects=claims_as_objects,
            controller_always_emit=controller_always_emit,
            global_meta=global_meta,
            job_number_per_country=job_number_per_country,
            language_per_country=language_per_country,
            cast_metadata=cast_metadata,
            flags_overview_object_always=flags_overview_object_always,
            schema_version=schema_version,
            no_orientation=no_orientation,
        )

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
    simple_mode = (
        (find_col(("starttime", "start", "in", "inpoint")) is not None)
        and (len(text_cols) <= 1)
        and (
            headers[0].strip().lower()
            not in ("subtitles", "claim", "disclaimer", "metadata")
        )
    )
    if simple_mode:
        return _core_convert_simple_mode(
            rows=rows,
            headers=headers,
            effective_fps=effective_fps,
            start_line_index=start_line_index,
            round_ndigits=round_ndigits,
            times_as_string=times_as_string,
            strip_text=strip_text,
            skip_empty_text=skip_empty_text,
            start_col=start_col,
            end_col=end_col,
            text_col=text_col,
        )

    return _core_convert_sectioned_mode(
        rows=rows,
        headers=headers,
        effective_fps=effective_fps,
        start_line_index=start_line_index,
        round_ndigits=round_ndigits,
        times_as_string=times_as_string,
        strip_text=strip_text,
        skip_empty_text=skip_empty_text,
        text_col=text_col,
    )


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Convert subtitle CSV/XLSX to JSON")
    p.add_argument("input", help="Path to input CSV file")
    p.add_argument("output", help="Path to output JSON file")
    p.add_argument(
        "--fps",
        type=float,
        default=None,
        help="Frames per second for HH:MM:SS:FF timecodes. Default: use input meta_global fps when present, otherwise 25. Use this flag to override input FPS.",
    )
    p.add_argument(
        "--no-orientation",
        action="store_true",
        help="Emit legacy non-orientation shape: flat claim/disclaimer/logo arrays and single videoId (landscape only)",
    )
    p.add_argument(
        "--start-line",
        type=int,
        default=1,
        help="Starting line index in output (default: 1)",
    )
    p.add_argument(
        "--round",
        dest="round_digits",
        type=int,
        default=2,
        help="Round seconds to N digits (default: 2; use -1 to disable)",
    )
    p.add_argument(
        "--times-as-string",
        action="store_true",
        help="Write time values as strings (keeps trailing zeros)",
    )
    p.add_argument(
        "--no-strip-text",
        action="store_true",
        help="Do not strip whitespace from text cells",
    )
    p.add_argument(
        "--keep-empty-text",
        action="store_true",
        help="Keep rows where text is empty/whitespace",
    )
    p.add_argument(
        "--encoding", default="utf-8-sig", help="CSV file encoding (default: utf-8-sig)"
    )
    p.add_argument(
        "--delimiter",
        default="auto",
        help=(
            "CSV delimiter. One of: auto (default), comma, semicolon, tab, pipe, or a single character. "
            "If auto, the script will sniff among , ; TAB |"
        ),
    )
    p.add_argument(
        "--xlsx-sheet",
        default=None,
        help="XLSX only: sheet name to read (default: 'data' if present, otherwise first sheet)",
    )
    p.add_argument(
        "--start-col",
        help="Override Start column by name or 1-based index",
        default=None,
    )
    p.add_argument(
        "--end-col", help="Override End column by name or 1-based index", default=None
    )
    p.add_argument(
        "--text-col", help="Override Text column by name or 1-based index", default=None
    )
    p.add_argument(
        "--verbose", action="store_true", help="Print detected delimiter and headers"
    )
    p.add_argument(
        "--schema-version",
        default="v2",
        help="Schema version tag to use if not supplied via meta_global 'schemaVersion' row (default v2)",
    )
    p.add_argument(
        "--no-merge-subtitles",
        action="store_true",
        help="Disable merging of multi-line subtitles with same line number",
    )
    p.add_argument(
        "--merge-disclaimer",
        action="store_false",
        help="Disable merging of multi-line disclaimer continuation lines",
    )
    p.add_argument(
        "--merge-disclaimer-02",
        action="store_false",
        help="Disable merging of multi-line disclaimer_02 continuation lines",
    )
    p.add_argument(
        "--cast-metadata",
        action="store_true",
        help="Attempt numeric casting of metadata values (int/float detection)",
    )
    p.add_argument(
        "--join-claim",
        action="store_true",
        help="Join multiple claim rows with same timing into one block (newline separated)",
    )
    p.add_argument(
        "--prefer-local-claim-disclaimer",
        action="store_false",
        dest="prefer_local_claim_disclaimer",
        help="(Deprecated name) Disable per-video local claim/disclaimer override (default: enabled)",
    )
    p.add_argument(
        "--no-local-claim-override",
        action="store_false",
        dest="prefer_local_claim_disclaimer",
        help="Alias: disable per-video local claim/disclaimer override (default: enabled)",
    )
    p.add_argument(
        "--test-mode",
        action="store_true",
        help="Prefix per-video claim/disclaimer/disclaimer_02 text with '<videoId>_' for testing",
    )
    p.add_argument(
        "--claims-as-objects",
        action="store_true",
        help="In each video, output claims as claim_01, claim_02, ... objects instead of a single 'claim' array",
    )
    p.add_argument(
        "--check",
        action="store_true",
        help="Run validation + inspection preview only; do not write output files",
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="With --check: return non-zero when validation errors are present",
    )
    p.add_argument(
        "--required-global-keys",
        default="briefVersion,fps",
        help="Comma-separated list of required keys that must appear in metadataGlobal (default: briefVersion,fps). Empty string to disable.",
    )
    p.add_argument(
        "--missing-keys-warn",
        action="store_true",
        help="Treat missing required global metadata keys as warnings (do not fail validation)",
    )
    p.add_argument(
        "--validation-report",
        default=None,
        help="Write a JSON validation report to this path during --check",
    )
    p.add_argument(
        "--auto-output",
        action="store_true",
        help="Derive output name from input base (adds _{country} when splitting)",
    )
    p.add_argument(
        "--output-dir",
        default=None,
        help="Directory for auto-derived outputs (default: input file directory)",
    )
    p.add_argument(
        "--split-by-country",
        action="store_true",
        help="When multiple Text columns exist, write one JSON per country using output pattern",
    )
    p.add_argument(
        "--country-column",
        type=int,
        default=None,
        help="1-based index among Text columns to select when not splitting",
    )
    p.add_argument(
        "--output-pattern",
        default=None,
        help="Pattern for outputs; use {country}. Applies to split mode and to single-country exports with --country-column. If omitted, infer from output path by inserting _{country} before extension.",
    )
    p.add_argument(
        "--country-variant-index",
        type=int,
        default=None,
        help=(
            "Select which duplicated country column pair (variant) to use (0-based). When omitted, first pair is used."
        ),
    )
    p.add_argument(
        "--sample",
        action="store_true",
        help="Also write a truncated preview JSON alongside each output (adds _sample before extension)",
    )
    p.add_argument(
        "--converter-version",
        default="auto",
        help=(
            "Converter build/version tag. If set to 'auto' (default) or left as 'dev', the tool will attempt to derive a version automatically in this order: "
            "1) CONVERTER_VERSION env var, 2) first heading in CHANGELOG.md, 3) latest git tag, 4) '0.0.0+<shortcommit>', else 'dev'."
        ),
    )
    p.add_argument(
        "--no-generation-meta",
        action="store_true",
        help="Disable injection of generation metadata (generatedAt, inputSha256, converterVersion, etc.)",
    )
    p.add_argument(
        "--no-logo-anim-overview",
        action="store_true",
        help="Do not embed aggregated logo_anim_flag mapping object in metadataGlobal (CSV to JSON 47)",
    )
    p.add_argument(
        "--flags-overview-object-always",
        action="store_true",
        help="Emit metadataGlobal *_flag overviews always as objects (default behavior emits scalar when default-only and object when targeted exists)",
    )
    p.add_argument(
        "--controller-always-emit",
        action="store_true",
        help="Legacy behavior: emit per-video controller_NN rows from global controller_NN when local rows are missing",
    )

    # Media injection (CSV to JSON media)
    p.add_argument(
        "--media-config",
        default=None,
        help="Optional path to media config CSV/XLSX for injection per country/language (exact match only)",
    )
    p.add_argument(
        "--media-delimiter", default=";", help="Delimiter for media CSV (default ';')"
    )
    p.add_argument(
        "--media-country-col",
        default="Country",
        help="Country column name in media CSV (default 'Country')",
    )
    p.add_argument(
        "--media-language-col",
        default="Language",
        help="Language column name in media CSV (default 'Language')",
    )
    p.add_argument(
        "--layer-config",
        default=None,
        help="Optional path to layer config XLSX for injection into config.addLayers",
    )
    p.add_argument(
        "--layer-config-required",
        action="store_true",
        help=(
            "Treat all --layer-config failures as fatal: missing file, converter unavailable, "
            "and conversion errors all abort with rc=1. "
            "By default all three are non-fatal warnings and conversion continues."
        ),
    )

    args = p.parse_args(argv)

    runtime_error_count = 0

    def _report_runtime_error(message: str):
        nonlocal runtime_error_count
        runtime_error_count += 1
        print(message, file=sys.stderr)

    def _print_conversion_summary(files_written: int, validation_errors: int = 0):
        print(
            f"Conversion complete: Files written: {files_written}, Errors: {runtime_error_count + validation_errors}"
        )

    if not os.path.exists(args.input):
        _report_runtime_error(
            f"FileNotFoundError: [Errno 2] No such file or directory: '{args.input}'"
        )
        _print_conversion_summary(0)
        return 1

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
                            stripped_line = line.strip()
                            if stripped_line.startswith("#"):
                                # Extract first token after '#'
                                heading = stripped_line.lstrip("#").strip()
                                # Common forms: "1.3.1 - 2025-09-29" or "[1.3.1]" etc.
                                m = re.match(
                                    r"\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.]+)?)",
                                    heading,
                                )
                                if m:
                                    return m.group(1)
                                # Fallback: take first contiguous non-space chunk
                                token = heading.split()[0]
                                if re.match(r"v?[0-9]+\.[0-9]+(\.[0-9]+)?", token):
                                    return token.lstrip("v")
                                break
        except Exception:
            pass
        # 3) Latest git tag
        try:
            import subprocess  # local import to avoid cost when unused

            tag = (
                subprocess.check_output(
                    ["git", "describe", "--tags", "--abbrev=0"],
                    stderr=subprocess.DEVNULL,
                )
                .decode("utf-8")
                .strip()
            )
            if tag:
                # Normalize leading 'v'
                return tag[1:] if tag.startswith("v") else tag
        except Exception:
            pass
        # 4) Short commit hash appended to 0.0.0+
        try:
            import subprocess

            sc = (
                subprocess.check_output(
                    ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
                )
                .decode("utf-8")
                .strip()
            )
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
        out_dir = (
            args.output_dir
            or os.path.dirname(os.path.abspath(args.input))
            or os.getcwd()
        )
        # Auto-output now supports single-country {country} expansion when --country-column provided
        if (
            args.split_by_country
            or ("{country}" in (args.output or ""))
            or args.output_pattern
            or args.country_column
        ):
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
        flags_overview_object_always=args.flags_overview_object_always,
        xlsx_sheet=args.xlsx_sheet,
        controller_always_emit=args.controller_always_emit,
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

    # Only inject when we are actually writing outputs (skip --check mode)
    if (not args.no_generation_meta) and (not getattr(args, "check", False)):
        _core_inject_generation_metadata(
            data,
            input_path=args.input,
            converter_version=args.converter_version,
            script_file_path=__file__,
        )

    # Prepare addLayers config once (if provided)
    layer_config_payload: Optional[Dict[str, Any]] = None
    if args.layer_config:
        if not os.path.isfile(args.layer_config):
            _report_runtime_error(
                f"Warning: failed to load layer config '{args.layer_config}': "
                f"[Errno 2] No such file or directory: '{args.layer_config}'"
            )
            if args.layer_config_required:
                _print_conversion_summary(0)
                return 1
        elif layercfg_convert_workbook is None:
            _report_runtime_error(
                "Layer config converter not available; cannot process --layer-config"
            )
            if args.layer_config_required:
                _print_conversion_summary(0)
                return 1
        else:
            try:
                converted = layercfg_convert_workbook(
                    in_path=args.layer_config,
                    separator=";",
                    layer_names_sheet="LAYER_NAME_CONFIG_items",
                    recenter_rules_sheet="LAYER_NAME_CONFIG_recenterRules",
                    root_key="LAYER_NAME_CONFIG",
                )
                if isinstance(converted, dict):
                    add_layers_payload: Optional[Dict[str, Any]] = None
                    cfg = converted.get("config")
                    if isinstance(cfg, dict):
                        add_layers = cfg.get("addLayers")
                        if isinstance(add_layers, dict):
                            add_layers_payload = cast(Dict[str, Any], add_layers)
                    if add_layers_payload is None:
                        legacy_add_layers = converted.get("addLayers")
                        if isinstance(legacy_add_layers, dict):
                            add_layers_payload = cast(Dict[str, Any], legacy_add_layers)
                    if add_layers_payload is None:
                        legacy = converted.get("LAYER_NAME_CONFIG")
                        if isinstance(legacy, dict):
                            add_layers_payload = {"LAYER_NAME_CONFIG": legacy}

                    if isinstance(add_layers_payload, dict):
                        layer_config_payload = add_layers_payload
                    else:
                        raise ValueError(
                            "layer config payload missing config.addLayers/LAYER_NAME_CONFIG"
                        )
            except Exception as ex:
                _report_runtime_error(
                    f"Failed to load layer config '{args.layer_config}': {ex}"
                )
                if args.layer_config_required:
                    _print_conversion_summary(0)
                    return 1

    # Prepare media mappings once (if provided) for exact (country, language) match only
    media_groups_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
    if args.media_config:
        if (
            media_read_csv is None
            or media_group_by_country_language is None
            or media_convert_rows is None
        ):
            print(
                "Warning: media tools not available; skipping --media-config integration",
                file=sys.stderr,
            )
        elif not os.path.isfile(args.media_config):
            _report_runtime_error(
                f"Warning: failed to load media config '{args.media_config}': "
                f"[Errno 2] No such file or directory: '{args.media_config}'"
            )
        else:
            try:
                m_rows = media_read_csv(
                    args.media_config, delimiter=args.media_delimiter
                )
                groups = media_group_by_country_language(
                    m_rows,
                    country_col=args.media_country_col,
                    language_col=args.media_language_col,
                    trim=True,
                )
                # Build mapping per (country, language)
                for (ctry, lang), g_rows in groups.items():
                    mapping = media_convert_rows(g_rows, trim=True)
                    # Keep only non-empty mappings to avoid injecting empty objects
                    if mapping:
                        media_groups_map[(ctry, lang)] = mapping
            except Exception as ex:
                print(
                    f"Warning: failed to load media config '{args.media_config}': {ex}",
                    file=sys.stderr,
                )

    def _inject_media(payload: Dict[str, Any], country_code: str):
        if not media_groups_map:
            return
        mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
        if not isinstance(mg, dict):
            return
        try:
            lang = str(mg.get("language") or "").strip()
        except Exception:
            lang = ""
        key = (country_code, lang)
        media_map = media_groups_map.get(key)
        if media_map:
            # Inject into config namespace: config.pack.EXTRA_OUTPUT_COMPS
            config = payload.setdefault("config", {})
            if isinstance(config, dict):
                pack = config.setdefault("pack", {})
                if isinstance(pack, dict):
                    pack["EXTRA_OUTPUT_COMPS"] = media_map

    def _inject_layer_config(payload: Dict[str, Any]):
        if not layer_config_payload:
            return
        config = payload.setdefault("config", {})
        if isinstance(config, dict):
            config["addLayers"] = copy.deepcopy(layer_config_payload)

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
        if (
            any(k in obj for k in ("subtitles", "claim", "disclaimer", "disclaimer_02"))
            and "videos" not in obj
        ):
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
                                errs.append(
                                    f"{arr_name}[{i}] in > out ({tin} > {tout})"
                                )
                            if prev_out is not None and ftin < prev_out:
                                errs.append(
                                    f"{arr_name}[{i}] overlaps previous (start {ftin} < prev end {prev_out})"
                                )
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
                    errs.append(
                        f"{name} must be an object with landscape/portrait keys"
                    )
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
                if isinstance(val.get("landscape"), list) and isinstance(
                    val.get("portrait"), list
                ):
                    land = val["landscape"]
                    port = val["portrait"]
                    if land and not port:
                        warnings.append(
                            f"{name}: portrait empty while landscape has data (expected mirror)"
                        )
                    if land and port and len(port) != len(land):
                        warnings.append(
                            f"{name}: landscape/portrait length mismatch {len(land)}!={len(port)}"
                        )

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
                        if not (
                            vid.endswith("_landscape") or vid.endswith("_portrait")
                        ):
                            warnings.append(
                                f"videos[{v_index}].videoId missing orientation suffix"
                            )
                    meta = v.get("metadata", {})
                    if isinstance(meta, dict):
                        orient = meta.get("orientation")
                        if isinstance(vid, str) and (
                            vid.endswith("_landscape") or vid.endswith("_portrait")
                        ):
                            expected = (
                                "landscape"
                                if vid.endswith("_landscape")
                                else "portrait"
                            )
                            if orient != expected:
                                errs.append(
                                    f"videos[{v_index}].metadata.orientation '{orient}' != expected '{expected}'"
                                )
                        # Orientation key should exist for duplicated videos
                        if "orientation" not in meta:
                            warnings.append(
                                f"videos[{v_index}].metadata missing orientation"
                            )
                    subs = v.get("subtitles")
                    if subs is None:
                        continue
                    if not isinstance(subs, list):
                        errs.append(f"videos[{v_index}].subtitles not a list")
                        continue
                    prev_out: Optional[float] = None
                    for si, s in enumerate(subs):
                        if not isinstance(s, dict):
                            errs.append(
                                f"videos[{v_index}].subtitles[{si}] not an object"
                            )
                            continue
                        tin = s.get("in")
                        tout = s.get("out")
                        try:
                            if tin is not None and tout is not None:
                                ftin = float(tin)
                                ftout = float(tout)
                                if ftin > ftout:
                                    errs.append(
                                        f"videos[{v_index}].subtitles[{si}] in > out ({tin} > {tout})"
                                    )
                                if prev_out is not None and ftin < prev_out:
                                    errs.append(
                                        f"videos[{v_index}].subtitles[{si}] overlaps previous (start {ftin} < prev end {prev_out})"
                                    )
                                prev_out = ftout
                        except Exception:
                            pass
        return {"errors": errs, "warnings": warnings}

    file_write_count = 0

    def write_json(path: str, payload: Dict[str, Any]):
        nonlocal file_write_count
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        file_write_count += 1

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
                out["claim"] = out["claim"][: SAMPLE_LIMITS["claim"]]
            if "disclaimer" in out and isinstance(out["disclaimer"], list):
                out["disclaimer"] = out["disclaimer"][: SAMPLE_LIMITS["disclaimer"]]
            if "disclaimer_02" in out and isinstance(out["disclaimer_02"], list):
                out["disclaimer_02"] = out["disclaimer_02"][
                    : SAMPLE_LIMITS["disclaimer_02"]
                ]
            if "logo" in out and isinstance(out["logo"], list):
                out["logo"] = out["logo"][: SAMPLE_LIMITS["logo"]]
            # Orientation-aware objects
            for key in ("claim", "disclaimer", "disclaimer_02", "logo"):
                val = out.get(key)
                if isinstance(val, dict):
                    for orient in ("landscape", "portrait"):
                        arr = val.get(orient)
                        if isinstance(arr, list):
                            limit = (
                                SAMPLE_LIMITS["claim"]
                                if key == "claim"
                                else SAMPLE_LIMITS["disclaimer"]
                                if key == "disclaimer"
                                else SAMPLE_LIMITS["disclaimer_02"]
                                if key == "disclaimer_02"
                                else SAMPLE_LIMITS["logo"]
                            )
                            val[orient] = arr[:limit]
            return out

        sample = copy.deepcopy(payload)
        # Unified per-country wrapper (we only sample the per-country payloads)
        if sample.get("_multi") and isinstance(sample.get("byCountry"), dict):
            for c, pld in sample.get("byCountry", {}).items():
                sample["byCountry"][c] = make_sample(
                    pld
                )  # recursive call on each per-country payload
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
            for v in vids[: SAMPLE_LIMITS["videos"]]:
                v2 = copy.deepcopy(v)
                subs = v2.get("subtitles")
                if isinstance(subs, list):
                    v2["subtitles"] = subs[: SAMPLE_LIMITS["subtitles"]]
                # Claim array
                if "claim" in v2 and isinstance(v2["claim"], list):
                    v2["claim"] = v2["claim"][: SAMPLE_LIMITS["video_claim"]]
                # claim_XX objects (claims-as-objects mode) -> keep only first two by sorted key
                claim_keys = sorted([k for k in v2.keys() if k.startswith("claim_")])
                for ck in claim_keys[SAMPLE_LIMITS["video_claim"] :]:
                    del v2[ck]
                vids_trunc.append(v2)
            sample["videos"] = vids_trunc
        # Simple single-structure legacy (subtitles only)
        if "subtitles" in sample and isinstance(sample["subtitles"], list):
            sample["subtitles"] = sample["subtitles"][: SAMPLE_LIMITS["subtitles"]]
        return sample

    def derive_sample_path(path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}_sample{ext or '.json'}"

    if isinstance(data, dict) and data.get("_multi"):
        countries: List[str] = data.get("countries", [])
        by_country: Dict[str, Any] = data.get("byCountry", {})
        if args.check:
            all_errors: List[str] = []
            all_warnings: List[str] = []
            reports: List[Dict[str, Any]] = []
            print(f"Discovered countries ({len(countries)}): {countries}")
            for c in countries:
                payload = by_country.get(c, {})
                res = _validate_structure(payload)
                vids_objs = [
                    v for v in payload.get("videos", []) if isinstance(v, dict)
                ]
                vids = [v.get("videoId") for v in vids_objs]
                subtitle_count = sum(len(v.get("subtitles", [])) for v in vids_objs)
                print(
                    f"  {c}: videos={len(vids)} subtitleLines={subtitle_count} claimLines={len(payload.get('claim', []))} disclaimerLines={len(payload.get('disclaimer', []))} disclaimer_02Lines={len(payload.get('disclaimer_02', []))} logoLines={len(payload.get('logo', []))}"
                )
                all_errors.extend([f"{c}: {e}" for e in res["errors"]])
                all_warnings.extend([f"{c}: {w}" for w in res["warnings"]])
                reports.append(
                    {
                        "country": c,
                        "errors": res["errors"],
                        "warnings": res["warnings"],
                        "videos": [
                            {
                                "videoId": v.get("videoId"),
                                "subtitleCount": len(v.get("subtitles", [])),
                            }
                            for v in vids_objs
                        ],
                        "claimLines": len(payload.get("claim", [])),
                        "disclaimerLines": len(payload.get("disclaimer", [])),
                        "disclaimer_02Lines": len(payload.get("disclaimer_02", [])),
                        "logoLines": len(payload.get("logo", [])),
                    }
                )
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
                    "mode": "check",
                    "countries": reports,
                    "summary": {
                        "errors": len(all_errors),
                        "warnings": len(all_warnings),
                    },
                }
                try:
                    os.makedirs(
                        os.path.dirname(os.path.abspath(args.validation_report)),
                        exist_ok=True,
                    )
                    with open(args.validation_report, "w", encoding="utf-8") as rf:
                        json.dump(report_obj, rf, ensure_ascii=False, indent=2)
                except Exception as ex:
                    print(f"Failed to write validation report: {ex}", file=sys.stderr)
            print("Check mode output targets:")
            if args.split_by_country:
                pattern = _core_ensure_country_placeholder(
                    args.output_pattern or args.output
                )
                variant_counts: Dict[str, int] = (
                    data.get("_countryVariantCount", {})
                    if isinstance(data, dict)
                    else {}
                )
                for c in countries:
                    count = max(1, int(variant_counts.get(c, 1)))
                    for vi in range(count):
                        if vi == 0:
                            payload = by_country.get(c, {})
                        else:
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
                                flags_overview_object_always=args.flags_overview_object_always,
                                xlsx_sheet=args.xlsx_sheet,
                                controller_always_emit=args.controller_always_emit,
                            )
                            payload = (
                                alt.get("byCountry", {})
                                if isinstance(alt, dict)
                                else {}
                            ).get(c, {})
                        mg = (
                            payload.get("metadataGlobal")
                            if isinstance(payload, dict)
                            else None
                        )
                        out_path = _core_resolve_country_output_path(
                            pattern=pattern,
                            country_code=c,
                            metadata_global=mg,
                        )
                        variant_label = (
                            f" [{c} variant {vi}]" if count > 1 else f" [{c}]"
                        )
                        print(f"  - {out_path}{variant_label}")
                        if args.sample:
                            print(
                                f"  - {derive_sample_path(out_path)}{variant_label} (sample)"
                            )
            else:
                csel = None
                if args.country_column and 1 <= args.country_column <= len(countries):
                    csel = countries[args.country_column - 1]
                else:
                    csel = countries[-1] if countries else "default"
                payload = by_country.get(csel, {})
                mg = (
                    payload.get("metadataGlobal") if isinstance(payload, dict) else None
                )
                out_path_single = _core_resolve_single_country_output_path(
                    output=args.output,
                    output_pattern=args.output_pattern,
                    country_code=csel,
                    metadata_global=mg,
                )
                print(f"  - {out_path_single} [selected country: {csel}]")
                if args.sample:
                    print(
                        f"  - {derive_sample_path(out_path_single)} [selected country: {csel}] (sample)"
                    )
            exit_code = 0
            if args.strict and all_errors:
                exit_code = 1
            print(
                "Check complete (no files written)."
                + (
                    " Errors found."
                    if exit_code == 1
                    else " OK (warnings only)."
                    if all_warnings
                    else " OK."
                )
            )
            _print_conversion_summary(0, len(all_errors))
            return exit_code
        # Split branch only when explicitly splitting; otherwise handle single-country templating separately
        if args.split_by_country:
            pattern = _core_ensure_country_placeholder(args.output_pattern or args.output)
            # Variant counts per country (if provided by convert)
            variant_counts: Dict[str, int] = (
                data.get("_countryVariantCount", {}) if isinstance(data, dict) else {}
            )
            for c in countries:
                count = max(1, int(variant_counts.get(c, 1)))
                for vi in range(count):
                    if vi == 0:
                        payload = by_country.get(
                            c,
                            {
                                "subtitles": [],
                                "claim": [],
                                "disclaimer": [],
                                "metadata": {},
                            },
                        )
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
                            flags_overview_object_always=args.flags_overview_object_always,
                            xlsx_sheet=args.xlsx_sheet,
                            controller_always_emit=args.controller_always_emit,
                        )
                        # Inject generation metadata for alternate variant payloads as well
                        if not args.no_generation_meta:
                            try:
                                _core_inject_generation_metadata(
                                    alt,  # type: ignore[arg-type]
                                    input_path=args.input,
                                    converter_version=args.converter_version,
                                    script_file_path=__file__,
                                )
                            except Exception:
                                pass
                        payload = (
                            alt.get("byCountry", {}) if isinstance(alt, dict) else {}
                        ).get(
                            c,
                            {
                                "subtitles": [],
                                "claim": [],
                                "disclaimer": [],
                                "metadata": {},
                            },
                        )
                    # Inject media/layer config before writing
                    if isinstance(payload, dict):
                        _inject_media(payload, c)
                        _inject_layer_config(payload)
                    if isinstance(payload, dict):
                        _core_trim_logo_anim_flag_for_country(
                            payload=payload,
                            country_code=c,
                        )
                    mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
                    out_path = _core_resolve_country_output_path(
                        pattern=pattern,
                        country_code=c,
                        metadata_global=mg,
                    )
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
            payload = by_country.get(
                csel, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}}
            )
            if isinstance(payload, dict):
                _core_trim_logo_anim_flag_for_country(
                    payload=payload,
                    country_code=csel,
                )
            mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
            out_path_single = _core_resolve_single_country_output_path(
                output=args.output,
                output_pattern=args.output_pattern,
                country_code=csel,
                metadata_global=mg,
            )
            if args.verbose:
                print(f"Writing {out_path_single} (selected country: {csel})")
            # Inject media/layer config for selected country before writing
            if isinstance(payload, dict):
                _inject_media(payload, csel)
                _inject_layer_config(payload)
            write_json(out_path_single, payload)
            if args.sample:
                sample_path = derive_sample_path(out_path_single)
                write_json(sample_path, make_sample(payload))
    else:
        if args.check:
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
                    "mode": "check",
                    "errors": errors,
                    "warnings": warnings,
                }
                try:
                    os.makedirs(
                        os.path.dirname(os.path.abspath(args.validation_report)),
                        exist_ok=True,
                    )
                    with open(args.validation_report, "w", encoding="utf-8") as rf:
                        json.dump(report_obj, rf, ensure_ascii=False, indent=2)
                except Exception as ex:
                    print(f"Failed to write validation report: {ex}", file=sys.stderr)
            print("Check mode output targets:")
            print(f"  - {args.output}")
            if args.sample:
                print(f"  - {derive_sample_path(args.output)} (sample)")
            exit_code = 0 if (not errors or not args.strict) else 1
            print(
                "Check complete (no file written)."
                + (
                    " Errors found."
                    if exit_code == 1
                    else " OK (warnings only)."
                    if warnings
                    else " OK."
                )
            )
            _print_conversion_summary(0, len(errors))
            return exit_code
        if isinstance(data, dict):
            _inject_layer_config(data)
        write_json(args.output, data)
        if args.sample and not args.check:
            sample_path = derive_sample_path(args.output)
            write_json(sample_path, make_sample(data))

    _print_conversion_summary(file_write_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
