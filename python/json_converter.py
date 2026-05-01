#!/usr/bin/env python3
"""
CSV -> JSON subtitle converter entrypoint.
"""

from __future__ import annotations

from typing import List, Optional

try:
    from python.core.cli_runner import run_cli as _core_run_cli
    from python.core.converter_engine import (
        _normalize_header_map,
        _read_table,
        _resolve_column,
        _sniff_delimiter,
        convert_csv_to_json,
        detect_columns,
        parse_timecode,
        safe_int,
    )
    from python.core.optional_tools import (
        load_layer_config_converter as _core_load_layer_config_converter,
        load_media_tools as _core_load_media_tools,
    )
except ModuleNotFoundError:
    from core.cli_runner import run_cli as _core_run_cli
    from core.converter_engine import (
        _normalize_header_map,
        _read_table,
        _resolve_column,
        _sniff_delimiter,
        convert_csv_to_json,
        detect_columns,
        parse_timecode,
        safe_int,
    )
    from core.optional_tools import (
        load_layer_config_converter as _core_load_layer_config_converter,
        load_media_tools as _core_load_media_tools,
    )

media_read_csv, media_group_by_country_language, media_convert_rows = (
    _core_load_media_tools(__file__)
)
layercfg_convert_workbook = _core_load_layer_config_converter(__file__)

# Public compatibility surface retained for legacy imports.
__all__ = [
    "main",
    "convert_csv_to_json",
    "parse_timecode",
    "safe_int",
    "detect_columns",
    "_sniff_delimiter",
    "_read_table",
    "_normalize_header_map",
    "_resolve_column",
]


def main(argv: Optional[List[str]] = None) -> int:
    return _core_run_cli(
        argv,
        convert_csv_to_json=convert_csv_to_json,
        script_file_path=__file__,
        layercfg_convert_workbook=layercfg_convert_workbook,
        media_read_csv=media_read_csv,
        media_group_by_country_language=media_group_by_country_language,
        media_convert_rows=media_convert_rows,
    )


if __name__ == "__main__":
    raise SystemExit(main())
