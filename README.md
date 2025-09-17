# CSV → JSON Subtitle Converter

This small Python CLI converts a CSV with columns like `Start Time, End Time, Text` into the JSON schema used by your After Effects expressions.

Schema:

{
  "subtitles": [
    {"line": 1, "in": 0.00, "out": 2.40, "text": "Hello world."}
  ]
}

Works with timecodes in:
- HH:MM:SS:FF (frames; requires `--fps`)
- HH:MM:SS[.ms]
- MM:SS[.ms]
- SS[.ms]

## Usage (macOS, zsh)

1) Ensure Python 3 is available.

2) Run the converter:

```sh
python3 csv_to_subtitles_json.py "<input.csv>" "<output.json>" --fps 25
```

Examples:

```sh
# Convert your attached CSV at 25 fps
python3 csv_to_subtitles_json.py \
  "/Volumes/globalservs/pop-emea/_HS-PROJECTS-EU/PRG/HERCULES/SAUDI/2025/2025/_LIBRARIES/IBC4/VIDEO/PROJECT FILES/subtitles/ENG_2/WTA 30s v03.csv" \
  "json_test_conv/WTA_30s_v03_from_csv.json" \
  --fps 25

# Produce times as strings with trailing zeros and 2 decimals
python3 csv_to_subtitles_json.py input.csv output.json --fps 25 --times-as-string --round 2

# Semicolon-delimited CSV (autodetects, or force delimiter):
python3 csv_to_subtitles_json.py "in/WTA_30s_v03_ara.csv" "out/WTA_30s_v03_from_csv.json" --fps 25
python3 csv_to_subtitles_json.py "in/WTA_30s_v03_ara.csv" "out/WTA_30s_v03_from_csv.json" --fps 25 --delimiter semicolon
python3 csv_to_subtitles_json.py "in/WTA_30s_v03_ara.csv" "out/WTA_30s_v03_from_csv.json" --fps 25 --start-col "Start Time" --end-col "End Time" --text-col "Text" --verbose
```

Flags:
- `--fps <float>`: Frames per second for HH:MM:SS:FF (default 25)
- `--start-line <int>`: Starting line index (default 1)
- `--round <int>`: Round seconds to N digits (default 2; use -1 to disable rounding)
- `--times-as-string`: Keep times as strings (keeps trailing zeros)
- `--no-strip-text`: Do not trim subtitle text
- `--keep-empty-text`: Keep rows with empty text
- `--encoding <name>`: CSV encoding (default utf-8-sig; handles BOM)
 - `--delimiter <auto|comma|semicolon|tab|pipe|char>`: CSV delimiter (default auto; sniff among , ; TAB |)

Notes:
- Header names are matched case-insensitively. It looks for Start Time, End Time, Text (or common variants like Start/End/In/Out/Caption).
- CSV with BOM is handled by default.
- Outputs pretty-printed JSON with UTF-8.

If you need a different JSON shape, tell me the schema and I’ll adapt the script.