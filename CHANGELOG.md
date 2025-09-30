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
