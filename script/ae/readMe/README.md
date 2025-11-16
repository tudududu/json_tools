<!-- Executive Summary -->
Executive summary

- Single-run: open your template under POST/WORK and run `script/ae/pipeline_run.jsx`. It links JSON, saves as `name_<ISO>.aep`, builds comps, applies template layers, sets output paths, and can queue to AME.
- Batch-run: run `script/ae/batch_orchestrator.jsx` to iterate all `POST/IN/data/data_*.json`. The close policy for every run (and final) is controlled by `batch.SAVE_AFTER_RUN`; the template is reopened between runs.
- Strict AUTO: set `createComps.AUTO_FROM_PROJECT_FOOTAGE=true` to collect footage only from `project/in/footage/YYMMDD` (no fallbacks to selection or other folders).
- Logs: unified pipeline log plus optional per‑phase file logs under `POST/WORK/log/`. Set `PHASE_FILE_LOGS_MASTER_ENABLE=false` to silence per‑phase logs.
- Minimal knobs: `RUN_*` toggles per step; `ame.EXPORT_SUBPATH` for output base; `closeProject.CLOSE_MODE` for single run; `batch.SAVE_AFTER_RUN` for batch closes.

Table of contents

- [1. Overview](#1-overview)
- [2. Folder & Phase Layout](#2-folder--phase-layout)
- [3. Quick Start](#3-quick-start)
- [4. Options Merging](#4-options-merging)
- [5. Global Toggles & Logging](#5-global-toggles--logging)
- [6. Step Details](#6-step-details)
  - [Step 0 – Open Project](#step-0--open-project-optional)
  - [Step 1 – Link Data / ISO](#step-1--link-data--iso-detection)
  - [Step 2 – Save As with ISO](#step-2--save-as-with-iso)
  - [Step 3 – Create Compositions](#step-3--create-compositions)
  - [Step 4 – Insert & Relink Footage](#step-4--insert--relink-footage)
  - [Step 5 – Add Layers](#step-5--add-layers-template-application)
  - [Step 6 – Pack Output Comps](#step-6--pack-output-comps)
  - [Step 7 – AME Output Paths & Queue](#step-7--ame-output-paths--queue)
  - [Step 8 – Close Project](#step-8--close-project-optional)
- [7. Batch Mode (Multi-ISO)](#7-batch-mode-multi-iso)
- [8. Preset Examples](#8-preset-examples)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Glossary](#10-glossary)
- [11. Changelog (Recent Highlights)](#11-changelog-recent-highlights)
- [12. Design Principles](#12-design-principles)

# After Effects Pipeline Guide

 

  ### 1. Overview
  The ExtendScript pipeline automates campaign production:
  1. Loads & links campaign JSON (with ISO auto/manual detection).
  2. Saves the project with an ISO suffix.
  3. Builds compositions from footage (manual selection or strict AUTO path scan).
  4. Inserts & relinks footage/data into those comps.
  5. Adds template layers (with advanced matching, extras, parenting, and optional simple precomp mode).
  6. Packs output comps, normalizing names & deriving videoId.
  7. Assigns deterministic output paths and optionally queues to AME.
  8. (Optional) Closes the project (prompt / force-save / force-no-save).

  Batch Mode wraps the pipeline to run all `data_*.json` files (multiple ISOs) sequentially with a single save/no‑save policy.

  ### 2. Folder & Phase Layout
  Phase scripts live in `script/ae/phase/`:
  | Step | Script | Purpose |
  |------|--------|---------|
  | 0 | `open_project.jsx` | Open template project (bootstrap unattended runs). |
  | 1 | `link_data.jsx` | Relink data.json, detect ISO. |
  | 2 | `save_as_with_iso.jsx` | Save as `<name>_<ISO>.aep`. |
  | 3 | `create_compositions.jsx` | Build comps from footage (AUTO or selection). |
  | 4 | `insert_and_relink_footage.jsx` | Insert footage into comps, optional audio ISO & SOUND imports. |
  | 5 | `add_layers_to_comp.jsx` | Copy template layers / apply extras / parenting / simple mode. |
  | 6 | `pack_output_comps.jsx` | Prepare outputs (naming, videoId, extras MEDIA override). |
  | 7 | `set_ame_output_paths.jsx` | Set output paths & queue to AME (templates & extras routing). |
  | 8 | `close_project.jsx` | Close project with selected mode. |

  Integrating script: `pipeline_run.jsx` orchestrates Steps 1–7 (+0,8 if toggled). Batch wrapper: `batch_orchestrator.jsx` performs multi-ISO runs.

  ### 3. Quick Start
  1. Prepare campaign JSON in `POST/IN/data/` (e.g. `data_ENG.json`).
  2. Open template project under `POST/WORK/` (or enable DEV preset override with `.use_dev_preset`).
  3. (Optional) Enable Step 0/8 and set `closeProject.CLOSE_MODE`.
  4. Run `pipeline_run.jsx` (single ISO) or `batch_orchestrator.jsx` (multi ISO). 
  5. Find logs under `POST/WORK/log/`. Output paths assigned under `POST/OUT/...` (per `ame.EXPORT_SUBPATH`).

  ### 4. Options Merging
  Single effective options object = Defaults + `pipeline.preset.json` overrides.
  Merge rules:
  - Objects: deep merge.
  - Arrays: replace wholly.
  - Primitives: replace.
  Reserved (`__presetMeta`, `__sticky`) are loader metadata.

  ### 5. Global Toggles & Logging
  - `RUN_*` booleans gate each phase (default: true).
  - `PHASE_FILE_LOGS_MASTER_ENABLE=false` disables per-phase file logs.
  - `sleepBetweenPhasesMs` adds a stabilizing delay between steps.
  - `PIPELINE_SHOW_PHASE_TAGS` toggles `INFO {phase}` prefixes.
  - `LOG_MARKER` sets a bullet used across logs (sanitized ASCII).

  ### 6. Step Details
  #### Step 0 – Open Project (optional)
  Enable with `RUN_open_project`. Auto-discovers newest template under `POST/WORK/` when no explicit path. Respects `openProject.OPEN_IF_DIRTY_BEHAVIOR` (abort/prompt/force-no-save) if a project is already open & unsaved.

  #### Step 1 – Link Data / ISO Detection
  Controls: `linkData.ENABLE_RELINK_DATA_JSON`, `linkData.DATA_JSON_ISO_MODE` (`manual`|`auto`), `linkData.DATA_JSON_ISO_CODE_MANUAL`, and optional `linkData.DATA_JSON_LANG_CODE_MANUAL`.
  Behavior:
  - ISO can be auto-detected from parent folder name or forced via `DATA_JSON_ISO_CODE_MANUAL`.
  - Language is manual-only: set `DATA_JSON_LANG_CODE_MANUAL` to use `data_<ISO>_<LANG>.json`. If unset, the pipeline uses `data_<ISO>.json` and does not auto-pick any language file.
  - Strictness: if a manually requested file is missing (ISO or ISO+LANG), Step 1 returns fatal and the run aborts immediately.
  - Ambiguity warning: when multiple `data_<ISO>_<LANG>.json` files exist and no language is selected, a warning is logged and ISO-only is used.
  Keeps ISO/LANG authoritative for later steps (Save As, audio checks, AME folder building).

  #### Step 2 – Save As with ISO
  Saves as `<base>_<ISO>.aep` (or `<base>_<ISO>_<runId>.aep` if collision unless `saveAsISO.OVERWRITE=true`). Independent of Batch `SAVE_AFTER_RUN` policy.

  #### Step 3 – Create Compositions
  Modes:
  - Manual: uses current Project selection of FootageItem(s).
  - Strict AUTO: `createComps.AUTO_FROM_PROJECT_FOOTAGE=true` resolves only `FOOTAGE_PROJECT_PATH` (default `project/in/footage`), chooses newest YYMMDD or manual `FOOTAGE_DATE_YYMMDD`, collects footage recursively if `INCLUDE_SUBFOLDERS=true`.
  Abort reasons logged (path missing / no YYMMDD / empty). No fallback to selection or other folders.
  Validation: width/height must be 4–30000; invalid dims log WARN and fallback to 1920×1080 unless `createComps.SKIP_INVALID_DIMENSIONS=true` (skip instead).

  #### Step 4 – Insert & Relink Footage
  Adds footage layers to created comps. Optional audio ISO filename check:
  - `insertRelink.ENABLE_CHECK_AUDIO_ISO` + `insertRelink.CHECK_AUDIO_ISO_STRICT` to abort or warn on mismatch.
  Sound import modes (language subfolders): `SOUND_USE_ISO_SUBFOLDER`, `SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER`, `SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER`.

  Import-time token filtering (SOUND import)
  - Source tokens: Step 1 provides `linkData.iso` and optional `linkData.lang`. For standalone runs, Step 4 can use manual fallbacks `AUDIO_ISO_MANUAL` / `AUDIO_LANG_MANUAL`.
  - Filtering rules during import (before any layer insertion):
    - Project has ISO+LANG → import only files whose names encode `<duration>_<ISO>_<LANG>`.
    - Project has ISO only → import only files whose names encode `<duration>_<ISO>` and contain no language token (strict ISO-only at import time).
    - Logging shows the active filter: `Filter AUDIO by token: 'ISO[_LANG]'` with a note `(strict ISO-only)` or `(preferred ISO-only; lenient fallback)` depending on strictness toggle.
  - Note: The insert-time validator (below) ignores LANG for ISO-only projects, but the importer is stricter and may exclude `ISO_LANG` audio unless a lenient fallback is triggered.

  Audio ISO / ISO_LANG filename check (Insert & Relink)
  - When enabled, Step 4 parses tokens immediately after the duration (e.g., `06s_ENG` or `06s_BEL_FRA`). Dual-token form treated as `<ISO>_<LANG>`.
  - Matching rules:
    - If project has both ISO & LANG (Step 1 provided language), audio filename must present both tokens in order (duration → ISO → LANG).
    - If project has ISO only (no language), audio may supply ISO only or ISO+LANG; ISO must match; LANG (if present) is ignored at validation time (see import-time filter note above).
  - Failure reasons surfaced: missing ISO token, ISO mismatch, missing LANG when required, LANG mismatch.
  - Strict mode (`CHECK_AUDIO_ISO_STRICT=true`) aborts the pipeline on first mismatch; non-strict logs `[warn]` and continues.
  - Project tokens sourced from Step 1 (`linkData.iso`, `linkData.lang`); ISO fallback to manual if absent.
  - Options:
    - `insertRelink.ENABLE_CHECK_AUDIO_ISO` (boolean): enable the check. Default: false.
    - `insertRelink.CHECK_AUDIO_ISO_STRICT` (boolean): when true, a mismatch triggers an alert and aborts the pipeline; when false, a `[warn]` is logged and processing continues. Default: false.

  Sound import from ISO/ISO_LANG subfolders (Insert & Relink)
  - When your SOUND date folder contains country/language subfolders, the importer can target them directly when `SOUND_USE_ISO_SUBFOLDER=true`.
  - Project tokens: `linkData.iso` and optional `linkData.lang` (from Step 1); ISO falls back to manual if absent.
  - Selection order (case-insensitive, first match wins):
    1) `<ISO>_<LANG>` (e.g., `BEL_FRA`) when project language is present
    2) `<ISO>` (e.g., `BEL`)
  - If neither candidate subfolder exists or tokens are unavailable, the script imports from the date folder and logs a `[warn]` line.
  - Options:
    - `insertRelink.SOUND_USE_ISO_SUBFOLDER` (boolean): enable ISO/ISO_LANG subfolder selection. Default: false.
    - When `false`, only top-level files in `POST/IN/SOUND/YYMMDD` are imported; subfolders are skipped.
  - Soft fallback (flat mode): If `insertRelink.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER=true` and no top-level files are found, the script will try to import `<ISO>_<LANG>` then `<ISO>` as a fallback. A `[warn]` is logged when fallback is used.
  - Flat strict abort: If `insertRelink.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER=true` and neither candidate subfolder exists, the pipeline aborts with a fatal summary.

  Flat vs recursive behavior and fallbacks
  - Flat mode (`SOUND_USE_ISO_SUBFOLDER=false`): imports only top-level files in the date folder; applies token filter. If nothing is imported:
    - With `SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER=true`: tries `<ISO>_<LANG>` then `<ISO>` subfolder; applies token filter there.
    - If still empty and `CHECK_AUDIO_ISO_STRICT=false` and `SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER=false`: lenient subfolder fallback prefers `GBL`, else the single subfolder, else the first subfolder containing audio, importing all audio (no token filter).
    - If strict/abort flags are active: logs fatal and aborts.
  - Recursive mode (`SOUND_USE_ISO_SUBFOLDER=true` or when importing a chosen subfolder): imports recursively with token filter. If nothing matches and `CHECK_AUDIO_ISO_STRICT=false`, it retries recursively without a token filter (imports all audio) and proceeds with warnings at insert time.

  Audit & safety
  - Audit lines include both the expected token and the chosen SOUND path: `Expecting AUDIO token: ...` and `Using SOUND folder: <path>`.
  - Import uses `importAs=FOOTAGE` and a manual recursive scan (not `ImportOptions(Folder)`) to avoid first‑run anomalies.
  - The script only moves the imported folder under `project/in/sound/` when audio was actually imported (`__didImportAny`).

  #### Step 5 – Add Layers (Template Application)
  Template folder path: `addLayers.TEMPLATE_FOLDER_PATH` (default `['project','work','template']`). Matching strategies via `TEMPLATE_MATCH_CONFIG` (AR tolerance, duration strictness). Parenting features: reference-time assignment (`PARENTING_REF_TIME_MODE`), cycle-safe guard, debug dumps.
  Simple mode: `SIMPLE_INSERT_TEMPLATE_AS_LAYER` + related prep toggles for muted/solo/footage disable.
  Extras duplication: `EXTRA_TEMPLATES` namespace (allowed AR list, tag tokens, suffix, duration matching overrides). Duplicate comps included downstream.
  Skip logic: `SKIP_COPY_CONFIG` respects JSON flags & token/group filters.

  #### Step 6 – Pack Output Comps
  Derives stable videoId (token-before-duration heuristic). Overrides MEDIA token for extras (suffix → `MEDIA=<EXTRA>`). Optional dev self-test (`DEV_VIDEOID_SELF_TEST`).

  #### Step 7 – AME Output Paths & Queue
  Path base: `ame.EXPORT_SUBPATH` under `POST/`. Duration subfolder toggle: `ENABLE_DURATION_SUBFOLDER`.
  Extras routing: `EXTRA_EXPORT_SUBFOLDER=true` yields `<date>/<AR>_<extraName>/...` (respecting duration subfolder toggle).
  Template mapping: `APPLY_TEMPLATES`, `OUTPUT_MODULE_TEMPLATE`, AR maps, AR+duration maps, dynamic selection & optional reapply (`DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES`).
  Logging density: `VERBOSE_DEBUG`, `COMPACT_ITEM_DETAIL` (caps detail at 80 lines with “… (X more) …”).

  #### Step 8 – Close Project (optional)
  `closeProject.CLOSE_MODE`: `prompt` | `force-save` | `force-no-save`. Pipeline-level; Batch Mode applies policy after each run & final run via its own flag.

  ### 7. Batch Mode (Multi-ISO)
  Script: `batch_orchestrator.jsx`. Discovers `data_*.json` in `POST/IN/data/` (regex anchored by `FILE_PREFIX` & `FILE_SUFFIX`). For each file:
  - Supports both ISO and ISO+LANG files:
    - `data_<ISO>.json` → runs ISO only.
    - `data_<ISO>_<LANG>.json` → runs ISO with manual language.
  - Forces ISO (and, when present, language) into Step 1 using manual overrides:
    - `linkData.DATA_JSON_ISO_MODE='manual'`
    - `linkData.DATA_JSON_ISO_CODE_MANUAL=<ISO>`
    - `linkData.DATA_JSON_LANG_CODE_MANUAL=<LANG>` (empty when no `<LANG>` in filename)
  - Strictness inherited from Step 1:
    - If a manually specified file is missing (ISO-only or ISO_LANG), Step 1 returns fatal and the batch aborts that run immediately.
  - Runs pipeline (`RUN_open_project=false`, `RUN_close_project=false`).
  - Applies per-run close policy: `batch.SAVE_AFTER_RUN` → `force-save` or `force-no-save` (between runs & final). Step 2 still saves per ISO regardless.
  - Reopens template between runs (reset environment).
  Dry-run: `batch.DRY_RUN=true` lists planned runs only (no open/close or phase execution).

  Batch options:
  | Option | Default | Notes |
  |--------|---------|-------|
  | DATA_FS_SUBPATH | ['IN','data'] | Path under POST scanned for JSON files. |
  | FILE_PREFIX / FILE_SUFFIX | data_ / .json | Filename pattern producing 3-letter ISO. |
  | RUNS_MAX | 0 | Limit number of runs (0 = all). |
  | SLEEP_BETWEEN_RUNS_MS | 500 | Stabilizing pause. |
  | DRY_RUN | false | Discovery only. |
  | SAVE_AFTER_RUN | false | Save policy for every close (force-save vs force-no-save). |

  ### 8. Preset Examples
  Minimal pipeline (single ISO run with open/close):
  ```json
  {
    "RUN_open_project": true,
    "RUN_close_project": true,
    "openProject": { "OPEN_IF_DIRTY_BEHAVIOR": "force-no-save" },
    "closeProject": { "CLOSE_MODE": "force-no-save" },
    "linkData": { "ENABLE_RELINK_DATA_JSON": true, "DATA_JSON_ISO_MODE": "auto" }
  }
  ```
  Strict AUTO footage + skip invalid dims:
  ```json
  {
    "createComps": {
      "AUTO_FROM_PROJECT_FOOTAGE": true,
      "FOOTAGE_PROJECT_PATH": ["project","in","footage"],
      "INCLUDE_SUBFOLDERS": true,
      "SKIP_INVALID_DIMENSIONS": true
    }
  }
  ```
  Extras & AME routing snippet:
  ```json
  {
    "addLayers": {
      "EXTRA_TEMPLATES": { "ENABLE_EXTRA_TEMPLATES": true, "TAG_TOKENS": ["TIKTOK"], "OUTPUT_NAME_SUFFIX": "_tiktok" }
    },
    "ame": { "EXPORT_SUBPATH": ["OUT","DELIVERIES"], "EXTRA_EXPORT_SUBFOLDER": true, "ENABLE_DURATION_SUBFOLDER": true }
  }
  ```

  ### 9. Troubleshooting
  Preset loader alert (“Save the project under POST/WORK…”): ensure current project is saved under `POST/WORK/` or enable `.use_dev_preset` for DEV override.
  “Object is invalid”: occurs when phases access project before Step 0 open; fixed by early bootstrap logic in `pipeline_run.jsx`.
  No comps created (AUTO mode): check path existence, YYMMDD subfolder, or disable AUTO to use manual selection.
  Audio ISO abort: if strict enabled and mismatch, confirm audio filenames encode the ISO after the duration token.
  Missing AME template: leave `APPLY_TEMPLATES=false` or install presets in AME; pathing still works.

  ### 10. Glossary
  ISO: 3-letter country/language code from data filename (`data_ENG.json`) or JSON.
  YYMMDD: Date folder naming convention for footage & sound (e.g., `250910`).
  AR: Aspect Ratio token expressed as `w:h` normalized (e.g., `16x9`, `9x16`).
  Extras: Duplicate variant (e.g., TikTok) generated via `EXTRA_TEMPLATES`. Suffix (e.g., `_tiktok`) signals routing & MEDIA override.
  VideoId: Canonical identifier derived from comp naming tokens prior to duration (fallback scans applied).

  ### 11. Changelog (Recent Highlights)
  See prior integration notes for full history. Key additions: Strict AUTO footage mode; template duration matching; extras duplication & routing; unified save policy in Batch Mode; global log marker; dimension validation; early Step 0 bootstrap; dynamic AME template mapping.

  #### Integration 182–189 – Step 4 Audio Hardening
  Goals: Make SOUND imports deterministic, safer, and self-documenting.
  Changes:
  - Audit: Added single-line summary after expectation — `Using SOUND folder: <path>`.
  - Import type: Forced `importAs=FOOTAGE` for audio to avoid AE guessing.
  - Token-based filtering: During import, only bring in files whose names match expected `ISO` or `ISO_LANG` tokens immediately after duration (prevents wrong-country audio landing in comps).
  - Strict ISO-only (ISO without language): For projects with ISO only, import-time filtering accepts only `ISO` (no `LANG`) by default. A lenient path still exists when non‑strict.
  - Lenient fallbacks (non‑strict):
    - Flat mode: If no top-level audio matched, optionally fall back to an `ISO[_LANG]` subfolder; if absent and abort disabled, prefer `GBL`, then the single/first viable subfolder with audio.
    - Recursive mode: If nothing matched the token filter and strict check is off, import all audio recursively (mismatch warnings are emitted on insert).
  - Subfolder selection fix: Corrected fallback ISO variable typo in ISO-subfolder selection.
  - Safety: Replaced folder `ImportOptions(Folder)` with manual recursive scan to avoid first‑run cold‑start issues in AE; added `__didImportAny` guard so the script only moves/labels imported folders when something was actually imported.

  #### Integration 190 – Step 4 Audio Validation Pass
  Outcome: Verified behaviors above with additional scenarios; no functional changes beyond logging refinements.

  #### Integration 191 – Data.json Relink Removal from Step 4
  Rationale: Centralize JSON linking in Step 1 for single source of truth.
  Changes:
  - Removed all `data.json` relink logic and settings from Step 4.
  - Step 4 now relies on tokens provided by Step 1 (`linkData.iso` / `linkData.lang`).
  - Standalone runs (outside pipeline) can set manual fallbacks: `AUDIO_ISO_MANUAL` and `AUDIO_LANG_MANUAL` for import-time filtering and validation.

  #### Integration 165 – Multi-Language Countries (MLC) Foundation
  Goal: Introduce minimal options to support campaigns where a single country ISO may have multiple language JSON variants without exploding configuration surface.
  Scope implemented:
  - Added manual language override option: `linkData.DATA_JSON_LANG_CODE_MANUAL` (empty string => no manual language).
  - Added AME language subfolder toggle: `ame.USE_LANGUAGE_SUBFOLDER`.
  - Language handling in `link_data.jsx` (initial): auto-detected language based on `data_<ISO>_<LANG>.json` pattern with fallback to ISO-only when missing.
  - Save-As (Step 2) includes language when present: `project_<ISO>_<LANG>_<runId>.aep`.
  - Pack naming (Step 6): introduced distinct `COUNTRY` (ISO only) and new `LANGUAGE` token inserted immediately after country. COUNTRY token no longer carries language; LANGUAGE suppressed if no ISO or language.
  - AME output date folder naming (Step 7):
    - When `USE_LANGUAGE_SUBFOLDER=false`: date folder suffix becomes `_ISO_LANG` (e.g., `251112_CAN_FRA`).
    - When `USE_LANGUAGE_SUBFOLDER=true`: date folder suffix `_ISO` only, with `<LANG>/` nested (e.g., `251112_CAN/FRA/16x9/...`).
  - Robust preset loader & batch orchestrator JSON parsing updated to support environments missing native `JSON.parse` (BOM strip, comment & trailing comma cleanup, eval fallback).
  - Strict fatal enforcement extended: manual ISO missing file now aborts early (alongside manual ISO+LANG missing).
  Guidance:
  - Prefer manual language only when needing deterministic pair; rely on auto-detect for typical multi-file drops.
  - If multiple `data_<ISO>_<LANG>.json` exist, first match selected (deterministic by folder enumeration order); future enhancement could sort by modified time.
  - Logging origins: `isoOrigin` = `manual(forced)|manual(fallback)|auto`; `langOrigin` = `manual|auto|none` clarifies detection path.
  Deferred (possible future work):
  - Sorting heuristic for multiple language files.
  - Batch Mode multi-language runs per ISO (batch now iterates both ISO and ISO+LANG variants).
  - Pack token for language when country token suppressed (currently LANGUAGE inherits COUNTRY suppression).
  - Language-aware audio ISO checks (currently only country vs audio ISO).


  ### 12. Design Principles
  Idempotent phases (safe re-run). Deterministic naming & logging (capped sections with reliable overflow markers). Single merged options object for predictability. Fail-fast on strict mismatches (audio ISO, extras duration strictness) with clear fatal summaries.
    - With duration subfolders OFF: `<date>/<AR>_<extraName>/...`

  #### Integration 176 – MLC Cleanup: Manual-only Language, No Fallbacks
  #### Integration 179 – Multi-Language Audio Matching (Step 4)
  Goal: Extend audio filename ISO validation to support dual ISO_LANG tokens for campaigns with language-specific audio variants.
  Changes:
  - Added parser for ISO or ISO_LANG tokens immediately following duration (e.g., `06s_BEL_FRA_...`).
  - Validation considers presence of project language (from Step 1). If project expects language, audio must provide matching ISO_LANG pair.
  - Reused existing strict toggle (`insertRelink.CHECK_AUDIO_ISO_STRICT`) for abort behavior; no new options added.
  - Warning messages now include consolidated `audio='BEL_FRA' vs project='BEL_FRA'` tags and detailed mismatch reason.
  - Backward-compatible: single ISO filenames continue to validate for ISO-only projects.
  Notes:
  - Audio with extra tokens between duration and ISO (e.g., `06s_NEW_BEL_FRA`) is tolerated only when ISO appears immediately after duration.
  - When project has language but audio supplies only ISO, mismatch logged (missing LANG).
  Goal: Remove language auto-detection/fallback for deterministic runs; add explicit operator signal when multiple language files exist.
  Changes:
  - Removed auto-detection of language in Step 1. The pipeline will never auto-select a `data_<ISO>_<LANG>.json` when `DATA_JSON_LANG_CODE_MANUAL` is empty.
  - Removed fallback from missing ISO+LANG to ISO-only. When a language is manually selected and the file is missing, Step 1 is fatal.
  - Added warning when multiple `data_<ISO>_<LANG>.json` files are present for the selected ISO and no language is chosen; run continues using ISO-only file.
  - Documentation updated in Step 1 to reflect manual-only language policy.
  Notes:
  - Batch orchestrator already injects `DATA_JSON_LANG_CODE_MANUAL` when iterating `data_<ISO>_<LANG>.json` files, aligning with this strict policy.

