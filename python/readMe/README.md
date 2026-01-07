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
  * `disclaimer_02` – secondary disclaimer rows (same behavior as `disclaimer`)
  * `sub` – subtitle rows (must have `video_id` + start/end)
  * `super_a` – timed auxiliary rows (per‑video; same rules as `sub` but emitted under `super_A`)
  * `super_b` – timed auxiliary rows (per‑video; same rules as `sub` but emitted under `super_B`)
* `video_id`: identifies the target video for `sub` and `meta_local` rows
* `line`: optional manual line index; auto-assigned when missing
* `start` / `end`: timecodes (may be empty for continuation lines of disclaimers/disclaimer_02 or untimed claim segments)
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
| disclaimer_02 | Appended / merged into per‑country `disclaimer_02[]` blocks |
| sub           | Appended to `videos[].subtitles[]` for the given `video_id` |
| super_a       | Appended to `videos[].super_A[]` for the given `video_id` |
| super_b       | Appended to `videos[].super_B[]` for the given `video_id` |
| endFrame      | Appended to `videos[].endFrame[]` (timed segments; mirrors logo behavior per video) |

### Merging Behaviors
* Subtitle continuation lines (same `line` + same timing OR untimed continuation) concatenate text with newline unless `--no-merge-subtitles`.
* `super_A` continuation lines follow the exact same logic as subtitles.
* `super_B` continuation lines follow the exact same logic as subtitles.
* Disclaimer continuation lines (untimed lines after a timed starter) do NOT merge by default. Enable merging with `--merge-disclaimer`.
* Disclaimer_02 continuation lines follow identical behavior: non‑merging by default; enable with `--merge-disclaimer-02`.
* Claim rows with identical timing are combined (newline joined) when `--join-claim` is used.
* Per-video claim/disclaimer/disclaimer_02 text always takes precedence over the global arrays when a local cell is populated (landscape or portrait). Global text still supplies fallback content whenever the local cell is empty, so sparse overrides remain safe.
* Local claim/disclaimer/disclaimer_02 override is ON by default. A portrait line whose portrait cell is empty inherits the landscape local text when present before falling back to any global text. Use `--no-local-claim-override` (preferred) or the legacy inverted flag `--prefer-local-claim-disclaimer` to disable this behavior and revert to global timing/index fallback only.
* Non‑contiguous dedup (subtitles + `super_A`): after contiguous merging, rows sharing `(line,start,end)` are grouped. Identical duplicate texts are not re‑appended; distinct texts for the same key are newline‑concatenated in original encounter order. Portrait texts use the same rule, with fallback to landscape when empty.

### Sample CSV (super_A / super_B + flags)

Semicolon‑delimited minimal unified CSV showing `super_a` / `super_b` rows and `super_A_flag` / `super_B_flag` usage:

```
record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL
meta_global;;;;;briefVersion;Y;ALL;25;
meta_global;;;;;fps;Y;ALL;25;
meta_global;;;;;super_A_flag;Y;ALL;enabled;
meta_global;;;;;super_B_flag;Y;ALL;enabled;
meta_local;VID_A;;;;title;N;ALL;Test Video;
sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello world;
super_a;VID_A;1;00:00:05:00;00:00:07:00;;;;;EVENT ONE;
super_a;VID_A;2;00:00:08:00;00:00:09:12;;;;;EVENT TWO;
super_b;VID_A;1;00:00:10:00;00:00:12:00;;;;;EVENT B ONE;
super_b;VID_A;2;00:00:12:08;00:00:13:12;;;;;EVENT B TWO;
```

```json
{
  "videos": [{
    "videoId": "VID_001_landscape",
    "metadata": {"super_A_flag": "enabled", "super_B_flag": "enabled"},
    "super_A": [
      {"line": 1, "in": 1.0, "out": 3.0, "text": "Super A Text"}
    ],
    "super_B": [
      {"line": 1, "in": 10.0, "out": 12.0, "text": "Super B Text"}
    ]
  }]
}
```
Notes:
- The `super_a` rows are emitted under each video as `super_A` arrays (duplicated to portrait; portrait text mirrors landscape when its cell is empty).
- The `super_b` rows are emitted under each video as `super_B` arrays (duplicated to portrait; portrait text mirrors landscape when its cell is empty).
- `super_A_flag` from `meta_global` is injected into per‑video metadata by country; a per‑video `meta_local.super_A_flag` (when provided per country) overrides the global value.
- `super_B_flag` from `meta_global` is injected into per‑video metadata by country; a per‑video `meta_local.super_B_flag` (when provided per country) overrides the global value.
- No automatic inheritance: if only some videos have `super_a` rows, other videos simply emit `"super_A": []`.
  The same non‑inheritance applies to `super_b` rows (other videos emit `"super_B": []`).

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
  "disclaimer_02": {
    "landscape": ["Disclaimer 02 block"],
    "portrait":  ["Disclaimer 02 block"]
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
       "disclaimer_02": [ {"line":1,"in":0.0,"out":29.5,"text":"Disclaimer 02 block"} ],
       "logo": [ {"line":1,"in":29.5,"out":30.0,"text":"Logo text"} ]
      ,"super_A": [ {"line":1,"in":5.0,"out":7.5,"text":"Aux line 1"} ]
      ,"super_B": [ {"line":1,"in":10.0,"out":12.0,"text":"Aux B line 1"} ]
     },
     {
       "videoId": "WTA_30s_portrait",
       "metadata": {"duration": 30, "orientation": "portrait"},
       "subtitles": [{"line":1,"in":0.0,"out":2.4,"text":"Hello"}],
       "claim": [ {"line":1,"text":"Claim line 1"}, {"line":2,"text":"Claim line 2"} ],
       "disclaimer": [ {"line":1,"in":0.0,"out":29.5,"text":"Disclaimer block"} ],
       "disclaimer_02": [ {"line":1,"in":0.0,"out":29.5,"text":"Disclaimer 02 block"} ],
       "logo": [ {"line":1,"in":29.5,"out":30.0,"text":"Logo text"} ],
      "super_A": [ {"line":1,"in":5.0,"out":7.5,"text":"Aux line 1"} ],
      "super_B": [ {"line":1,"in":10.0,"out":12.0,"text":"Aux B line 1"} ]
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
  "disclaimer_02": [ {"line":1, "in":0.0, "out":29.5, "text":"Disclaimer 02 block"} ],
  "logo": [ {"line":1, "in":29.5, "out":30.0, "text":"Logo text"} ],
  "videos": [
     {
       "videoId": "WTA_30s",
       "metadata": {"duration":30},
       "subtitles": [ {"line":1, "in":0.0, "out":2.4, "text":"Hello"} ],
       "super_A": [],
       "super_B": []
     }
  ]
}
```

## CLI Usage

Basic simple CSV:
```sh
python3 csv_to_json.py input.csv output.json --fps 25
```

Unified CSV → split one file per country:
```sh
python3 csv_to_json.py unified.csv out/result.json --fps 25 --split-by-country
```

Custom output naming:
```sh
python3 csv_to_json.py unified.csv out/subs.json --fps 25 --split-by-country --output-pattern out/WTA_{country}.json
```

When `language` is present (see below), filenames automatically include it after the country code during `{country}` expansion: `out/WTA_GBR_EN.json`. If the language is missing for a country, the file name remains `out/WTA_GBR.json`.

Single-country with templated filename:
```sh
python3 csv_to_json.py unified.csv out/WTA_{country}.json --fps 25 --country-column 1
```

Validation only (no files written):
```sh
python3 csv_to_json.py unified.csv /dev/null --fps 25 --validate-only
```

Dry run (list discovered countries/videos):
```sh
python3 csv_to_json.py unified.csv /dev/null --fps 25 --dry-run
```

## Development Tasks (Lint, Format, Tests)

### One‑Click VS Code Tasks

This repo defines several helpful tasks in `.vscode/tasks.json`:

| Task Label | Purpose |
|------------|---------|
| Tests: pytest (quick) | Fast test run (`pytest -q`) |
| Tests: pytest (quick, parallel) | Parallel quick run (`pytest -q -n auto`) |
| Tests: pytest (coverage term) | Test run with inline coverage summary |
| Tests: pytest (coverage term, parallel) | Coverage run using xdist workers |
| Tests: quick (wrapper) | Invoke `python/run_tests.py` (no coverage) |
| Tests: coverage (wrapper) | Invoke wrapper with coverage + badge update |
| Lint: ruff | Static analysis via `ruff check .` |
| Lint: flake8 | Style/errors via `flake8 .` |
| Lint: all | Fail fast (ruff then flake8) |
| Lint: all (continue) | Always run both, fail if either reports issues |
| Lint: ruff fix | Auto-fix ruff violations where supported |
| Format: isort | Sort imports in place |
| Format: black | Black format code in place |
| Format: check | Non‑modifying isort + black validation |
| Format: ruff | Ruff formatter (alternative to black) |
| Format: ruff check | Non‑modifying ruff format validation |
| Fix: all (ruff format+ruff fix+isort) | Full pipeline: format, fix lint, normalize imports |

### Recommended Local Workflow

1. Run `Tests: pytest (quick)` while iterating.
2. Use `Lint: all (continue)` before committing (catches both tool outputs).
3. For code style:
  * Prefer `Fix: all (ruff format+ruff fix+isort)` OR `Format: black` + `Format: isort` (choose one style approach).
4. Run `Tests: coverage (wrapper)` or the coverage term task to refresh the badge.

### Formatting Strategy

Ruff can now replace black for formatting. Both are configured to a line length of 88. If you fully migrate to ruff formatting you can remove the black tasks. Current pipeline keeps them separate to allow incremental adoption.

### Makefile & Direct Commands

Equivalent shell invocations (inside the virtualenv):

```sh
ruff check .              # lint
ruff check --fix .        # auto-fix subset
flake8 .                  # supplemental style checks
black .                   # format with black
isort .                   # sort imports
pytest -q                 # quick tests
pytest -q -n auto         # quick tests (parallel)
pytest --cov=python --cov-branch --cov-config=.coveragerc  # coverage
pytest -n auto --cov=python --cov-branch --cov-config=.coveragerc  # coverage (parallel)
python3 python/run_tests.py --coverage  # wrapper + badge
```

## Tools

Helper utilities live under `python/tools/`.

- `srt_to_csv.py`: Convert SubRip (`.srt`) files to a simple CSV with `Start Time, End Time, Text` columns. Supports output in frames (`HH:MM:SS:FF`) or milliseconds (`HH:MM:SS,SSS`). Also supports batch directory mode (`--input-dir` + `--output-dir`) and a joined-output mode (`--join-output`) to combine multiple `.srt` files into one `.csv` with filename markers.
  See `python/tools/README.md` for usage, flags like `--quote-all` and `--delimiter`, and examples.

  Common invocations:
  ```sh
  # Batch: convert all .srt → separate .csv files
  python -m python.tools.srt_to_csv --input-dir in/ --output-dir out/ --fps 25 --out-format frames

  # Batch join: combine all .srt → one .csv with filename markers
  python -m python.tools.srt_to_csv --input-dir in/ --output-dir out/joined.csv --join-output --fps 25 --out-format frames
  ```

- `csv_json_media.py`: Convert media deliverables CSV (`AspectRatio;Dimensions;Creative;Media;Template;Template_name`) into a JSON index keyed by `<AspectRatio>[ _<Template_name> if Template==extra ]|<duration>`, with values as `{size, media}` arrays. Handles consecutive C2–C5 dedup and trims surrounding whitespace. See `python/tools/README.md` for rules and options.

  Common invocation:
  ```sh
  python -m python.tools.csv_json_media path/to/input.csv out/media_outputs.json
  ```
  Note: add `--compact` to write JSON with inline array items.
  Split by country/language:
  ```sh
  python -m python.tools.csv_json_media path/to/input.csv out/ --split-by-country \
    --output-pattern "media_{COUNTRY}[_{LANG}].json"
  ```

### Parallel Test Execution (xdist)

Pytest-xdist is included for optional speed-ups on multi-core machines. The `-n auto` flag chooses a worker count based on CPU cores; `--dist=loadfile` groups tests by file to reduce fixture thrashing.

Guidelines:
* Use parallel mode for larger test suites or when adding more parametrized cases.
* If you encounter flaky tests due to shared global state, run without `-n` and refactor those tests (prefer isolated tmp_path usage, avoid modifying process-wide globals).
* Coverage with xdist uses the same `--cov` flags; pytest-cov writes worker files that our wrapper then combines into a single XML/badge.

Example:
```sh
pytest -n auto --dist=loadfile --cov=python --cov-branch --cov-config=.coveragerc
```

#### Troubleshooting parallel coverage

- Always use `--dist=loadfile` with parallel coverage to keep test files on the same worker; other strategies can skew or drop coverage.
- Avoid exporting `COVERAGE_SUBPROCESS=1` unless your tests spawn extra Python processes themselves. Pytest‑cov already handles xdist workers; enabling subprocess coverage when you have `sitecustomize.py` hooks can lead to coverage's sqlite data error ("no such table: file").
- If you see INTERNALERRORs or odd totals, first clear old data: run the new VS Code task "Coverage: clean" (does `coverage erase` and removes `.coverage*` files), then rerun tests.
- Use up‑to‑date tooling: coverage ≥ 7.6.1, pytest‑cov ≥ 5.0.0, pytest‑xdist ≥ 3.6.1 (see `requirements-test.txt`).
- The canonical coverage configuration is `.coveragerc`. Any older `pyproject.toml` coverage section was removed to prevent config conflicts across workers and subprocesses.

## Continuous Integration

GitHub Actions workflow (`.github/workflows/tests.yml`) now has a separate `quality` job matrix:

| Matrix Entry | Command(s) |
|--------------|------------|
| ruff | `ruff check .` |
| flake8 | `flake8 .` |
| format-black-isort | `isort --check-only .` then `black --check .` |
| format-ruff-check | `ruff format --check .` |

These run in parallel on Ubuntu with Python 3.12. The `build` job then runs the full test + coverage suite (wrapper plus direct pytest-cov). Adjust required checks in branch protection to include both jobs for stricter gating.

### Adding Pre-Commit Hooks (Optional)

You can adopt pre-commit with a `.pre-commit-config.yaml` to enforce ruff, isort, black, and tests-on-changed (lightweight). Not yet included to keep dependency surface minimal.

---

## Discrepancy Postmortem (tests/coverage)

Symptom
- Test count and coverage differed between local runs and CI in earlier revisions.

Root causes
- Mixed discovery: the old unittest-based runner didn’t see three pytest-only tests, so fewer tests executed → lower, uneven coverage.
- Coverage scope after refactor: moving `python/tools/log_picker.py` temporarily excluded it from coverage due to config/paths.
- Invocation differences: VS Code inline env assignments and mixed runners led to inconsistent coverage data/combination.

Fixes
- Unified on pytest for a single discovery model (all tests run consistently; now 44).
- Updated `.coveragerc` and used `--cov=python` so `python/tools/*` is included.
- Added a wrapper (`python/run_tests.py --coverage`) to standardize flags and badge generation.

Current state
- Coverage is stable (e.g., `log_picker.py` ~94%), and tasks/CI are aligned for repeatable results.

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
* `--merge-disclaimer` Enable disclaimer continuation block merging (default off)
* `--merge-disclaimer-02` Enable disclaimer_02 continuation block merging (default off)
* `--join-claim` Merge claim rows sharing identical timing into one block
* `--claims-as-objects` In each video, output claims as claim_01, claim_02, ... objects instead of a single 'claim' array
* `--no-local-claim-override` Disable per‑video local claim/disclaimer override (default override enabled). Legacy alias: `--prefer-local-claim-disclaimer` (same effect)
* `--cast-metadata` Attempt numeric casting of metadata values (ints / floats)
* `--sample` Also emit a truncated preview file alongside each output (adds `_sample` before extension). The sample keeps at most: 2 claim lines, 1 disclaimer line, 1 disclaimer_02 line, 1 logo line, 2 videos, 5 subtitles per video, 2 claim entries per video (or first two claim_XX objects).

Deprecated (pre‑1.5.5): Prior versions merged disclaimers by default and used `--no-merge-disclaimer` / `--no-merge-disclaimer-02` to disable merging. These flags are now deprecated; non‑merging is the default. Update any automation to use `--merge-disclaimer` / `--merge-disclaimer-02` when merging is desired.

Multi-country output control:
* `--split-by-country` Write one JSON per country (pattern can include `{country}`)
* `--output-pattern <path>` Custom output path pattern using `{country}`. Works with split mode and with single-country exports when used with `--country-column <n>` (the placeholder expands to the selected country). If the pattern lacks `{country}`, it will be injected before the extension.
* `--country-column <n>` When not splitting, choose the Nth country among detected ones (default last). You can still use `{country}` in the output path to inject the selected code.
* `--country-variant-index <n>` When a country appears multiple times (duplicate column pairs, e.g., to represent different language variants), select which pair to use in non-split scenarios (0-based; default 0). Split mode emits all variants automatically.

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

* Per-country language (CSV to JSON 167–171):
  * Provide a `meta_global` row with `key=language` to set per-country language codes. The converter captures values per country (portrait > landscape > metadata cell). When a value is missing for a country, `metadataGlobal.language` is set to an empty string.
  * Filenames: when `{country}` is expanded, the language ISO is appended for that country if present, yielding `<base>_<COUNTRY>_<LANG>.json`; otherwise `<base>_<COUNTRY>.json`.
  * Multi‑variant export: if the same country appears multiple times (duplicate columns representing distinct variants), split mode emits one file per variant (e.g., `..._BEL_FRA.json` and `..._BEL_NLD.json`). In non‑split mode you may choose a specific variant via `--country-variant-index`.

* A `CHANGELOG.md` file tracks recent changes; `lastChangeId` references its latest heading.
  * `super_A` & `super_A_flag` (CSV to JSON 174–176):
    * `super_a` rows mirror subtitle row requirements (must specify `video_id` and timings; auto line numbering when omitted; portrait fallback to landscape when the portrait cell is empty).
    * Emitted under each video as `super_A` (orientation duplicated like other per‑video arrays).
    * Merging: identical to subtitles for contiguous continuation lines; subsequent dedup pass collapses non‑contiguous identical duplicates and newline‑joins distinct duplicates (see Merging Behaviors).
    * Flag precedence: per‑country `meta_global.super_A_flag` provides a default injected into each video’s metadata for that country; a per‑country `meta_local.super_A_flag` overrides it. Values are not coerced—`N` remains `N`.
    * No automatic inheritance to shorter cutdowns: if only the longest duration video has rows, other videos simply emit an empty `super_A` array (even when their flag is `Y`), matching the subtitle non‑inheritance model.
    * Empty array emission keeps the schema stable for consumers that expect the key.
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

### Per-Video End Frame Markers: `record_type endFrame` (CSV to JSON 115–116)

Some campaigns also include explicit end-of-spot markers per video. These are modeled with `record_type` set to `endFrame` and behave like per‑video logo segments:

- Rows must provide timing (`start`, `end`); text comes from the usual precedence: metadata column fallback, then per‑country landscape cell, then portrait cell.
- Values are collected per video and emitted as an array at `videos[*].endFrame` with objects shaped like logo entries: `{ "line", "text", "in", "out" }`.
- Orientation mode duplicates appear in both `<videoId>_landscape` and `<videoId>_portrait`. When portrait text is empty, it mirrors landscape as with subtitles/logo.
- No top-level `endFrame` aggregate is produced; the data lives only under each video.

Example CSV rows (unified schema):

```
record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBR,DEU
endFrame,WTA_30s,1,00:00:29:12,00:00:30:00,,,,End frame,,
endFrame,WTA_30s,2,00:00:29:20,00:00:30:00,,,,,GBR end frame,
```

Example output excerpt (one video object shown):

```jsonc
{
  "videoId": "WTA_30s_landscape",
  "metadata": { "duration": 30, "orientation": "landscape" },
  "subtitles": [ { "line": 1, "in": 0.0, "out": 2.4, "text": "Hello" } ],
  "logo": [ { "line": 1, "in": 29.5, "out": 30.0, "text": "Logo text" } ],
  "endFrame": [ { "line": 1, "in": 29.5, "out": 30.0, "text": "End frame" } ]
}
```

Validation: `in <= out` is enforced for each item. Items are optional; omit `endFrame` entirely if not used.

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
python3 csv_to_json.py input.csv output.json --fps 25
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

The test runner is unified on pytest. Use the wrapper for convenience, a `--coverage` flag, or call pytest directly.

### Wrapper script (`python/run_tests.py`)

- Quick run:
  ```sh
  python3 python/run_tests.py
  ```
- With coverage (flag form):
  ```sh
  python3 python/run_tests.py --coverage
  ```
- With coverage (env var, legacy style – equivalent):
  ```sh
  COVERAGE=1 python3 python/run_tests.py
  ```

The flag form avoids occasional terminal input truncation issues some shells/editors have with leading environment assignments.

### Direct pytest invocation

- Plain:
  ```sh
  pytest -q python/tests
  ```
- With coverage (requires `pytest-cov`):
  ```sh
  pytest -q python/tests --cov=python --cov-branch --cov-report=term-missing \
    --cov-report=xml:python/tests/coverage/coverage.xml
  coverage-badge -o python/tests/coverage/coverage.svg -f
  ```

### Makefile shortcuts

If available (see repository `Makefile`):
```sh
make test       # runs python/run_tests.py
make coverage   # runs python/run_tests.py with coverage enabled
make pytest-cov # direct pytest-cov invocation
```

### VS Code Task (optional)
You can add a `.vscode/tasks.json` task to invoke coverage via the flag:
```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Tests: Coverage",
      "type": "shell",
      "command": "python3 python/run_tests.py --coverage",
      "group": "test",
      "presentation": {"reveal": "always", "panel": "shared"},
      "problemMatcher": []
    }
  ]
}
```
Place this in `.vscode/tasks.json` (create folder/file if missing). Then run via Command Palette: *Tasks: Run Task* → *Tests: Coverage*.

What’s covered by tests (CSV to JSON 62–105 highlights):
- Unified multi-country/orientation parsing, video duplication and orientation metadata
- `logo_anim_flag` overview aggregation, per-video overrides and split trimming; `--no-logo-anim-overview`
- `jobNumber` precedence and default sentinel `"noJobNumber"`
- `subtitle_flag` / `disclaimer_flag` per‑country meta_local propagation vs per-video overrides
- `--join-claim`, `prefer_local_claim_disclaimer`, disclaimer multi-line merges
- Validation-only paths (sectioned/unified), `--no-orientation` legacy shape, negative overlap checks
- CLI outputs: `--split-by-country` with `--auto-output` naming and `--output-pattern {country}` paths
- Optional shapes: `claims_as_objects` (claim_XX objects per video)
- `endFrame` record_type parsing mirrored to per‑video arrays in both landscape and portrait

### Try it

- Generate coverage with the unittest runner and view artifacts:
  ```sh
  COVERAGE=1 python3 python/run_tests.py
  ```
  Outputs:
  - Badge: [coverage.svg](../tests/coverage/coverage.svg)
  - XML: [coverage.xml](../tests/coverage/coverage.xml)
  - HTML: [index.html](../tests/coverage/html/index.html)

Or, using direct pytest-cov:
```sh
pytest -q python/tests --cov=python --cov-branch --cov-report=term-missing --cov-report=xml:python/tests/coverage/coverage.xml
coverage-badge -o python/tests/coverage/coverage.svg -f
```
Outputs:
- Badge: [coverage.svg](../tests/coverage/coverage.svg)
- XML: [coverage.xml](../tests/coverage/coverage.xml)

### Media Injection (csv_json_media)

Use a separate media CSV to inject a per-country `media` object into the converter’s output. Injection occurs only for exact `(country, language)` matches (language may be empty). The `media` key is appended immediately after `videos` in each per-country payload.

Flags:
- `--media-csv`: Path to the media CSV (enables injection).
- `--media-delimiter`: Media CSV delimiter (default `;`).
- `--media-country-col`: Country column header in the media CSV (default `Country`).
- `--media-language-col`: Language column header in the media CSV (default `Language`).

Behavior:
- Exact match only: `(DEU, "")` matches a media row with `Country=DEU` and `Language` empty; `(BEL, FRA)` matches only rows with both `BEL` and `FRA`.
- No fallbacks: if there is no exact match, `media` is not injected.
- Mapping shape is produced by the media tool: keys like `1x1|06s` → array of `{ size, media }`.

Example (split by country):
```sh
python3 python/csv_to_json.py data.csv out/{country}.json \
  --split-by-country \
  --media-csv media.csv \
  --media-delimiter ';' \
  --media-country-col Country \
  --media-language-col Language

python3 python/csv_to_json.py in.csv out.json \
  --country-column 1 \
  --fps 25 \
  --media-csv media.csv
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