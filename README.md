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

When the unified schema is detected the converter produces an internal multi-country structure which can be split to separate files (`--split-by-country`) or a single chosen country file. There are now two shapes depending on orientation mode:

### Default (Orientation Enabled)

Top-level `claim`, `disclaimer`, and `logo` are orientation objects with `landscape` and `portrait` arrays. Each video is duplicated: `<videoId>_landscape` and `<videoId>_portrait`, each containing an `orientation` metadata key. When portrait text is missing it is mirrored from landscape.

```json
{
  "schemaVersion": "v2",
  "country": "GBR",
  "metadataGlobal": {"version": 6, "fps": 25},
  "claim": {
    "landscape": ["Claim line 1", "Claim line 2"],
    "portrait":  ["Claim line 1", "Claim line 2"]
  },
  "disclaimer": {
    "landscape": ["Disclaimer block"],
    "portrait":  ["Disclaimer block"]
  },
  "logo": {
    "landscape": ["Logo text"],
    "portrait":  ["Logo text"]
  },
  "videos": [
     {
       "videoId": "WTA_30s_landscape",
       "metadata": {"duration": 30, "orientation": "landscape"},
       "subtitles": [{"line":1,"in":0.0,"out":2.4,"text":"Hello"}],
       "claim": [ {"line":1,"text":"Claim line 1"}, {"line":2,"text":"Claim line 2"} ],
       "disclaimer": [ {"line":1,"in":0.0,"out":29.5,"text":"Disclaimer block"} ],
       "logo": [ {"line":1,"in":29.5,"out":30.0,"text":"Logo text"} ]
     },
     {
       "videoId": "WTA_30s_portrait",
       "metadata": {"duration": 30, "orientation": "portrait"},
       "subtitles": [{"line":1,"in":0.0,"out":2.4,"text":"Hello"}],
       "claim": [ {"line":1,"text":"Claim line 1"}, {"line":2,"text":"Claim line 2"} ],
       "disclaimer": [ {"line":1,"in":0.0,"out":29.5,"text":"Disclaimer block"} ],
       "logo": [ {"line":1,"in":29.5,"out":30.0,"text":"Logo text"} ]
     }
  ]
}
```

### Legacy Flattened Mode (`--no-orientation`)

Top-level values are simple arrays and only the landscape set is emitted. Video IDs are not suffixed and no `orientation` metadata key appears.

```json
{
  "schemaVersion": "v2",
  "country": "GBR",
  "metadataGlobal": {"version": 6, "fps": 25, "duration": 30},
  "claim": [ {"line":1, "in":0.0, "out":3.2, "text":"Claim line 1"}, {"line":2, "text":"Claim line 2"} ],
  "disclaimer": [ {"line":1, "in":0.0, "out":29.5, "text":"Disclaimer block"} ],
  "logo": [ {"line":1, "in":29.5, "out":30.0, "text":"Logo text"} ],
  "videos": [
     {
       "videoId": "WTA_30s",
       "metadata": {"duration":30},
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
* `--claims-as-objects` In each video, output claims as claim_01, claim_02, ... objects instead of a single 'claim' array
* `--cast-metadata` Attempt numeric casting of metadata values (ints / floats)
* `--sample` Also emit a truncated preview file alongside each output (adds `_sample` before extension). The sample keeps at most: 2 claim lines, 1 disclaimer line, 1 logo line, 2 videos, 5 subtitles per video, 2 claim entries per video (or first two claim_XX objects).

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
* `--test-mode` Prefix per-video claim/disclaimer text with '<videoId>_' for testing
* `--no-orientation` Revert to legacy flat array output (no duplicated videos, ignores portrait columns)

Automatic output naming:
* `--auto-output` Derive output file name(s) from input base name (adds `_{country}` when splitting)
* `--output-dir <dir>` Directory for auto-output (default: directory of input CSV)

Schema tagging:
* `--schema-version <tag>` Embed schema version string (default `v2`)
* `--converter-version <tag>` Embed a converter build/version identifier (default `dev`). Also attempts to record the current git short commit if available.
* `--no-generation-meta` Disable automatic injection of generation metadata (useful for deterministic diffing without volatile fields).

## Validation Rules
The validator performs lightweight structural checks:
* Arrays `subtitles` plus either (a) flat `claim`/`disclaimer`/`logo` lists in `--no-orientation` mode or (b) orientation objects `{landscape:[],portrait:[]}` in default mode
* Orientation mode: `claim.landscape` and `claim.portrait` (same for `disclaimer`, `logo`) lengths should match (portrait auto-mirrors when empty)
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
* Each written output now includes generation metadata in `metadataGlobal` (or `metadata` in simple shape):
  * `generatedAt` – UTC ISO-8601 timestamp (no microseconds, `Z` suffix)
  * `inputSha256` – SHA-256 checksum of the source CSV
  * `inputFileName` – basename of the input CSV
  * `converterVersion` – value from `--converter-version` (default `dev`)
  * `converterCommit` – short git commit hash when repository and `git` available (best-effort)
  * `pythonVersion`, `pythonImplementation`, `platform` – environment/toolchain information
  * `lastChangeId` – first heading line in `CHANGELOG.md` (best-effort)
  These are omitted only during `--validate-only` and `--dry-run` since no files are written.
  Use `--no-generation-meta` to suppress all of the above for reproducible snapshots.

* A `CHANGELOG.md` file tracks recent changes; `lastChangeId` references its latest heading.

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