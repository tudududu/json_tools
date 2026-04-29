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
import os
from typing import List

from python.tools.srt_csv.csv_to_srt import csv_to_srt, csv_to_srt_joined
from python.tools.srt_csv.srt_parse import HEADER, parse_srt, records_to_rows
from python.tools.srt_csv.timecode import (
    resolve_output_type,
)
from python.tools.srt_csv.xlsx_output import (
    XLSX_TEMPLATE_ENV,
    XLSX_THEME_ENV,
    write_tabular_output,
)


def srt_to_csv(
    in_path: str,
    out_path: str,
    fps: float,
    out_format: str,
    encoding: str,
    quote_all: bool,
    delimiter_name: str,
    output_type: str | None = None,
    xlsx_template: str | None = None,
    xlsx_theme_file: str | None = None,
) -> None:
    with open(in_path, "r", encoding=encoding) as f:
        # Preserve lines; splitlines handles CRLF/CR/LF
        lines = f.read().splitlines()
    records = parse_srt(lines)
    rows = records_to_rows(records, fps=fps, out_format=out_format)
    resolved_output_type = resolve_output_type(out_path, output_type)
    write_tabular_output(
        out_path,
        rows,
        quote_all=quote_all,
        delimiter_name=delimiter_name,
        output_type=resolved_output_type,
        xlsx_template=xlsx_template,
        xlsx_theme_file=xlsx_theme_file,
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

    # Determine mode: single file or batch directory
    import os

    if args.reverse or args.reverse_joined:
        if args.join_output:
            raise SystemExit("--join-output is not supported in reverse mode yet")

        if args.reverse_joined:
            if args.output:
                raise SystemExit(
                    "--reverse-joined writes multiple files; use --output-dir (or omit to use input directory)"
                )
            if args.input_dir:
                in_dir = args.input_dir
                if not os.path.isdir(in_dir):
                    raise SystemExit(f"Input directory not found: {in_dir}")
                names = [
                    n
                    for n in sorted(os.listdir(in_dir))
                    if n.lower().endswith(".csv") or n.lower().endswith(".xlsx")
                ]
                out_dir = args.output_dir or args.input_dir
                os.makedirs(out_dir, exist_ok=True)
                for name in names:
                    in_path = os.path.join(in_dir, name)
                    csv_to_srt_joined(
                        in_path,
                        out_dir,
                        fps=args.fps,
                        encoding=args.encoding,
                        start_col=args.start_col,
                        end_col=args.end_col,
                        text_col=args.text_col,
                    )
            else:
                if not args.input:
                    raise SystemExit(
                        "Provide input path, or use --input-dir/--output-dir for batch mode"
                    )
                if not os.path.isfile(args.input):
                    raise SystemExit(f"No such file or directory: '{args.input}'")
                out_dir = args.output_dir or os.path.dirname(args.input) or "."
                csv_to_srt_joined(
                    args.input,
                    out_dir,
                    fps=args.fps,
                    encoding=args.encoding,
                    start_col=args.start_col,
                    end_col=args.end_col,
                    text_col=args.text_col,
                )
            return

        if args.input_dir:
            in_dir = args.input_dir
            if not os.path.isdir(in_dir):
                raise SystemExit(f"Input directory not found: {in_dir}")
            names = [
                n
                for n in sorted(os.listdir(in_dir))
                if n.lower().endswith(".csv") or n.lower().endswith(".xlsx")
            ]
            out_dir = args.output_dir or args.input_dir
            os.makedirs(out_dir, exist_ok=True)
            for name in names:
                in_path = os.path.join(in_dir, name)
                base = os.path.splitext(name)[0]
                out_path = os.path.join(out_dir, base + ".srt")
                csv_to_srt(
                    in_path,
                    out_path,
                    fps=args.fps,
                    encoding=args.encoding,
                    start_col=args.start_col,
                    end_col=args.end_col,
                    text_col=args.text_col,
                )
        else:
            if not args.input or not args.output:
                raise SystemExit(
                    "Provide input and output paths, or use --input-dir/--output-dir for batch mode"
                )
            if not os.path.isfile(args.input):
                raise SystemExit(f"No such file or directory: '{args.input}'")
            csv_to_srt(
                args.input,
                args.output,
                fps=args.fps,
                encoding=args.encoding,
                start_col=args.start_col,
                end_col=args.end_col,
                text_col=args.text_col,
            )
        return

    if args.input_dir:
        in_dir = args.input_dir
        if not os.path.isdir(in_dir):
            raise SystemExit(f"Input directory not found: {in_dir}")
        names = [n for n in sorted(os.listdir(in_dir)) if n.lower().endswith(".srt")]
        if args.join_output:
            # Resolve output file path: allow positional output OR positional input token used as output OR --output-dir as file path
            out_path = None
            if args.output:
                out_path = args.output
            elif args.input:
                # Users might place the output file path in the positional 'input' when using --input-dir
                out_path = args.input
            elif args.output_dir:
                out_path = args.output_dir
            if not out_path:
                raise SystemExit(
                    "Provide an output file path for --join-output mode (positional after --input-dir or via --output-dir)"
                )
            rows: List[List[str]] = []
            for name in names:
                in_path = os.path.join(in_dir, name)
                rows.append(["", "", name])
                with open(in_path, "r", encoding=args.encoding) as sf:
                    lines = sf.read().splitlines()
                rows.extend(
                    records_to_rows(
                        parse_srt(lines), fps=args.fps, out_format=args.out_format
                    )
                )
            resolved_output_type = resolve_output_type(out_path, args.output_type)
            write_tabular_output(
                out_path,
                rows,
                quote_all=args.quote_all,
                delimiter_name=args.delimiter,
                output_type=resolved_output_type,
                xlsx_template=args.xlsx_template,
                xlsx_theme_file=args.xlsx_theme_file,
            )
        else:
            out_dir = args.output_dir or args.input_dir
            os.makedirs(out_dir, exist_ok=True)
            for name in names:
                in_path = os.path.join(in_dir, name)
                base = os.path.splitext(name)[0]
                ext = ".xlsx" if args.output_type == "xlsx" else ".csv"
                out_name = base + ext
                out_path = os.path.join(out_dir, out_name)
                srt_to_csv(
                    in_path,
                    out_path,
                    fps=args.fps,
                    out_format=args.out_format,
                    encoding=args.encoding,
                    quote_all=args.quote_all,
                    delimiter_name=args.delimiter,
                    output_type=args.output_type,
                    xlsx_template=args.xlsx_template,
                    xlsx_theme_file=args.xlsx_theme_file,
                )
    else:
        if not args.input or not args.output:
            raise SystemExit(
                "Provide input and output paths, or use --input-dir/--output-dir for batch mode"
            )
        if not os.path.isfile(args.input):
            raise SystemExit(f"No such file or directory: '{args.input}'")
        srt_to_csv(
            args.input,
            args.output,
            fps=args.fps,
            out_format=args.out_format,
            encoding=args.encoding,
            quote_all=args.quote_all,
            delimiter_name=args.delimiter,
            output_type=args.output_type,
            xlsx_template=args.xlsx_template,
            xlsx_theme_file=args.xlsx_theme_file,
        )


if __name__ == "__main__":
    main()
