"""Compatibility shim for forward parser symbols.

Canonical location: python.tools.srt_csv.srt_parse.
"""

from python.tools.srt_csv.srt_parse import HEADER, _TIME_RE, parse_srt, records_to_rows

__all__ = ["HEADER", "_TIME_RE", "parse_srt", "records_to_rows"]
