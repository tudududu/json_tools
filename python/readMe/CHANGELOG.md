# 1.8.8 - 2026-03-12

Added:
- Updated per-video generic key emission logic in csv_to_json.py:
	Before: if local generic rows were missing for a video/key, it fell back to global generic rows.
	Now: it uses local rows only; if missing, it emits an empty list for that per-video key.

# 1.8.7 - 2026-03-09

Changed:
- Quality gates and lint/format stabilization (CSV to JSON 249–268):
	* Standardized repository lint/format workflow on Ruff checks (`ruff check` + `ruff format --check`) and removed duplicate formatter/linter overlap in CI.
	* Completed focused lint debt cleanup for style-only violations (`E701`, `E702`, `E741`, `F841`) across converter/tools/tests files.
	* Removed unused variables and dead assignments flagged by Ruff (including `idx_is_global`, `header`, and unused test locals).
	* Reworked test imports to avoid per-file `sys.path` mutation (`E402`) and use package imports consistently.
	* Added editable package install support for tests/CI (`pip install -e .`) via `pyproject.toml` packaging metadata and workflow updates.
	* Pinned Ruff in `requirements-test.txt` to `0.14.4` to eliminate local-vs-CI formatter drift.

Maintenance:
- Dependencies and docs cleanup:
	* Simplified top-level `requirements.txt` to minimal runtime dependency set (kept `openpyxl` as the only required runtime package).
	* Kept test/tooling dependencies in `requirements-test.txt`, including editable local install for stable test imports.

# 1.8.6 - 2026-03-07

Added:
- SRT → CSV tool (CSV to JSON 245):
	* Added XLSX header row background formatting in `python/tools/srt_to_csv.py`.
	* XLSX row 1 now uses Excel theme color "Text 2 (Dark Blue), Lighter 50%".

# 1.8.5 - 2026-03-04

Added:
- SRT → CSV tool (CSV to JSON 242):
	* Added XLSX output support to `python/tools/srt_to_csv.py` in parallel with existing CSV output.
	* Added `--output-type {csv,xlsx}` as an explicit output container override.
	* Added output extension inference when `--output-type` is omitted (`.xlsx` => XLSX, otherwise CSV).
	* XLSX output writes a single worksheet named `subtitles`.
	* Refactored shared row serialization so single-file and batch-join modes use the same output pipeline.

# 1.8.4 - 2026-03-04

Fixed:
- CSV → JSON tool (CSV to JSON 241):
	* Updated top-level `disclaimer`, `disclaimer_02`, `logo`, and `generic_XX` arrays to preserve all explicitly defined rows, including rows where both landscape and portrait are empty.
	* Removed row filtering for these top-level arrays so defined empty rows emit `""` placeholders and keep index alignment.
	* Portrait values continue to fall back to the landscape value when portrait is empty.

# 1.8.3 - 2026-03-04

Fixed:
- CSV → JSON tool (CSV to JSON 240):
	* Preserved explicitly defined global claim rows even when both landscape and portrait values are empty.
	* Empty defined claim rows now emit empty-string placeholders in top-level `claim.landscape`/`claim.portrait`.
	* Per-video claim fallback keeps correct row alignment and no longer drifts to a previous line in this case.

# 1.8.2 - 2026-03-03

Fixed:
- CSV → JSON tool (CSV to JSON 239):
	* Fixed claim parsing alignment when a global claim row contains portrait-only text.
	* Portrait-only rows are now preserved (landscape placeholder emitted as empty string) instead of being dropped.
	* Per-video claim arrays keep correct line mapping for both orientations in this scenario.

# 1.8.1 - 2026-02-25

Added:
- CSV → JSON media tool (CSV to JSON 238):
	* Added direct XLSX input support to `python/tools/csv_json_media.py` alongside existing CSV support.
	* Added `--xlsx-sheet` option for explicit sheet selection.
	* Default XLSX sheet resolution: use sheet named `media` when present, otherwise use first sheet.
	* XLSX reader uses cached formula values (`data_only=True`) and keeps CSV parsing logic unchanged after row ingestion.

# 1.8.0 - 2026-02-25

Added:
- CSV → JSON tool (CSV to JSON 236):
	* Added direct XLSX input support alongside existing CSV input (no CSV workflow changes required).
	* Added `--xlsx-sheet` option for explicit sheet selection.
	* Default XLSX sheet resolution: use sheet named `data` if present, otherwise use first sheet.
	* XLSX reader uses cached formula values (`data_only=True`) and preserves duplicate headers for country/orientation mapping.

# 1.7.3 - 2026-02-22

Added:
- CSV → JSON tool (CSV to JSON 235):
	* Added flags overview shape option: default output is scalar when a flag has default-only value, and object only when targeted durations exist.
	* Added optional `--flags-overview-object-always` to force object shape per flag in `metadataGlobal`.

# 1.7.2 - 2026-02-22

Added:
- CSV → JSON tool (CSV to JSON 233):
	* Rebuilt metadata flag handling to auto-detect any `meta_global`/`meta_local` key ending with `_flag` (including `generic_XX_flag`) without hardcoded flag lists.
	* Added duration-targeted emission for global flags via `target_duration` with rules: untargeted default applies to all videos, targeted rows apply only to matching durations, and targeted rows override default for matching durations.
	* Preserved precedence for per-video metadata injection: `meta_local` override > targeted `meta_global` > untargeted `meta_global`.
	* Added global per-country flag overview emission in `metadataGlobal` as objects like `{ "_default": ..., "<duration>": ... }`.

# 1.7.1 - 2026-02-22

Added:
- CSV → JSON tool (CSV to JSON 232):
	* Normalized numeric duration tokens for `logo_anim_flag` matching so values like `06` and `6` resolve to the same key.

# 1.7.0 - 2026-02-22

Added:
- CSV → JSON tool (CSV to JSON 231):
	* Added optional `target_duration` unified-schema column for `meta_global.logo_anim_flag` duration targeting.
	* Kept backward compatibility: when `target_duration` is empty, legacy `country_scope` is still accepted for `logo_anim_flag` with a warning.
	* Clarified docs so `country_scope` remains scope/broadcast semantics while duration targeting uses `target_duration`.

# 1.6.0 - 2026-02-16

Added:
- CSV → JSON tool (CSV to JSON 220–223):
	* Scalable generic timed keys (`generic_01`..`generic_NN`) with top-level and per-video outputs.
	* Auto-detected `generic_XX_flag` support via `meta_global`/`meta_local` with the usual per-country default + per-video override rules.
	* Output ordering guarantees: generic keys appear before `videos`, and per-video `claim` follows `super_B`.

# 1.5.10 - 2026-02-12

Fixed:
- CSV → JSON tool
	Traced and fixed the claim line-shift bug, then added regression coverage for your Test A and Test B scenarios.

	What was wrong
	Portrait claims were built by appending only explicit portrait rows, then padding by list length.
	That caused row-order drift when portrait was missing on earlier rows (exactly your A/B symptom).

	Fix applied
	Updated csv_to_json.py to keep claim.portrait aligned per row index:
	For each emitted claim row, portrait now uses:
		explicit portrait text when present,
		otherwise fallback to same-row landscape text.
	Removed the old “append portrait then extend tail” behavior that caused shifting.

# 1.5.9 - 2026-01-21

Added:
- CSV → JSON tool
	* Media injection into `csv_to_json.py` (CSV to JSON 212–213): added `--media-*` flags, single-load media CSV, and per-country injection on exact (Country, Language) matches.
- CSV → JSON media tool enhancements (CSV to JSON 212–218):
	* Multi-country/language split outputs with `--split-by-country` and `{COUNTRY}/{LANG}` filename templating.
	* Optional bracket segments in output patterns only included when tokens are present.
	* Robust handling for blank/separator rows and skipping empty split groups.
	* Media CSV duration sourced from `Duration`/`Title` columns with fallback to `Creative`.
	* Media mapping integration into `csv_to_json.py` with exact (country, language) injection after `videos`.
	* Dimensions normalization (e.g., `1440 x 1800` → `1440x1800`).

# 1.5.8 - 2025-12-31

Added:
- CSV → JSON media tool `csv_json_media.py` (CSV to JSON 206–211):
	* Converts deliverables CSV into a media index keyed by `<AspectRatio>[ _<Template_name> if Template==extra ]|<duration>`.
	* Supports duration parsing/normalization, consecutive creative dedup, and stable ordering of `{size, media}` pairs.
	* Optional split-by-country output with filename templating and dry-run summaries.
	* Media injection integrated into `csv_to_json.py` via `--media-csv` with exact country+language matching.

# 1.5.7 - 2025-12-11

Added:
- SRT → CSV converter tool `srt_to_csv.py` (CSV to JSON 195–203):
	* Converts SubRip blocks into CSV with either frame timecodes (`HH:MM:SS:FF`) or milliseconds (`HH:MM:SS,SSS`).
	* `--fps` controls frame conversion; `--out-format` selects `frames` or `ms` output.
	* `--encoding` supports `utf-8-sig` and other inputs with BOM.
	* CSV formatting controls: `--quote-all` and `--delimiter` (comma/semicolon).
	* Batch mode: `--input-dir` and `--output-dir` convert multiple `.srt` files.
	* Batch join: `--join-output` merges many `.srt` files into one CSV with filename markers.
	* Includes CLI module entry (`python -m python.tools.srt_to_csv`) and tool documentation.

Tests:
- Added coverage for `srt_to_csv.py` (frame/ms output, join-output, batch mode, quoting, and delimiter handling).

Docs:
- README updated with `srt_to_csv.py` usage, flags, and batch examples.

# 1.5.6 - 2025-12-10

Added (CSV to JSON 191–192):
- New timed collection `super_B` with behavior identical to `super_A`:
	* Recognized via `record_type=super_b`; parsed per video and emitted under `videos[].super_B[]`.
	* Orientation mirroring: portrait text falls back to landscape when empty; arrays exist for both duplicated videos.
	* Continuation merging: follows subtitle rules (contiguous lines combine unless `--no-merge-subtitles`).
	* Non‑contiguous dedup: rows sharing `(line,start,end)` are grouped; identical duplicates collapse, distinct texts concatenate in stable order.
	* Flag precedence: `super_B_flag` supports `meta_global` per‑country defaults overridden by `meta_local` per‑country values.
	* Legacy mode (`--no-orientation`): `super_B` remains per‑video arrays; empty arrays are emitted for videos without `super_b` rows.

Docs:
- README updated to include `record_type=super_b`, mapping to `videos[].super_B[]`, merging/dedup rules, sample CSV/JSON, and `super_B_flag` precedence.

# 1.5.5 - 2025-11-26

Changed (CSV to JSON 186):
- Inverted disclaimer merging default and flags:
	* Previous: disclaimer blocks merged by default; disable via `--no-merge-disclaimer` and `--no-merge-disclaimer-02`.
	* Now: disclaimer blocks do NOT merge by default; enable merging via `--merge-disclaimer` and `--merge-disclaimer-02`.
	* Behavior applies to both global and per‑video disclaimer/disclaimer_02 continuation rows (untimed lines after a timed starter).
	* Old `--no-merge-...` flags are deprecated; use the new `--merge-...` flags.

Docs:
- README updated to reflect new default (non‑merging) and new flags (`--merge-disclaimer`, `--merge-disclaimer-02`).


# 1.5.4 - 2025-11-24

Added (CSV to JSON 184–185):
- New timed collection `disclaimer_02` with identical behavior to `disclaimer` (184):
  * Recognized via `record_type=disclaimer_02`; supports global and per-video rows.
  * Independent merge flag `--no-merge-disclaimer-02` controls continuation block merging (default enabled).
  * Shares the existing local override flag `--no-local-claim-override` (applies to claim, disclaimer, disclaimer_02, logo, endFrame).
  * Portrait fallback to landscape local text before global arrays (when override enabled).
  * Metadata flag `disclaimer_02_flag` (meta_global, meta_local) controls per-video visibility.
  * Full orientation support: top-level `disclaimer_02` object with `landscape`/`portrait` arrays; per-video `disclaimer_02` items.
  * Legacy mode (`--no-orientation`) outputs simple `disclaimer_02` array.
  * Validation includes legacy validation, orientation validation, and no-orientation mode.
  * Sampling: `SAMPLE_LIMITS["disclaimer_02"] = 1` (keeps 1 disclaimer_02 line in samples).
- Tests: Added 8 comprehensive tests covering parsing, continuation merging, no-merge flag, portrait fallback, per-video override, flag metadata, empty defaults, and per-video structure (185).

Docs:
- README updated with `disclaimer_02` in record_type list, mapping table, merging behaviors section, sample JSON blocks (orientation and legacy modes), and CLI flags documentation.
- CHANGELOG entry added for version 1.5.4.

# 1.5.3 - 2025-11-23

Changed (CSV to JSON 181–182):
- Inverted gating for per-video claim/disclaimer local overrides. Local text precedence (including portrait fallback to landscape local) is now enabled by default.
- Introduced clearer alias flag `--no-local-claim-override` to disable local override (preferred). Legacy flag name `--prefer-local-claim-disclaimer` retained as an alias but now also disables the override.
- README updated to clarify new default and inverted flag usage; tests added to verify behavior when override disabled; added test for alias flag.

# 1.5.2 - 2025-11-22

Changed (CSV to JSON 178–180):


Changed (CSV to JSON 178–180) (superseded by 1.5.3 override default change):
- Per-video claim override retained under flag `--prefer-local-claim-disclaimer`; when enabled, local claim text (landscape or portrait) takes precedence over global claim text for that orientation.
- New portrait local fallback: if the flag is enabled and a portrait claim/disclaimer cell is empty but the landscape local cell has content, the portrait line inherits the landscape local text before considering global fallbacks.
- Claim joining retains precedence: when `--join-claim` merges per-video rows sharing a timing, the combined local text wins over any global row for that timing; subsequent unmatched timings still use global arrays (timing or index) when local cells are blank.

Tests:
- Added unit coverage for local-override precedence (with and without `--join-claim`) and portrait inheritance of landscape local claim/disclaimer text.

Docs:
- README clarifies per-video claim precedence and how it interacts with join + global fallback behavior.

# 1.5.1 - 2025-11-21

Added (CSV to JSON 174–176):
- New timed collection `super_A` plus flag `super_A_flag`, implemented with identical parsing, orientation mirroring, line auto‑numbering, and per‑video scoping rules as `subtitles` (174).
- Per-country `super_A_flag` precedence: `meta_local` per‑country value (if present) overrides `meta_global` per‑country default; values like `N` are preserved verbatim (174).
- Non‑contiguous dedup merge pass for `subtitles` and `super_A`: rows sharing `(line,start,end)` are grouped; identical duplicate texts are collapsed (not re‑concatenated), distinct texts are newline‑joined in stable order (175).
- Portrait text handling for `super_A` mirrors subtitles: when a portrait cell for a line is empty its landscape text is used (174).
- Empty `super_A` arrays are emitted for videos without any `super_a` rows (no implicit inheritance to shorter cutdowns; behavior clarified vs. subtitles) (176).

Docs:
- README updated with `super_a` record_type mapping, merging & dedup rules, flag precedence, sample video object containing `super_A` arrays, a minimal sample CSV snippet, and clarification on non‑inheritance (176–177).

Tests:
- Added unit tests covering basic `super_A` parsing, flag precedence (global vs local), merging of continuation lines, portrait mirroring, empty array emission, and the new non‑contiguous dedup logic ensuring identical duplicates are not duplicated while distinct duplicates concatenate (175–176).

# 1.5.0 - 2025-11-10

Added:
- Per-country `language` support in unified CSVs (CSV to JSON 167):
	* A `meta_global` row with `key=language` now captures per-country values (portrait > landscape > metadata cell), defaulting to empty string when missing.
	* The captured value is injected into each output under `metadataGlobal.language`.
- Filename language suffix (CSV to JSON 168):
	* Wherever `{country}` is used in output naming (split mode or single-country templating), a language ISO code is appended when present: `<name>_<COUNTRY>_<LANG>.json`; otherwise `<name>_<COUNTRY>.json`.
- Multi-variant export for duplicated country columns (CSV to JSON 169/170):
	* When a country appears multiple times (e.g., repeated `BEL` columns representing distinct language variants), split mode now emits one file per variant (e.g., `..._BEL_FRA.json` and `..._BEL_NLD.json`).
	* New optional `--country-variant-index` selects which duplicated pair to use in non-split scenarios (0-based; default 0).

Tests:
- Added tests for frames rounding near HH:MM:SS:FF boundaries, delimiter auto-sniff for tab/pipe, minimal `endFrame` branch coverage, `{country}` + language filename injection, multi-variant BEL exports with generation metadata on all variants, and a `--dry-run` visibility check for discovered countries.

Docs:
- Updated README with `language` rules, filename language suffix behavior, multi-variant export notes, and the `--country-variant-index` flag.

# 1.4.12 - 2025-11-08

Added:
- `{country}` filename templating extended to single-country exports (CSV to JSON 120):
	* When using `--country-column <n>` (non-split mode), `{country}` in the positional output path or in `--output-pattern` is now expanded to the selected country code.
	* `--auto-output` with `--country-column` now also derives a `{country}`-aware default (e.g. `input_GBR.json`).
	* Split behavior unchanged; multi-file mode still expands `{country}` for all countries.
	* Note:“Previously, ‘{country}’ expansion only applied when --split-by-country was used. It now also expands in single-country mode when --country-column is provided.”

Tests:
- Added unit tests covering single-country `{country}` expansion both with an explicit templated output path and with `--output-pattern` + `--country-column`.

Docs:
- Updated README multi-country section and CLI examples to describe single-country `{country}` templating and added a one-country usage example.

# 1.4.11 - 2025-10-29

Added:
- Unified schema support for a new `record_type` key `endFrame`, parsed into each video's `endFrame` array (CSV to JSON 115):
	* Shape matches `logo` items: `{ "line": <int>, "text": <string>, "in": <number|null>, "out": <number|null> }`.
	* Per‑video timed rows populate `endFrame`; optional per‑country text follows the same precedence as `logo` (local orientation, then global orientation, with landscape→portrait mirroring when portrait is empty).
	* Global `endFrame` rows (without `video_id`) can serve as text fallbacks, analogous to global `logo` text rows.

Tests:
- Added unit test `test_unit_endframe_rows.py` to verify `endFrame` rows are parsed and emitted like `logo` with correct timings and presence in both landscape and portrait videos.

# 1.4.10 - 2025-10-28

Added:
- Unit test to assert the converter derives `metadataGlobal.converterVersion` from the first heading in `python/readMe/CHANGELOG.md` (CSV to JSON 108).

Changed:
- Repository docs reorg: Python-specific docs now live under `python/readMe/` (README.md and CHANGELOG.md) (CSV to JSON 106).
- `python/bump_changelog.py` now reads/writes `python/readMe/CHANGELOG.md` and stages that path for git commit/tag (CSV to JSON 106).
- `python/csv_to_json.py` version resolution (`--converter-version auto`) falls back to `python/readMe/CHANGELOG.md` when the repo-root `CHANGELOG.md` is absent; `lastChangeId` metadata uses the same fallback (CSV to JSON 107).

# 1.4.9 - 2025-10-28

Backfilled summary: CSV to JSON 62–105 (concise)

Added tests (highlights):
- Unified schema behaviors: multi-country parsing, orientation mirroring, and per-video duplication with correct `orientation` metadata.
- Flags and overrides: `logo_anim_flag` overview aggregation and per-video overrides; `subtitle_flag` and `disclaimer_flag` meta_local per‑country propagation vs per-video overrides; `--no-logo-anim-overview` trimming.
- Job numbers: per-country `jobNumber` precedence and global fallback; default sentinel `"noJobNumber"` when absent.
- Claims/disclaimers: `--join-claim` grouping by identical timing; `prefer_local_claim_disclaimer`; disclaimer multi-line merges.
- Structure modes: validation-only path for sectioned and unified inputs; `--no-orientation` legacy shape emission.
- Negative cases: per-video subtitle overlap detection; detect_columns and delimiter edge branches.
- CLI output behaviors: `--split-by-country` with `--auto-output` naming and `--output-pattern {country}` custom paths.
- Output shapes: `claims_as_objects` per-video claim_XX object emission.

Testing options/configuration:
- Unittest runner: `python python/run_tests.py` (normal) or `COVERAGE=1 python python/run_tests.py` (collects branch + subprocess coverage, emits XML/JSON and `python/tests/coverage/coverage.svg`).
- Pytest support: `make pytest-cov` for term, XML, and HTML coverage reports (uses `.coveragerc`).
- Makefile shortcuts: `make test`, `make coverage`, `make pytest-cov`.

# 1.4.8 - 2025-10-09

Added:
- Test coverage tooling and CI (CSV to JSON 61):
	* Installing pytest-cov, added to requirements-test.txt
	* Introduced `.coveragerc` with branch coverage, `python` as source, and outputs into `python/tests/coverage/`.
	* Makefile targets: `make test`, `make coverage` (unittest runner), and `make pytest-cov` (pytest-cov reports: term, xml, html).
	* GitHub Actions workflow `.github/workflows/tests.yml` running unittest runner and pytest-cov; uploads `coverage.xml` as an artifact.
	* README shows a coverage badge referencing `python/tests/coverage/coverage.svg` (generated when running coverage locally).

# 1.4.7 - 2025-10-08

Added:
- Added coverage tooling and reporting for the project.
	Implemented:
	requirements-test.txt: added coverage and coverage-badge dependencies.
	pyproject.toml already had coverage config (source path).
	run_tests.py: supports coverage mode when run with environment variable COVERAGE=1:
		Runs tests under coverage (branch analysis).
		Generates coverage.xml, coverage.json, and coverage.svg badge.
		Prints a coverage report to the console.
	README.md: inserted coverage badge reference (will display once coverage.svg is produced and committed).
	Tests run successfully in both normal and coverage modes (6 tests passing).

# 1.4.6 - 2025-10-08

Added:
- `meta_local` per-country override support for `logo_anim_flag` (CSV to JSON 51):
	* A `meta_local` row with `key=logo_anim_flag` now records per-country values (portrait > landscape > metadata fallback) per video.
	* During video assembly, any per-video `logo_anim_flag` from `meta_local` overrides the duration-derived mapping injection.
	* Precedence summary for per-video `logo_anim_flag`: meta_local per-country value > per-country meta_global override > meta_global default mapping.

# 1.4.5 - 2025-10-07
Added:
- Multi-row `meta_global` aggregation for `logo_anim_flag` (CSV to JSON 46–48):
	* Multiple `meta_global` rows with `key=logo_anim_flag` now build an overview object inside `metadataGlobal.logo_anim_flag` mapping duration strings → flag value.
	* Duration is taken from the `country_scope` column (e.g. `6`, `15`, `30`, ...); value from the `metadata` column (typical ALL usage) with per‑country landscape / portrait cells as fallback if metadata empty.
	* Stable sort order: ascending by string length then lexicographically (so 6,15,30,60,90,120).
	* Per‑video metadata automatically receives a single `logo_anim_flag` value based on its own `duration` (cast as string) unless overridden by a `meta_local` row for that video.
	* New CLI flag `--no-logo-anim-overview` removes the aggregated object from outputs while keeping per‑video injected values.
	* Safe with casting: overview remains a dictionary even when `--cast-metadata` is used.

Fixed/Adjusted:
- Ensured fallback injection of overview if early embedding phase is skipped (defensive redundancy inside converter pipeline).

# 1.4.4 - 2025-10-02

Added:
- Bugfix: Preserve portrait disclaimer text (CSV to JSON 45)
	* Fixed an issue where portrait disclaimer lines were overwritten by (or fell back to) landscape text.
	* Root cause: during disclaimer block merging we only stored `texts` (landscape) and discarded `texts_portrait`; later selection logic therefore had no portrait content and reused landscape.
	* Now both global and per‑video disclaimer merging maintain `texts_portrait` and merge continuation lines for portrait just like landscape.
	* Multi‑line portrait disclaimers (separate continuation rows) are concatenated with `\n` exactly as for landscape.
	* No schema/output shape changes; only content correctness for portrait disclaimers.
	* Internal: added `texts_portrait` dict to merged disclaimer block structures and updated continuation append logic.

# 1.4.3 - 2025-10-01

Added:
- Per-country `meta_global` handling for `disclaimer_flag` and `subtitle_flag` (CSV to JSON 44):
	* These flag keys may now appear on a `meta_global` row; per‑country cell values (landscape / portrait first non‑empty) are captured.
	* Captured values act as per‑country defaults applied to every video's metadata for that country.
	* Precedence: per‑video `meta_local` value (if present) > per‑country `meta_global` value > (key omitted).
	* Empty per‑video `meta_local` rows now cleanly fall back to the global per‑country values—no duplication required in the sheet.
	* Values like `N` are treated as meaningful (not falsy) and are preserved in output.
	* These flags are NOT written as a single shared key in `metadataGlobal` (to avoid implying cross‑country uniformity); they remain per‑video metadata entries.
	* Backwards compatibility: sheets that only used per‑video `meta_local` rows still behave the same; other `meta_global` keys unchanged.
	* Internal: added `global_flag_values_per_country` structure and adjusted assembly step to inject defaults before per‑video overrides.

# 1.4.2 - 2025-09-30

Added:
- Per-country `meta_local` handling for `disclaimer_flag` and `subtitle_flag` (CSV to JSON 42/43):
	* These keys are now read from the per-country text (landscape/portrait) columns on their `meta_local` rows.
	* Previous behavior treated `disclaimer_flag` as (in some sheets) broadcast via `country_scope=ALL`; now the parser ignores `country_scope` for these keys and records actual per-country values.
	* Each video’s `metadata` now includes `disclaimer_flag` / `subtitle_flag` per country (before orientation duplication), without overwriting any existing global values for the same key.
	* Fallback: if both per-country orientation cells are empty but the legacy `metadata` column has a value, that value is used for countries still missing one.
	* Other `meta_local` keys continue to use the first non-empty per-country value (or metadata cell) as a shared value.
		* Added helper script `python/tools/inspect_flags.py` to simplify inspection of these flags and `jobNumber` across generated JSON outputs.

# 1.4.1 - 2025-09-30

Added:
### New keys: jobNumber, brand (CSV to JSON 38, 39, 40)
`schemaVersion` row at line 2 is still recognized (no special change needed beyond using its meta_global value, which we already did).
New meta_global key `brand` is captured automatically (generic handling).
New meta_global key `jobNumber` now supports per‑country overrides

# 1.4.0 - 2025-09-29

Migration:
- Moved `schemaVersion` and `country` into `metadataGlobal` (removed from top-level output).
- Renamed global metadata key `version` to `briefVersion` to reduce ambiguity with converter or schema versions.
- Updated default required global keys to `briefVersion,fps`.

# 1.3.3 - 2025-09-29

Added:
- Fixed the deprecation warning in bump_changelog.py by replacing datetime.utcnow() with a timezone‑aware datetime.now(datetime.UTC) (with a fallback for older Python versions). Dry run shows no warnings now.


# 1.3.2 - 2025-09-29

Added an automated CHANGELOG bump script and documented its usage.

# 1.3.1 - 2025-09-29

Changes:
- Added automatic converter version derivation when `--converter-version auto` (default) using: env var CONVERTER_VERSION > CHANGELOG heading > latest git tag > 0.0.0+<shortcommit> > dev fallback.

# 1.3.0 - 2025-09-29
Added features:
- --sample flag to generate truncated preview JSON alongside outputs
- Generation metadata: generatedAt, inputSha256, inputFileName, converterVersion, converterCommit
- --converter-version flag for embedding build identifier
- Timezone-aware timestamp (replaced deprecated utcnow usage)
- --no-generation-meta flag to disable metadata injection
- Environment/toolchain metadata: pythonVersion, pythonImplementation, platform, lastChangeId

Improvements:
- Added SHA-256 checksum for reproducibility
- Added git short commit hash capture (best-effort)

Notes:
- lastChangeId is derived from the first heading in this file.
