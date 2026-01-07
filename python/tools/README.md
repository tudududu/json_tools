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

## csv_json_media.py

Converts a semicolon-delimited media deliverables CSV into a compact JSON index mapping `<AspectRatio>[ _<Template_name> if Template==extra ]|<duration>` → list of `{ size, media }` objects.

- Input columns: `AspectRatio;Dimensions;Creative;Media;Template;Template_name`
- Key rules:
  - Duration from `Creative` with `C1…C5` removed and zero-padded (e.g., `6sC1` → `06s`).
  - Append `_<Template_name>` to the AR part only when `Template == extra` (spaces/underscores removed; case preserved).
  - Example keys: `1x1|06s`, `9x16_tiktok|15s`.
- Values: `{ "size": <Dimensions>, "media": <Media> }` with surrounding whitespace trimmed, case preserved.
- Deduplication: for consecutive rows that differ only by the creative number (C2–C5) while other columns and base duration match, only the first is kept.

Usage:
```sh
python python/tools/csv_json_media.py input.csv output.json
python python/tools/csv_json_media.py input.csv out/ --split-by-country
python python/tools/csv_json_media.py input.csv out/ --split-by-country --output-pattern "media_{COUNTRY}[_{LANG}].json"
python python/tools/csv_json_media.py input.csv out/ --split-by-country --country-col Territory --language-col Lang
```

Options:
- `--delimiter <char>`: CSV delimiter (default: `;`)
- `--trim` / `--no-trim`: Trim surrounding whitespace on fields (default: trim)
- `--dry-run`: Parse only and print a brief summary; no file written
- `--compact`: Write JSON with inline array items (objects on a single line inside arrays)
 - `--split-by-country`: Split outputs per `Country`/`Language` columns; writes one JSON per group
 - `--country-col <name>`: Country column header (default: `Country`)
 - `--language-col <name>`: Language column header (default: `Language`)
 - `--output-pattern <pattern>`: Filename pattern for split outputs. Supports `{country},{COUNTRY},{lang},{LANG}` tokens and optional bracket segments `[...]` that are included only when their expanded content is non-empty. Default: `media_{COUNTRY}[_{LANG}].json`.

Dry run examples:
```sh
# Summarize split groups without writing files
python python/tools/csv_json_media.py input.csv dummy.json --split-by-country --dry-run
```

### Changes since CSV to JSON 198 (SRT to CSV script)
- Added quoting control: `--quote-all` to force quoting on all fields; default remains minimal quoting per RFC 4180.
- Added delimiter selection: `--delimiter semicolon` to reduce quoting in text-heavy CSV; default `comma` retained.
- Added batch directory mode: `--input-dir` + optional `--output-dir` to convert multiple `.srt` files, inheriting basenames for `.csv` outputs.
- Added joined output mode: `--join-output` to combine many `.srt` files into one `.csv`, inserting a filename marker row before each file’s records.

### New: Country/Language split for media CSV
- Added per-country/language grouping with `--split-by-country`.
- Custom column names via `--country-col` and `--language-col`.
- Flexible file naming with `--output-pattern` (tokens: `{country},{COUNTRY},{lang},{LANG}`; optional segments `[...]`).
- Dry-run prints a concise summary per group (keys/items counts).
