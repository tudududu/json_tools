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
