"""Shared modules for srt_to_csv split architecture."""

from .csv_to_srt import csv_to_srt, csv_to_srt_joined
from .srt_parse import HEADER, parse_srt, records_to_rows
from .timecode import FRAME_TC_RE, MS_TC_RE, format_time_frames, format_time_ms, resolve_output_type
from .xlsx_output import XLSX_TEMPLATE_ENV, XLSX_THEME_ENV, write_tabular_output

__all__ = [
    "HEADER",
    "parse_srt",
    "records_to_rows",
    "csv_to_srt",
    "csv_to_srt_joined",
    "FRAME_TC_RE",
    "MS_TC_RE",
    "format_time_frames",
    "format_time_ms",
    "resolve_output_type",
    "XLSX_TEMPLATE_ENV",
    "XLSX_THEME_ENV",
    "write_tabular_output",
]
