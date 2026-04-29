#!/usr/bin/env python3
"""
SRT → CSV converter

Converts a SubRip (.srt) subtitle file into a simple CSV with columns:
"Start Time","End Time","Text"

Options:
- --fps <float>               Input frame rate for HH:MM:SS:FF output (default 25)
- --out-format <format>       Output format: 'frames' (HH:MM:SS:FF) or 'ms' (HH:MM:SS,SSS) [default: frames]
- --encoding <name>           Input file encoding (default: utf-8-sig)
- --quote-all                 Always quote all CSV fields (default OFF; minimal quoting otherwise)
- --delimiter <name>          CSV output delimiter: 'comma' or 'semicolon' (default 'comma')
- --output-type <csv|xlsx>    Output container override (otherwise inferred from output extension)
- --xlsx-theme-file <path>    Optional OOXML theme XML file to apply to generated XLSX workbooks
- --xlsx-template <path>      Optional XLSX template workbook to use as base for output

Examples:
    # Single file
    python python/tools/srt_to_csv.py input.srt output.csv --fps 25 --out-format frames
    python python/tools/srt_to_csv.py input.srt output.xlsx --fps 25 --out-format frames
    python python/tools/srt_to_csv.py input.srt output.csv --out-format ms

    # Batch mode: iterate all .srt in an input folder and write .csv to an output folder
    python python/tools/srt_to_csv.py --input-dir in_srt/ --output-dir out_csv/ --fps 25 --out-format frames
    python python/tools/srt_to_csv.py --input-dir in_srt/ --output-dir out_xlsx/ --output-type xlsx --fps 25 --out-format frames

    # Batch join: iterate all .srt in an input folder and write a single combined .csv/.xlsx
    python python/tools/srt_to_csv.py --input-dir in_srt/ joined.csv --join-output --fps 25 --out-format frames
    python python/tools/srt_to_csv.py --input-dir in_srt/ joined.xlsx --join-output --fps 25 --out-format frames
"""

from __future__ import annotations

import argparse

from python.tools.srt_csv.cli_ops import run_forward_mode, run_reverse_mode

from python.tools.srt_csv.xlsx_output import (
    XLSX_TEMPLATE_ENV,
    XLSX_THEME_ENV,
)


def main() -> None:
    p = argparse.ArgumentParser(description="Convert SRT<->CSV/XLSX subtitles")
    p.add_argument(
        "input", nargs="?", help="Path to input .srt file (omit when using --input-dir)"
    )
    p.add_argument(
        "output",
        nargs="?",
        help="Path to output .csv/.xlsx file (omit when using --output-dir; in --join-output mode this can be the joined output file path)",
    )
    p.add_argument(
        "--input-dir", help="Directory containing .srt files to convert (batch mode)"
    )
    p.add_argument("--output-dir", help="Directory to write .csv files in batch mode")
    p.add_argument(
        "--join-output",
        action="store_true",
        help="In batch mode, join all inputs into a single output CSV (provide output file path)",
    )
    p.add_argument(
        "--reverse",
        action="store_true",
        help="Reverse mode: convert CSV/XLSX back to SRT",
    )
    p.add_argument(
        "--reverse-joined",
        action="store_true",
        help="Reverse mode: parse joined CSV/XLSX input (marker rows) and split to multiple SRT files",
    )
    p.add_argument(
        "--fps",
        type=float,
        default=25.0,
        help="Input frame rate for frames output (default 25)",
    )
    p.add_argument(
        "--out-format",
        choices=["frames", "ms"],
        default="frames",
        help="Output format: frames (HH:MM:SS:FF) or ms (HH:MM:SS,SSS)",
    )
    p.add_argument(
        "--encoding",
        default="utf-8-sig",
        help="Input file encoding (default utf-8-sig)",
    )
    p.add_argument(
        "--quote-all",
        action="store_true",
        help="Always quote all CSV fields (default OFF)",
    )
    p.add_argument(
        "--delimiter",
        choices=["comma", "semicolon"],
        default="comma",
        help="Output delimiter (default comma)",
    )
    p.add_argument(
        "--output-type",
        choices=["csv", "xlsx"],
        help="Output container override. When omitted, inferred from output extension (.xlsx => xlsx, otherwise csv)",
    )
    p.add_argument(
        "--xlsx-template",
        default=None,
        help=(
            "Optional path to an XLSX template workbook used as output base. "
            f"If omitted, falls back to {XLSX_TEMPLATE_ENV} env var when set."
        ),
    )
    p.add_argument(
        "--xlsx-theme-file",
        default=None,
        help=(
            "Optional OOXML theme XML file applied to generated XLSX. "
            f"If omitted, falls back to {XLSX_THEME_ENV} env var; otherwise a built-in theme is used when available."
        ),
    )
    p.add_argument(
        "--start-col",
        help="Reverse mode: start time column name or 1-based index",
    )
    p.add_argument(
        "--end-col",
        help="Reverse mode: end time column name or 1-based index",
    )
    p.add_argument(
        "--text-col",
        help="Reverse mode: text column name or 1-based index",
    )
    args = p.parse_args()

    if args.reverse or args.reverse_joined:
        run_reverse_mode(args)
        return

    run_forward_mode(args)


if __name__ == "__main__":
    main()
