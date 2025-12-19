// Default pipeline options and builder
// Usage: $.evalFile(pipeline_options.jsx); var OPTS = AE_PIPELINE_OPTIONS.build(AE_PIPE && AE_PIPE.options);

(function(){
    if (typeof AE_PIPELINE_OPTIONS !== 'undefined') return; // idempotent

    // Require utils
    if (typeof AE_OPTS_UTILS === 'undefined') {
        // Expect options_utils.jsx to be evaluated by the integrator before this file
        AE_OPTS_UTILS = {
            optBool: function(o,k,d){ try{ var v=o&&o[k]; if(typeof v==='boolean') return v; if(typeof v==='string'){var s=v.toLowerCase(); if(s==='true'||s==='1'||s==='yes'||s==='on') return true; if(s==='false'||s==='0'||s==='no'||s==='off') return false;} }catch(e){} return d; },
            optNum: function(o,k,d){ try{ var v=o&&o[k]; if(typeof v==='number'&&!isNaN(v)) return v; if(typeof v==='string'){var n=parseFloat(v); if(!isNaN(n)) return n;} }catch(e){} return d; },
            optStr: function(o,k,d){ try{ var v=o&&o[k]; if(typeof v==='string') return v; if(v===null||v===undefined) return d; return String(v);}catch(e){} return d; },
            // deepMerge semantics:
            // - Plain objects are merged recursively (left = defaults, right = user overrides).
            // - Arrays and non-objects are REPLACED (not concatenated/merged). This is intentional to avoid
            //   surprising partial merges of ordered lists. If a preset provides an array, it fully overrides
            //   the default array at that key.
            deepMerge: function(a,b){ if(!b) return a; if(!a) return b; var o={}; function isObj(x){return x&&typeof x==='object'&&!(x instanceof Array);} for(var k in a) if(a.hasOwnProperty(k)) o[k]=a[k]; for(var k2 in b) if(b.hasOwnProperty(k2)){ var av=o[k2], bv=b[k2]; if(isObj(av)&&isObj(bv)) o[k2]=AE_OPTS_UTILS.deepMerge(av,bv); else o[k2]=bv; } return o; }
        };
    }

    var Defaults = {
        //
        // Merge/override rules (applied by AE_PIPELINE_OPTIONS.build using deepMerge):
        // - The user (preset) object is merged over Defaults.
        // - Plain objects are merged recursively.
        // - Arrays are replaced as a whole (no concatenation/union).
        //   Example: Defaults.linkData.DATA_JSON_FS_SUBPATH = ["IN","data"].
        //            If preset sets ["IN","meta"], the result is exactly ["IN","meta"].
        // - Primitive values (string/number/boolean/null) replace Defaults.
        //
        // Common toggles to consider
        ENABLE_FILE_LOG: true,
        // Master switch: when false, all per-phase ENABLE_FILE_LOG toggles are forcibly disabled regardless of per-phase setting.
        PHASE_FILE_LOGS_MASTER_ENABLE: true,
        DRY_RUN: false,
        PIPELINE_QUEUE_TO_AME: true,
        VERBOSE: false,
        DEBUG_DUMP_EFFECTIVE_OPTIONS: false,
        sleepBetweenPhasesMs: 0,
        ENABLE_FINAL_ALERT: true,

        // Phase run toggles (default ON). Names mirror script files for recognisability.
        RUN_open_project: false,
        RUN_link_data: true,
        RUN_save_as_iso: true,
        RUN_create_compositions: true,
        RUN_insert_and_relink_footage: true,
        RUN_add_layers_to_comp: true,
        RUN_pack_output_comps: true,
        RUN_set_ame_output_paths: true,
        RUN_close_project: false,

        // When true, phases may forward selected messages into the unified pipeline log
        PHASES_SHARE_PIPELINE_LOG: false,
        // Pipeline logger controls
        LOG_WITH_TIMESTAMPS: false,
        PIPELINE_FILE_LOG_APPEND_MODE: false,
        PIPELINE_FILE_LOG_PRUNE_ENABLED: true,
        // Unified log pruning controller for all pipeline and phase log families
        LOG_MAX_FILES: 24,
        // Pipeline log content controls
        PIPELINE_SHOW_PHASE_TAGS: true,
        PIPELINE_SHOW_LEVELS: true,
        // ASCII-safe marker for bullets/indented list items across all steps. Examples: "*", "-", ">".
        LOG_MARKER: "*",

        // Phase-specific namespaces
        openProject: {
            // Absolute path to the .aep template to open. If empty, and a project is currently open,
            // the script will attempt to auto-discover the newest .aep under POST/WORK of the current project.
            PROJECT_TEMPLATE_PATH: "",
            // Behavior when another project is open at the time of opening the template.
            //  - abort: do nothing and abort Step 0
            //  - prompt: let AE prompt to save/discard current project (interactive)
            //  - force-no-save: close current project without saving, then open template
            OPEN_IF_DIRTY_BEHAVIOR: "prompt"
        },
        linkData: {
            ENABLE_RELINK_DATA_JSON: true,
            DATA_JSON_ISO_MODE: "manual",             // "auto" | "manual"
            DATA_JSON_ISO_CODE_MANUAL: "SAU",
            DATA_JSON_LANG_CODE_MANUAL: "",
            DATA_JSON_PROJECT_FOLDER: ["project","in","data"],
            DATA_JSON_PROJECT_ITEM_NAME: "data.json",
            DATA_JSON_FS_SUBPATH: ["IN","data"],
            DATA_JSON_FILE_PREFIX: "data_",
            DATA_JSON_FILE_SUFFIX: ".json",
            DATA_JSON_IMPORT_IF_MISSING: true,
            DATA_JSON_RENAME_IMPORTED_TO_CANONICAL: true,
            DATA_JSON_LOG_VERBOSE: true
        },
        // New phase: Save As (include ISO)
        saveAsISO: {
            OVERWRITE: false,     // If true, overwrite existing <name>_<ISO>.aep; otherwise append _<runId>
            iso: ""              // Optional explicit ISO override when Step 1 result is unavailable
        },
        createComps: {
            ENABLE_FILE_LOG: true,
            DEFAULT_STILL_DURATION: 5,
            ENABLE_MARKER_TRIM: false,
            SKIP_IF_COMP_EXISTS: true,
            // New: automatic footage scan mode (project panel path)
            AUTO_FROM_PROJECT_FOOTAGE: false,
            FOOTAGE_PROJECT_PATH: ["project","in","footage"],
            FOOTAGE_DATE_YYMMDD: "", // empty => pick newest YYMMDD folder under FOOTAGE_PROJECT_PATH
            INCLUDE_SUBFOLDERS: true,
            SKIP_INVALID_DIMENSIONS: false,
            ENABLE_COMP_MOTION_BLUR: false,      // when true, set comp.motionBlur = true for created comps
	        ENABLE_COMP_FRAME_BLENDING: false,    // when true, set comp.frameBlending = true for created comps
            // Gate: allow AE CompItem as source (treated like footage; added as precomp layer)
            ENABLE_ACCEPT_COMP_SOURCE: true    // when true, selected CompItems are processed similarly to footage
        },
        insertRelink: {
            ENABLE_FILE_LOG: true,
            ENABLE_ALIGN_AUDIO_TO_MARKERS: false,
            ENABLE_REMOVE_EXISTING_AUDIO_LAYERS: true,
            ENABLE_MUTE_EXISTING_AUDIO_LAYERS: true,
            CLEAR_EXISTING_PROJECT_SOUND_FOLDER: true,

            // New: audio filename ISO check
            ENABLE_CHECK_AUDIO_ISO: false,            // Phase 1: when true, check token3 (ISO) in audio filename vs project ISO
            CHECK_AUDIO_ISO_STRICT: false,            // Phase 2: when true and check is enabled, alert+abort on mismatch; when false, log warning only
            // New: import from ISO-named subfolder under SOUND/<YYMMDD>/ when present
            SOUND_USE_ISO_SUBFOLDER: false,
            // Flat-mode soft fallback: if no top-level files in YYMMDD and this is true, use ISO-named subfolder instead
            SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER: false,
            // Flat-mode strict behavior: when no top-level files and ISO subfolder is not available, abort pipeline (set fatal)
            SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER: false,
            AUDIO_TITLE_TOKEN_COUNT: 2, // default keeps backward compatibility (token01_token02_duration)
            // New: optional strict adjacency for tokens (require tokens to appear contiguously with underscores before duration)
            AUDIO_TOKENS_REQUIRE_ADJACENT: false // default false preserves lenient matching

        },
        addLayers: {
            // Simple mode: instead of copying individual layers from the template into targets,
            // insert the entire template comp as a single (precomp) layer into each target.
            // When enabled, you can choose to mute audio on the inserted template layer (default: true).
            SIMPLE_INSERT_TEMPLATE_AS_LAYER: false,
            SIMPLE_MUTE_TEMPLATE_AUDIO: true,
            // Simple-mode companion options to adjust the target comp
            // - SIMPLE_SOLO_INSERTED_LAYER: when true, solo the inserted template layer
            // - SIMPLE_PREP_REMOVE_ALL_LAYERS: when true, remove all existing layers in the target before insert (destructive)
            // - SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO: when true, disable visibility for FootageItem layers before insert
            // - SIMPLE_PREP_MUTE_FOOTAGE_AUDIO: when true, mute audio for FootageItem layers before insert
            SIMPLE_SOLO_INSERTED_LAYER: false,
            SIMPLE_PREP_REMOVE_ALL_LAYERS: false,
            SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO: false,
            SIMPLE_PREP_MUTE_FOOTAGE_AUDIO: false,
            // Auto-center any un-parented layers when the target AR differs from the template.
            // When false, no auto-centering is attempted unless explicitly forced by recenterRules (see LAYER_NAME_CONFIG in the script).
            ENABLE_AUTOCENTER_ON_AR_MISMATCH: true,
            // Template picking configuration (Solutions A/B/C)
            //  A) Single template: keep a single template comp under TEMPLATE_FOLDER_PATH (implicit)
            //  B) Multiple templates — match AR: the picker prefers AR within tolerance; optionally require AR match
            //  C) Multiple templates — match AR & duration: when enabled, duration proximity is considered (and can be required)
            TEMPLATE_MATCH_CONFIG: {
                // Solution B (AR)
                // Acceptable absolute delta between template AR (width/height) and target AR.
                arTolerance: 0.001,
                // When true, only candidates within arTolerance are considered; otherwise AR closeness is preferred but not required.
                requireAspectRatioMatch: false,
                // Solution C (AR + Duration)
                // Master toggle to include duration in scoring/selection.
                enableDurationMatch: false,
                // When true (and enableDurationMatch is true), only candidates within durationToleranceSeconds are considered.
                requireDurationMatch: false,
                // Allowed absolute difference (in seconds) between template comp duration and target comp duration.
                durationToleranceSeconds: 0.50
            },
            // Extra template outputs (e.g., special layout for TikTok on 9x16)
            // When enabled, the script duplicates eligible target comps and applies layers from an "extra" template variant
            // identified by TAG_TOKENS in the template comp name. The duplicate's name gets OUTPUT_NAME_SUFFIX and will flow
            // through subsequent steps (pack/AME) like any other comp.
            EXTRA_TEMPLATES: {
                // Master enable for creating extra outputs.
                ENABLE_EXTRA_TEMPLATES: false,
                // Restrict extras to specific AR keys. Empty array => allow all. Keys typically: "1x1","4x5","9x16","16x9".
                ALLOWED_AR: ["9x16"],
                // Case-insensitive tokens that mark a template comp as an "extra" variant (any token match qualifies).
                // Example: ["EXTRA","TIKTOK"] will classify comps whose names contain those tokens as extra templates.
                TAG_TOKENS: ["EXTRA"],
                // Suffix appended to duplicated comp names for the extra output (also used implicitly for routing/matching).
                OUTPUT_NAME_SUFFIX: "_extra",
                // Duration strictness for extras (overrides TEMPLATE_MATCH_CONFIG when set).
                // When true, an extra is created only if a template within DURATION_TOLERANCE_SECONDS exists; otherwise skip.
                REQUIRE_DURATION_MATCH: null,           // null => inherit TEMPLATE_MATCH_CONFIG.requireDurationMatch
                DURATION_TOLERANCE_SECONDS: null,       // null => inherit TEMPLATE_MATCH_CONFIG.durationToleranceSeconds
                // Behavior when no extra template is present or strict duration matching fails.
                // true => silently skip creating extra (default); false => still skip but can be used to enforce different logging later.
                FALLBACK_WHEN_NO_EXTRA: true
            },
            // Skip-copy behavior for template layers. When a flag resolves to OFF for a target, the matching template layers
            // are not copied into the target. Also supports group-based and ad-hoc token-based skips.
            SKIP_COPY_CONFIG: {
                disclaimerOff: true, 
                disclaimer02Off: true,
                subtitlesOff: true,
                logoAnimOff: true,
                logo02Off: true,
                claim01Off: true,
                claim02Off: true,
                // Base logo layers that must always be copied regardless of flags (case-insensitive exact names).
                alwaysCopyLogoBaseNames: ["Size_Holder_Logo"],
                // Group-based skip using LAYER_NAME_CONFIG keys. When enabled, any layers matching these groups are skipped.
                groups: {
                    enabled: false,
                    keys: [] // e.g., ["info", "claim"]
                },
                // Ad-hoc skip list using name tokens (case-insensitive contains match). Useful for quick one-offs.
                adHoc: {
                    enabled: false,
                    tokens: [] // e.g., ["template_aspect", "debug"]
                }
            },
            APPLY_INPOINT_TO_LAYER_STARTTIME: true,
            // Config: Layer name configuration (case-insensitive)
            // - exact: list of layer names to match exactly
            // - contains: list of substrings; if present in layer name, it's a match
            // - imageOnlyForContains (logo only): when true, a 'contains' match is valid only for image/bitmap footage layers
            // Adjust these lists to match your template naming conventions.
            LAYER_NAME_CONFIG: {
                info: {
                    exact: ["info"],
                    contains: ["info"]
                },
                logo: {
                    exact: ["Size_Holder_Logo"],
                    contains: ["logo"],
                    imageOnlyForContains: false
                },
                logo_02: {
                    exact: ["Size_Holder_Logo_02", "logo_static"],
                    contains: [],
                    imageOnlyForContains: false
                },
                // Specific match for animated logo variant to distinguish from generic 'logo'
                logoAnim: {
                    exact: ["logo_anim", "Size_Holder_Logo"],
                    contains: ["logo_anim"]
                },
                claim: {
                    exact: ["claim", "Size_Holder_Claim", "web", "__scaler__null__"],
                    contains: []
                },
                disclaimer: {
                    exact: ["disclaimer", "Size_Holder_Disclaimer"],
                    contains: []
                },
                disclaimer02: {
                    exact: ["disclaimer_02"],
                    contains: []
                },
                subtitles: {
                    exact: [],
                    contains: ["subtitles"]
                },
                super_A: {
                    exact: ["super_A", "Size_Holder_Super_A"],
                    contains: ["super_A"]
                },
                dataJson: {
                    exact: ["DATA_JSON", "data.json"],
                    contains: []
                },
                // Auto-center exceptions and alignment rules (case-insensitive exact names)
                recenterRules: {
                    // If all arrays are empty, all un-parented layers will be auto-centered (default behavior).
                    // noRecenter entries will be skipped from auto-centering.
                    // force entries will be auto-centered regardless (useful if default changes in future).
                    // alignH/alignV will align X/Y to center after the re-centering step (or even if re-centering is skipped).
                    force: [],        // e.g., ["Logo", "Brand_Safe"]
                    noRecenter: [],   // e.g., ["BG", "DoNotCenter"]
                    alignH: [],       // e.g., ["Claim", "CTA"]
                    alignV: []        // e.g., ["Disclaimer"]
                }
            },

            // TIMING_BEHAVIOR: declarative timing control
            // Values: 'timed' => apply JSON min/max; 'span' => force full comp duration; 'asIs' => keep template timing.
            // Keys may be LAYER_NAME_CONFIG group keys OR literal layer names (case-insensitive exact).
            TIMING_BEHAVIOR: {
                // JSON timed groups
                logo: 'timed',
                logoAnim: 'timed',
                claim: 'timed',
                // Disclaimers default to span (full duration)
                disclaimer: 'span',
                disclaimer_02: 'span', // raw name variant
                disclaimer02: 'span',  // group key variant
                // Span groups / literals
                subtitles: 'span',
                dataJson: 'span',
                info: 'span',
                template_aspect: 'span',
                center: 'span',
                super_A: 'span',
                // Literal layer names
                'Size_Holder_Subtitles': 'span',
                'DATA_JSON': 'span',
                'data.json': 'span',
                'Size_Holder_Super_A': 'span',
                'Pin': 'span'
            },

            // TIMING_ITEM_SELECTOR: choose which item in each JSON timing array supplies the timing span when a layer/group is 'timed'.
            // Supported selector modes per key:
            //   { mode:'line', value:<lineNumber> }      -> pick object whose .line === value
            //   { mode:'index', value:<zeroBasedIndex> } -> pick array[value] directly
            //   { mode:'minMax' }                        -> fallback aggregate min(in)/max(out) (legacy default)
            // If omitted or invalid, we fallback to minMax aggregation.
            // Zero-length (in==out) selections are returned as-is (layer trimmed to an instant); callers may ignore if not useful.
            TIMING_ITEM_SELECTOR: {
                // Example (override via options): logo: { mode: 'line', value: 1 }
                logo: { mode: 'line', value: 1 }
            },

            // One-off parenting debug gate (OFF by default). When enabled, logs all planned and actual
            // child->parent assignments for a comp. You can limit to specific target comp names via
            // DEBUG_PARENTING_DUMP_ONLY_COMPS (exact matches). Optional transform logging is gated too.
            DEBUG_PARENTING_DUMP: false,
            DEBUG_PARENTING_DUMP_ONLY_COMPS: [],
            DEBUG_PARENTING_DUMP_WITH_TRANSFORM: false,
            DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET: false, // compare template child local Position vs target after-parenting
            // Note: LOG_MARKER moved to pipeline general level for cross-step consistency

            // Parenting behavior: assign parents at a stable reference time to avoid time-dependent offsets
            // when parent has animated transforms. Default: use 0s.
            PARENTING_ASSIGN_AT_REF_TIME: true,
            PARENTING_REF_TIME_MODE: "zero", // 'zero' | 'current' | 'inPoint' | 'custom'
            PARENTING_REF_TIME_SECONDS: 0.0, // used when mode='custom'
            // Per-phase file logging
            ENABLE_FILE_LOG: true,
            // Pipeline log controls for Step 3
            PIPELINE_SHOW_CONCISE_LOG: true,
            PIPELINE_SHOW_VERBOSE_LOG: false
        },
        pack: {
            ENABLE_FILE_LOG: true,  // Per-phase master switch for any file logs
            DRY_RUN_MODE: false,    // When true: do NOT create folders or comps; only log what would happen
            ENABLE_DETAILED_FILE_LOG: false,    // Master flag for detailed log
            SUPPRESS_FILE_LOG_WHEN_NOT_DRY_RUN: true, // If true, disables detailed file log when DRY_RUN_MODE == false
            DEBUG_NAMING: false,                      // When true: verbose logging for each token (detailed log only)
            ENABLE_SUMMARY_LOG: true,   // Produce a summary-only log (names list)
            USE_PROJECT_LOG_FOLDER: true,             // Try to write logs under project ./log/ folder
            PROJECT_LOG_SUBFOLDER: "log",             // Subfolder name
            DEV_VIDEOID_SELF_TEST: false,             // Dev-only: when true, logs sample name -> videoId mappings
            DEV_VIDEOID_SELF_TEST_USE_SELECTION: false, // When true, also log mappings for selected/auto-selected comps

            OUTPUT_ROOT_PATH: ["project", "out"],   // Base output path
            ANCHOR_SOURCE_FOLDER: "comps",           // Mirror segments AFTER this folder
            APPEND_SUFFIX: "_OUT",                   // Suffix for delivery/export comps
            ENABLE_SUFFIX_APPEND: false,        // Toggle: when false, do NOT append APPEND_SUFFIX even if OUTPUT_NAME_CONFIG.appendSuffix is true
            ENSURE_UNIQUE_NAME: true,           // If a name collision occurs, append numeric counter
            SKIP_IF_ALREADY_IN_OUTPUT: true,          // Avoid recursion
            SKIP_IF_OUTPUT_ALREADY_EXISTS: true,    // If an output comp with the expected base name already exists in dest folder, skip instead of creating _01
            DATA_JSON_PRIMARY_NAME: 'data.json',      // Primary expected data JSON name (moved here so ordering stays logical)
            // Pipeline log controls for Step 4
            PIPELINE_SHOW_CONCISE_LOG: true,
            PIPELINE_SHOW_VERBOSE_LOG: false,
                // Extra output comps (alternate resolutions)
            ENABLE_EXTRA_OUTPUT_COMPS: false,         // Master toggle
            EXTRA_OUTPUT_COMPS: {},                   // Map: "AR|NNs" -> "WxH" string
            EXTRA_OUTPUTS_USE_DATE_SUBFOLDER: true    // Place extras under out/YYMMDD/AR_WxH
        },
        ame: {
            ENABLE_FILE_LOG: true,
            PROCESS_SELECTION: true,
            PROCESS_EXISTING_RQ: true,
            AUTO_QUEUE_IN_AME: true,
            AME_MAX_QUEUE_ATTEMPTS: 3,
            AME_RETRY_DELAY_MS: 650,
            FILE_LOG_APPEND_MODE: true,
            // Base export path relative to POST/ (segments or string). Default: POST/OUT/PREVIEWS
            EXPORT_SUBPATH: ["OUT","PREVIEWS"],
            // Extras routing: when true, items created from an extra template are routed into a subfolder named
            // "<AR>_<extraName>" (e.g., 9x16_tiktok) under the AR/duration path. The extra name is derived from
            // addLayers.EXTRA_TEMPLATES.OUTPUT_NAME_SUFFIX (leading underscore removed).
            EXTRA_EXPORT_SUBFOLDER: false,
            // 5c. Duration-level subfolder toggle
            ENABLE_DURATION_SUBFOLDER: true,           // When false, place exports directly under <AR> (or <AR>_<extra>) without <duration>
            USE_LANGUAGE_SUBFOLDER: false,
            // When true (default), if an Output Module already has a file set, reuse its base name as the output filename base.
            // When false, always derive the base name from the comp name (only reuse extension from OM if present).
            USE_OM_FILENAME_AS_BASE: true,

            // Logging toggles for Step 7 (AME)
            VERBOSE_DEBUG: true,             // Gates selection/RQ add logs and DETAIL block
            COMPACT_ITEM_DETAIL: false,      // When true, log one compact per-item line (ASSIGN+DEST [+tpl]) inside DETAIL (independent of VERBOSE_DEBUG)
            // Step 7 (AME) template controls
            // Master switch: apply any Output Module templates; when false, script only sets output paths and skips template operations
            APPLY_TEMPLATES: true,
            // Dynamic Output Module selection by AR and/or AR|duration
            ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION: true,
            // Reapply the chosen template right before queueing to AME (helps inheritance). Can be noisy on missing presets.
            DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES: true,
            // If any mapped/default preset is missing, auto-disable the reapply pass to reduce log noise.
            AUTO_DISABLE_REAPPLY_ON_MISSING: true,
            // Default Output Module template name (string). Leave empty to use AE's current default.
            OUTPUT_MODULE_TEMPLATE: "",
            // Template mapping by Aspect Ratio (keys like "1x1", "16x9", "9x16").
            // Example: { "1x1": "25Mbs", "16x9": "YouTube_1080p" }
            OUTPUT_MODULE_TEMPLATE_BY_AR: {},
            // Optional template mapping by "AR|duration"; overrides AR-only when present. Keys like "1x1|06s"
            OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION: {},
            // 5e. Mimic AE project panel folder structure under date folder
            MIMIC_PROJECT_FOLDER_STRUCTURE: true,
            PROJECT_FOLDER_ANCHOR_NAME: "out" // anchor folder name to cut at (case-insensitive)
        }
        ,
        closeProject: {
            // How to close the project at the end of the pipeline.
            //  - prompt: allow AE to prompt user (interactive)
            //  - force-save: save current project (if possible) then close without further prompts
            //  - force-no-save: close without saving
            CLOSE_MODE: "force-no-save"
        }
    };

    AE_PIPELINE_OPTIONS = {
        defaults: Defaults,
        build: function(user) {
            // Deep merge user options over defaults.
            // Array semantics: arrays from "user" REPLACE arrays in Defaults (no deep merge of arrays).
            var merged = AE_OPTS_UTILS.deepMerge(Defaults, user || {});
            return merged;
        }
    };
})();
