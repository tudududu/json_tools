from __future__ import annotations

import os
from typing import List, Protocol

from python.tools.srt_csv.reverse_seam import csv_to_srt, csv_to_srt_joined
from python.tools.srt_csv.srt_parse import parse_srt, records_to_rows
from python.tools.srt_csv.timecode import resolve_output_type
from python.tools.srt_csv.xlsx_output import write_tabular_output


class CliArgs(Protocol):
    input: str | None
    output: str | None
    input_dir: str | None
    output_dir: str | None
    join_output: bool
    reverse_joined: bool
    fps: float
    out_format: str
    encoding: str
    quote_all: bool
    delimiter: str
    output_type: str | None
    xlsx_template: str | None
    xlsx_theme_file: str | None
    start_col: str | None
    end_col: str | None
    text_col: str | None


def _srt_to_tabular_file(
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


def run_reverse_mode(args: CliArgs) -> None:
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
        return

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


def run_forward_mode(args: CliArgs) -> None:
    if args.input_dir:
        in_dir = args.input_dir
        if not os.path.isdir(in_dir):
            raise SystemExit(f"Input directory not found: {in_dir}")
        names = [n for n in sorted(os.listdir(in_dir)) if n.lower().endswith(".srt")]
        if args.join_output:
            out_path = None
            if args.output:
                out_path = args.output
            elif args.input:
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
            return

        out_dir = args.output_dir or args.input_dir
        os.makedirs(out_dir, exist_ok=True)
        for name in names:
            in_path = os.path.join(in_dir, name)
            base = os.path.splitext(name)[0]
            ext = ".xlsx" if args.output_type == "xlsx" else ".csv"
            out_name = base + ext
            out_path = os.path.join(out_dir, out_name)
            _srt_to_tabular_file(
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
        return

    if not args.input or not args.output:
        raise SystemExit(
            "Provide input and output paths, or use --input-dir/--output-dir for batch mode"
        )
    if not os.path.isfile(args.input):
        raise SystemExit(f"No such file or directory: '{args.input}'")
    _srt_to_tabular_file(
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
