This repo uses a single options bundle merged from Defaults + your preset (pipeline.preset.json).

Merge rules
- Objects are merged recursively.
- Arrays are replaced as a whole (no concatenation/union).
- Primitives (string/number/boolean/null) replace defaults.

Reserved keys
- Keys starting with `__` (e.g., `__presetMeta`, `__sticky`) are reserved for the loader and
  are not part of the effective options.

Phase toggles and logging
- `RUN_*` booleans (e.g., `RUN_link_data`) gate whether a phase executes. Default: true.
- `PHASE_FILE_LOGS_MASTER_ENABLE=false` forces each phase to disable its own file log for that run.
- `PIPELINE_SHOW_PHASE_TAGS`/`PIPELINE_SHOW_LEVELS` influence INFO {phase} tagging in the unified pipeline log.
- `sleepBetweenPhasesMs` lets the orchestrator pause before each step to stabilize AE.

Global log marker (ASCII-safe)
- `LOG_MARKER` (top-level option): one place to control the bullet/marker used across all steps' logs.
- Accepts simple ASCII markers (e.g., `*`, `-`, `>`). Non-ASCII markers are sanitized to `*` to avoid garbled characters in some viewers.

Link-data vs insert-relink (data.json)
- Step 1 (link_data) owns data.json relinking.
  - Use `linkData.ENABLE_RELINK_DATA_JSON=true` to enable here.
  - `linkData.DATA_JSON_ISO_MODE`: `manual` | `auto`. Manual uses `DATA_JSON_ISO_CODE_MANUAL`; auto tries to
    derive ISO from the folder above `POST`, then falls back to manual.
  - Path segments like `linkData.DATA_JSON_FS_SUBPATH` and `linkData.DATA_JSON_PROJECT_FOLDER` are arrays; they
    replace defaults entirely when provided in a preset.
- To avoid duplication, `insertRelink.ENABLE_RELINK_DATA_JSON` defaults to false. Only turn it on intentionally (e.g., migration/testing).

AME export base
- `ame.EXPORT_SUBPATH` can be a string or array of segments; it’s appended under `POST` to build the export base.
  Example: `["OUT","PREVIEWS"]` => `POST/OUT/PREVIEWS/...`.

Tips
- Keep phase settings under their namespace (linkData, createComps, insertRelink, addLayers, pack, ame).
- When in doubt, check `script/ae/pipeline_options.jsx` for defaults and comments.

Strict AUTO footage mode (Step 3)
- `createComps.AUTO_FROM_PROJECT_FOOTAGE=true` enables strict automatic discovery; manual selection is ignored entirely.
- The script resolves only the configured Project Panel path (default `project/in/footage`). If it cannot find:
  - the path itself → logs `Auto footage: path not found: project/in/footage`
  - a YYMMDD subfolder → logs `Auto footage: no YYMMDD subfolder under: project/in/footage`
  - any footage items → logs `Auto footage: no footage items found under '<dateFolder>'`
- In any of those cases, Step 3 aborts early (0 comps created) and does NOT fall back to other folders (e.g. `project/in/data`) or the user's selection.
- Normal (non‑AUTO) mode still uses the current selection or a provided `selection` array.
- Optional hardening: `createComps.SKIP_INVALID_DIMENSIONS=true` skips footage with invalid width/height (outside 4–30000) instead of creating a fallback 1920x1080 comp. When false (default), such items log a WARN and use 1920x1080.


Project open/close automation (Step 0 and Step 8)
- Purpose: prepare for unattended/batch runs by opening a template AEP at the start and closing the project at the end.
- Behavior
  - Step 0 (open): opens a template .aep before Step 1 runs. If no path is provided, the script auto-discovers the newest .aep under the current project’s `POST/WORK/`.
  - Step 8 (close): closes the project after Step 7 completes; you can choose prompt/force save/force no-save.
- Toggles and options
  - `RUN_open_project` (boolean): enable Step 0. Default: false.
  - `openProject.PROJECT_TEMPLATE_PATH` (string): absolute path to the template .aep. Optional; if empty, auto-discover newest under `POST/WORK` based on the currently open project.
  - `openProject.OPEN_IF_DIRTY_BEHAVIOR` (string): `abort` | `prompt` | `force-no-save`. Default: `prompt`.
  - `RUN_close_project` (boolean): enable Step 8. Default: false.
  - `closeProject.CLOSE_MODE` (string): `prompt` | `force-save` | `force-no-save`. Default: `force-no-save`.
- Minimal preset example
```json
{
  "RUN_open_project": true,
  "RUN_close_project": true,
  "openProject": {
    "PROJECT_TEMPLATE_PATH": "/absolute/path/to/POST/WORK/YourTemplate.aep",
    "OPEN_IF_DIRTY_BEHAVIOR": "force-no-save"
  },
  "closeProject": {
    "CLOSE_MODE": "force-no-save"
  }
}
```

Add layers to comp (Step 3) — Template picking (Solutions A/B/C)
- Where templates live: under the project panel path in `add_layers_to_comp.jsx` → `TEMPLATE_FOLDER_PATH` (default `["project","work","template"]`). The script searches this folder recursively (subfolders included).
- Safety: if you accidentally select template comps, they’re protected and skipped; only non-template comps are processed.
- Candidate discovery: all comps under the template folder are collected and considered as candidates.
- Solutions overview
  - A) Single template: keep exactly one template comp under the folder; it will be used for all targets.
  - B) Multiple templates — match AR: the picker prefers aspect ratio within tolerance and, when both candidates are within tolerance, the closest resolution wins; tie-breaker: newer date/version in name (`..._template_YYMMDD_vNN`).
  - C) Multiple templates — match AR & duration: when enabled, duration closeness is considered (and can be required). Order of preference becomes: AR within tolerance → duration within tolerance (if enabled) → smaller duration diff → closer resolution → newer date/version.
- Toggles (see `addLayers.TEMPLATE_MATCH_CONFIG` in `pipeline_options.jsx`)
  - `arTolerance` (number): acceptable absolute delta between template AR (w/h) and target AR (default 0.001).
  - `requireAspectRatioMatch` (boolean): when true, only candidates within `arTolerance` are considered. If none, the target comp is skipped and you’ll get a one-time alert explaining why.
  - `enableDurationMatch` (boolean): when true, include duration in the scoring/tie-breaking.
  - `requireDurationMatch` (boolean): when true (and duration matching is enabled), duration must be within `durationToleranceSeconds`.
  - `durationToleranceSeconds` (number): allowed absolute difference (seconds) between template comp duration and target comp duration (default 0.50s).
- Calling logic: alerts, skips, and fallbacks
  - If `requireAspectRatioMatch=true` and no candidate matches AR within tolerance, the comp is skipped; an alert appears once per run with guidance to adjust tolerance/requirement.
  - If `requireAspectRatioMatch=false` and no candidate matches AR within tolerance, selection falls back to the closest AR, then resolution, then date/version.
  - If `enableDurationMatch=true` and `requireDurationMatch=true` but no candidate matches the duration tolerance, the comp is skipped; an alert appears once per run with guidance to relax or disable duration strictness.
- Skip‑copy behavior while inserting layers
  - Controlled by `addLayers.SKIP_COPY_CONFIG` (see options file for all toggles with comments). When a JSON flag (e.g., `disclaimer_flag`, `subtitle_flag`, `logo_anim_flag`) resolves to OFF for a video, matching template layers are not copied into the target.
  - You can also opt into group-based or ad‑hoc token skips to quickly omit certain layers by name.

Simple mode (Step 3) — insert template as a single precomp layer
- Purpose: when your template comp already contains everything, insert it as one precomp layer instead of copying its children into targets.
- Behavior
  - The script still selects the best template per target using the same AR/duration rules.
  - It inserts the chosen template comp as a single layer into the target.
  - Placement: the inserted layer is positioned directly above the bottom‑most video footage layer (if present); otherwise it remains at the top.
  - JSON timing and per‑layer skip logic are not applied in simple mode (the precomp remains intact).
- Toggles (`addLayers` namespace in `pipeline_options.jsx`)
  - `SIMPLE_INSERT_TEMPLATE_AS_LAYER` (boolean): master switch. Default: false.
  - `SIMPLE_MUTE_TEMPLATE_AUDIO` (boolean): mute audio on the inserted precomp layer. Default: true.
  - `SIMPLE_SOLO_INSERTED_LAYER` (boolean): set `solo=true` on the inserted layer. Default: false.
  - `SIMPLE_PREP_REMOVE_ALL_LAYERS` (boolean): remove all existing layers in the target before inserting (destructive). Default: false.
  - `SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO` (boolean): before inserting, disable visibility for FootageItem layers in the target. Default: false.
  - `SIMPLE_PREP_MUTE_FOOTAGE_AUDIO` (boolean): before inserting, mute audio for FootageItem layers in the target. Default: false.
- Minimal preset example
```json
{
  "addLayers": {
    "SIMPLE_INSERT_TEMPLATE_AS_LAYER": true,
    "SIMPLE_MUTE_TEMPLATE_AUDIO": true,
    "SIMPLE_SOLO_INSERTED_LAYER": true,
    "SIMPLE_PREP_REMOVE_ALL_LAYERS": false,
    "SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO": true,
    "SIMPLE_PREP_MUTE_FOOTAGE_AUDIO": true
  }
}
```

Parenting robustness and debugging (Step 3)
- Assign parenting at a stable reference time to avoid time-dependent offsets when the parent has animated transforms.
  - `addLayers.PARENTING_ASSIGN_AT_REF_TIME` (default `true`)
  - `addLayers.PARENTING_REF_TIME_MODE`: `zero` | `current` | `inPoint` | `custom` (default `zero`)
  - `addLayers.PARENTING_REF_TIME_SECONDS`: numeric (used when `custom`)
- Cycle-safe parenting guard: skip assignment if it would create a cycle or parent to itself (logged with reason).
- Robust new-layer detection: maps template → target using layer-reference diffs before/after copy (prevents mis-parenting like mapping to `DATA_JSON`).
- One-off debugging gates:
  - `addLayers.DEBUG_PARENTING_DUMP`: logs planned child→parent and actual assignments.
  - `addLayers.DEBUG_PARENTING_DUMP_ONLY_COMPS`: restrict dump to specific comp names.
  - `addLayers.DEBUG_PARENTING_DUMP_WITH_TRANSFORM`: adds before/after Position readbacks at the reference time.
  - `addLayers.DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET`: compares template child local Position (at ref time, while still parented) vs target child local Position after parenting.

Preset snippet (enable Solution C: AR + strict duration)
```json
{
  "addLayers": {
    "TEMPLATE_MATCH_CONFIG": {
      "arTolerance": 0.001,
      "requireAspectRatioMatch": false,
      "enableDurationMatch": true,
      "requireDurationMatch": true,
      "durationToleranceSeconds": 0.5
    }
  }
}
```

Extras (Step 3) — Duplicate with an extra template
- Purpose: create an additional output variant (e.g., TikTok layout) for selected aspect ratios by duplicating the target comp and applying layers from an "extra" template.
- How it works
  - Mark extra template comps by name tokens (case-insensitive), e.g., "EXTRA" or "TIKTOK". Place them under the same template folder.
  - When enabled, and a target comp’s AR is allowed, the script duplicates the comp, appends a suffix (default `_extra`), finds the best-matching extra template by AR (and optionally duration), and copies its layers into the duplicate.
  - The duplicate is included in the returned `processed` list, so subsequent steps (pack/AME) will pick it up automatically.
- Options: `addLayers.EXTRA_TEMPLATES` (see comments in `pipeline_options.jsx`)
  - `ENABLE_EXTRA_TEMPLATES` (boolean): master switch. Default: false.
  - `ALLOWED_AR` (array): AR keys allowed for extras (e.g., `["9x16"]`). Empty → allow all.
  - `TAG_TOKENS` (array): tokens to detect extra templates (e.g., `["EXTRA","TIKTOK"]`).
  - `OUTPUT_NAME_SUFFIX` (string): name suffix for the duplicate (default `_extra`).
  - `REQUIRE_DURATION_MATCH` (boolean|null): when boolean, overrides `TEMPLATE_MATCH_CONFIG.requireDurationMatch` for extra selection; null inherits.
  - `DURATION_TOLERANCE_SECONDS` (number|null): when number, overrides `TEMPLATE_MATCH_CONFIG.durationToleranceSeconds` for extra selection; null inherits.
  - `FALLBACK_WHEN_NO_EXTRA` (boolean): currently informational; extras are simply skipped when not available.
  - Naming parity with pack: the pack step can override the `MEDIA` token for extras based on the duplicate suffix (e.g., `_tiktok`). This avoids naming collisions and produces consistent names (see pack options below).
- Minimal preset snippet
```json
{
  "addLayers": {
    "EXTRA_TEMPLATES": {
      "ENABLE_EXTRA_TEMPLATES": true,
      "ALLOWED_AR": ["9x16"],
      "TAG_TOKENS": ["EXTRA", "TIKTOK"],
      "OUTPUT_NAME_SUFFIX": "_tiktok",
      "REQUIRE_DURATION_MATCH": true,
      "DURATION_TOLERANCE_SECONDS": 0.5
    }
  }
}
```

Save As (include ISO)
- Step 2 saves the current project next to the original `.aep` as `<name>_<ISO>.aep`.
- ISO is taken from Step 1 (link_data) when available; you can override using `saveAsISO.iso`.
- Options:
  - `RUN_save_as_iso` (boolean): enable/disable Step 2. Default: true.
  - `saveAsISO.OVERWRITE` (boolean): when true, overwrite `<name>_<ISO>.aep` if it exists; when false (default), use `<name>_<ISO>_<runId>.aep` to avoid collision.
  - `saveAsISO.iso` (string): manual ISO override used if Step 1 did not provide one.

Audio ISO filename check (Insert & Relink)
- When enabled, Step 4 parses a 3‑letter ISO token from the audio filename (preferring the token immediately after the duration like `06s`; e.g., `AlBalad_NEW_06s_ENG_v02_...` → `ENG`) and compares it against the project ISO.
- Project ISO source: prefers Step 1 result (`linkData.iso`), fallback to `insertRelink.DATA_JSON_ISO_CODE` (auto/manual).
- Options:
  - `insertRelink.ENABLE_CHECK_AUDIO_ISO` (boolean): enable the check. Default: false.
  - `insertRelink.CHECK_AUDIO_ISO_STRICT` (boolean): when true, a mismatch triggers an alert and aborts the pipeline; when false, a `[warn]` is logged and processing continues. Default: false.

Sound import from ISO subfolders (Insert & Relink)
- When your SOUND date folder contains per-language subfolders (e.g., `POST/IN/SOUND/YYMMDD/DEU`, `.../FRA`), you can import only the subfolder matching the project ISO.
- Project ISO source: prefers Step 1 (`linkData.iso`), fallback to `insertRelink.DATA_JSON_ISO_CODE`.
- If the ISO subfolder is missing or ISO is unavailable, the script falls back to importing the whole date folder and logs a `[warn]` line.
- Option:
  - `insertRelink.SOUND_USE_ISO_SUBFOLDER` (boolean): enable ISO folder selection. Default: false.
  - When `false`, only top-level files in `POST/IN/SOUND/YYMMDD` are imported. Any subfolders inside `YYMMDD` are skipped entirely.
  - Soft fallback (flat mode): If `insertRelink.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER=true` and no top-level files are found, the script will try to import the ISO-named subfolder instead (using the project ISO from Step 1, with manual/auto fallback). A `[warn]` is logged when fallback is used.
  - Flat strict abort: If `insertRelink.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER=true` and no top-level files exist and the ISO subfolder is not available, the pipeline aborts with a fatal summary (instead of a graceful exit).

Queue to AME (Step 7)
- Purpose: set deterministic output paths for each Render Queue item and optionally queue to Adobe Media Encoder.
- Behavior:
  - Output path assignment is independent of presets. Folders and `om.file` are set first; template application (if any) happens afterwards.
  - Date folder suffix prefers ISO from Step 1 (`linkData.iso`), then falls back to project data.json filename, then disk scan of `POST/IN/data`.
  - When a mapped/default preset is missing, the script proceeds with path assignment and logs clear template diagnostics.
- Options (ame namespace):
  - Pathing and queueing
    - `EXPORT_SUBPATH`: string or array under `POST/` (default `["OUT","PREVIEWS"]`).
    - `AUTO_QUEUE_IN_AME`: boolean. Queue to AME after configuring paths.
    - `AME_MAX_QUEUE_ATTEMPTS` / `AME_RETRY_DELAY_MS`: retry when Dynamic Link isn’t ready.
    - `EXTRA_EXPORT_SUBFOLDER` (boolean): when true, extras (detected by name tokens; see below) are routed to a sibling folder of the AR, named `<AR>_<extraName>`.
      - With duration subfolders ON (default): `<date>/<AR>_<extraName>/<duration>/...`
      - With duration subfolders OFF: `<date>/<AR>_<extraName>/...`
      - Default: false
    - `ENABLE_DURATION_SUBFOLDER` (boolean): when false, omit the `<duration>` level from the output path.
      - Normal items: `<date>/<AR>/...`
      - Extras (with `EXTRA_EXPORT_SUBFOLDER=true`): `<date>/<AR>_<extraName>/...`
      - Default: true
  - Template application
    - `APPLY_TEMPLATES` (boolean): master switch. When false, no templates are applied (only paths are set).
    - `ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION` (boolean): enable mapping by AR and AR|duration.
    - `DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES` (boolean): reapply chosen preset just before queue (helps inheritance when present).
    - `AUTO_DISABLE_REAPPLY_ON_MISSING` (boolean): if any preset is missing, skip the reapply pass to reduce log noise.
    - `OUTPUT_MODULE_TEMPLATE` (string): default template name.
    - `OUTPUT_MODULE_TEMPLATE_BY_AR` (object): map AR to template (e.g., `{ "1x1": "25Mbs" }`).
    - `OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION` (object): map `AR|duration` to template, overrides AR-only when present.
  - Logging
    - `VERBOSE_DEBUG` (boolean): gates selection/RQ add logging and the multi-line DETAIL block.
    - `COMPACT_ITEM_DETAIL` (boolean): when true, emit one compact line per item (ASSIGN+DEST [+tpl]) inside DETAIL; works even if `VERBOSE_DEBUG=false`.
    - Internally, the DETAIL section caps at 80 lines; when capped, a reliable `... (X more) ...` footer is printed.
  - Extras detection (name-based; shared intent with addLayers EXTRA_TEMPLATES)
    - Pulls `addLayers.EXTRA_TEMPLATES.OUTPUT_NAME_SUFFIX` (e.g., `_tiktok`) and `TAG_TOKENS` (e.g., `["TIKTOK"]`) from effective options when available.
    - Matching rules (case-insensitive, alphanumeric-normalized):
      1) If the suffix token (without leading `_`) appears anywhere in the comp name → mark as extra.
      2) If any `TAG_TOKENS` appears anywhere in the comp name → mark as extra.
      3) Fallback: strict name endsWith `OUTPUT_NAME_SUFFIX`.
    - `extraName` is derived from the matched token (e.g., `_tiktok` → `tiktok`), producing the folder `<AR>_<extraName>`.

Preset snippet (extras routing + duration toggle)
```json
{
  "addLayers": {
    "EXTRA_TEMPLATES": {
      "ENABLE_EXTRA_TEMPLATES": true,
      "ALLOWED_AR": ["9x16"],
      "TAG_TOKENS": ["TIKTOK"],
      "OUTPUT_NAME_SUFFIX": "_tiktok"
    }
  },
  "ame": {
    "EXPORT_SUBPATH": ["OUT", "DELIVERIES"],
    "AUTO_QUEUE_IN_AME": true,
    "APPLY_TEMPLATES": false,
    "EXTRA_EXPORT_SUBFOLDER": true,
    "ENABLE_DURATION_SUBFOLDER": true
  }
}
```

Pack outputs (Step 6) — naming, IDs, and extras
- VideoId derivation is resilient and consistent with Step 3 (token-before-duration with fallback scan). Works with names like `token1_token2_Title_06s_v01`.
- Concise summary includes created/skip counts and timing metrics.
- Dev self-test (optional): log sample name → videoId mappings; optionally include selection.
  - `pack.DEV_VIDEOID_SELF_TEST` (boolean)
  - `pack.DEV_VIDEOID_SELF_TEST_USE_SELECTION` (boolean)
- Extras naming: when enabled, the `MEDIA` token is overridden for extras based on the duplicate suffix (e.g., `_tiktok` → `MEDIA=TIKTOK`).
  - Controlled by internal logic tied to `addLayers.EXTRA_TEMPLATES.OUTPUT_NAME_SUFFIX`.
  - Default `MEDIA` for non-extras is `OLV`.

Preset snippet (paste into your `pipeline.preset.json`)
```json
{
  "ame": {
    "EXPORT_SUBPATH": ["OUT", "DELIVERIES"],
    "AUTO_QUEUE_IN_AME": true,

    "APPLY_TEMPLATES": false,
    "ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION": true,
    "DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES": false,
    "AUTO_DISABLE_REAPPLY_ON_MISSING": true,
    "OUTPUT_MODULE_TEMPLATE": "",
    "OUTPUT_MODULE_TEMPLATE_BY_AR": {
      "1x1": "25Mbs",
      "16x9": "YouTube_1080p",
      "9x16": "TikTok_1080x1920"
    },
    "OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION": {
      "1x1|06s": "Short_1x1",
      "1x1|15s": "Short_1x1_15"
    },

    "VERBOSE_DEBUG": false,
    "COMPACT_ITEM_DETAIL": true
  }
}
```

Notes
- When presets are not installed on the machine, prefer `APPLY_TEMPLATES=false` to avoid errors; output paths will still be set correctly.
- AME does not inherit AE Output Module templates when queueing; presets must exist in AME, or you can render in AE RQ instead.

## Batch Mode

Batch Phase 1: preset loader prerequisites and troubleshooting
- Why the alert appears
  - The preset loader finds your preset at `POST/IN/data/config/pipeline.preset.json` by first locating the currently open project’s path. If no project is saved under `POST/WORK`, it can’t infer `POST`, so it shows:
    - “Preset Loader: Save the project under POST/WORK before running. Expected: POST/WORK/<project>.aep and POST/IN/data/config/<preset>.json”
- Important sequencing
  - Step 0 (open project) only runs after the preset is loaded. That means `openProject.PROJECT_TEMPLATE_PATH` helps Step 0, but it does not help the preset loader itself locate the preset. You must satisfy the loader first.
- Three ways to proceed
  1) Recommended: save any .aep under `POST/WORK/` and run the loader
     - Example: `POST/WORK/project.aep` and your preset at `POST/IN/data/config/pipeline.preset.json`.
  2) Dev override: force using the repo-local preset
     - Create an empty file: `script/ae/config/.use_dev_preset`
     - The loader will use `script/ae/config/pipeline.preset.json` regardless of the current project location.
  3) Manual pick (when prompted)
     - If the loader can’t find the default preset but does know `POST`, it will offer a file dialog. Pick any JSON preset.
- Tip: with Step 0 enabled, set an absolute `openProject.PROJECT_TEMPLATE_PATH` to a .aep inside `POST/WORK` (as in your example), so the pipeline opens the correct template automatically once the preset is loaded.


Batch Mode (Phase 2) — Run multiple ISOs in one go
- Purpose: iterate all `data_*.json` under `POST/IN/data/` and run the pipeline once per ISO (derived from filename), with per-run overrides applied for Step 1 (link_data ISO).
- Two ways to run
  - Dev preset mode: create `script/ae/config/.use_dev_preset` and keep your `pipeline.preset.json` in `script/ae/config/`. Then run `script/ae/batch_orchestrator.jsx` from AE.
  - POST-based mode: open any project saved under `POST/WORK/` in AE so the orchestrator can infer `POST`; it will load `POST/IN/data/config/pipeline.preset.json` automatically.
- What it does per file
  1) Derives ISO from filename using `FILE_PREFIX` + 3-letter code + `FILE_SUFFIX` (default: `data_XXX.json`).
  2) Merges your preset and forces per-run overrides:
     - `RUN_open_project=false`, `RUN_close_project=false` (the batch owns open/close lifecycle)
    - `linkData.ENABLE_RELINK_DATA_JSON=true`
    - `linkData.DATA_JSON_ISO_MODE="manual"`
    - `linkData.DATA_JSON_ISO_CODE_MANUAL=<ISO from filename>`
  3) Calls `pipeline_run.jsx` and records counts for created/inserted/addLayers/pack/ame.
  4) Closes the project after each run with a save/no-save policy derived from `batch.SAVE_AFTER_RUN` and logs `Closed with: <mode>`.
  5) Automatically reopens the template for the next run (when any). After the last run, closes the project once more with the same policy and logs the final mode.
- Batch log
  - Writes `POST/WORK/log/batch_orchestrator_<RunId>.log` with one line per run and a final summary.
- Options (batch namespace, in your preset)
```json
{
  "batch": {
    "DATA_FS_SUBPATH": ["IN", "data"],
    "FILE_PREFIX": "data_",
    "FILE_SUFFIX": ".json",
    "RUNS_MAX": 0,                     // 0 = all files
    "SLEEP_BETWEEN_RUNS_MS": 500,      // small AE stabilization pause
    "DRY_RUN": false,                  // when true: list planned runs only, no pipeline execution
    "SAVE_AFTER_RUN": false            // save policy for between-run and final close: true=force-save, false=force-no-save
  }
}
```
- Minimal usage
  - Dev preset: enable `.use_dev_preset`, then run `batch_orchestrator.jsx` (no dialogs).
  - POST preset: open `POST/WORK/project.aep`, then run `batch_orchestrator.jsx` (no dialogs).
- Example outcome
  - Batch log shows:
    - `-- RUN 1/3 ISO=ESP file=.../data_ESP.json` → `Result: ok=true | counts=12,12,15,15,15`
    - `-- RUN 2/3 ISO=GBL ...`
    - `-- RUN 3/3 ISO=FRA ...`
  - Pipeline logs appear per run under `POST/WORK/log/` (standard pipeline logging).

Dry-run (no side effects)
- Set `batch.DRY_RUN=true` to verify discovery and ISO mapping without executing the pipeline.
- The batch log will list each `data_*.json` and `ISO=...` it would run. No project resets/closing and no phase execution occur.

Save on close policy (simplified)
- Purpose: one option controls save/no-save for every run, including the final close.
- Option (inside the `batch` namespace):
  - `SAVE_AFTER_RUN` (boolean, default `false`)
    - Determines close behavior after each run and at the end:
      - `true`  → close with `force-save`
      - `false` → close with `force-no-save`
    - Step 2 (Save As `name_<ISO>.aep`) is unaffected by this flag.
- Logging
  - After each run and at the final close, the batch log includes: `Closed with: force-save` or `Closed with: force-no-save`.
- Minimal snippet
```json
{
  "batch": {
    "SAVE_AFTER_RUN": true
  }
}
```


Batch options quick reference

| Option                     | Type (default)          | Description |
|----------------------------|-------------------------|-------------|
| DATA_FS_SUBPATH            | array (['IN','data'])   | Where to look under POST for data files. Usually ['IN','data']. |
| FILE_PREFIX                | string ('data_')        | Prefix for data files (e.g., data_ESP.json). |
| FILE_SUFFIX                | string ('.json')        | Suffix/extension for data files. |
| RUNS_MAX                   | number (0)              | Maximum runs to execute; 0 processes all discovered files. |
| SLEEP_BETWEEN_RUNS_MS      | number (500)            | Stabilization sleep between runs (milliseconds). |
| DRY_RUN                    | boolean (false)         | List planned runs only; do not execute pipeline; skip save/close and reopen. |
| SAVE_AFTER_RUN             | boolean (false)         | Save-on-close policy for each run and final close: true=force-save, false=force-no-save. |


Changelog since “Integration 70 - logging - rotation”
- Path/template decoupling: output path is set regardless of preset availability.
- ISO preference: Step 7 now prefers ISO from Step 1 (link_data), then filename, then disk scan.
- Header clarity: Step 7 header shows `ISO(Step1)=...` with origin.
- Template diagnostics: explicit `TEMPLATE SKIP (no map)`, `TEMPLATE FAIL ...`, `TEMPLATE NONE ...`, `TEMPLATE DEFAULT ...` messages.
- Robust logging: introduced safe error stringification to prevent AE host Error objects from breaking logs.
- New AME options: `APPLY_TEMPLATES`, `AUTO_DISABLE_REAPPLY_ON_MISSING`, `OUTPUT_MODULE_TEMPLATE*` mappings, all overridable via preset.
- Logging controls: `VERBOSE_DEBUG` to gate selection/DETAIL; `COMPACT_ITEM_DETAIL` for a one‑line per‑item summary, independent of verbose mode.
- Detail capping UX: selection “RQ add ->” moved out of the capped DETAIL block; reliable `... (X more) ...` footer when truncated.

Changelog since “Integration 100”
- Template selection
  - Implemented Solution C (AR + duration) with strict mode; documented toggles in `TEMPLATE_MATCH_CONFIG`.
- Add-layers parenting
  - Fixed parenting crash with cycle-safe guard; skip with reason when self/descendant.
  - Robust new-layer detection via before/after layer-reference diffing to correctly map template children to copied target layers.
  - Parenting at a reference time (default 0s) to avoid offsets under animated parents; configurable modes and custom seconds.
  - Debug gates: planned vs actual parenting dump; optional transform readbacks; optional template-vs-target local Position comparison at ref time.
- Extras
  - Added extras pipeline: duplicate eligible comps and apply extra templates (e.g., TikTok); controlled by `addLayers.EXTRA_TEMPLATES`.
  - Pack integrates extras by overriding `MEDIA` token from the suffix to avoid naming collisions and improve clarity.
- Pack outputs
  - Resilient videoId detection (token-before-duration with fallback), shared with Step 3 for parity.
  - Concise summary enhanced with skip counts and timing metrics; optional dev self-test for mappings.
- Logging ergonomics
  - Introduced global `LOG_MARKER` at pipeline level; all steps use an ASCII-safe marker for bullets (sanitized to avoid garbled characters).

Changelog since “Integration 125 - Extra template - EXTRA_EXPORT_SUBFOLDER”
- Step 7: Extras detection and routing
  - Improved detection: considers the configured extra suffix token anywhere in the name, `TAG_TOKENS` anywhere, with a strict suffix fallback; normalization is case-insensitive and alphanumeric-only for reliable matching.
  - Extras routing updated: extras now export into a sibling folder at the AR level — `<date>/<AR>_<extraName>/` — instead of nesting under the AR/duration tree. The `<duration>` level is still applied inside that folder when duration subfolders are enabled.
- Step 7: Duration subfolder toggle
  - Added `ame.ENABLE_DURATION_SUBFOLDER` (default `true`). When set to `false`, omit the `<duration>` level entirely.
  - Structures:
    - ON (default): `.../<AR>/<duration>/...` and `.../<AR>_<extraName>/<duration>/...`
    - OFF: `.../<AR>/...` and `.../<AR>_<extraName>/...`
- Step 7: Logging
  - ENV header now includes `DurationSubfolders=true|false` for quick verification.

Changelog since “Integration 134”
- Preset loader
  - Prefers DEV override first when `script/ae/config/.use_dev_preset` exists; logs “DEV override active; skipping POST/WORK checks.”
  - Echoes loader status lines into the unified pipeline log.
- Step 0/8 orchestration
  - Early bootstrap: if no project is open and `RUN_open_project=true`, Step 0 runs before headers/logging to avoid “Object is invalid”.
  - Step 8 added with `closeProject.CLOSE_MODE` (prompt/force-save/force-no-save).
- Batch Phase 2
  - New `script/ae/batch_orchestrator.jsx` iterates `data_*.json`, overrides per-run ISO, sleeps between runs, resets to the template each iteration, and closes after each run and at the end using the unified `SAVE_AFTER_RUN` policy.
  - ISO extraction is now anchored to the configured `FILE_PREFIX`/`FILE_SUFFIX` to avoid mismatches; prevents looking up the wrong `data_<ISO>.json`.
  - Added `batch.DRY_RUN` to allow “dry verification” with zero side effects.
# AE Pipeline options: quick guide
