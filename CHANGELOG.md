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
