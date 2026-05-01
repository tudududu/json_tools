from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .columns import (
    _normalize_header_map as _core_normalize_header_map,
    _resolve_column as _core_resolve_column,
    detect_columns as _core_detect_columns,
)
from .sectioned_mode import convert_sectioned_mode as _core_convert_sectioned_mode
from .simple_mode import convert_simple_mode as _core_convert_simple_mode
from .table_reader import (
    _read_table as _core_read_table,
    _sniff_delimiter as _core_sniff_delimiter,
)
from .timecode import (
    parse_timecode as _core_parse_timecode,
    safe_int as _core_safe_int,
)
from .unified_processors import (
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

parse_timecode = _core_parse_timecode
safe_int = _core_safe_int
_normalize_header_map = _core_normalize_header_map
_resolve_column = _core_resolve_column
detect_columns = _core_detect_columns
_sniff_delimiter = _core_sniff_delimiter
_read_table = _core_read_table


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
        global_flag_defaults_per_country = (
            unified_state.global_flag_defaults_per_country
        )
        # Global targeted flags per country (meta_global rows with target_duration)
        global_flag_targeted_per_country = (
            unified_state.global_flag_targeted_per_country
        )
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
