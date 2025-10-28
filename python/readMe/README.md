# CSV → JSON Subtitle Converter (Python CLI)

![Coverage](../tests/coverage/coverage.svg "Test Coverage")

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
  "metadataGlobal": {"schemaVersion": "v2", "country": "GBR", "briefVersion": 6, "fps": 25},
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
  "metadataGlobal": {"schemaVersion": "v2", "country": "GBR", "briefVersion": 6, "fps": 25, "duration": 30},
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
* `--required-global-keys <k1,k2>` Comma list of required keys in `metadataGlobal` (default `briefVersion,fps`; empty string disables)
* `--missing-keys-warn` Downgrade missing required keys to warnings (still reported but do not fail)
* `--validation-report <path>` Emit a JSON validation report (usable with `--validate-only` or `--dry-run`)
* `--test-mode` Prefix per-video claim/disclaimer text with '<videoId>_' for testing
* `--no-orientation` Revert to legacy flat array output (no duplicated videos, ignores portrait columns)

Automatic output naming:
* `--auto-output` Derive output file name(s) from input base name (adds `_{country}` when splitting)
* `--output-dir <dir>` Directory for auto-output (default: directory of input CSV)

Schema tagging:
* `--schema-version <tag>` Embed schema version string (default `v2`)
* `--converter-version <tag>` Embed a converter build/version identifier (default `auto`). When left as `auto` (or `dev`), the tool derives a version in this order: (1) `CONVERTER_VERSION` env var, (2) first heading in `CHANGELOG.md`, (3) latest git tag, (4) `0.0.0+<shortcommit>`, else falls back to `dev`. The git short commit is still recorded separately as `converterCommit` when available.
* `--no-generation-meta` Disable automatic injection of generation metadata (useful for deterministic diffing without volatile fields).

## Validation Rules
The validator performs lightweight structural checks:
* Arrays `subtitles` plus either (a) flat `claim`/`disclaimer`/`logo` lists in `--no-orientation` mode or (b) orientation objects `{landscape:[],portrait:[]}` in default mode
* Orientation mode: `claim.landscape` and `claim.portrait` (same for `disclaimer`, `logo`) lengths should match (portrait auto-mirrors when empty)
* For timed entries: `in <= out`
* Monotonic non-overlapping subtitle timing per video (start must be >= previous end)
* Disclaimer / claim timing ordering (if present) receives the same basic in/out sanity check
* Global metadata (`metadataGlobal`) – optional enforcement of keys via `--required-global-keys` (default: `briefVersion,fps`)
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
* Country & schemaVersion are now stored inside `metadataGlobal` (migrated from former top-level keys) and not duplicated.
* Each written output now includes generation metadata in `metadataGlobal` (or `metadata` in simple shape):
  * `generatedAt` – UTC ISO-8601 timestamp (no microseconds, `Z` suffix)
  * `inputSha256` – SHA-256 checksum of the source CSV
  * `inputFileName` – basename of the input CSV
  * `converterVersion` – resolved value (auto or provided) from `--converter-version` (default `auto` logic)
  * `schemaVersion`, `country`, `briefVersion` now reside inside `metadataGlobal` instead of top-level (post-migration)
  * `converterCommit` – short git commit hash when repository and `git` available (best-effort)
  * `pythonVersion`, `pythonImplementation`, `platform` – environment/toolchain information
  * `lastChangeId` – first heading line in `CHANGELOG.md` (best-effort)
  These are omitted only during `--validate-only` and `--dry-run` since no files are written.
  Use `--no-generation-meta` to suppress all of the above for reproducible snapshots.

* A `CHANGELOG.md` file tracks recent changes; `lastChangeId` references its latest heading.
  In this repository the Python-specific changelog resides at `python/readMe/CHANGELOG.md`.
  The converter’s `--converter-version auto` first looks for a repo-root `CHANGELOG.md`, then falls back to `python/readMe/CHANGELOG.md`.

### CHANGELOG Auto-Bump Helper

Use `python3 python/bump_changelog.py` to prepend a new version heading automatically. Examples:

```
# Bump patch (e.g., 1.3.0 -> 1.3.1)
python3 python/bump_changelog.py --part patch

# Explicit version
python3 python/bump_changelog.py --set 1.4.0

# Pre-release
python3 python/bump_changelog.py --part minor --pre rc1

# Dry run (no file write)
python3 python/bump_changelog.py --part patch --dry-run

# Create git commit + tag
python3 python/bump_changelog.py --part patch --commit --tag
```

Resolution order for `converterVersion` already aligns with this (the new top heading becomes the version when using `--converter-version auto`).

### Repo layout & bump helper (CSV to JSON 106–108)

- Python documentation (README.md and CHANGELOG.md) now lives under `python/readMe/`.
- The converter’s version auto-detection falls back to `python/readMe/CHANGELOG.md` when a repo-root `CHANGELOG.md` is not present. The `lastChangeId` metadata field uses the same fallback.
- The bump helper `python/bump_changelog.py` reads/writes `python/readMe/CHANGELOG.md` and stages that path for commit/tag operations.

### Migration (schemaVersion / country relocation & briefVersion key)

As of version 1.3.x the following changes were introduced:
* `schemaVersion` and `country` moved from top-level into `metadataGlobal`.
* `version` metadata key has been renamed to `briefVersion` in CSV and output.
* Default required global keys changed from `version,fps` to `briefVersion,fps`.

If you still have older CSVs providing `version`, either:
1. Update the CSV header row (`meta_global` entries) to use `briefVersion`, or
2. Invoke the converter with `--required-global-keys version,fps` for backward compatibility.

Consumers parsing previous top-level fields should now look inside `metadataGlobal` for `schemaVersion` and `country`.

### Per-Country jobNumber Override (CSV to JSON 38, 39, 40)
`schemaVersion` row at line 2 is still recognized (no special change needed beyond using its meta_global value, which we already did).
New meta_global key `brand` is captured automatically (generic handling).
New meta_global key `jobNumber` now supports per‑country overrides

`jobNumber` is now always emitted inside `metadataGlobal` for every country. When no value is supplied it is set to the sentinel `"noJobNumber"` (CSV to JSON 40; previously an empty string). The precedence rules when deriving each country's `jobNumber` are:

1. Country-specific value from the per-country landscape/portrait text cells on a `meta_global` row whose key is `jobNumber` (first non-empty among the two orientation cells).
2. Otherwise, the fallback `metadata` column value on that same row (applied uniformly to all countries still lacking a per-country value).
3. If neither (1) nor (2) provides a value, the sentinel `"noJobNumber"` is set so downstream systems can rely on the key's existence.

This fixes a previous edge case where a single populated country-specific cell would suppress a global fallback and omit `jobNumber` entirely for other countries. Now those other countries inherit the global value (if any) or get `"noJobNumber"`.

Example `meta_global` row (simplified):

```
meta_global,,, , ,jobNumber,,,GLOBAL123,GBR_DEU_value,,SAU_value
```

If `GBR` and `SAU` have explicit per-country entries, they use those; `DEU` (empty) receives `GLOBAL123` from the metadata column. All three outputs will include a `jobNumber` key.

If you need to detect whether a value was truly supplied vs. absent, treat `"noJobNumber"` as the sentinel for "not provided".

### Per-Country meta_local Flags: `disclaimer_flag` / `subtitle_flag` (CSV to JSON 42, 43)

Certain `meta_local` keys now support per-country values rather than a single shared value:

* `disclaimer_flag`
* `subtitle_flag`

How it works:
1. For these keys, the parser reads the per-country landscape / portrait text cells on the `meta_local` row. The first non-empty orientation cell becomes that country’s value.
2. If both orientation cells are empty for a country but the legacy `metadata` fallback column has a value, that fallback is used for that country.
3. Values are stored per video and injected into each duplicated video metadata object (landscape & portrait) without being overwritten by a global shared value.
4. `country_scope` is ignored for these keys (previous sheets sometimes used `ALL` with broadcast semantics; real per-country content now wins).

Example simplified row (semicolons omitted for brevity):
```
meta_local;SomeVideo;;;;disclaimer_flag;N;;;Y;;Y;;Y;
```
Will result in `"disclaimer_flag": "Y"` in `metadata` for each country’s `SomeVideo_landscape` / `SomeVideo_portrait` objects.

Fallback precedence (per key, per country):
1. Per-country landscape / portrait cell (landscape preferred only because it’s checked first; portrait used if landscape empty and portrait non-empty).
2. Metadata fallback column value.
3. (No sentinel added here—key simply omitted for that video & country if no value was ever provided.)

Other `meta_local` keys continue to behave as before: the first non-empty per-country cell (any country) or the metadata column value becomes a single shared metadata value across all countries for the video.

Consumer guidance: Treat absence of these keys as `false` / disabled; treat presence with any non-empty value (e.g. `Y`) as enabled.

### Multi-Row Global Logo Animation Overview: `logo_anim_flag` (CSV to JSON 46–51)

Some campaigns need a quick lookup for whether the logo animates at a given video duration. This is modeled via multiple `meta_global` rows whose `key` is `logo_anim_flag` and whose `country_scope` column holds the duration string (e.g. `6`, `15`, `30`, `60`, `90`, `120`). The flag value (`Y` / `N`) is taken from the `metadata` column (typical `ALL` usage) with a fallback to per-country landscape, then portrait cells if the metadata cell is empty.

At output time:
* `metadataGlobal.logo_anim_flag` becomes an object mapping duration → value, stably ordered by (length, lexicographic) for predictable diffs: `{"6":"N","15":"Y",...}`.
* Each video's `metadata.logo_anim_flag` is populated by looking up the video's `duration` (string compare) in the overview. (Videos whose duration is not present simply omit the key.)
* A `meta_local` row for `logo_anim_flag` now overrides the duration-derived (and per-country) mapping for that specific video & country (portrait > landscape > metadata fallback). Precedence per video per country: meta_local > per-country meta_global override > meta_global default value.
* Disable embedding of the overview object (but keep per-video injected values) with `--no-logo-anim-overview`.

Example rows:
```
meta_global;;;;;logo_anim_flag;;6;N;;;;;;
meta_global;;;;;logo_anim_flag;;15;Y;;;;;;
meta_global;;;;;logo_anim_flag;;120;Y;;;;;;
```

Example output excerpt:
```jsonc
"metadataGlobal": {
  "logo_anim_flag": { "6": "N", "15": "Y", "120": "Y" },
  "briefVersion": 19,
  ...
},
"videos": [
  { "videoId": "Brand_120s_landscape", "metadata": { "duration": "120", "logo_anim_flag": "Y", ... } },
  { "videoId": "Brand_120s_portrait",  "metadata": { "duration": "120", "logo_anim_flag": "Y", ... } }
]
```

CLI toggle:
```
--no-logo-anim-overview   Remove metadataGlobal.logo_anim_flag (per-video values stay)
```

Splitting Behavior (`--split-by-country`):
When writing per-country JSON files the overview is filtered/simplified for that country:
* Nested entries (with `_default` + country keys) are reduced to just the effective scalar for that country.
* Scalar durations remain unchanged.
* Result: each per-country file exposes only values relevant to its own country (no leakage of other country overrides, no `_default`).

Use a non-split (combined) run if you need the full multi-country matrix with nested objects.

### Helper: Inspecting Flags & Job Numbers Safely

To avoid brittle ad-hoc greps (and terminal line-wrap issues), use the helper:

```sh
python3 python/tools/inspect_flags.py out/v14_test_*.json --per-video
```

By default it reports `disclaimer_flag`, `subtitle_flag`, and `jobNumber`. Customize:

```sh
python3 python/tools/inspect_flags.py out/v14_test_GBR.json --keys disclaimer_flag,subtitle_flag --per-video
```

Add `--show-missing` to list keys that are absent. You can pass directories or mixed glob patterns.

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

## Testing

You can run the suite in either unittest or pytest styles.

- Unittest (fast default):
  - Full run
    ```sh
    python3 python/run_tests.py
    ```
  - With coverage (branch + subprocess; emits XML/JSON and a badge at `python/tests/coverage/coverage.svg`)
    ```sh
    COVERAGE=1 python3 python/run_tests.py
    ```
- Pytest with coverage (requires pytest-cov):
  ```sh
  make pytest-cov
  ```
  This uses `.coveragerc` and outputs term, XML (`python/tests/coverage/coverage.xml`) and HTML (`python/tests/coverage/html`).

Shortcuts:
- `make test` → runs the unittest suite
- `make coverage` → runs unittest suite with coverage enabled

What’s covered by tests (CSV to JSON 62–105 highlights):
- Unified multi-country/orientation parsing, video duplication and orientation metadata
- `logo_anim_flag` overview aggregation, per-video overrides and split trimming; `--no-logo-anim-overview`
- `jobNumber` precedence and default sentinel `"noJobNumber"`
- `subtitle_flag` / `disclaimer_flag` per‑country meta_local propagation vs per-video overrides
- `--join-claim`, `prefer_local_claim_disclaimer`, disclaimer multi-line merges
- Validation-only paths (sectioned/unified), `--no-orientation` legacy shape, negative overlap checks
- CLI outputs: `--split-by-country` with `--auto-output` naming and `--output-pattern {country}` paths
- Optional shapes: `claims_as_objects` (claim_XX objects per video)

### Try it

- Generate coverage with the unittest runner and view artifacts:
  ```sh
  COVERAGE=1 python3 python/run_tests.py
  ```
  Outputs:
  - Badge: [coverage.svg](../tests/coverage/coverage.svg)
  - XML: [coverage.xml](../tests/coverage/coverage.xml)
  - HTML: [index.html](../tests/coverage/html/index.html)

- Or with pytest-cov:
  ```sh
  make pytest-cov
  ```
  Outputs:
  - XML: [coverage.xml](../tests/coverage/coverage.xml)
  - HTML: [index.html](../tests/coverage/html/index.html)

## Troubleshooting
* Delimiter guess wrong? Use `--delimiter semicolon` (or `comma`, `tab`, `|`).
* Timecode parse error: confirm format and `--fps` for frame-based codes.
* Missing global metadata key? Add a `meta_global` row or provide placeholder value.
* Overlap validation complaints: ensure subtitle rows are time sorted and non-overlapping per video.
* Want a machine-readable report? Add `--validation-report report.json`.
* Need only warnings for missing keys? Add `--missing-keys-warn` (optionally adjust keys list).

---
If additional schema evolutions are needed, open an issue or extend the script where noted.