"""Compatibility shim for timecode formatting APIs.

Canonical location: python.tools.srt_csv.timecode.
"""

from python.tools.srt_csv.timecode import (  # noqa: F401
    FRAME_TC_RE,
    MS_TC_RE,
    format_time_frames,
    format_time_ms,
    resolve_output_type,
)

__all__ = [
    "FRAME_TC_RE",
    "MS_TC_RE",
    "format_time_frames",
    "format_time_ms",
    "resolve_output_type",
]
