## Timing Item Selector
  - **line:** select object where `line === value`.
  - **index:** select by zero-based array index.
  - **minMax:** aggregate min(`in`) to max(`out`) across all valid entries (legacy default).

### Defaults

### Example Override
```json
{
  "TIMING_BEHAVIOR": { "logo": "timed", "claim": "timed", "disclaimer": "span" },
  "APPLY_INPOINT_TO_LAYER_STARTTIME": true,
  "TIMING_ITEM_SELECTOR": {
    "logo": { "mode": "line", "value": 1 },
    "claim": { "mode": "minMax" },
    "disclaimer": { "mode": "index", "value": 0 }
  }
}
```

### Notes
<!-- Executive Summary -->
Executive summary
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
  | 6 | `pack_output_comps.jsx` | Prepare outputs (naming, videoId); extras MEDIA override; split regular vs extras into configurable subfolders. |
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

  Recent additions (Integration 196–199):
  - Comp-as-source in AUTO: when `createComps.ENABLE_ACCEPT_COMP_SOURCE=true`, AUTO collection now includes `CompItem` sources from the project path (added as precomp layers).
  - AUTO collection audit: summary now logs total collected items and breakdown by type (footage vs comps).

  ### Create Comps: Motion Blur & Frame Blending
  - Toggles: `createComps.ENABLE_COMP_MOTION_BLUR`, `createComps.ENABLE_COMP_FRAME_BLENDING`.
  - Effect: When enabled, newly created compositions will have `comp.motionBlur` and/or `comp.frameBlending` set to true.
  - Configuration: Set in `config/pipeline.preset.json` under the `createComps` block or pass via `opts.options` when running standalone.

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

  Options quick reference (Step 4)
  | Option key | Default | Description |
  |------------|---------|-------------|
  | `insertRelink.CLEAR_EXISTING_PROJECT_SOUND_FOLDER` | `true` | Clear `project/in/sound` before new import. |
  | `insertRelink.SOUND_USE_ISO_SUBFOLDER` | `false` | Import from matching ISO/ISO_LANG subfolder recursively. |
  | `insertRelink.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER` | `false` | Flat mode: when top-level empty, try `<ISO>_<LANG>` then `<ISO>` subfolder. |
  | `insertRelink.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER` | `false` | Flat mode: abort if required ISO subfolder not found. |
  | `insertRelink.ENABLE_CHECK_AUDIO_ISO` | `false` | Validate inserted audio filename tokens against project ISO/LANG. |
  | `insertRelink.CHECK_AUDIO_ISO_STRICT` | `false` | When true, abort on first mismatch; otherwise log warnings only. |
  | `insertRelink.ENABLE_ALIGN_AUDIO_TO_MARKERS` | `false` | Align new audio layer start to first comp marker. |
  | `insertRelink.ENABLE_REMOVE_EXISTING_AUDIO_LAYERS` | `true` | Remove existing audio-only layers after inserting new audio. |
  | `insertRelink.ENABLE_MUTE_EXISTING_AUDIO_LAYERS` | `true` | Mute other audio-capable layers (when not removed). |

  Standalone constants (when not running via pipeline)
  - `AUDIO_ISO_MANUAL` (default `"SAU"`): ISO fallback used for import-time filtering and insert-time validation.
  - `AUDIO_LANG_MANUAL` (default `null`): Optional language fallback for the above.

  Example configurations
  Strict import and validation (fail-fast):
  ```json
  {
    "insertRelink": {
      "ENABLE_CHECK_AUDIO_ISO": true,
      "CHECK_AUDIO_ISO_STRICT": true,
      "SOUND_USE_ISO_SUBFOLDER": true,
      "SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER": false,
      "SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER": true,
      "CLEAR_EXISTING_PROJECT_SOUND_FOLDER": true
    }
  }
  ```

  Lenient import with safe fallbacks (warn-only):
  ```json
  {
    "insertRelink": {
      "ENABLE_CHECK_AUDIO_ISO": true,
      "CHECK_AUDIO_ISO_STRICT": false,
      "SOUND_USE_ISO_SUBFOLDER": false,
      "SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER": true,
      "SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER": false
    }
  }
  ```

  Title token matching (audio pairing)
  - Universal N-token support: audio selection now matches 1–4 title tokens immediately before the duration, configurable via `insertRelink.AUDIO_TITLE_TOKEN_COUNT` (default `2`).
  - Lenient vs strict adjacency: `insertRelink.AUDIO_TOKENS_REQUIRE_ADJACENT=false` (default) requires tokens in order before duration but allows extra characters between them; `true` requires contiguous underscore-separated tokens directly before duration (e.g., `token01_token02_30s`).
  - Debug logs: non-breaking `[debug]` lines note expected token count, the tokens used, and detailed miss context; primary miss messages remain unchanged to preserve downstream parsers.

  Quick config snippets (typical values)
  - Default, balanced matching:
    - `insertRelink.AUDIO_TITLE_TOKEN_COUNT = 2`
    - `insertRelink.AUDIO_TOKENS_REQUIRE_ADJACENT = false`
    - Example filename (matches lenient, also matches strict if tokens adjacent):
      - `Alula_Saudi_30s_eng_NEW.wav` → tokens: `Alula`, `Saudi`; duration: `30s`
      - `Alula-Saudi_30s_eng.wav` → lenient matches (`-` between tokens allowed); strict does NOT match
  - Strict title adjacency for tightly controlled naming:
    - `insertRelink.AUDIO_TITLE_TOKEN_COUNT = 2`
    - `insertRelink.AUDIO_TOKENS_REQUIRE_ADJACENT = true`
    - Example filename (requires contiguous underscores before duration):
      - `Alula_Saudi_30s_ar.wav` → matches
      - `Alula-Saudi_30s_ar.wav` → does NOT match (non-underscore separator)
  - Single-token titles (legacy projects):
    - `insertRelink.AUDIO_TITLE_TOKEN_COUNT = 1`
    - `insertRelink.AUDIO_TOKENS_REQUIRE_ADJACENT = false`
    - Example filename:
      - `Saudi_30s_en.wav` → token: `Saudi`; duration: `30s`
      - Note: Higher collision risk; prefer 2 tokens where possible.
  - Three/four tokens for highly specific titles:
    - `insertRelink.AUDIO_TITLE_TOKEN_COUNT = 3 // or 4`
    - `insertRelink.AUDIO_TOKENS_REQUIRE_ADJACENT = true // recommended`
    - Example filenames:
      - 3 tokens: `BrandA_CampaignX_Saudi_30s_en.wav` → tokens: `BrandA`, `CampaignX`, `Saudi`
      - 4 tokens: `BrandA_CampaignX_Saudi_Trailer_30s_en.wav` → tokens: `BrandA`, `CampaignX`, `Saudi`, `Trailer`

  Gotchas (separators & markers)
  - Non-ASCII separators: characters like en-dash/em-dash or localized separators may cause token detection to fail. Use plain ASCII underscores `_` between tokens for strict mode, hyphens `-` only in lenient mode.
  - Pre-duration markers (e.g., `NEW`): if placed before the duration, they become part of the token area. Strict adjacency will reject `BrandA_NEW_Saudi_30s` because `NEW` breaks contiguous tokens. Prefer placing such markers after duration or inside the ISO/LANG segment: `BrandA_Saudi_30s_en_NEW.wav`.
  - Spaces: `BrandA Saudi_30s` will match only in lenient mode; strict mode requires `BrandA_Saudi_30s`.
  - Mixed separators: `BrandA-Saudi_Trailer_30s` is lenient-only. For strict, normalize to `BrandA_Saudi_Trailer_30s`.




  #### Step 5 – Add Layers (Template Application)
    Timing Behavior Map
    - `TIMING_BEHAVIOR` controls per-layer timing as one of:
      - `timed`: apply JSON min/max (in/out) from `data.json`.
      - `span`: force full composition duration (0 → `comp.duration`).
      - `asIs`: keep template timing unchanged.
    - Supports both group keys from `LAYER_NAME_CONFIG` and raw literal layer names (case-insensitive exact).
    - Defaults:
      - `logo`, `logoAnim`, `claim`: `timed`
      - `disclaimer`, `disclaimer_02`: `span`
      - `subtitles`, `dataJson`, `super_A`, `info`, `template_aspect`, `center`: `span`
      - Literal names like `Size_Holder_Subtitles`, `DATA_JSON`, `data.json`, `Size_Holder_Super_A`, `Pin`: `span`
    - Replaces legacy `ENABLE_JSON_TIMING_FOR_DISCLAIMER` and `FULL_DURATION_LAYER_GROUPS`.

    Start Time Alignment
    - `APPLY_INPOINT_TO_LAYER_STARTTIME` (default: true) aligns `layer.startTime` to the computed `inPoint` whenever `timed` behavior is applied. This helps expressions relying on layer-local time.

    Example `TIMING_BEHAVIOR`
    ```js
    var TIMING_BEHAVIOR = {
      logo: 'timed',
      logoAnim: 'timed',
      claim: 'timed',
      disclaimer: 'span',
      disclaimer02: 'span',
      subtitles: 'span',
      dataJson: 'span',
      super_A: 'span',
      'DATA_JSON': 'span',
      'Size_Holder_Super_A': 'span'
    };
    ```

    Preset Options Override (per campaign)

    Options Quick Reference (Step 5)
    | Option key | Default | Description |
    |------------|---------|-------------|
    | `addLayers.TEMPLATE_FOLDER_PATH` | `["project","work","template"]` | Where the template comp lives in the Project panel tree. |
    | `addLayers.TEMPLATE_MATCH_CONFIG.arTolerance` | `0.001` | Aspect ratio tolerance for template matching. |
    | `addLayers.TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch` | `false` | Require AR match within tolerance. |
    | `addLayers.TEMPLATE_MATCH_CONFIG.enableDurationMatch` | `false` | Include duration in template selection scoring. |
    | `addLayers.TEMPLATE_MATCH_CONFIG.requireDurationMatch` | `false` | Require duration within tolerance when enabled. |
    | `addLayers.TEMPLATE_MATCH_CONFIG.durationToleranceSeconds` | `0.50` | Duration tolerance (seconds). |
    | `addLayers.TIMING_BEHAVIOR` | map | Per-group/literal timing: `timed` | `span` | `asIs`. Defaults documented above. |
    | `addLayers.APPLY_INPOINT_TO_LAYER_STARTTIME` | `true` | Align `layer.startTime` to `inPoint` for `timed` layers. |
    | `addLayers.SKIP_COPY_CONFIG` | object | Skip-copy gates by flags/groups/tokens; always-copy base logo names. |
    | `addLayers.EXTRA_TEMPLATES.*` | various | Controls duplicate “extras” comps (allowed ARs, tags, suffix, duration strictness). |
    | `addLayers.EXTRA_TEMPLATES.USE_DEDICATED_TARGET_FOLDERS` | `false` | Place extras in sibling `<AR>_<extraTag>` folders and create `<NNs>` duration subfolders under them. |
    ```json
    {
      "addLayers": {
        "TIMING_BEHAVIOR": {
          "logo": "timed",
          "logoAnim": "timed",
          "claim": "timed",
          "disclaimer": "span",
          "disclaimer02": "span",
          "subtitles": "span",
          "dataJson": "span",
          "super_A": "span",
          "Pin": "span"
        },
        "APPLY_INPOINT_TO_LAYER_STARTTIME": true
      }
    }
    ```

  Template folder path: `addLayers.TEMPLATE_FOLDER_PATH` (default `['project','work','template']`). Matching strategies via `TEMPLATE_MATCH_CONFIG` (AR tolerance, duration strictness). Parenting features: reference-time assignment (`PARENTING_REF_TIME_MODE`), cycle-safe guard, debug dumps.
    Unified flag handling
    - Flags `disclaimer_flag`, `disclaimer_02_flag`, `subtitle_flag`, and `logo_anim_flag` are parsed via a single helper that reads from the video object or its `metadata` and interprets values against the configured lists (`ON`: y/yes/1, `OFF`: n/no/0).
    - Unknown or missing values default to OFF. An audit log line notes any unrecognized values once per comp.
    - AUTO support is currently dormant: values would map to `'auto'` only if enabled, but the pipeline treats flags strictly as ON/OFF for deterministic behavior.

    Advantages of `getModesForVideo`
    - Centralizes extraction and interpretation, reducing duplication and keeping behavior consistent across copy-skip gates and visibility timing.
    - Returns both raw and effective modes, making defaults explicit and simplifying downstream usage.
  Simple mode: `SIMPLE_INSERT_TEMPLATE_AS_LAYER` + related prep toggles for muted/solo/footage disable.
  Extras duplication: `EXTRA_TEMPLATES` namespace (allowed AR list, tag tokens, suffix, duration matching overrides). Duplicate comps included downstream.
  Skip logic: `SKIP_COPY_CONFIG` respects JSON flags & token/group filters.
  Dedicated extras foldering
  - Gate: `addLayers.EXTRA_TEMPLATES.USE_DEDICATED_TARGET_FOLDERS` (default false).
  - Behavior: extra-template comps are placed into a sibling folder named `<AR>_<extraTag>` (e.g., `9x16_tiktok`) alongside the base `<AR>` folder.
  - Duration subfolders: a `<NNs>` duration subfolder (e.g., `30s`) is created under the dedicated folder when a duration token can be parsed from the comp name; otherwise extras land at the dedicated folder root.

  Recent additions (Integration 195–199):
  - New per-video flags: `logo_03_flag`, `logo_04_flag`, `logo_05_flag` parsed and honored in `SKIP_COPY_CONFIG` (`logo03Off`, `logo04Off`, `logo05Off`).
  - Group-based detection aligned: skip-copy gates for `logo_03`, `logo_04`, `logo_05` now use `nameMatchesGroup` consistently with claim groups.

  #### Step 6 – Pack Output Comps
  Derives stable videoId (token-before-duration heuristic). Optional dev self-test (`DEV_VIDEOID_SELF_TEST`).
  Extras parsing & MEDIA override
  - `EXTRA_OUTPUT_COMPS` supports multiple value forms per `AR|duration` key:
    - String size: `"WxH"` (e.g., `"1080x1350"`).
    - Compact: `"WxH@Label"` (e.g., `"1080x1920@TT"`).
    - Object: `{ size: "WxH", media: "Label" }` or `{ w: 1080, h: 1920, media|label: "TT" }`.
    - Array: combine several entries for the same key (produces multiple extras).
  - Gates: `ENABLE_EXTRA_OUTPUT_COMPS=true` enables extras; `ENABLE_EXTRA_MEDIA_OVERRIDE=true` injects `MEDIA=<Label>` from extras config. Suffix-based name appends are no longer used in Step 6.
  - Naming: When the override gate is on and a `media`/`label` is provided, the `MEDIA` token uses that label; otherwise it falls back to the existing logic (e.g., default `OLV`).
  - Logging: `DEBUG_EXTRAS=true` outputs a one-time parsed extras dump for auditing.

  Extras source differentiation & foldering
  - Keys: Backward-compatible. Regular entries continue to use `AR|NNs` (e.g., `9x16|15s`). Extra-template entries can optionally use `AR_<extra>|NNs` (e.g., `9x16_tiktok|15s`). The `<extra>` tag is normalized (case-insensitive; sanitized) for matching.
  - Matching: Regular entries only match regular source comps (no extra suffix). Extra-template entries only match extra-sourced comps whose suffix-derived tag equals `<extra>` (case-insensitive).
  - Folder naming for extras: When a source comp is extra-template based, the extras destination AR segment includes the extra tag: `AR_<extra>_WxH[_MEDIA]`. Regular-sourced extras use `AR_WxH[_MEDIA]`.
  - Essentials vs Extras split: When `ENABLE_EXTRA_OUTPUT_COMPS=true`, regular output comps are placed under an `essentials` subfolder and extra output comps under an `extras` subfolder within the mirrored output path. If the first mirrored segment is a six-digit date (`YYMMDD`), the subfolder is inserted directly after it; otherwise at the start of the mirrored segments.
  - Configurable names: `OUTPUT_ESSENTIALS_DIRNAME` (default `essentials`) and `OUTPUT_EXTRAS_DIRNAME` (default `extras`). When `ENABLE_EXTRA_OUTPUT_COMPS=false`, the `essentials` subfolder is not created and regular outputs use the original mirrored path.
  - Debugging: With `DEBUG_EXTRAS=true`, logs include the parsed `extraKey` per entry and a concise note when regular entries are skipped for extra-sourced comps.

  Options Quick Reference (Step 6)
  | Option key | Default | Description |
  |------------|---------|-------------|
  | `ENABLE_EXTRA_OUTPUT_COMPS` | — | Enable creation of extras from `EXTRA_OUTPUT_COMPS` map. |
  | `EXTRA_OUTPUT_COMPS` | — | Map keyed by `AR|NNs` (regular) and optionally `AR_<extra>|NNs` (extra-template), with values in string/compact/object/array forms to produce extras. |
  | `ENABLE_EXTRA_MEDIA_OVERRIDE` | — | Use `media`/`label` from extras config to override the `MEDIA` token. |
  | `DEBUG_EXTRAS` | — | Emit a one-time parsed extras dump for audit. |
  | `OUTPUT_ESSENTIALS_DIRNAME` | `essentials` | Name of the subfolder for regular outputs when extras are enabled; inserted after `YYMMDD` when present. |
  | `OUTPUT_EXTRAS_DIRNAME` | `extras` | Name of the subfolder for extra outputs; inserted after `YYMMDD` when present. |
  | `DEV_VIDEOID_SELF_TEST` | — | Development-only self-test for videoId derivation. |

  #### Step 7 – AME Output Paths & Queue
  Path base: `ame.EXPORT_SUBPATH` under `POST/`. Duration subfolder toggle: `ENABLE_DURATION_SUBFOLDER`.
  Project-folder mimic: When `MIMIC_PROJECT_FOLDER_STRUCTURE=true`, AME paths mirror Project panel segments following an anchor (default `PROJECT_FOLDER_ANCHOR_NAME="out"`). Pure six-digit date segments (`YYMMDD`) found after the anchor are filtered to avoid duplicating the date folder under `YYMMDD_ISO`.
  Extras routing: `EXTRA_EXPORT_SUBFOLDER=true` yields `<date>/<AR>_<extraName>/...` (respects the duration subfolder toggle) in addition to any mimic segments.
  Template mapping: `APPLY_TEMPLATES`, `OUTPUT_MODULE_TEMPLATE`, AR maps, AR+duration maps, dynamic selection & optional reapply (`DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES`).
  Logging density: `VERBOSE_DEBUG`, `COMPACT_ITEM_DETAIL` (caps detail at 80 lines with “… (X more) …”).

  Options Quick Reference (Step 7)
  | Option key | Default | Description |
  |------------|---------|-------------|
  | `ame.EXPORT_SUBPATH` | — | Path segments under `POST/` forming the output base (e.g., `OUT/PREVIEWS`). |
  | `ENABLE_DURATION_SUBFOLDER` | — | Place outputs under duration subfolders (e.g., `30s/`). |
  | `MIMIC_PROJECT_FOLDER_STRUCTURE` | — | Mirror Project panel segments after anchor; filters pure `YYMMDD` segments found post-anchor. |
  | `PROJECT_FOLDER_ANCHOR_NAME` | — | Anchor name for mimic start (default convention: `out`). |
  | `EXTRA_EXPORT_SUBFOLDER` | — | Route extras into `<AR>_<extraName>/` subfolders (respects duration subfolder toggle). |
  | `APPLY_TEMPLATES` | — | Apply AME output module templates based on AR/duration maps. |
  | `OUTPUT_MODULE_TEMPLATE` | — | Base template name applied to items being queued. |
  | `DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES` | — | Reapply template selection to stabilize overrides when needed. |
  | `VERBOSE_DEBUG` | — | Increase logging detail for pathing and template application. |
  | `COMPACT_ITEM_DETAIL` | — | Cap per-item log lines with concise summaries. |

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

  Pack extras parsing & AME mimic (advanced):
  ```json
  {
    "ENABLE_EXTRA_OUTPUT_COMPS": true,
    "ENABLE_EXTRA_MEDIA_OVERRIDE": true,
    "OUTPUT_ESSENTIALS_DIRNAME": "essentials",
    "OUTPUT_EXTRAS_DIRNAME": "extras",
    "EXTRA_OUTPUT_COMPS": {
      "16x9|30s": [
        "1920x1080@OLV",
        { "size": "1080x1920", "media": "TT" },
        { "w": 1080, "h": 1350, "label": "IG" }
      ],
      "9x16|15s": "1080x1920@TT",
      "9x16_tiktok|15s": [
        { "size": "720x1280", "media": "TikTok" },
        { "size": "720x1280", "media": "MetaInFeed" }
      ]
    },
    "ame": {
      "EXPORT_SUBPATH": ["OUT","PREVIEWS"],
      "MIMIC_PROJECT_FOLDER_STRUCTURE": true,
      "PROJECT_FOLDER_ANCHOR_NAME": "out",
      "EXTRA_EXPORT_SUBFOLDER": true,
      "ENABLE_DURATION_SUBFOLDER": true
    }
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
  Extras: Additional output variants produced either by Step 5 `EXTRA_TEMPLATES` duplicates or Step 6 `EXTRA_OUTPUT_COMPS` entries (string/compact/object/array). Extras may be routed into dedicated subfolders; naming can include a `MEDIA` token label when enabled.
  MEDIA: Naming token representing media/placement. Defaults to `OLV` when no explicit label is provided. When `ENABLE_EXTRA_MEDIA_OVERRIDE=true`, the label from extras config (`media`/`label`) overrides `MEDIA` in names; suffix-based appends are not used in Step 6.
  VideoId: Canonical identifier derived from comp naming tokens prior to duration (fallback scans applied).

  ### 11. Changelog (Recent Highlights)
  See prior integration notes for full history. Highlights since Integration 195:
  - Step 3 (Create Comps): AUTO now accepts `CompItem` sources via `ENABLE_ACCEPT_COMP_SOURCE`; collection summary includes item type counts.
  - Step 4 (Insert & Relink): Audio pairing generalized to N (1–4) title tokens before duration with `AUDIO_TITLE_TOKEN_COUNT`; optional strict adjacency via `AUDIO_TOKENS_REQUIRE_ADJACENT`; added debug-only audit without breaking existing parsers.
  - Step 5 (Add Layers): Added `logo_03/04/05` flags and wired skip-copy gates using group-based detection.
  - Logging: Per-phase file logs remain consistent; additional concise debug lines aid auditing while keeping primary summaries stable.

  Recent additions (Integration 202+ / Packs 28–35):
    Recent additions (Packs 40–45):
    - Step 6 (Pack Output Comps): Extras config keys now accept `AR_<extra>|NNs` to target extra-template sourced comps distinctly from regular `AR|NNs`. Matching is case-insensitive and normalized; regular entries never apply to extra-sourced comps.
    - Step 6: Extras folder naming reflects source type — extra-sourced use `AR_<extra>_WxH[_MEDIA]`, regular-sourced use `AR_WxH[_MEDIA]`.
    - Step 6: Essentials vs Extras split — when `ENABLE_EXTRA_OUTPUT_COMPS=true`, regular outputs are placed under `essentials/` and extra outputs under `extras/` within the mirrored path (after `YYMMDD` when present). Names are configurable via `OUTPUT_ESSENTIALS_DIRNAME` and `OUTPUT_EXTRAS_DIRNAME`. When extras are disabled, `essentials/` is not created.
    - Step 6: Debugging improvements — parsed extras dump includes the normalized `extraKey`; logs note when regular entries are skipped for extra-sourced comps.
  - Step 6 (Pack Output Comps): Extras parsing expanded — `EXTRA_OUTPUT_COMPS` now supports string, compact (`WxH@Label`), object (`{size|w/h, media|label}`), and arrays (multiple extras per key). MEDIA token can be overridden from extras config when `ENABLE_EXTRA_MEDIA_OVERRIDE=true`; suffix-based appends removed in Step 6.
  - Step 7 (AME Output Paths): Project-panel mimic added with anchor support — `MIMIC_PROJECT_FOLDER_STRUCTURE=true` mirrors segments after `PROJECT_FOLDER_ANCHOR_NAME` (default `out`); pure `YYMMDD` segments after the anchor are filtered to avoid duplicating the date folder under `YYMMDD_ISO`.

  ### 12. Design Principles
  Idempotent phases (safe re-run). Deterministic naming & logging (capped sections with reliable overflow markers). Single merged options object for predictability. Fail-fast on strict mismatches (audio ISO, extras duration strictness) with clear fatal summaries.
    - With duration subfolders OFF: `<date>/<AR>_<extraName>/...`





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



