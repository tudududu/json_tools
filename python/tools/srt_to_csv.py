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
import csv
import os
import re
from typing import List, Optional, Tuple

from python.tools.srt_parse import HEADER, parse_srt, records_to_rows
from python.tools.srt_csv.timecode import (
    FRAME_TC_RE,
    MS_TC_RE,
    format_time_ms,
    resolve_output_type,
)
from python.tools.srt_csv.xlsx_output import (
    XLSX_TEMPLATE_ENV,
    XLSX_THEME_ENV,
    write_tabular_output,
)

try:
    from openpyxl import load_workbook as _load_workbook
except Exception:  # pragma: no cover - optional dependency
    _load_workbook = None  # type: ignore[assignment]


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


def _normalize_header_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").strip().lower())


def _resolve_column_index(
    headers: List[str],
    override: Optional[str],
    aliases: Tuple[str, ...],
) -> int:
    if override:
        if override.isdigit():
            idx = int(override) - 1
            if 0 <= idx < len(headers):
                return idx
            raise ValueError(f"Column index out of range: {override}")
        target = _normalize_header_name(override)
        for i, header in enumerate(headers):
            if _normalize_header_name(header) == target:
                return i
        raise ValueError(f"Column not found: {override}")

    normalized_headers = [_normalize_header_name(h) for h in headers]
    for alias in aliases:
        alias_norm = _normalize_header_name(alias)
        if alias_norm in normalized_headers:
            return normalized_headers.index(alias_norm)
    raise ValueError(f"Could not detect required column. Tried aliases: {aliases}")


def _read_reverse_table(
    in_path: str,
    encoding: str,
) -> Tuple[List[str], List[List[str]]]:
    if in_path.lower().endswith(".xlsx"):
        if _load_workbook is None:
            raise SystemExit(
                "XLSX input requires openpyxl. Install with: pip install openpyxl"
            )
        wb = _load_workbook(in_path, data_only=True)
        ws = wb.active
        if ws is None:
            raise ValueError("XLSX file has no active worksheet")
        all_rows: List[List[str]] = []
        for row in ws.iter_rows(values_only=True):
            all_rows.append(["" if v is None else str(v) for v in row])
        if not all_rows:
            return [], []
        headers = [c.strip() for c in all_rows[0]]
        return headers, all_rows[1:]

    with open(in_path, "r", newline="", encoding=encoding) as f:
        sample = f.read(8192)
        f.seek(0)
        delimiter = ","
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;")
            delimiter = dialect.delimiter
        except Exception:
            delimiter = ";" if ";" in sample and "," not in sample else ","
        reader = csv.reader(f, delimiter=delimiter)
        all_rows = [list(r) for r in reader]
    if not all_rows:
        return [], []
    headers = [(c or "").strip() for c in all_rows[0]]
    return headers, all_rows[1:]


def _detect_reverse_time_format(
    rows: List[List[str]],
    idx_start: int,
    idx_end: int,
) -> str:
    detected: Optional[str] = None
    for row in rows:
        start = (row[idx_start] if idx_start < len(row) else "").strip()
        end = (row[idx_end] if idx_end < len(row) else "").strip()
        if not start and not end:
            continue
        if not start or not end:
            raise ValueError(
                "Row has only one time value; both Start Time and End Time are required"
            )
        for token in (start, end):
            current: Optional[str] = None
            if FRAME_TC_RE.fullmatch(token):
                current = "frames"
            elif MS_TC_RE.fullmatch(token):
                current = "ms"
            else:
                raise ValueError(f"Unsupported timecode format: {token}")
            if detected is None:
                detected = current
            elif detected != current:
                raise ValueError("Mixed timecode formats detected in a single file")
    if detected is None:
        raise ValueError("No valid timed subtitle rows found in input")
    return detected


def _parse_reverse_timecode(value: str, fmt: str, fps: float) -> float:
    token = value.strip()
    if fmt == "frames":
        h, m, s, ff = [int(part) for part in token.split(":")]
        if fps <= 0:
            raise ValueError("fps must be > 0 for frames input")
        return h * 3600 + m * 60 + s + ff / fps
    if fmt == "ms":
        base, ms = re.split(r"[,.]", token, maxsplit=1)
        h, m, s = [int(part) for part in base.split(":")]
        return h * 3600 + m * 60 + s + int(ms) / 1000.0
    raise ValueError(f"Unsupported timecode format: {fmt}")


def _rows_to_reverse_records(
    rows: List[List[str]],
    idx_start: int,
    idx_end: int,
    idx_text: int,
    time_format: str,
    fps: float,
) -> List[Tuple[float, float, str]]:
    out: List[Tuple[float, float, str]] = []
    for row in rows:
        start = (row[idx_start] if idx_start < len(row) else "").strip()
        end = (row[idx_end] if idx_end < len(row) else "").strip()
        text = row[idx_text] if idx_text < len(row) else ""

        # Skip joined marker rows emitted by --join-output in forward mode.
        if not start and not end:
            continue
        if not start or not end:
            raise ValueError(
                "Row has only one time value; both Start Time and End Time are required"
            )

        tin = _parse_reverse_timecode(start, time_format, fps)
        tout = _parse_reverse_timecode(end, time_format, fps)
        out.append((tin, tout, text))
    return out


def _records_to_srt_text(records: List[Tuple[float, float, str]]) -> str:
    lines: List[str] = []
    for idx, (start, end, text) in enumerate(records, start=1):
        lines.append(str(idx))
        lines.append(f"{format_time_ms(start)} --> {format_time_ms(end)}")
        text_lines = text.splitlines() if text else [""]
        lines.extend(text_lines)
        lines.append("")
    return "\n".join(lines)


def _extract_joined_reverse_blocks(
    rows: List[List[str]],
    idx_start: int,
    idx_end: int,
    idx_text: int,
) -> List[Tuple[str, List[List[str]]]]:
    blocks: List[Tuple[str, List[List[str]]]] = []
    current_name: Optional[str] = None
    current_rows: List[List[str]] = []
    marker_count = 0

    for row in rows:
        start = (row[idx_start] if idx_start < len(row) else "").strip()
        end = (row[idx_end] if idx_end < len(row) else "").strip()
        text = (row[idx_text] if idx_text < len(row) else "").strip()

        if not start and not end:
            if not text:
                continue
            marker_count += 1
            if current_name is not None:
                blocks.append((current_name, current_rows))
            current_name = text
            current_rows = []
            continue

        if not start or not end:
            raise ValueError(
                "Row has only one time value; both Start Time and End Time are required"
            )
        if current_name is None:
            raise ValueError(
                "Joined reverse input requires marker rows before timed rows"
            )
        current_rows.append(row)

    if current_name is not None:
        blocks.append((current_name, current_rows))

    if marker_count == 0:
        raise ValueError(
            "Joined reverse input requires marker rows (empty Start/End with filename in Text)"
        )

    return blocks


def _sanitize_joined_marker_filename(marker: str) -> str:
    raw = (marker or "").strip()
    raw = re.sub(r"\.srt$", "", raw, flags=re.I)
    raw = re.sub(r"[\\/]+", "_", raw)
    raw = re.sub(r"[^A-Za-z0-9._ -]", "_", raw)
    raw = re.sub(r"\s+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("._ ")
    if not raw:
        raw = "subtitle"
    return f"{raw}.srt"


def _dedupe_output_filename(name: str, used: set[str]) -> str:
    base, ext = os.path.splitext(name)
    candidate = name
    i = 2
    while candidate.lower() in used:
        candidate = f"{base}_{i}{ext}"
        i += 1
    used.add(candidate.lower())
    return candidate


def csv_to_srt(
    in_path: str,
    out_path: str,
    fps: float,
    encoding: str,
    start_col: Optional[str] = None,
    end_col: Optional[str] = None,
    text_col: Optional[str] = None,
) -> None:
    import os

    headers, rows = _read_reverse_table(in_path, encoding=encoding)
    if not headers:
        raise ValueError(f"Input table is empty: {in_path}")

    idx_start = _resolve_column_index(
        headers,
        start_col,
        aliases=("Start Time", "start", "in", "inpoint"),
    )
    idx_end = _resolve_column_index(
        headers,
        end_col,
        aliases=("End Time", "end", "out", "outpoint"),
    )
    idx_text = _resolve_column_index(
        headers,
        text_col,
        aliases=("Text", "subtitle", "caption"),
    )

    time_format = _detect_reverse_time_format(rows, idx_start, idx_end)
    records = _rows_to_reverse_records(
        rows,
        idx_start=idx_start,
        idx_end=idx_end,
        idx_text=idx_text,
        time_format=time_format,
        fps=fps,
    )

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(_records_to_srt_text(records))


def csv_to_srt_joined(
    in_path: str,
    out_dir: str,
    fps: float,
    encoding: str,
    start_col: Optional[str] = None,
    end_col: Optional[str] = None,
    text_col: Optional[str] = None,
) -> List[str]:
    headers, rows = _read_reverse_table(in_path, encoding=encoding)
    if not headers:
        raise ValueError(f"Input table is empty: {in_path}")

    idx_start = _resolve_column_index(
        headers,
        start_col,
        aliases=("Start Time", "start", "in", "inpoint"),
    )
    idx_end = _resolve_column_index(
        headers,
        end_col,
        aliases=("End Time", "end", "out", "outpoint"),
    )
    idx_text = _resolve_column_index(
        headers,
        text_col,
        aliases=("Text", "subtitle", "caption"),
    )

    blocks = _extract_joined_reverse_blocks(rows, idx_start, idx_end, idx_text)
    timed_rows = [r for _, block_rows in blocks for r in block_rows]
    time_format = _detect_reverse_time_format(timed_rows, idx_start, idx_end)

    os.makedirs(out_dir, exist_ok=True)
    used_names: set[str] = set()
    written: List[str] = []

    for marker_name, block_rows in blocks:
        if not block_rows:
            continue
        records = _rows_to_reverse_records(
            block_rows,
            idx_start=idx_start,
            idx_end=idx_end,
            idx_text=idx_text,
            time_format=time_format,
            fps=fps,
        )
        if not records:
            continue
        fname = _sanitize_joined_marker_filename(marker_name)
        fname = _dedupe_output_filename(fname, used_names)
        out_path = os.path.join(out_dir, fname)
        with open(out_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(_records_to_srt_text(records))
        written.append(out_path)

    if not written:
        raise ValueError("No timed subtitle blocks found under joined markers")
    return written


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
