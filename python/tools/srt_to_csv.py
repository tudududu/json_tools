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
import re
from typing import List, Tuple

try:
    from openpyxl import Workbook
    from openpyxl.styles import Color, PatternFill
except Exception:  # pragma: no cover - optional dependency
    Workbook = None
    Color = None
    PatternFill = None

TIME_RE = re.compile(
    r"^(?P<h1>\d{2}):(?P<m1>\d{2}):(?P<s1>\d{2})[,.](?P<ms1>\d{3})\s*-->\s*"
    r"(?P<h2>\d{2}):(?P<m2>\d{2}):(?P<s2>\d{2})[,.](?P<ms2>\d{3})\s*$"
)

HEADER = ["Start Time", "End Time", "Text"]


def parse_srt(lines: List[str]) -> List[Tuple[float, float, str]]:
    """Parse SRT lines into a list of (start_seconds, end_seconds, text)."""
    records: List[Tuple[float, float, str]] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip("\r\n")
        m = TIME_RE.match(line)
        if not m:
            i += 1
            continue
        # Parse times
        h1 = int(m.group("h1"))
        m1 = int(m.group("m1"))
        s1 = int(m.group("s1"))
        ms1 = int(m.group("ms1"))
        h2 = int(m.group("h2"))
        m2 = int(m.group("m2"))
        s2 = int(m.group("s2"))
        ms2 = int(m.group("ms2"))
        start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000.0
        end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0
        # Collect following text lines until blank line
        i += 1
        text_lines: List[str] = []
        while i < n:
            lt = lines[i].rstrip("\r\n")
            if lt.strip() == "":
                break
            # Skip the optional numeric index line when encountered before time line; here we are past time line.
            text_lines.append(lt)
            i += 1
        # Move past the blank separator line (if present)
        while i < n and lines[i].strip() == "":
            i += 1
        text = "\n".join(text_lines)
        records.append((start, end, text))
    return records


def format_time_frames(seconds: float, fps: float) -> str:
    """Format time as HH:MM:SS:FF using nearest-frame rounding."""
    if fps <= 0:
        raise ValueError("fps must be > 0 for frames output")
    sec_int = int(seconds)
    frac = seconds - sec_int
    frames = int(round(frac * fps))
    # Carry over if frames equals fps due to rounding
    if frames >= int(fps):
        sec_int += 1
        frames -= int(fps)
    h = sec_int // 3600
    rem = sec_int % 3600
    m = rem // 60
    s = rem % 60
    return f"{h:02d}:{m:02d}:{s:02d}:{frames:02d}"


def format_time_ms(seconds: float) -> str:
    """Format time as HH:MM:SS,SSS with millisecond rounding."""
    sec_int = int(seconds)
    frac = seconds - sec_int
    ms = int(round(frac * 1000))
    if ms >= 1000:
        sec_int += 1
        ms -= 1000
    h = sec_int // 3600
    rem = sec_int % 3600
    m = rem // 60
    s = rem % 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def resolve_output_type(out_path: str, explicit_output_type: str | None) -> str:
    """Resolve output container from explicit flag or file extension."""
    if explicit_output_type:
        return explicit_output_type
    if out_path.lower().endswith(".xlsx"):
        return "xlsx"
    return "csv"


def records_to_rows(
    records: List[Tuple[float, float, str]], fps: float, out_format: str
) -> List[List[str]]:
    rows: List[List[str]] = []
    for start, end, text in records:
        if out_format == "frames":
            start_str = format_time_frames(start, fps)
            end_str = format_time_frames(end, fps)
        elif out_format == "ms":
            start_str = format_time_ms(start)
            end_str = format_time_ms(end)
        else:
            raise ValueError("out_format must be 'frames' or 'ms'")
        rows.append([start_str, end_str, text])
    return rows


def write_tabular_output(
    out_path: str,
    rows: List[List[str]],
    quote_all: bool,
    delimiter_name: str,
    output_type: str,
) -> None:
    import os

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    if output_type == "csv":
        delimiter = "," if delimiter_name == "comma" else ";"
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(
                f,
                delimiter=delimiter,
                quoting=(csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL),
            )
            writer.writerow(HEADER)
            writer.writerows(rows)
        return

    if output_type != "xlsx":
        raise ValueError("output_type must be 'csv' or 'xlsx'")
    if Workbook is None:
        raise SystemExit(
            "XLSX output requires openpyxl. Install with: pip install openpyxl"
        )

    wb = Workbook()
    ws = wb.active
    ws.title = "subtitles"
    ws.append(HEADER)
    # Excel theme color: Text 2 (Dark Blue), Lighter 50%.
    header_fill = PatternFill(fill_type="solid", fgColor=Color(theme=3, tint=0.5))
    # Excel theme color: Turquoise, Accent 4, Lighter 40%.
    title_fill = PatternFill(fill_type="solid", fgColor=Color(theme=2, tint=0.3))
    # Excel theme color: Text 2 (Dark Blue) alternating variants.
    plain_fill_1 = PatternFill(fill_type="solid", fgColor=Color(theme=3, tint=0.75))
    plain_fill_2 = PatternFill(fill_type="solid", fgColor=Color(theme=3, tint=0.85))
    # Apply fill only to used output columns.
    for col_idx in range(1, len(HEADER) + 1):
        ws.cell(row=1, column=col_idx).fill = header_fill
    for row in rows:
        ws.append(row)

    plain_row_index = 0
    for row_idx in range(2, ws.max_row + 1):
        c1 = ws.cell(row=row_idx, column=1).value
        c2 = ws.cell(row=row_idx, column=2).value
        c3 = ws.cell(row=row_idx, column=3).value

        # Only style rows that contain at least one value in the data columns.
        in_use = any(value not in (None, "") for value in (c1, c2, c3))
        if not in_use:
            continue

        # Joined-output title marker rows are emitted as ["", "", <filename>].
        is_title_row = (
            c1 in (None, "") and c2 in (None, "") and str(c3 or "").strip() != ""
        )
        if is_title_row:
            for col_idx in range(1, len(HEADER) + 1):
                ws.cell(row=row_idx, column=col_idx).fill = title_fill
            continue

        row_fill = plain_fill_1 if plain_row_index % 2 == 0 else plain_fill_2
        plain_row_index += 1
        for col_idx in range(1, len(HEADER) + 1):
            ws.cell(row=row_idx, column=col_idx).fill = row_fill

    wb.save(out_path)


def srt_to_csv(
    in_path: str,
    out_path: str,
    fps: float,
    out_format: str,
    encoding: str,
    quote_all: bool,
    delimiter_name: str,
    output_type: str | None = None,
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
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Convert SRT subtitles to CSV")
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
    args = p.parse_args()

    # Determine mode: single file or batch directory
    import os

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
                )
    else:
        if not args.input or not args.output:
            raise SystemExit(
                "Provide input and output paths, or use --input-dir/--output-dir for batch mode"
            )
        srt_to_csv(
            args.input,
            args.output,
            fps=args.fps,
            out_format=args.out_format,
            encoding=args.encoding,
            quote_all=args.quote_all,
            delimiter_name=args.delimiter,
            output_type=args.output_type,
        )


if __name__ == "__main__":
    main()
