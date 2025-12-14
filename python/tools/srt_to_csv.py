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
- --delimiter <name>          Output delimiter: 'comma' or 'semicolon' (default 'comma')

Examples:
    # Single file
    python python/tools/srt_to_csv.py input.srt output.csv --fps 25 --out-format frames
    python python/tools/srt_to_csv.py input.srt output.csv --out-format ms

    # Batch mode: iterate all .srt in an input folder and write .csv to an output folder
    python python/tools/srt_to_csv.py --input-dir in_srt/ --output-dir out_csv/ --fps 25 --out-format frames

    # Batch join: iterate all .srt in an input folder and write a single combined .csv
    python python/tools/srt_to_csv.py --input-dir in_srt/ joined.csv --join-output --fps 25 --out-format frames
"""
from __future__ import annotations

import argparse
import csv
import re
from typing import List, Tuple

TIME_RE = re.compile(
    r"^(?P<h1>\d{2}):(?P<m1>\d{2}):(?P<s1>\d{2})[,.](?P<ms1>\d{3})\s*-->\s*" 
    r"(?P<h2>\d{2}):(?P<m2>\d{2}):(?P<s2>\d{2})[,.](?P<ms2>\d{3})\s*$"
)


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
        h1 = int(m.group("h1")); m1 = int(m.group("m1")); s1 = int(m.group("s1")); ms1 = int(m.group("ms1"))
        h2 = int(m.group("h2")); m2 = int(m.group("m2")); s2 = int(m.group("s2")); ms2 = int(m.group("ms2"))
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


def srt_to_csv(in_path: str, out_path: str, fps: float, out_format: str, encoding: str, quote_all: bool, delimiter_name: str) -> None:
    with open(in_path, "r", encoding=encoding) as f:
        # Preserve lines; splitlines handles CRLF/CR/LF
        lines = f.read().splitlines()
    records = parse_srt(lines)

    # Choose delimiter
    delimiter = "," if delimiter_name == "comma" else ";"
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter=delimiter, quoting=(csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL))
        writer.writerow(["Start Time", "End Time", "Text"])
        for start, end, text in records:
            if out_format == "frames":
                start_str = format_time_frames(start, fps)
                end_str = format_time_frames(end, fps)
            elif out_format == "ms":
                start_str = format_time_ms(start)
                end_str = format_time_ms(end)
            else:
                raise ValueError("out_format must be 'frames' or 'ms'")
            writer.writerow([start_str, end_str, text])


def main() -> None:
    p = argparse.ArgumentParser(description="Convert SRT subtitles to CSV")
    p.add_argument("input", nargs="?", help="Path to input .srt file (omit when using --input-dir)")
    p.add_argument("output", nargs="?", help="Path to output .csv file (omit when using --output-dir)")
    p.add_argument("--input-dir", help="Directory containing .srt files to convert (batch mode)")
    p.add_argument("--output-dir", help="Directory to write .csv files in batch mode")
    p.add_argument("--join-output", action="store_true", help="In batch mode, join all inputs into a single output CSV (provide output file path)")
    p.add_argument("--fps", type=float, default=25.0, help="Input frame rate for frames output (default 25)")
    p.add_argument("--out-format", choices=["frames", "ms"], default="frames", help="Output format: frames (HH:MM:SS:FF) or ms (HH:MM:SS,SSS)")
    p.add_argument("--encoding", default="utf-8-sig", help="Input file encoding (default utf-8-sig)")
    p.add_argument("--quote-all", action="store_true", help="Always quote all CSV fields (default OFF)")
    p.add_argument("--delimiter", choices=["comma", "semicolon"], default="comma", help="Output delimiter (default comma)")
    args = p.parse_args()

    # Determine mode: single file or batch directory
    import os
    if args.input_dir:
        in_dir = args.input_dir
        if not os.path.isdir(in_dir):
            raise SystemExit(f"Input directory not found: {in_dir}")
        names = [n for n in sorted(os.listdir(in_dir)) if n.lower().endswith('.srt')]
        if args.join_output:
            # Write a single combined CSV to args.output
            if not args.output:
                raise SystemExit("Provide an output file path for --join-output mode")
            # Choose delimiter
            delimiter = "," if args.delimiter == "comma" else ";"
            with open(args.output, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f, delimiter=delimiter, quoting=(csv.QUOTE_ALL if args.quote_all else csv.QUOTE_MINIMAL))
                writer.writerow(["Start Time", "End Time", "Text"])
                for name in names:
                    in_path = os.path.join(in_dir, name)
                    # Marker row: include filename to separate sections
                    writer.writerow(["", "", name])
                    # Convert and append rows
                    with open(in_path, "r", encoding=args.encoding) as sf:
                        lines = sf.read().splitlines()
                    for start, end, text in parse_srt(lines):
                        if args.out_format == "frames":
                            start_str = format_time_frames(start, args.fps)
                            end_str = format_time_frames(end, args.fps)
                        else:
                            start_str = format_time_ms(start)
                            end_str = format_time_ms(end)
                        writer.writerow([start_str, end_str, text])
        else:
            out_dir = args.output_dir or args.input_dir
            os.makedirs(out_dir, exist_ok=True)
            for name in names:
                in_path = os.path.join(in_dir, name)
                base = os.path.splitext(name)[0]
                out_name = base + '.csv'
                out_path = os.path.join(out_dir, out_name)
                srt_to_csv(
                    in_path,
                    out_path,
                    fps=args.fps,
                    out_format=args.out_format,
                    encoding=args.encoding,
                    quote_all=args.quote_all,
                    delimiter_name=args.delimiter,
                )
    else:
        if not args.input or not args.output:
            raise SystemExit("Provide input and output paths, or use --input-dir/--output-dir for batch mode")
        srt_to_csv(
            args.input,
            args.output,
            fps=args.fps,
            out_format=args.out_format,
            encoding=args.encoding,
            quote_all=args.quote_all,
            delimiter_name=args.delimiter,
        )


if __name__ == "__main__":
    main()
