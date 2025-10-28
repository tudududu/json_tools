# AE Pipeline options: quick guide

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

Changelog since “Integration 70 - logging - rotation”
- Path/template decoupling: output path is set regardless of preset availability.
- ISO preference: Step 7 now prefers ISO from Step 1 (link_data), then filename, then disk scan.
- Header clarity: Step 7 header shows `ISO(Step1)=...` with origin.
- Template diagnostics: explicit `TEMPLATE SKIP (no map)`, `TEMPLATE FAIL ...`, `TEMPLATE NONE ...`, `TEMPLATE DEFAULT ...` messages.
- Robust logging: introduced safe error stringification to prevent AE host Error objects from breaking logs.
- New AME options: `APPLY_TEMPLATES`, `AUTO_DISABLE_REAPPLY_ON_MISSING`, `OUTPUT_MODULE_TEMPLATE*` mappings, all overridable via preset.
- Logging controls: `VERBOSE_DEBUG` to gate selection/DETAIL; `COMPACT_ITEM_DETAIL` for a one‑line per‑item summary, independent of verbose mode.
- Detail capping UX: selection “RQ add ->” moved out of the capped DETAIL block; reliable `... (X more) ...` footer when truncated.
