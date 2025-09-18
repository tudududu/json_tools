# CSV → JSON Subtitle Converter (Unified Multi‑Country / Multi‑Video)

This Python CLI converts several related CSV formats into structured JSON suitable for automation / templating pipelines. It supports:

1. Simple legacy CSV: `Start Time, End Time, Text` → `{ "subtitles": [...] }`
2. Sectioned CSV (subtitles / claim / disclaimer / metadata blocks)
3. Unified scalable schema for multiple countries and multiple videos per country.

## Timecode Formats Supported
* `HH:MM:SS:FF` (frames; requires `--fps`)
* `HH:MM:SS[.ms]`
* `MM:SS[.ms]`
* `SS[.ms]`

## Unified CSV Schema (Recommended)

Header columns (fixed order up to `metadata` then one column per country):

```
record_type,video_id,line,start,end,key,is_global,country_scope,metadata,<COUNTRY1>,<COUNTRY2>,...
```

Meaning:
* `record_type` (required): one of
  * `meta_global` – global metadata key/value
  * `meta_local` – per‑video metadata key/value (requires `video_id`)
  * `claim` – claim text rows (timed or untimed)
  * `disclaimer` – disclaimer rows (first timed row starts a block; following untimed rows append)
  * `sub` – subtitle rows (must have `video_id` + start/end)
* `video_id`: identifies the target video for `sub` and `meta_local` rows
* `line`: optional manual line index; auto-assigned when missing
* `start` / `end`: timecodes (may be empty for continuation lines of disclaimers or untimed claim segments)
* `key`: metadata key for meta rows
* `is_global`: (reserved / optional) – currently not required (parser ignores)
* `country_scope`: `ALL` will propagate the first non-empty text across all country columns
* `metadata`: fallback value column for metadata rows if no per-country value provided
* `<COUNTRY*>` columns: per-country text. Add as many as needed (e.g., `GBR, DEU, FRA, ...`).

### Mapping Rules
| record_type    | JSON placement |
|---------------|----------------|
| meta_global   | `metadataGlobal[key] = value` |
| meta_local    | Inside matching video: `videos[].metadata[key] = value` |
| claim         | Appended to per‑country `claim[]` (merged if `--join-claim`) |
| disclaimer    | Appended / merged into per‑country `disclaimer[]` blocks |
| sub           | Appended to `videos[].subtitles[]` for the given `video_id` |

### Merging Behaviors
* Subtitle continuation lines (same `line` + same timing OR untimed continuation) concatenate text with newline unless `--no-merge-subtitles`.
* Disclaimer continuation lines (untimed lines after a timed starter) merge into a single block unless `--no-merge-disclaimer`.
* Claim rows with identical timing are combined (newline joined) when `--join-claim` is used.

### Per-Country Output Structure

When the unified schema is detected the converter produces an internal multi-country structure which can be split to separate files (`--split-by-country`) or a single chosen country file:

```json
{
  "schemaVersion": "v2",
  "country": "GBR",
  "metadataGlobal": {"version": 6, "fps": 25, "duration": 30},
  "claim": [ {"line":1, "in":0.0, "out":3.2, "text":"..."} ],
  "disclaimer": [ {"line":1, "in":0.0, "out":29.5, "text":"...merged..."} ],
  "videos": [
     {
       "videoId": "WTA_30s",
       "metadata": {"aspect":"16:9"},
       "subtitles": [ {"line":1, "in":0.0, "out":2.4, "text":"Hello"} ]
     }
  ]
}
```

## CLI Usage

Basic simple CSV:
```sh
python3 csv_to_subtitles_json.py input.csv output.json --fps 25
```

Unified CSV → split one file per country:
```sh
python3 csv_to_subtitles_json.py unified.csv out/result.json --fps 25 --split-by-country
```

Custom output naming:
```sh
python3 csv_to_subtitles_json.py unified.csv out/subs.json --fps 25 --split-by-country --output-pattern out/WTA_{country}.json
```

Validation only (no files written):
```sh
python3 csv_to_subtitles_json.py unified.csv /dev/null --fps 25 --validate-only
```

Dry run (list discovered countries/videos):
```sh
python3 csv_to_subtitles_json.py unified.csv /dev/null --fps 25 --dry-run
```

## Key Flags

General:
* `--fps <float>` Frames per second for `HH:MM:SS:FF` parsing (default 25)
* `--start-line <int>` Starting line index for auto numbering (default 1)
* `--round <int>` Round seconds to N decimals (default 2; `-1` disables rounding)
* `--times-as-string` Emit times as strings (retain trailing zeros)
* `--encoding <name>` CSV encoding (default `utf-8-sig`)
* `--delimiter <auto|comma|semicolon|tab|pipe|char>` Force / sniff delimiter (default auto)
* `--verbose` Print detected delimiter and headers

Simple mode overrides:
* `--start-col`, `--end-col`, `--text-col` Column name or 1-based index overrides

Merging / content behavior:
* `--no-merge-subtitles` Disable multi-line subtitle merging
* `--no-merge-disclaimer` Disable disclaimer merging
* `--join-claim` Merge claim rows sharing identical timing into one block
* `--cast-metadata` Attempt numeric casting of metadata values (ints / floats)

Multi-country output control:
* `--split-by-country` Write one JSON per country (pattern can include `{country}`)
* `--output-pattern <path>` Custom split output path pattern (must include `{country}` or will be injected)
* `--country-column <n>` When not splitting, choose the Nth country among detected ones (default last)

Validation / inspection:
* `--validate-only` Parse & validate only (exit code 0 on success, 1 on validation errors)
* `--dry-run` Summarize countries, videos, line counts; no files written (always exit 0)
* `--required-global-keys <k1,k2>` Comma list of required keys in `metadataGlobal` (default `version,fps`; empty string disables)
* `--missing-keys-warn` Downgrade missing required keys to warnings (still reported but do not fail)
* `--validation-report <path>` Emit a JSON validation report (usable with `--validate-only` or `--dry-run`)

Automatic output naming:
* `--auto-output` Derive output file name(s) from input base name (adds `_{country}` when splitting)
* `--output-dir <dir>` Directory for auto-output (default: directory of input CSV)

Schema tagging:
* `--schema-version <tag>` Embed schema version string (default `v2`)

## Validation Rules
The validator performs lightweight structural checks:
* Arrays `subtitles`, `claim`, `disclaimer` must be lists
* For timed entries: `in <= out`
* Monotonic non-overlapping subtitle timing per video (start must be >= previous end)
* Disclaimer / claim timing ordering (if present) receives the same basic in/out sanity check
* Global metadata (`metadataGlobal`) – optional enforcement of keys via `--required-global-keys` (default: `version,fps`)
* Missing keys become warnings instead of errors when `--missing-keys-warn` is set
* Basic shape checks for per‑video objects

Future enhancements could add: duplicate line detection, empty video detection, strict metadata typing.

## Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success (conversion OR validation/dry-run OK; may include warnings) |
| 1 | Validation errors encountered (`--validate-only`) and not only warnings |
| >1 | Unexpected runtime exception (traceback printed) |

## Notes
* BOM (`utf-8-sig`) automatically handled.
* Empty or whitespace text rows are skipped unless `--keep-empty-text`.
* `country_scope=ALL` will broadcast a non-empty first country text to empty country cells on that row.
* Time rounding is applied after parsing and before string conversion.
* No redundant `metadata.country` injection—country lives only in the top level of per‑country outputs.

## Legacy Simple Example
Input CSV:
```
Start Time,End Time,Text
00:00:00:00,00:00:02:12,Hello world.
00:00:02:12,00:00:04:00,Second line.
```

Command:
```sh
python3 csv_to_subtitles_json.py input.csv output.json --fps 25
```

Output:
```json
{
  "subtitles": [
    {"line": 1, "in": 0.0, "out": 2.48, "text": "Hello world."},
    {"line": 2, "in": 2.48, "out": 4.0, "text": "Second line."}
  ]
}
```

## Troubleshooting
* Delimiter guess wrong? Use `--delimiter semicolon` (or `comma`, `tab`, `|`).
* Timecode parse error: confirm format and `--fps` for frame-based codes.
* Missing global metadata key? Add a `meta_global` row or provide placeholder value.
* Overlap validation complaints: ensure subtitle rows are time sorted and non-overlapping per video.
* Want a machine-readable report? Add `--validation-report report.json`.
* Need only warnings for missing keys? Add `--missing-keys-warn` (optionally adjust keys list).

---
If additional schema evolutions are needed, open an issue or extend the script where noted.