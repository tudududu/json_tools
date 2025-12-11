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
```

Options:
- `--fps <float>`: Input frame rate for frames output (default: 25)
- `--out-format <frames|ms>`: Output time format (`frames` → `HH:MM:SS:FF`, `ms` → `HH:MM:SS,SSS`; default: `frames`)
- `--encoding <name>`: Input file encoding (default: `utf-8-sig`)
