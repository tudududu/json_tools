# Tools

This folder contains helper scripts used alongside the CSV → JSON converter.

## srt_to_csv.py

Converts a SubRip (`.srt`) subtitle file into a simple CSV with columns:
`Start Time, End Time, Text`.

- Input: Standard SRT blocks
  ```
  1
  00:00:00,120 --> 00:00:02,560
  text string
  ```
- Output (frames): `HH:MM:SS:FF` (requires `--fps`)
  ```
  Start Time,End Time,Text
  00:00:00:03,00:00:02:14,text string
  ```
- Output (milliseconds): `HH:MM:SS,SSS`
  ```
  Start Time,End Time,Text
  "00:00:00,120","00:00:02,560",text string
  ```

Usage:
```sh
python python/tools/srt_to_csv.py input.srt output.csv --fps 25 --out-format frames
python python/tools/srt_to_csv.py input.srt output_ms.csv --out-format ms
python -m python.tools.srt_to_csv --input-dir in_srt/ --output-dir out_csv/ --fps 25 --out-format frames
python -m python.tools.srt_to_csv --input-dir in_srt/ joined.csv --join-output --fps 25 --out-format frames
```

Options:
- `--fps <float>`: Input frame rate for frames output (default: 25)
- `--out-format <frames|ms>`: Output time format (`frames` → `HH:MM:SS:FF`, `ms` → `HH:MM:SS,SSS`; default: `frames`)
- `--encoding <name>`: Input file encoding (default: `utf-8-sig`)
- `--quote-all`: Quote all CSV fields (default: minimal quoting)
- `--delimiter <comma|semicolon>`: Output delimiter (default: `comma`)
- `--input-dir`: Batch mode — iterate all `.srt` files in the directory
- `--output-dir`: Batch mode — directory to write separate `.csv` files (defaults to `--input-dir`)
- `--join-output`: Batch join — write a single combined CSV (provide an output file path either positionally after `--input-dir` or via `--output-dir`)

### Changes since CSV to JSON 198 (SRT to CSV script)
- Added quoting control: `--quote-all` to force quoting on all fields; default remains minimal quoting per RFC 4180.
- Added delimiter selection: `--delimiter semicolon` to reduce quoting in text-heavy CSV; default `comma` retained.
- Added batch directory mode: `--input-dir` + optional `--output-dir` to convert multiple `.srt` files, inheriting basenames for `.csv` outputs.
- Added joined output mode: `--join-output` to combine many `.srt` files into one `.csv`, inserting a filename marker row before each file’s records.
