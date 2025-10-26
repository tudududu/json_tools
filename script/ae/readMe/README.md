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
- When enabled, Step 4 checks the audio filename’s token 3 as a 3‑letter ISO (e.g., `AlBalad_06s_ENG_v02_...` -> `ENG`) against the project ISO.
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
