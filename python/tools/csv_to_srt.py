"""Compatibility shim for reverse conversion APIs.

Canonical location: python.tools.srt_csv.csv_to_srt.
"""

from python.tools.srt_csv.csv_to_srt import (  # noqa: F401
    _dedupe_output_filename,
    _detect_reverse_time_format,
    _extract_joined_reverse_blocks,
    _normalize_header_name,
    _parse_reverse_timecode,
    _read_reverse_table,
    _records_to_srt_text,
    _resolve_column_index,
    _rows_to_reverse_records,
    _sanitize_joined_marker_filename,
    csv_to_srt,
    csv_to_srt_joined,
)

__all__ = [
    "_normalize_header_name",
    "_resolve_column_index",
    "_read_reverse_table",
    "_detect_reverse_time_format",
    "_parse_reverse_timecode",
    "_rows_to_reverse_records",
    "_records_to_srt_text",
    "_extract_joined_reverse_blocks",
    "_sanitize_joined_marker_filename",
    "_dedupe_output_filename",
    "csv_to_srt",
    "csv_to_srt_joined",
]
