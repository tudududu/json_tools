# 1.12.4 - 2026-05-01

Added:
- Fixed source-run `converterVersion` auto-resolution precedence so stale `CONVERTER_VERSION` environment values no longer override the current changelog version.

Details:
1. Source runs now prefer the first CHANGELOG heading as the primary version source.
2. Frozen runtime keeps env-first behavior (needed for baked standalone binaries).
3. Env var remains as fallback for source runs when changelog parsing is unavailable.

# 1.12.3 - 2026-05-01

Added:
- Refactor Phase 6.3 completed against the thin-entrypoint-only goal.

Completion summary:
1. Moved conversion orchestration from `python/json_converter.py` into `python/core/converter_engine.py`.
2. Kept API compatibility by re-exporting `convert_csv_to_json`, `parse_timecode`, `safe_int`, `detect_columns`, `_sniff_delimiter`, and related helpers from `python/json_converter.py`.
3. Kept runtime behavior stable: `python/json_converter.py` now acts as a thin shell that delegates CLI flow to `python/core/cli_runner.py` and optional tool loading to `python/core/optional_tools.py`.
4. Updated package and installer wiring for the new module boundary (`python/core/__init__.py`, `python/installer/build_json_converter.py`).
5. Verification: full pytest passed (249 passed, 0 failed).

# 1.12.2 - 2026-05-01

Added:
- Refactor review record for Phase 6 (Thin Entrypoint Finalization).

Review summary:
1. Partially complete: CLI entrypoint is thin and delegated (`main()` calls core runner), but conversion orchestration still lives in `python/json_converter.py` (`convert_csv_to_json(...)`), so the Phase 6 goal "entrypoint orchestration only" is not fully met yet.
2. Completed: Phase 6 documentation touchpoints are present in Python README, installer README, and test runner notes.
3. Verification: full pytest passed (249 passed, 0 failed).


# 1.12.1 - 2026-05-01

Added:
- Implemented a packaging fix that resolves the frozen startup crash (ModuleNotFoundError for python.core/core) and verified the executable now starts correctly.

	1. Added bundling of the core package files into the PyInstaller build args in build_json_converter.py:95.
	2. Wired the core directory from main into the builder call in build_json_converter.py:165.
	3. Kept python.core hidden imports and removed noisy non-resolvable core.* hidden imports in build_json_converter.py:123.


# 1.12.0 - 2026-05-01

Added:
- Refactor Phase 1-5 is now effectively completed.

# 1.11.0 - 2026-04-30

Added:
- Implementation completed for the hard rename from csv_to_json.py to json_converter.py across code, tests, installer flow, and docs, with no compatibility shim.

	1. Core module and installer entrypoint renamed.
		python/csv_to_json.py -> deleted
		json_converter.py -> added
		python/installer/build_csv_to_json.py -> deleted
		build_json_converter.py -> added
	2. Tests updated to new module/script names.
	3. Installer binary/build naming switched to json_converter.
		PyInstaller name now json_converter in build_json_converter.py
		Build root now python/build/json_converter in build_json_converter.py
		Executable target now json_converter in build_json_converter.py
	4. Ecosystem/docs/comments updated.
	
	Historical references in CHANGELOG.md were intentionally left intact.

# 1.10.8 - 2026-04-22

Added:
- The traceback during build is fixed by changing the placeholder strategy so build substitution can no longer rewrite Python syntax into an invalid assignment.
	1. In runtime_hook_converter_version.py, I removed the TYPE_CHECKING placeholder variable pattern and replaced it with a string sentinel:
	_CONVERTER_VERSION_SENTINEL = "__CSV_TO_JSON_CONVERTER_VERSION__"
	os.environ["CONVERTER_VERSION"] = _CONVERTER_VERSION_SENTINEL
	2. In build_csv_to_json.py, I changed render_runtime_hook(...) to replace only the quoted sentinel string once:
	from global .replace("__CSV_TO_JSON_CONVERTER_VERSION__", ...)
	to .replace('"__CSV_TO_JSON_CONVERTER_VERSION__"', repr(converter_version), 1)
	3. Added a guard in the renderer that raises a clear error if the sentinel is missing from the template.

# 1.10.7 - 2026-04-22

Added:
- Error-handling and stderr/stdout discipline in `csv_to_json.py` (py 344–352):

	**Clean error messages (py 344–346)**
	* Missing main input file no longer produces a Python traceback.
	* An `os.path.exists` guard now prints a clean `FileNotFoundError` message to stderr, emits the conversion summary, and exits with rc=1.
	* All diagnostic output (warnings, errors) is routed to stderr; all summaries and conversion output remain on stdout.

	**Runtime error counter and unified summary (py 349)**
	* Introduced shared `runtime_error_count` counter and two helper functions inside `main()`:
		- `_report_runtime_error(message)` — prints to stderr and increments the counter.
		- `_print_conversion_summary(files_written, validation_errors=0)` — prints `Conversion complete: Files written: N, Errors: N` to stdout, combining runtime and validation error counts.
	* The summary is now always emitted, including when the run aborts early (missing input, fatal layer-config failure).
	* Missing `--media-config` file is counted as a runtime error.

	**Stderr routing for all diagnostics (py 347–348)**
	* Layer-config missing-file warning, media tools unavailable, media config load failure, and validation report write failures are all routed to stderr via `_report_runtime_error` or explicit `file=sys.stderr`.

	**`--layer-config` exit strategy unification (py 350–352)**
	* Two previously hard-coded fatal `raise SystemExit(...)` branches in layer-config setup are replaced with `_report_runtime_error` + `_print_conversion_summary(0)` + `return 1`, keeping the summary path consistent.
	* Added `--layer-config-required` flag: when omitted (default), all three `--layer-config` failure modes (missing file, converter unavailable, conversion exception) are non-fatal warnings that increment the error counter and allow conversion to continue.
	  When `--layer-config-required` is passed, any `--layer-config` failure aborts with rc=1.

	**Build hook fix (py 353)**
	* Fixed a `SyntaxError` in the PyInstaller runtime-hook template that occurred when a `TYPE_CHECKING` placeholder declaration was present during the build-time token substitution pass.
	* The template now uses a quoted string sentinel (`"__CSV_TO_JSON_CONVERTER_VERSION__"`) instead of a bare identifier, and the build helper replaces only that exact quoted token.
	* Added a guard in `render_runtime_hook()` that raises a clear error when the sentinel is missing from the template.

Tests:
- `test_csv_to_json_cli_subset.py`: updated `test_missing_input_file_prints_clean_error` to assert error on stderr, summary on stdout (`Errors: 1`), rc=1, no output file.
- `test_media_integration.py`:
	* `test_missing_layer_config_warns_and_continues`: updated to check warning in stderr, `Errors: 1` in summary, rc=0.
	* `test_missing_media_config_warns_and_continues`: new — verifies missing media config is non-fatal with `Errors: 1` in summary.
	* `test_layer_config_converter_unavailable_uses_summary_path`: updated to pass `--layer-config-required`; verifies rc=1, no output, error in stderr, summary in stdout.
	* `test_layer_config_conversion_failure_uses_summary_path`: updated similarly.
	* `test_layer_config_converter_unavailable_nonfatal_by_default`: new — verifies rc=0 and output file present without `--layer-config-required`.
	* `test_layer_config_conversion_failure_nonfatal_by_default`: new — same for conversion exception.

# 1.10.6 - 2026-04-18

Added:
- Runtime-hook version baking in installer build helper: During build, a PyInstaller runtime hook is generated to bake `CONVERTER_VERSION` into the standalone binary.

# 1.10.5 - 2026-04-18

Added:
- CSV to JSON 335-338: validation/check workflow and completion logging updates in `csv_to_json.py`.
- Reworked validation UX to a unified check mode:
	* Replaced legacy `--validate-only` / `--dry-run` flow with `--check`.
	* Added `--strict` so check mode returns non-zero when validation errors are present.
	* Kept `--validation-report` support in check mode, with report mode value set to `"check"`.
	* Check mode continues to preview discovered output targets without writing files.
- Updated generation metadata behavior so it is skipped during check mode (no file-writing path).
- Added a final completion summary line at the end of conversion/check runs:
	`Conversion complete: Files written: NN, Errors: NN`
- Updated related tests and Python README examples to use the new `--check` / `--strict` flags and check-mode wording.

# 1.10.4 - 2026-04-17

Added:
- Changed csv_to_json.py so a missing --layer-config file is now non-fatal and matches the media-config style:
	Before: conversion stopped with SystemExit: No such file or directory: '...'
	Now: conversion continues and prints warning:
	Warning: failed to load layer config '...': [Errno 2] No such file or directory: '...'
- Unchanged:
	If layer-config tooling is unavailable (layercfg_convert_workbook is None), it still exits (same as before).
	If a provided layer-config file exists but fails to parse/load for other reasons, it still exits (same as before).

# 1.10.3 - 2026-04-15

Added:
- Standalone PyInstaller packaging workflow for `csv_to_json.py` via `python/installer/build_csv_to_json.py`.
- One-file build output under `python/build/csv_to_json/` with required bundled integrations for `--layer-config` and `--media-config`.
- Packaging documentation in `python/installer/README.md` and regression coverage for installer build arguments in `python/tests/test_installer_build.py`.

# 1.10.2 - 2026-04-15

Added:
- Changed FPS default source logic in csv_to_json.py
	Input row like meta_global;;;;;fps;Y;ALL;25;;;; becomes the default FPS source.
	CLI --fps remains supported and explicitly overrides input-data FPS.
	else fallback 25.0

# 1.10.1 - 2026-04-12

Added:
- Changed behavior and naming from generic to controller across converter, tests, and Python docs.
- All CSV record_type values generic_NN/generic_NN_flag, the function param generic_always_emit, the CLI flag --generic-always-emit, and all related internal names become controller_NN/controller_NN_flag, controller_always_emit, --controller-always-emit.
- Updated relevant changelog entries already below in existing records.

# 1.10.0 - 2026-04-01

Release notes (condensed):
- Strengthened reverse SRT workflows (CSV/XLSX -> SRT) in `srt_to_csv.py` (py 284).
- Renamed media helper module to `python/tools/media_converter.py` (py 299).
- Expanded layer-config workbook pipeline end-to-end:
	* `generate_config_template.py` now emits `TIMING_BEHAVIOR`, `TIMING_ITEM_SELECTOR`, and `SKIP_COPY_CONFIG` sheets from `config.addLayers`.
	* `config_converter.py` parses those sheets by default when present and emits nested `config.addLayers` output.
	* `csv_to_json.py --layer-config` now injects the full `config.addLayers` payload.
- Finalized injection semantics in `csv_to_json.py` (py 319): `config.addLayers` is replaced as a whole (merge mode removed).
- Added/updated tests and docs for the new workbook schema, validation constraints, and integration behavior.

Added:
- SRT/Tabular conversion follow-up (py 284):
	* Finalized reverse conversion robustness in `python/tools/srt_to_csv.py` for CSV/XLSX -> SRT workflows, including stricter mode handling and end-to-end reverse-path stabilization.

Changed:
- Media tool rename (py 299):
	* Renamed `csv_json_media.py` to `python/tools/media_converter.py` and aligned references/usages to the new module name.

Added:
- Layer config toolchain expansion (py 305-313):
	* Promoted workbook defaults to `LAYER_NAME_CONFIG_items` and `LAYER_NAME_CONFIG_recenterRules`.
	* Added `TIMING_BEHAVIOR` support in both directions:
		- `config_converter.py`: parses optional `TIMING_BEHAVIOR` sheet by default when present.
		- `generate_config_template.py`: emits `TIMING_BEHAVIOR` from `config.addLayers.TIMING_BEHAVIOR` by default when present.
		- Validation lock in template: behavior values constrained to `timed|span|asIs`.
	* Added `TIMING_ITEM_SELECTOR` support in both directions:
		- `generate_config_template.py`: emits `TIMING_ITEM_SELECTOR` sheet with `itemName, mode, value`.
		- `config_converter.py`: parses optional `TIMING_ITEM_SELECTOR` sheet by default when present.
		- Validation lock in template: mode values constrained to `line|index|minMax`.
	* Added `SKIP_COPY_CONFIG` support in both directions:
		- `generate_config_template.py`: emits unified `SKIP_COPY_CONFIG` sheet (`key, value, names`) with boolean dropdown lock on `value`.
		- `config_converter.py`: parses `SKIP_COPY_CONFIG` into mixed output shape under `config.addLayers.SKIP_COPY_CONFIG`:
			+ fixed keys `groups`, `adHoc`, `alwaysCopyLogoBaseNames` -> `{ "enabled": <bool>, "names": [...] }`
			+ all other keys -> plain boolean values.
		- Added CLI override `--skip-config-sheet` and default-on parsing when matching sheet exists.

Changed:
- `config_converter.py` output structure modernization (py 310+):
	* Standardized converter output to AE-style nested shape:
		`config.addLayers.{LAYER_NAME_CONFIG,TIMING_BEHAVIOR,TIMING_ITEM_SELECTOR,SKIP_COPY_CONFIG}`
	* Kept defensive backward-compatible extraction paths where needed during integration.

Added:
- `csv_to_json.py` integration for layer config injection (py 317-319):
	* `--layer-config` now loads converter output once and injects full `config.addLayers` payload (not only `LAYER_NAME_CONFIG`).
	* Supported injected sections: `LAYER_NAME_CONFIG`, `TIMING_BEHAVIOR`, `TIMING_ITEM_SELECTOR`, `SKIP_COPY_CONFIG`.
	* Finalized replacement semantics (py 319): when `--layer-config` is used, `config.addLayers` is replaced as a whole by converted workbook output (merge mode removed).
	* Maintained compatibility with media injection under `config.pack.EXTRA_OUTPUT_COMPS`.

Tests/Docs:
- Expanded unit/integration coverage across converter/template/csv pipeline for all added sheets, validation rules, custom sheet overrides, dry-run summaries, and replacement semantics.
- Updated tool documentation to reflect new defaults, nested output shape, and `--layer-config` behavior.

# 1.9.0 - 2026-03-23

Added:
- SRT/Tabular bidirectional conversion updates in `python/tools/srt_to_csv.py` (py 277-280):
	* Added reverse conversion mode `--reverse` for CSV/XLSX -> SRT in both single-file and batch directory workflows.
	* Added joined reverse mode `--reverse-joined` to parse marker-row joined CSV/XLSX input and split output into multiple SRT files.
	* Added reverse column overrides `--start-col`, `--end-col`, `--text-col` (name or 1-based index).
	* Added strict per-file timecode detection/validation (frames vs milliseconds) and mixed-format rejection.
	* Added marker block validation, filename sanitization, and duplicate output-name deduping in joined reverse mode.
	* Added missing-input CLI handling for positional input with user-friendly message: `No such file or directory: '<path>'`.
	* Added reverse-mode test coverage for single, batch, joined split, marker validation, and invalid mode combinations.

# 1.8.9 - 2026-03-14

Added:
- backward-compatible flag (--controller-always-emit) with default off, 
	Function param: controller_always_emit: bool = False
	CLI flag: --controller-always-emit
	Behavior now:
	Default (no flag): per-video controller_NN uses only local rows; missing local rows -> [] (your current desired behavior).
	With --controller-always-emit: restores legacy fallback; missing local rows fall back to global controller_NN rows for that video.

# 1.8.8 - 2026-03-12

Added:
- Updated per-video controller key emission logic in csv_to_json.py:
	Before: if local controller rows were missing for a video/key, it fell back to global controller rows.
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
	* Updated top-level `disclaimer`, `disclaimer_02`, `logo`, and `controller_XX` arrays to preserve all explicitly defined rows, including rows where both landscape and portrait are empty.
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
	* Added direct XLSX input support to `python/tools/media_converter.py` alongside existing CSV support.
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
	* Rebuilt metadata flag handling to auto-detect any `meta_global`/`meta_local` key ending with `_flag` (including `controller_XX_flag`) without hardcoded flag lists.
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
	* Scalable generic timed keys (`controller_01`..`controller_NN`) with top-level and per-video outputs.
	* Auto-detected `controller_XX_flag` support via `meta_global`/`meta_local` with the usual per-country default + per-video override rules.
	* Output ordering guarantees: controller keys appear before `videos`, and per-video `claim` follows `super_B`.

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
- CSV → JSON media tool `media_converter.py` (CSV to JSON 206–211):
	* Converts deliverables CSV into a media index keyed by `<AspectRatio>[ _<Template_name> if Template==extra ]|<duration>`.
	* Supports duration parsing/normalization, consecutive creative dedup, and stable ordering of `{size, media}` pairs.
	* Optional split-by-country output with filename templating and dry-run summaries.
	* Media injection integrated into `csv_to_json.py` via `--media-config` with exact country+language matching.

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
