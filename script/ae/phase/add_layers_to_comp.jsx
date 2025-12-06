// Script for Adobe After Effects — Add layers to composition from a template comp
// ——————————————————————————————————————————————————————————————
// What it does
// 1) Finds the template composition under a configurable Project panel path (default: ./project/work/template/)
//    Expected template name pattern: title_duration_template_YYMMDD_vNN
//    Example: WTA_30s_template_250923_v01
// 2) Copies ALL layers from the template EXCEPT the underlying video footage layer
//    defined as: the highest layer index whose source is a FootageItem with video
// 3) Pastes/copies those layers into the selected compositions, preserving order and timing
//
// Configuration notes
// - TEMPLATE_FOLDER_PATH: where the template comp lives in the Project panel tree
// - TIMING_BEHAVIOR: map choosing 'timed' | 'span' | 'asIs' per group or literal layer name.
//   Replaces legacy ENABLE_JSON_TIMING_FOR_DISCLAIMER & FULL_DURATION_LAYER_GROUPS.
//   Default: disclaimer & disclaimer_02 => 'span'; logo/logoAnim/claim => 'timed'; subtitles/dataJson/super_A/info/template_aspect/center => 'span'.
// - LAYER_NAME_CONFIG: identification lists for logo/claim/disclaimer/subtitles/dataJson/super_A etc.
// - JSON wiring: videoId derived from comp name; applies min/max for groups with 'timed' behavior.
//   Visibility flags: disclaimer_flag, disclaimer_02_flag, subtitle_flag, logo_anim_flag (y/n/1/0 values).
// - DATA_JSON/data.json layers span full duration via TIMING_BEHAVIOR.
// - TEMPLATE_MATCH_CONFIG: controls picking the best template comp for each target comp (Solution B)
//   arTolerance: numeric tolerance used to treat two aspect ratios as equal (default: 0.001)
//   requireAspectRatioMatch: when true, only templates within arTolerance are eligible; if none found, target is skipped
//
// Usage
// - Select one or more target comps (or make one active) and run this script.
// - Ensure a template comp exists under ./work/template/ as described above.

// Pipeline detection and API namespace
var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_AddLayers === 'undefined') { var AE_AddLayers = {}; }

function __AddLayers_coreRun(opts) {
    app.beginUndoGroup("Add Layers From Template");

    // ---------------- Logging Configuration ----------------
    // Enable/disable file logging and customize location.
    // By default tries to place logs under ./project/work/log relative to the project panel root.
    var ENABLE_FILE_LOG = true;                  // Master toggle for file logging
    var LOG_PATH_SEGMENTS = ["project","log"]; // Relative folder chain under project rootFolder
    var LOG_FILENAME_PREFIX = "add_layers_to_comp";      // Base filename prefix
    var SUPPRESS_CONSOLE_LOG = false;            // If true, only file logging (no $.writeln)
    var __logFile = null;                        // File handle once resolved
    // Pipeline log controls (whether to forward logs to AE_PIPE.log)
    var PIPELINE_SHOW_CONCISE_LOG = true;  // used by orchestrator; kept for consistency
    var PIPELINE_SHOW_VERBOSE_LOG = false; // when false in pipeline, suppress forwarding verbose phase logs

    function __buildTimestamp(){ var d=new Date(); function p(n){return (n<10?'0':'')+n;} return d.getFullYear()+''+p(d.getMonth()+1)+''+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); }

    function __findOrCreateLogFolder(){
        if(!ENABLE_FILE_LOG) return null;
        try {
            if(!app.project || !app.project.rootFolder) return null;
            var cur = app.project.rootFolder;
            // Walk down segments, creating if necessary
            for(var i=0;i<LOG_PATH_SEGMENTS.length;i++){
                var seg = LOG_PATH_SEGMENTS[i]; if(!seg) continue;
                var found=null;
                for(var j=1;j<=cur.numItems;j++){ var it=cur.items[j]; if(it instanceof FolderItem && String(it.name)===seg){ found=it; break; } }
                if(!found){ try { found = app.project.items.addFolder(seg); found.parentFolder = cur; } catch(eC) { found=null; } }
                if(!found) return null; // fail early
                cur = found;
            }
            // cur now represents an AE FolderItem; convert to disk folder relative to project file if possible
            // We'll attempt to use the project file path; if project unsaved fallback to desktop
            var baseFolder = null;
            try { if(app.project.file && app.project.file.parent) baseFolder = app.project.file.parent; } catch(ePF) {}
            if(baseFolder){
                // Build physical path .../<projectDir>/work/log or nested chain after removing initial 'project'
                var phys = baseFolder.fsName; // project folder path
                // If first segment is 'project', skip it for disk path (since project.file.parent already is that folder)
                var startIdx = 0; if(LOG_PATH_SEGMENTS.length && LOG_PATH_SEGMENTS[0]==='project') startIdx = 1;
                for(var si=startIdx; si<LOG_PATH_SEGMENTS.length; si++){
                    phys += '/' + LOG_PATH_SEGMENTS[si];
                    var testF = new Folder(phys); if(!testF.exists) { try { testF.create(); } catch(eMk) {} }
                }
                var finalF = new Folder(phys);
                if(finalF.exists) return finalF;
            }
        } catch(eF) {}
        try { return Folder.desktop; } catch(eD) {}
        try { return Folder.temp; } catch(eT) {}
        return null;
    }

    (function __initLog(){
        if(!ENABLE_FILE_LOG) return;
        var folder = __findOrCreateLogFolder();
        if(!folder) return;
        var ts = __buildTimestamp();
        try { __logFile = new File(folder.fsName + '/' + LOG_FILENAME_PREFIX + '_' + ts + '.log'); } catch(eLF) { __logFile = null; }
    })();

    function __writeFileLine(line){ if(!__logFile) return; try { if(__logFile.open('a')) { __logFile.write(line + '\n'); __logFile.close(); } } catch(eWF) { try { __logFile.close(); } catch(eC) {} } }

    // Tagged logger (lazily initialized so it can see parsed options)
    var __logger = null;

    function log(msg) {
        // Always write to file when enabled
        if(ENABLE_FILE_LOG) __writeFileLine(msg);
        // Prefer shared tagged logger but respect verbose gating for pipeline forwarding
        try {
            if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') {
                var share = false;
                try { share = (__AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASES_SHARE_PIPELINE_LOG === true && PIPELINE_SHOW_VERBOSE_LOG === true); } catch(eSh) { share = false; }
                var lg = __AE_PIPE__.getLogger('add_layers', { forwardToPipeline: share });
                try { lg.info(msg); } catch(eL) {}
                return;
            }
        } catch(eLG2) {}
        if (!SUPPRESS_CONSOLE_LOG) { try { $.writeln(msg); } catch(eC2) {} }
    }
    function alertOnce(msg) { if (__AE_PIPE__) { log(msg); return; } try { alert(msg); } catch (e) {} }
    // One-time alert guards for skip warnings
    var __AR_SKIP_ALERT_SHOWN = false;
    var __DUR_SKIP_ALERT_SHOWN = false;

    var proj = app.project;
    if (!proj) { alertOnce("No project open."); app.endUndoGroup(); return; }


    // Config: set the template folder path here (segments under Project panel Root)
    var TEMPLATE_FOLDER_PATH = ["project", "work", "template"]; // e.g., ["project","work","template"]
    // (Deprecated) Disclaimer timing toggle removed; use TIMING_BEHAVIOR to control timing.
    // Auto-center un-parented layers when aspect ratio differs from template
    var ENABLE_AUTOCENTER_ON_AR_MISMATCH = true;
    // Template picking config
    // Solutions:
    //  A) Single template: point TEMPLATE_FOLDER_PATH to a single comp or keep only one template comp (implicit)
    //  B) Multiple templates - match AR: enable requireAspectRatioMatch or let the picker prefer closest AR
    //  C) Multiple templates - match AR & duration: when enableDurationMatch is true, prefer templates whose duration
    //     is within durationToleranceSeconds of the target comp; you may also require a duration match.
    var TEMPLATE_MATCH_CONFIG = {
        // Solution B (AR)
        arTolerance: 0.001,            // acceptable AR delta (abs(w/h - target))
        requireAspectRatioMatch: false, // when true, candidates are filtered to those within arTolerance
        // Solution C (AR + duration)
        enableDurationMatch: false,     // when true, duration is part of the scoring (preferred)
        requireDurationMatch: false,     // when true, filter candidates to those within durationToleranceSeconds
        durationToleranceSeconds: 0.50  // tolerance for duration match (seconds)
    };
    // One-off parenting debug gate (OFF by default). When enabled, logs all planned and actual
    // child->parent assignments for a comp. You can limit to specific target comp names via
    // DEBUG_PARENTING_DUMP_ONLY_COMPS (exact matches). Optional transform logging is gated too.
    var DEBUG_PARENTING_DUMP = false;
    var DEBUG_PARENTING_DUMP_ONLY_COMPS = [];
    var DEBUG_PARENTING_DUMP_WITH_TRANSFORM = false;
    var DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET = false; // compare template child local Position vs target after-parenting
    var LOG_MARKER = "*"; // ASCII-safe bullet for logs (global default)
    // Simple mode: insert the entire template comp as a single layer
    var SIMPLE_INSERT_TEMPLATE_AS_LAYER = false; // when true, skip per-layer copy and insert template as one precomp layer
    var SIMPLE_MUTE_TEMPLATE_AUDIO = true;       // when true, mute audio on the inserted template layer (default)
    var SIMPLE_SOLO_INSERTED_LAYER = false;      // when true, solo the inserted template layer
    var SIMPLE_PREP_REMOVE_ALL_LAYERS = false;   // when true, remove all existing layers in target before insert
    var SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO = false; // when true, disable visibility for footage layers before insert
    var SIMPLE_PREP_MUTE_FOOTAGE_AUDIO = false;    // when true, mute audio for footage layers before insert
    // Parenting behavior: assign parents at a stable reference time to avoid time-dependent offsets
    // when parent has animated transforms. Default: use 0s.
    var PARENTING_ASSIGN_AT_REF_TIME = true;
    var PARENTING_REF_TIME_MODE = 'zero'; // 'zero' | 'current' | 'inPoint' | 'custom'
    var PARENTING_REF_TIME_SECONDS = 0.0; // used when mode='custom'

    // Logo timing behavior toggle (legacy removed):
    // Previously `APPLY_LOGO_INPOINT_TO_LAYER_STARTTIME` controlled startTime alignment for logo layers.
    // This has been unified under the global `APPLY_INPOINT_TO_LAYER_STARTTIME` below.
    // General startTime alignment: when true, for any timed layer we set layer.startTime
    // to the computed inPoint (tin). This helps expressions relying on layer time.
    var APPLY_INPOINT_TO_LAYER_STARTTIME = true;

    // Time-stretch configuration for 'logo_anim' layers
    // Enables speeding up the first N seconds of the logo_anim source so that the animation ends around
    // a fraction of the target layer's in/out span, while keeping the layer outPoint at the target time.
    // - ENABLE_LOGO_ANIM_TIMESTRETCH: master ON/OFF
    // - LOGO_ANIM_STRETCH_PERCENT: base percent (e.g., 66 means 0.66x duration, i.e., faster)
    // - LOGO_ANIM_SOURCE_ANIM_DURATION: how many seconds at the start of the source contain the animated part (e.g., 2.0s)
    // - LOGO_ANIM_ANIM_END_FRACTION: desired fraction of the target span where the animated part should complete (e.g., 2/3)
    // - LOGO_ANIM_STRETCH_GATE_MAX_DURATION: do NOT apply stretch if target layer span exceeds this threshold (e.g., 2.2s)
    var ENABLE_LOGO_ANIM_TIMESTRETCH = true;
    var LOGO_ANIM_STRETCH_PERCENT = 66;               // base stretch percent
    var LOGO_ANIM_SOURCE_ANIM_DURATION = 2.0;         // seconds
    var LOGO_ANIM_ANIM_END_FRACTION = 2.0/3.0;        // target fraction of span to end animation
    var LOGO_ANIM_STRETCH_GATE_MAX_DURATION = 2.2;    // seconds; if span > this, no stretch is applied

    // Start-time shift configuration for 'logo_anim' layers
    // Shift startTime backwards by a small amount to skip initial frames while keeping in/out unchanged.
    // - ENABLE_LOGO_ANIM_START_SHIFT: master ON/OFF
    // - LOGO_ANIM_START_SHIFT_SECONDS: e.g., -0.20 means move startTime 0.20s earlier relative to current
    // - LOGO_ANIM_START_SHIFT_PROGRESSIVE_MULTIPLIER: multiply the shift when comp duration < (gate/2)
    // - LOGO_ANIM_START_SHIFT_VIDEO_DURATION_GATE: only apply shift when comp.duration < this threshold (seconds)
    var ENABLE_LOGO_ANIM_START_SHIFT = true;
    var LOGO_ANIM_START_SHIFT_SECONDS = -0.20;            // seconds (negative to cut the beginning)
    var LOGO_ANIM_START_SHIFT_PROGRESSIVE_MULTIPLIER = 1.5;
    var LOGO_ANIM_START_SHIFT_VIDEO_DURATION_GATE = 35.0; // seconds

    // Visibility flag configuration (JSON key names)
    // These keys are looked up first on each video object, then (if not found) under video.metadata.*
    // Change here if the JSON schema evolves.
    var DISCLAIMER_FLAG_KEY = "disclaimer_flag"; // values: 'y','n' (case-insensitive)
    var DISCLAIMER_02_FLAG_KEY = "disclaimer_02_flag"; // second disclaimer flag (same semantics)
    var SUBTITLES_FLAG_KEY = "subtitle_flag";   // values: 'y','n' (case-insensitive)
    var LOGO_ANIM_FLAG_KEY = "logo_anim_flag";  // values: 'y','n' (case-insensitive); controls 'logo_anim' vs 'logo' visibility
    // New per-video flags for skip-copy behavior
    var LOGO_02_FLAG_KEY = "logo_02_flag";      // controls 'logo_02' layer visibility
    var CLAIM_01_FLAG_KEY = "claim_01_flag";    // controls 'claim_01' layer visibility
    var CLAIM_02_FLAG_KEY = "claim_02_flag";    // controls 'claim_02' layer visibility
    // Configurable acceptable values (all compared case-insensitively)
    // Extend these arrays if JSON may contain alternative tokens (e.g. Yes/No / 1/0)
    var FLAG_VALUES = {
        ON:   ['y', 'yes', '1'],
        OFF:  ['n', 'no', '0']
    };


    // Skip-copy configuration (compact)
    var SKIP_COPY_CONFIG = {
        // When true, these layers will not be copied when their flag resolves to OFF
        disclaimerOff: true,
        disclaimer02Off: true,
        subtitlesOff: true,
        logoAnimOff:  true,
        logo02Off: true,
        claim01Off: true,
        claim02Off: true,
        // Base logo layers that must always be copied (case-insensitive exact names)
        alwaysCopyLogoBaseNames: ["Size_Holder_Logo"],
        // Generic group-based skip (by LAYER_NAME_CONFIG keys, no flags)
        groups: {
            enabled: true,
            keys: ["info"/* e.g., "claim" */]
        },
        // Ad-hoc skip list (name tokens); case-insensitive contains match
        adHoc: {
            enabled: false,
            tokens: ["info", "template_aspect"]
        }
    };

    // Config: Layer name configuration (case-insensitive)
    // - exact: list of layer names to match exactly
    // - contains: list of substrings; if present in layer name, it's a match
    // - imageOnlyForContains (logo only): when true, a 'contains' match is valid only for image/bitmap footage layers
    // Adjust these lists to match your template naming conventions.
    var LAYER_NAME_CONFIG = {
        info: {
            exact: ["info"],
            contains: ["info"]
        },
        logo: {
            exact: ["logo_01", "Size_Holder_Logo"],
            contains: [],
            imageOnlyForContains: false
        },
        // Specific match for animated logo variant to distinguish from generic 'logo'
        logoAnim: {
            exact: ["logo_anim", "Size_Holder_Logo"],
            contains: ["logo_anim"]
        },
        logo_02: {
            exact: ["logo_02", "Size_Holder_Logo_02"],
            contains: []
        },
        logo_03: {
            exact: ["logo_03"],
            contains: []
        },
        logo_04: {
            exact: ["logo_04"],
            contains: []
        },
        logo_04: {
            exact: ["logo_04"],
            contains: []
        },
        logo_05: {
            exact: ["logo_05"],
            contains: []
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
    };

    // TIMING_BEHAVIOR: declarative timing control (replaces FULL_DURATION_LAYER_GROUPS & ENABLE_JSON_TIMING_FOR_DISCLAIMER)
    // Values: 'timed' => apply JSON min/max; 'span' => force full comp duration; 'asIs' => keep template timing.
    // Keys may be LAYER_NAME_CONFIG group keys OR literal layer names (case-insensitive exact).
    var TIMING_BEHAVIOR = {
        // JSON timed groups
        logo: 'timed',
        logoAnim: 'timed',
        logo_02: 'timed',
        claim: 'timed',
        // Span groups / literals
        logo_03: 'span',
        logo_04: 'span',
        logo_05: 'span',
        disclaimer: 'span',
        disclaimer_02: 'span', // raw name variant
        disclaimer02: 'span',  // group key variant
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
        'Size_Holder_Super_A': 'span'
    };

    // TIMING_ITEM_SELECTOR: choose which item in each JSON timing array supplies the timing span when a layer/group is 'timed'.
    // Supported selector modes per key:
    //   { mode:'line', value:<lineNumber> }      -> pick object whose .line === value
    //   { mode:'index', value:<zeroBasedIndex> } -> pick array[value] directly
    //   { mode:'minMax' }                        -> fallback aggregate min(in)/max(out) (legacy default)
    // If omitted or invalid, we fallback to minMax aggregation.
    // Zero-length (in==out) selections are returned as-is (layer trimmed to an instant); callers may ignore if not useful.
    var TIMING_ITEM_SELECTOR = {
        // Example (override via options): logo: { mode: 'line', value: 1 }
        logo: { mode: 'line', value: 1 },
        logoAnim: { mode: 'line', value: 1 },
        logo_02: { mode: 'line', value: 2 },
        claim: { mode: 'line', value: 1 }
    };

    // Options overrides
    function __toBool(v, defVal) {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') {
            var s = v.toLowerCase();
            if (s==='true' || s==='1' || s==='yes' || s==='on') return true;
            if (s==='false' || s==='0' || s==='no' || s==='off') return false;
        }
        if (v === null || v === undefined) return (defVal===undefined?false:defVal);
        return !!v;
    }
    try {
        var o = opts && opts.options ? opts.options : null;
        if (o) {
            // ENABLE_JSON_TIMING_FOR_DISCLAIMER deprecated: ignore if present
            if (o.ENABLE_AUTOCENTER_ON_AR_MISMATCH !== undefined) ENABLE_AUTOCENTER_ON_AR_MISMATCH = __toBool(o.ENABLE_AUTOCENTER_ON_AR_MISMATCH, true);
            // Allow campaigns to override timing behavior map
            if (o.TIMING_BEHAVIOR && typeof o.TIMING_BEHAVIOR === 'object') {
                try { TIMING_BEHAVIOR = o.TIMING_BEHAVIOR; } catch(eTB) {}
            }
            // Override layer name configuration (optional)
            if (o.LAYER_NAME_CONFIG && typeof o.LAYER_NAME_CONFIG === 'object') {
                try { LAYER_NAME_CONFIG = o.LAYER_NAME_CONFIG; } catch(eLNC) {}
            }
            // Override timing item selector map (optional)
            if (o.TIMING_ITEM_SELECTOR && typeof o.TIMING_ITEM_SELECTOR === 'object') {
                try { TIMING_ITEM_SELECTOR = o.TIMING_ITEM_SELECTOR; } catch(eTIS) {}
            }
            // Allow campaigns to control startTime alignment globally for timed layers
            if (o.APPLY_INPOINT_TO_LAYER_STARTTIME !== undefined) {
                APPLY_INPOINT_TO_LAYER_STARTTIME = __toBool(o.APPLY_INPOINT_TO_LAYER_STARTTIME, true);
            }
            if (o.TEMPLATE_MATCH_CONFIG) {
                if (typeof o.TEMPLATE_MATCH_CONFIG.arTolerance === 'number') TEMPLATE_MATCH_CONFIG.arTolerance = o.TEMPLATE_MATCH_CONFIG.arTolerance;
                if (typeof o.TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch === 'boolean') TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch = o.TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch;
                if (typeof o.TEMPLATE_MATCH_CONFIG.enableDurationMatch === 'boolean') TEMPLATE_MATCH_CONFIG.enableDurationMatch = o.TEMPLATE_MATCH_CONFIG.enableDurationMatch;
                if (typeof o.TEMPLATE_MATCH_CONFIG.requireDurationMatch === 'boolean') TEMPLATE_MATCH_CONFIG.requireDurationMatch = o.TEMPLATE_MATCH_CONFIG.requireDurationMatch;
                if (typeof o.TEMPLATE_MATCH_CONFIG.durationToleranceSeconds === 'number') TEMPLATE_MATCH_CONFIG.durationToleranceSeconds = o.TEMPLATE_MATCH_CONFIG.durationToleranceSeconds;
            }
            if (o.SKIP_COPY_CONFIG) {
                try { SKIP_COPY_CONFIG = o.SKIP_COPY_CONFIG; } catch(eS) {}
            }
            // EXTRA_TEMPLATES (optional) — read into local effective variables
            var __EXTRA_ENABLE = false;
            var __EXTRA_ALLOWED_AR = [];
            var __EXTRA_TAG_TOKENS = [];
            var __EXTRA_SUFFIX = "_extra";
            var __EXTRA_REQUIRE_DUR = null;      // null => inherit TEMPLATE_MATCH_CONFIG
            var __EXTRA_DUR_TOL = null;          // null => inherit TEMPLATE_MATCH_CONFIG
            var __EXTRA_FALLBACK = true;
            try {
                if (o.EXTRA_TEMPLATES && typeof o.EXTRA_TEMPLATES === 'object') {
                    var E = o.EXTRA_TEMPLATES;
                    if (typeof E.ENABLE_EXTRA_TEMPLATES !== 'undefined') __EXTRA_ENABLE = __toBool(E.ENABLE_EXTRA_TEMPLATES, false);
                    if (E.ALLOWED_AR instanceof Array) __EXTRA_ALLOWED_AR = E.ALLOWED_AR;
                    if (E.TAG_TOKENS instanceof Array) __EXTRA_TAG_TOKENS = E.TAG_TOKENS;
                    if (typeof E.OUTPUT_NAME_SUFFIX === 'string' && E.OUTPUT_NAME_SUFFIX) __EXTRA_SUFFIX = E.OUTPUT_NAME_SUFFIX;
                    if (typeof E.REQUIRE_DURATION_MATCH === 'boolean') __EXTRA_REQUIRE_DUR = E.REQUIRE_DURATION_MATCH;
                    if (typeof E.DURATION_TOLERANCE_SECONDS === 'number') __EXTRA_DUR_TOL = E.DURATION_TOLERANCE_SECONDS;
                    if (typeof E.FALLBACK_WHEN_NO_EXTRA !== 'undefined') __EXTRA_FALLBACK = __toBool(E.FALLBACK_WHEN_NO_EXTRA, true);
                }
            } catch(eExtra){ /* optional */ }
            // Expose as locals for later use
            var EXTRA_ENABLE = __EXTRA_ENABLE;
            var EXTRA_ALLOWED_AR = __EXTRA_ALLOWED_AR;
            var EXTRA_TAG_TOKENS = __EXTRA_TAG_TOKENS;
            var EXTRA_OUTPUT_SUFFIX = __EXTRA_SUFFIX;
            var EXTRA_REQUIRE_DURATION = __EXTRA_REQUIRE_DUR;
            var EXTRA_DURATION_TOL = __EXTRA_DUR_TOL;
            var EXTRA_FALLBACK = __EXTRA_FALLBACK;
            if (o.ENABLE_FILE_LOG !== undefined) ENABLE_FILE_LOG = __toBool(o.ENABLE_FILE_LOG, true);
            if (o.PIPELINE_SHOW_CONCISE_LOG !== undefined) PIPELINE_SHOW_CONCISE_LOG = __toBool(o.PIPELINE_SHOW_CONCISE_LOG, true);
            if (o.PIPELINE_SHOW_VERBOSE_LOG !== undefined) PIPELINE_SHOW_VERBOSE_LOG = __toBool(o.PIPELINE_SHOW_VERBOSE_LOG, false);
        }
        try { if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASE_FILE_LOGS_MASTER_ENABLE === false) { ENABLE_FILE_LOG = false; } } catch(eMSAL) {}
        // Parenting debug options (optional) from pipeline options
        try {
            var ao = (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.addLayers) ? __AE_PIPE__.optionsEffective.addLayers : null;
            if (ao) {
                if (ao.hasOwnProperty('DEBUG_PARENTING_DUMP')) DEBUG_PARENTING_DUMP = !!ao.DEBUG_PARENTING_DUMP;
                if (ao.hasOwnProperty('DEBUG_PARENTING_DUMP_WITH_TRANSFORM')) DEBUG_PARENTING_DUMP_WITH_TRANSFORM = !!ao.DEBUG_PARENTING_DUMP_WITH_TRANSFORM;
                if (ao.DEBUG_PARENTING_DUMP_ONLY_COMPS && ao.DEBUG_PARENTING_DUMP_ONLY_COMPS.length) {
                    DEBUG_PARENTING_DUMP_ONLY_COMPS = ao.DEBUG_PARENTING_DUMP_ONLY_COMPS.slice(0);
                }
                if (ao.hasOwnProperty('DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET')) DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET = !!ao.DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET;
                if (ao.hasOwnProperty('PARENTING_ASSIGN_AT_REF_TIME')) PARENTING_ASSIGN_AT_REF_TIME = !!ao.PARENTING_ASSIGN_AT_REF_TIME;
                if (typeof ao.PARENTING_REF_TIME_MODE === 'string' && ao.PARENTING_REF_TIME_MODE) PARENTING_REF_TIME_MODE = ao.PARENTING_REF_TIME_MODE;
                if (typeof ao.PARENTING_REF_TIME_SECONDS === 'number') PARENTING_REF_TIME_SECONDS = ao.PARENTING_REF_TIME_SECONDS;
                // Simple mode toggles (optional)
                if (ao.hasOwnProperty('SIMPLE_INSERT_TEMPLATE_AS_LAYER')) SIMPLE_INSERT_TEMPLATE_AS_LAYER = !!ao.SIMPLE_INSERT_TEMPLATE_AS_LAYER;
                if (ao.hasOwnProperty('SIMPLE_MUTE_TEMPLATE_AUDIO')) SIMPLE_MUTE_TEMPLATE_AUDIO = !!ao.SIMPLE_MUTE_TEMPLATE_AUDIO;
                if (ao.hasOwnProperty('SIMPLE_SOLO_INSERTED_LAYER')) SIMPLE_SOLO_INSERTED_LAYER = !!ao.SIMPLE_SOLO_INSERTED_LAYER;
                if (ao.hasOwnProperty('SIMPLE_PREP_REMOVE_ALL_LAYERS')) SIMPLE_PREP_REMOVE_ALL_LAYERS = !!ao.SIMPLE_PREP_REMOVE_ALL_LAYERS;
                if (ao.hasOwnProperty('SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO')) SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO = !!ao.SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO;
                if (ao.hasOwnProperty('SIMPLE_PREP_MUTE_FOOTAGE_AUDIO')) SIMPLE_PREP_MUTE_FOOTAGE_AUDIO = !!ao.SIMPLE_PREP_MUTE_FOOTAGE_AUDIO;
            }
            // Global pipeline-level LOG_MARKER takes precedence; keep per-phase as backward-compatible fallback
            try {
                if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && typeof __AE_PIPE__.optionsEffective.LOG_MARKER === 'string') {
                    LOG_MARKER = __AE_PIPE__.optionsEffective.LOG_MARKER;
                } else if (ao && typeof ao.LOG_MARKER === 'string') {
                    LOG_MARKER = ao.LOG_MARKER;
                }
            } catch(eLM) {}
        } catch(ePDO) {}
    } catch(eOpt){}


    // Helpers ————————————————————————————————————————————————

    function resolveTimingBehaviorForLayer(layerName) {
        if (!layerName) return null;
        var nmLower = String(layerName).toLowerCase();
        // Group-based matching first
        for (var key in TIMING_BEHAVIOR) {
            if (!TIMING_BEHAVIOR.hasOwnProperty(key)) continue;
            if (LAYER_NAME_CONFIG[key]) {
                if (nameMatchesGroup(layerName, key)) return TIMING_BEHAVIOR[key];
            }
        }
        // Literal matching second
        for (var lkey in TIMING_BEHAVIOR) {
            if (!TIMING_BEHAVIOR.hasOwnProperty(lkey)) continue;
            if (LAYER_NAME_CONFIG[lkey]) continue; // skip groups already tested
            if (nmLower === String(lkey).toLowerCase()) return TIMING_BEHAVIOR[lkey];
        }
        return null;
    }

    // Unified flag helpers (file-scope)
    function extractFlagFromVideo(videoObj, keyName) {
        if (!videoObj || !keyName) return null;
        try {
            if (videoObj.hasOwnProperty(keyName) && videoObj[keyName] !== undefined && videoObj[keyName] !== null && videoObj[keyName] !== '') {
                return String(videoObj[keyName]).toLowerCase();
            }
            if (videoObj.metadata && videoObj.metadata.hasOwnProperty(keyName) && videoObj.metadata[keyName] !== undefined && videoObj.metadata[keyName] !== null && videoObj.metadata[keyName] !== '') {
                return String(videoObj.metadata[keyName]).toLowerCase();
            }
        } catch (e) {}
        return null;
    }

    function interpretFlagValue(raw, cfg, opts) {
        if (!raw) return null;
        var allowAuto = opts && opts.allowAuto === true;
        var val = String(raw).toLowerCase();
        function inList(list){ if(!list||!list.length) return false; for(var i=0;i<list.length;i++){ if(val===String(list[i]).toLowerCase()) return true; } return false; }
        if (inList(cfg && cfg.ON)) return 'on';
        if (inList(cfg && cfg.OFF)) return 'off';
        if (allowAuto && inList(cfg && cfg.AUTO)) return 'auto';
        return null;
    }

    function toEffective(mode, fallback) { return mode || fallback; }

    function logUnrecognizedFlag(flagKey, raw, cfg, ctxName) {
        if (!raw) return; // only log when there is an unrecognized value
        var onList = (cfg && cfg.ON) ? cfg.ON.join('/') : '';
        var offList = (cfg && cfg.OFF) ? cfg.OFF.join('/') : '';
        log("Flag '"+flagKey+"' value '"+raw+"' not recognized (ON:"+onList+", OFF:"+offList+") for '"+ctxName+"'.");
    }

    function getModesForVideo(videoObj) {
        var raw = {
            disclaimer: extractFlagFromVideo(videoObj, DISCLAIMER_FLAG_KEY),
            disclaimer02: extractFlagFromVideo(videoObj, DISCLAIMER_02_FLAG_KEY),
            subtitles: extractFlagFromVideo(videoObj, SUBTITLES_FLAG_KEY),
            logoAnim: extractFlagFromVideo(videoObj, LOGO_ANIM_FLAG_KEY),
            logo02: extractFlagFromVideo(videoObj, LOGO_02_FLAG_KEY),
            claim01: extractFlagFromVideo(videoObj, CLAIM_01_FLAG_KEY),
            claim02: extractFlagFromVideo(videoObj, CLAIM_02_FLAG_KEY)
        };
        var modes = {
            disclaimer: interpretFlagValue(raw.disclaimer, FLAG_VALUES, { allowAuto: false }),
            disclaimer02: interpretFlagValue(raw.disclaimer02, FLAG_VALUES, { allowAuto: false }),
            subtitles: interpretFlagValue(raw.subtitles, FLAG_VALUES, { allowAuto: false }),
            logoAnim: interpretFlagValue(raw.logoAnim, FLAG_VALUES, { allowAuto: false }),
            logo02: interpretFlagValue(raw.logo02, FLAG_VALUES, { allowAuto: false }),
            claim01: interpretFlagValue(raw.claim01, FLAG_VALUES, { allowAuto: false }),
            claim02: interpretFlagValue(raw.claim02, FLAG_VALUES, { allowAuto: false })
        };
        var eff = {
            disclaimer: toEffective(modes.disclaimer, 'off'),
            disclaimer02: toEffective(modes.disclaimer02, 'off'),
            subtitles: toEffective(modes.subtitles, 'off'),
            logoAnim: toEffective(modes.logoAnim, 'off'),
            logo02: toEffective(modes.logo02, 'off'),
            claim01: toEffective(modes.claim01, 'off'),
            claim02: toEffective(modes.claim02, 'off')
        };
        return { raw: raw, modes: modes, effective: eff };
    }

    // Simple name matching helpers (case-insensitive)
    function _matchesExact(name, list) {
        if (!name || !list || !list.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < list.length; i++) if (n === String(list[i]).toLowerCase()) return true;
        return false;
    }
    function _matchesContains(name, list) {
        if (!name || !list || !list.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < list.length; i++) if (n.indexOf(String(list[i]).toLowerCase()) !== -1) return true;
        return false;
    }
    function nameMatchesGroup(name, groupKey) {
        var cfg = LAYER_NAME_CONFIG[groupKey];
        if (!cfg) return false;
        return _matchesExact(name, cfg.exact) || _matchesContains(name, cfg.contains);
    }
    function nameMatchesAnyTokenContains(name, tokens) {
        if (!name || !tokens || !tokens.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < tokens.length; i++) {
            var t = String(tokens[i]).toLowerCase();
            if (!t) continue;
            if (n.indexOf(t) !== -1) return true;
        }
        return false;
    }

    function findChildFolderByName(parent, name) {
        for (var i = 1; i <= parent.numItems; i++) {
            var it = parent.items[i];
            if (it && it instanceof FolderItem && it.name === name) return it;
        }
        return null;
    }

    function findFolderPath(root, segments) {
        var cur = root;
        for (var i = 0; i < segments.length; i++) {
            var f = findChildFolderByName(cur, segments[i]);
            if (!f) return null;
            cur = f;
        }
        return cur;
    }

    function pathToString(segments) {
        var s = "./";
        for (var i = 0; i < segments.length; i++) {
            s += segments[i];
            if (i < segments.length - 1) s += "/";
        }
        return s + "/";
    }

    function isDescendantOfFolder(item, folder) {
        if (!item || !folder) return false;
        try {
            var f = item.parentFolder;
            while (f) {
                if (f === folder) return true;
                if (f === proj.rootFolder) break;
                f = f.parentFolder;
            }
        } catch (e) {}
        return false;
    }

    function collectCompsRecursive(folder, outArr) {
        for (var i = 1; i <= folder.numItems; i++) {
            var it = folder.items[i];
            if (it instanceof CompItem) outArr.push(it);
            else if (it instanceof FolderItem) collectCompsRecursive(it, outArr);
        }
    }

    function pickBestTemplateComp(candidates) {
        if (!candidates || !candidates.length) return null;
        // Prefer those matching pattern: title_duration_template_YYMMDD_vNN
        var pat = /^(.+?)_(\d{1,4}s)_template_(\d{6})_v(\d{1,3})$/i;
        var best = null; var bestDate = -1; var bestVer = -1;
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var m = String(c.name || "").match(pat);
            if (m) {
                var dateNum = parseInt(m[3], 10);
                var verNum = parseInt(m[4], 10);
                if (dateNum > bestDate || (dateNum === bestDate && verNum > bestVer)) {
                    best = c; bestDate = dateNum; bestVer = verNum;
                }
            }
        }
        if (best) return best;
        // Fallback: first comp
        return candidates[0];
    }

    // New: pick best template per target using AR and resolution (Solution B)
    function pickBestTemplateCompForTarget(candidates, targetComp) {
        if (!candidates || !candidates.length) return null;
        if (!targetComp) return pickBestTemplateComp(candidates);
        var tAR = ar(targetComp.width, targetComp.height);
        var tol = (TEMPLATE_MATCH_CONFIG && typeof TEMPLATE_MATCH_CONFIG.arTolerance === 'number') ? TEMPLATE_MATCH_CONFIG.arTolerance : 0.001; // AR tolerance
        var requireAR = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch === true);
        // Solution C toggles
        var enableDur = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.enableDurationMatch === true);
        var requireDur = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.requireDurationMatch === true);
        var durTol = (TEMPLATE_MATCH_CONFIG && typeof TEMPLATE_MATCH_CONFIG.durationToleranceSeconds === 'number') ? TEMPLATE_MATCH_CONFIG.durationToleranceSeconds : 0.50;
        var tDur = 0; try { tDur = (typeof targetComp.duration === 'number') ? targetComp.duration : 0; } catch(eDur) { tDur = 0; }
        // Helper to parse date/version for tie-breaks
        function parseDateVer(name) {
            var pat = /^(.+?)_(\d{1,4}s)_template_(\d{6})_v(\d{1,3})$/i;
            var m = String(name || "").match(pat);
            if (m) return { dateNum: parseInt(m[3],10), verNum: parseInt(m[4],10) };
            return { dateNum: -1, verNum: -1 };
        }
        // If requireAspectRatioMatch is true, limit candidates to those within tolerance
        var working = candidates;
        if (requireAR) {
            var filtered = [];
            for (var fi = 0; fi < candidates.length; fi++) {
                var cc = candidates[fi];
                var cARf = ar(cc.width, cc.height);
                if (Math.abs(cARf - tAR) <= tol) filtered.push(cc);
            }
            if (!filtered.length) return null;
            working = filtered;
        }
        // If requireDurationMatch is true (only when enableDur), limit candidates to duration within tolerance
        if (enableDur && requireDur) {
            var filteredDur = [];
            for (var fdi = 0; fdi < working.length; fdi++) {
                var cd = working[fdi];
                var cDur = 0; try { cDur = (typeof cd.duration === 'number') ? cd.duration : 0; } catch(eCD) { cDur = 0; }
                if (Math.abs(cDur - tDur) <= durTol) filteredDur.push(cd);
            }
            if (!filteredDur.length) return null;
            working = filteredDur;
        }

        var best = null;
        var bestScore = null; // lower is better; structure: { arDiff, resDiff, durDiff, arInTol, durInTol, dateNum, verNum }
        for (var i = 0; i < working.length; i++) {
            var c = working[i];
            var cAR = ar(c.width, c.height);
            var arDiff = Math.abs(cAR - tAR);
            // resDiff: within AR match, prefer closest resolution; otherwise still compute to break ties
            var resDiff = Math.abs(c.width - targetComp.width) + Math.abs(c.height - targetComp.height);
            var dv = parseDateVer(c.name);
            var cDur2 = 0; try { cDur2 = (typeof c.duration === 'number') ? c.duration : 0; } catch(eCD2) { cDur2 = 0; }
            var durDiff = Math.abs(cDur2 - tDur);
            var score = {
                arDiff: arDiff,
                resDiff: resDiff,
                durDiff: durDiff,
                arInTol: (arDiff <= tol),
                durInTol: (enableDur ? (durDiff <= durTol) : true),
                dateNum: dv.dateNum,
                verNum: dv.verNum
            };
            if (!best) { best = c; bestScore = score; continue; }
            var s = bestScore;
            // Primary: Prefer AR within tolerance
            var bothARin = (score.arInTol && s.arInTol);
            if (bothARin) {
                // If Solution C is enabled, prefer duration within tolerance
                if (enableDur) {
                    if (score.durInTol && !s.durInTol) { best = c; bestScore = score; continue; }
                    if (!score.durInTol && s.durInTol) { /* keep current best */ } else {
                        // Both in or both out of duration tol: prefer smaller duration diff
                        if (score.durDiff < s.durDiff) { best = c; bestScore = score; continue; }
                        if (score.durDiff > s.durDiff) { /* keep current best */ } else {
                            // Then prefer closest resolution
                            if (score.resDiff < s.resDiff) { best = c; bestScore = score; continue; }
                            if (score.resDiff > s.resDiff) { /* keep */ } else {
                                // Tie: prefer newer date/version
                                if (score.dateNum > s.dateNum || (score.dateNum === s.dateNum && score.verNum > s.verNum)) { best = c; bestScore = score; }
                            }
                        }
                    }
                    continue;
                }
                // Solution B only: both AR within tol, prefer closest resolution
                if (score.resDiff < s.resDiff) { best = c; bestScore = score; continue; }
                if (score.resDiff > s.resDiff) { continue; }
                if (score.dateNum > s.dateNum || (score.dateNum === s.dateNum && score.verNum > s.verNum)) { best = c; bestScore = score; }
                continue;
            }
            // If only one is within AR tolerance, prefer that
            if (score.arInTol && !s.arInTol) { best = c; bestScore = score; continue; }
            if (!score.arInTol && s.arInTol) { /* keep current best */ continue; }
            // Both outside AR tolerance: pick smaller AR diff, then duration if enabled, then resolution, then recency
            if (score.arDiff < s.arDiff) { best = c; bestScore = score; continue; }
            if (score.arDiff > s.arDiff) { continue; }
            if (enableDur) {
                if (score.durDiff < s.durDiff) { best = c; bestScore = score; continue; }
                if (score.durDiff > s.durDiff) { continue; }
            }
            if (score.resDiff < s.resDiff) { best = c; bestScore = score; continue; }
            if (score.resDiff > s.resDiff) { continue; }
            if (score.dateNum > s.dateNum || (score.dateNum === s.dateNum && score.verNum > s.verNum)) { best = c; bestScore = score; }
        }
        return best || candidates[0];
    }

    function findBottomVideoFootageLayerIndex(comp) {
        // Return highest layer index whose source is FootageItem with video
        for (var i = comp.numLayers; i >= 1; i--) {
            var ly = comp.layer(i);
            try {
                if (ly && ly.source && (ly.source instanceof FootageItem)) {
                    var src = ly.source;
                    var hasVid = false;
                    try { hasVid = (src.hasVideo === true); } catch (e1) {}
                    if (hasVid) return i;
                }
            } catch (e) {}
        }
        return -1;
    }

    function getSelectedComps() {
        var out = [];
        var sel = proj.selection;
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) if (sel[i] instanceof CompItem) out.push(sel[i]);
        }
        if (!out.length && proj.activeItem && proj.activeItem instanceof CompItem) out.push(proj.activeItem);
        return out;
    }

    // Aspect ratio helpers and auto-center logic ————————————————————————
    function ar(w, h) { return (h && h !== 0) ? (w / h) : 0; }
    function arMismatch(compA, compB) {
        var rA = ar(compA.width, compA.height);
        var rB = ar(compB.width, compB.height);
        return Math.abs(rA - rB) > 0.001; // tolerance
    }

    // Reduce WxH to simplified AR key like "16x9" or "9x16"
    function __gcd(a,b){ a=Math.abs(a); b=Math.abs(b); while(b){ var t=b; b=a % b; a=t; } return a||1; }
    function getARKeyFromComp(c){ try{ var w=c.width|0, h=c.height|0; if(!w||!h) return ""; var g=__gcd(w,h); return (Math.round(w/g)+"x"+Math.round(h/g)); }catch(e){ return ""; } }
    function isExtraAllowedForComp(c, allowedList){ try{ if(!allowedList || !allowedList.length) return true; var key=getARKeyFromComp(c); for(var i=0;i<allowedList.length;i++){ if(String(allowedList[i])===key) return true; } }catch(e){} return false; }
    function projectHasItemNamed(name){ try{ var p=app.project; if(!p) return false; var n=p.numItems|0; for(var i=1;i<=n;i++){ var it=p.item(i); try{ if(it && it.name===name) return true; }catch(eN){} } }catch(eP){} return false; }
    function pickUniqueName(base){ var nm=String(base||""); if(!projectHasItemNamed(nm)) return nm; var idx=2; while(true){ var tryN = nm + "_" + idx; if(!projectHasItemNamed(tryN)) return tryN; idx++; if(idx>9999) return nm + "_" + (new Date().getTime()); }
    }

    function nameInListCaseInsensitive(name, list) {
        if (!name || !list || !list.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < list.length; i++) { if (n === String(list[i]).toLowerCase()) return true; }
        return false;
    }

    function recenterUnparentedLayers(comp) {
        var cx = comp.width / 2;
        var cy = comp.height / 2;

        function shiftCombined(posProp, cx, cy) {
            if (!posProp) return;
            try {
                if (posProp.expressionEnabled) { return; }
            } catch (eExp) {}
            var is3D = false; var cur = null; var z = 0;
            try { cur = posProp.value; is3D = (cur && cur.length === 3); if (is3D) z = cur[2]; } catch (eVal) {}
            if (posProp.numKeys && posProp.numKeys > 0) {
                // Compute delta from first key
                var base = posProp.keyValue(1);
                var dx = cx - base[0];
                var dy = cy - base[1];
                for (var k = 1; k <= posProp.numKeys; k++) {
                    try {
                        var v = posProp.keyValue(k);
                        if (v && v.length) {
                            var nv = (v.length === 3) ? [v[0] + dx, v[1] + dy, v[2]] : [v[0] + dx, v[1] + dy];
                            posProp.setValueAtKey(k, nv);
                        }
                    } catch (eSetK) {}
                }
            } else {
                try { posProp.setValue(is3D ? [cx, cy, z] : [cx, cy]); } catch (eSet) {}
            }
        }

        function shiftSeparated(posX, posY, cx, cy) {
            if (!posX || !posY) return;
            try { if (posX.expressionEnabled || posY.expressionEnabled) { return; } } catch (eExp) {}
            var baseX = (posX.numKeys > 0) ? posX.keyValue(1) : posX.value;
            var baseY = (posY.numKeys > 0) ? posY.keyValue(1) : posY.value;
            var dx = cx - baseX;
            var dy = cy - baseY;
            if (posX.numKeys > 0) {
                for (var kx = 1; kx <= posX.numKeys; kx++) {
                    try { posX.setValueAtKey(kx, posX.keyValue(kx) + dx); } catch (eKX) {}
                }
            } else { try { posX.setValue(cx); } catch (eSX) {} }
            if (posY.numKeys > 0) {
                for (var ky = 1; ky <= posY.numKeys; ky++) {
                    try { posY.setValueAtKey(ky, posY.keyValue(ky) + dy); } catch (eKY) {}
                }
            } else { try { posY.setValue(cy); } catch (eSY) {} }
        }

        function alignXCombined(posProp, cx) {
            if (!posProp) return; try { if (posProp.expressionEnabled) return; } catch (e) {}
            var cur = null; try { cur = posProp.value; } catch (eV) {}
            if (posProp.numKeys && posProp.numKeys > 0) {
                var base = posProp.keyValue(1);
                var dx = cx - base[0];
                for (var k = 1; k <= posProp.numKeys; k++) {
                    try {
                        var v = posProp.keyValue(k);
                        var nv = (v.length === 3) ? [v[0] + dx, v[1], v[2]] : [v[0] + dx, v[1]];
                        posProp.setValueAtKey(k, nv);
                    } catch (eSet) {}
                }
            } else {
                try {
                    var is3D = (cur && cur.length === 3);
                    var ny = cur ? cur[1] : 0; var nz = is3D ? cur[2] : undefined;
                    posProp.setValue(is3D ? [cx, ny, nz] : [cx, ny]);
                } catch (eSet2) {}
            }
        }

        function alignYCombined(posProp, cy) {
            if (!posProp) return; try { if (posProp.expressionEnabled) return; } catch (e) {}
            var cur = null; try { cur = posProp.value; } catch (eV) {}
            if (posProp.numKeys && posProp.numKeys > 0) {
                var base = posProp.keyValue(1);
                var dy = cy - base[1];
                for (var k = 1; k <= posProp.numKeys; k++) {
                    try {
                        var v = posProp.keyValue(k);
                        var nv = (v.length === 3) ? [v[0], v[1] + dy, v[2]] : [v[0], v[1] + dy];
                        posProp.setValueAtKey(k, nv);
                    } catch (eSet) {}
                }
            } else {
                try {
                    var is3D = (cur && cur.length === 3);
                    var nx = cur ? cur[0] : 0; var nz = is3D ? cur[2] : undefined;
                    posProp.setValue(is3D ? [nx, cy, nz] : [nx, cy]);
                } catch (eSet2) {}
            }
        }

        function alignXSeparated(posX, cx) {
            if (!posX) return; try { if (posX.expressionEnabled) return; } catch (e) {}
            if (posX.numKeys > 0) {
                var base = posX.keyValue(1); var dx = cx - base;
                for (var k = 1; k <= posX.numKeys; k++) { try { posX.setValueAtKey(k, posX.keyValue(k) + dx); } catch (eK) {} }
            } else { try { posX.setValue(cx); } catch (eS) {} }
        }

        function alignYSeparated(posY, cy) {
            if (!posY) return; try { if (posY.expressionEnabled) return; } catch (e) {}
            if (posY.numKeys > 0) {
                var base = posY.keyValue(1); var dy = cy - base;
                for (var k = 1; k <= posY.numKeys; k++) { try { posY.setValueAtKey(k, posY.keyValue(k) + dy); } catch (eK) {} }
            } else { try { posY.setValue(cy); } catch (eS) {} }
        }

        for (var i = 1; i <= comp.numLayers; i++) {
            var ly = comp.layer(i);
            // Skip parented layers
            try { if (ly.parent) continue; } catch (ePar) {}
            // Recenter/align rules lookups
            var nm = String(ly.name || "");
            var rr = LAYER_NAME_CONFIG && LAYER_NAME_CONFIG.recenterRules ? LAYER_NAME_CONFIG.recenterRules : null;
            var inForce = rr ? nameInListCaseInsensitive(nm, rr.force || []) : false;
            var inSkip = rr ? nameInListCaseInsensitive(nm, rr.noRecenter || []) : false;
            var doAlignH = rr ? nameInListCaseInsensitive(nm, rr.alignH || []) : false;
            var doAlignV = rr ? nameInListCaseInsensitive(nm, rr.alignV || []) : false;
            var doRecenter = true;
            if (inSkip) doRecenter = false;
            if (inForce) doRecenter = true;

            var tr = null;
            try { tr = ly.property("ADBE Transform Group"); } catch (eTG) {}
            if (!tr) continue;
            var pos = tr.property("ADBE Position");
            var posX = null, posY = null;
            if (!pos) {
                posX = tr.property("ADBE Position_0");
                posY = tr.property("ADBE Position_1");
            }
            var wasLocked = false;
            try { wasLocked = (ly.locked === true); } catch (eLk) {}
            try { if (wasLocked) ly.locked = false; } catch (eUl) {}
            try {
                if (doRecenter) {
                    if (pos) shiftCombined(pos, cx, cy);
                    else if (posX && posY) shiftSeparated(posX, posY, cx, cy);
                }
                // Alignment step after re-centering (or standalone if recenter skipped)
                if (doAlignH) {
                    if (pos) alignXCombined(pos, cx); else if (posX) alignXSeparated(posX, cx);
                }
                if (doAlignV) {
                    if (pos) alignYCombined(pos, cy); else if (posY) alignYSeparated(posY, cy);
                }
            } catch (eSh) {}
            try { if (wasLocked) ly.locked = true; } catch (eRl) {}
        }
    }

    // JSON wiring helpers ——————————————————————————————————————
    function findProjectItemByName(name) {
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (it && it.name === name) return it;
        }
        return null;
    }

    function readTextFile(file) {
        if (!file || !file.exists) return null;
        var txt = null;
        try {
            file.encoding = "UTF-8";
            if (file.open("r")) {
                txt = file.read();
                file.close();
            }
        } catch (e) { try { file.close(); } catch (e2) {} }
        return txt;
    }

    function parseJSONSafe(text) {
        if (!text) return null;
        try {
            if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
        } catch (e) {}
        // Fallback (last resort): naive eval in sandboxed parentheses
        try { return eval('(' + text + ')'); } catch (e2) { return null; }
    }

    function loadProjectJSONByName(name) {
        var it = findProjectItemByName(name);
        if (!it || !(it instanceof FootageItem) || !it.mainSource) return null;
        var f = null;
        try { f = it.mainSource.file; } catch (e) {}
        if (!f) return null;
        var txt = readTextFile(f);
        if (!txt) return null;
        return parseJSONSafe(txt);
    }

    // Base (orientation-agnostic) videoId builder from comp name
    // Rule: take the token immediately BEFORE the first duration token (NNs), allowing arbitrary leading tokens.
    // Fallback: if no standalone duration token exists, scan from the end for any token containing /(\d{1,4})s/ and use that.
    function buildVideoIdFromCompName(name) {
        if (!name) return null;
        var parts = String(name).split(/[_\s]+/);
        if (!parts.length) return null;
        var durIdx = -1;
        var durToken = null;
        // Pass 1: find first standalone duration token
        for (var i = 0; i < parts.length; i++) {
            var p1 = parts[i];
            if (/^\d{1,4}s$/i.test(p1)) { durIdx = i; durToken = String(p1).toLowerCase(); break; }
        }
        // Pass 2: fallback to last token that contains a duration-like substring (e.g., "(30s)", "06s_v02")
        if (durIdx === -1) {
            for (var j = parts.length - 1; j >= 0; j--) {
                var p2 = parts[j];
                var m = String(p2).match(/(\d{1,4})s/i);
                if (m) { durIdx = j; durToken = String(m[1]).toLowerCase() + 's'; break; }
            }
        }
        if (durIdx <= 0) return null; // need a title token immediately before duration
        var title = parts[durIdx - 1];
        if (!title || !durToken) return null;
        return title + '_' + durToken;
    }

    // Determine orientation of a comp: landscape if width > height; portrait otherwise (square counts as portrait)
    function getCompOrientation(comp) {
        try { if (comp && comp.width > comp.height) return "landscape"; } catch (e) {}
        return "portrait";
    }

    // Build oriented videoId (e.g., "Title_30s_landscape") from comp; returns { oriented: string|null, base: string|null, orientation: string }
    function buildOrientedVideoId(comp) {
        var baseId = buildVideoIdFromCompName(comp ? comp.name : null);
        var orientation = getCompOrientation(comp);
        if (!baseId) return { oriented: null, base: null, orientation: orientation };
        return { oriented: baseId + "_" + orientation, base: baseId, orientation: orientation };
    }

    function findVideoById(data, videoId) {
        try {
            var arr = data && data.videos ? data.videos : null;
            if (!arr) return null;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && String(arr[i].videoId) === String(videoId)) return arr[i];
            }
        } catch (e) {}
        return null;
    }

    function minMaxInOut(list) {
        if (!list || !list.length) return null;
        var minIn = null, maxOut = null;
        for (var i = 0; i < list.length; i++) {
            var o = list[i];
            if (!o) continue;
            var tin = (o["in"] !== undefined) ? parseFloat(o["in"]) : null;
            var tout = (o["out"] !== undefined) ? parseFloat(o["out"]) : null;
            if (tin === null || isNaN(tin) || tout === null || isNaN(tout)) continue;
            if (minIn === null || tin < minIn) minIn = tin;
            if (maxOut === null || tout > maxOut) maxOut = tout;
        }
        if (minIn === null || maxOut === null || maxOut <= minIn) return null;
        return { tin: minIn, tout: maxOut };
    }

    // Resolve timing span based on TIMING_ITEM_SELECTOR for a given key on video record.
    function resolveTimingSpan(videoObj, key, selectorMap) {
        if (!videoObj || !key) return null;
        var arr = videoObj[key];
        if (!arr || !arr.length) return null;
        var sel = selectorMap && selectorMap[key];
        if (!sel || typeof sel !== 'object') return minMaxInOut(arr);
        var mode = sel.mode || 'minMax';
        if (mode === 'minMax') return minMaxInOut(arr);
        if (mode === 'line') {
            var targetLine = sel.value;
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i]; if (!it) continue;
                var ln = (it.line !== undefined) ? parseInt(it.line, 10) : null;
                if (ln === targetLine) {
                    var tin = (it['in'] !== undefined) ? parseFloat(it['in']) : null;
                    var tout = (it['out'] !== undefined) ? parseFloat(it['out']) : null;
                    if (tin === null || isNaN(tin) || tout === null || isNaN(tout)) return null;
                    return { tin: tin, tout: tout };
                }
            }
            return null;
        }
        if (mode === 'index') {
            var idx = parseInt(sel.value, 10);
            if (isNaN(idx) || idx < 0 || idx >= arr.length) return null;
            var it2 = arr[idx]; if (!it2) return null;
            var tin2 = (it2['in'] !== undefined) ? parseFloat(it2['in']) : null;
            var tout2 = (it2['out'] !== undefined) ? parseFloat(it2['out']) : null;
            if (tin2 === null || isNaN(tin2) || tout2 === null || isNaN(tout2)) return null;
            return { tin: tin2, tout: tout2 };
        }
        // Unknown mode fallback
        return minMaxInOut(arr);
    }

    // Resolve timing span on a specific array using an explicit selector object.
    function resolveTimingSpanOnArray(videoObj, arrayKey, selector) {
        if (!videoObj || !arrayKey) return null;
        var arr = videoObj[arrayKey];
        if (!arr || !arr.length) return null;
        var sel = selector;
        if (!sel || typeof sel !== 'object') return minMaxInOut(arr);
        var mode = sel.mode || 'minMax';
        if (mode === 'minMax') return minMaxInOut(arr);
        if (mode === 'line') {
            var targetLine = sel.value;
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i]; if (!it) continue;
                var ln = (it.line !== undefined) ? parseInt(it.line, 10) : null;
                if (ln === targetLine) {
                    var tin = (it['in'] !== undefined) ? parseFloat(it['in']) : null;
                    var tout = (it['out'] !== undefined) ? parseFloat(it['out']) : null;
                    if (tin === null || isNaN(tin) || tout === null || isNaN(tout)) return null;
                    return { tin: tin, tout: tout };
                }
            }
            return null;
        }
        if (mode === 'index') {
            var idx = parseInt(sel.value, 10);
            if (isNaN(idx) || idx < 0 || idx >= arr.length) return null;
            var it2 = arr[idx]; if (!it2) return null;
            var tin2 = (it2['in'] !== undefined) ? parseFloat(it2['in']) : null;
            var tout2 = (it2['out'] !== undefined) ? parseFloat(it2['out']) : null;
            if (tin2 === null || isNaN(tin2) || tout2 === null || isNaN(tout2)) return null;
            return { tin: tin2, tout: tout2 };
        }
        return minMaxInOut(arr);
    }

    function setLayerInOut(layer, tin, tout, compDuration) {
        if (!layer) return;
        var start = (tin < 0) ? 0 : tin;
        var end = tout;
        if (compDuration && end > compDuration) end = compDuration;
        try { layer.startTime = (APPLY_INPOINT_TO_LAYER_STARTTIME ? start : 0); } catch (e) {}
        try { layer.inPoint = start; } catch (e1) {}
        try { layer.outPoint = end; } catch (e2) {}
    }

    function applyJSONTimingToComp(comp, data) {
        if (!data) return;
        var ids = buildOrientedVideoId(comp);
        if (!ids.base) { log("No base videoId derivable from comp: " + comp.name); return; }
        var v = null;
        // Try orientation-specific first
        if (ids.oriented) v = findVideoById(data, ids.oriented);
        // Fallback to base (backward compatibility / missing orientation entry)
        if (!v) v = findVideoById(data, ids.base);
        if (!v) {
            log("VideoId not found (tried oriented: '" + ids.oriented + "', base: '" + ids.base + "'). Orientation=" + ids.orientation);
            return;
        }
        var videoId = v.videoId || ids.oriented || ids.base;
        // Resolve timing spans per key (logo/claim/disclaimer) honoring TIMING_ITEM_SELECTOR
        var logoMM = resolveTimingSpan(v, 'logo', TIMING_ITEM_SELECTOR);
        // Support separate timing group for logo_02; when array is missing, use logo array with logo_02 selector; then fallback to logo
        var logo02MM = resolveTimingSpan(v, 'logo_02', TIMING_ITEM_SELECTOR);
        if (!logo02MM) {
            var selLogo02 = (TIMING_ITEM_SELECTOR && TIMING_ITEM_SELECTOR['logo_02']) ? TIMING_ITEM_SELECTOR['logo_02'] : null;
            if (selLogo02) logo02MM = resolveTimingSpanOnArray(v, 'logo', selLogo02);
            if (!logo02MM) logo02MM = logoMM;
        }
        var claimMM = resolveTimingSpan(v, 'claim', TIMING_ITEM_SELECTOR);
        var disclaimerMM = resolveTimingSpan(v, 'disclaimer', TIMING_ITEM_SELECTOR);
        // Helper to extract flag value given a configured key (checks video then video.metadata)
        function extractFlag(videoObj, keyName) {
            if (!videoObj || !keyName) return null;
            try {
                if (videoObj.hasOwnProperty(keyName) && videoObj[keyName] !== undefined && videoObj[keyName] !== null && videoObj[keyName] !== '') {
                    return String(videoObj[keyName]).toLowerCase();
                }
                if (videoObj.metadata && videoObj.metadata.hasOwnProperty(keyName) && videoObj.metadata[keyName] !== undefined && videoObj.metadata[keyName] !== null && videoObj.metadata[keyName] !== '') {
                    return String(videoObj.metadata[keyName]).toLowerCase();
                }
            } catch (eFlag) {}
            return null;
        }
        // Visibility flags (raw lower-cased values or null)
        var __modes = getModesForVideo(v);
        var disclaimerFlag = __modes.raw.disclaimer;
        var disclaimer02Flag = __modes.raw.disclaimer02;
        var subtitlesFlag = __modes.raw.subtitles;
        var logoAnimFlag = __modes.raw.logoAnim;
        var effectiveDisclaimerMode = __modes.effective.disclaimer;
        var effectiveDisclaimer02Mode = __modes.effective.disclaimer02;
        var effectiveSubtitlesMode = __modes.effective.subtitles;
        var effectiveLogoAnimMode = __modes.effective.logoAnim;
        // AUTO regime removed: no need to compute valid disclaimer intervals
        // Matching helpers using LAYER_NAME_CONFIG
        function matchesExact(name, list) {
            if (!name || !list || !list.length) return false;
            var n = String(name).toLowerCase();
            for (var i = 0; i < list.length; i++) {
                if (n === String(list[i]).toLowerCase()) return true;
            }
            return false;
        }

        function matchesContains(name, list) {
            if (!name || !list || !list.length) return false;
            var n = String(name).toLowerCase();
            for (var i = 0; i < list.length; i++) {
                if (n.indexOf(String(list[i]).toLowerCase()) !== -1) return true;
            }
            return false;
        }
        // Helper to test if layer is an image/bitmap footage
        function isImageFootageLayer(ly) {
            try {
                if (!ly || !ly.source) return false;
                var src = ly.source;
                if (!(src instanceof FootageItem)) return false;
                var hasVid = false, hasAud = false;
                try { hasVid = (src.hasVideo === true); } catch (e1) {}
                try { hasAud = (src.hasAudio === true); } catch (e2) {}
                // Images: video stream present in AE but no audio; often isStill=true
                var isStill = false;
                try { if (src.mainSource && src.mainSource.isStill === true) isStill = true; } catch (e3) {}
                var byExt = false;
                try {
                    var nm = String((src.name || "")).toLowerCase();
                    if (/\.(psd|psb|png|jpg|jpeg|tif|tiff|bmp|gif|ai)$/i.test(nm)) byExt = true;
                    var f = (src.mainSource && src.mainSource.file) ? src.mainSource.file : null;
                    if (!byExt && f) {
                        var fn = String((f.name || f.fsName || "")).toLowerCase();
                        if (/\.(psd|psb|png|jpg|jpeg|tif|tiff|bmp|gif|ai)$/i.test(fn)) byExt = true;
                    }
                } catch (e4) {}
                // Treat as image if isStill or byExt true and no audio
                return (isStill || byExt) && !hasAud;
            } catch (e) { return false; }
        }

        // Pre-pass removed; timing now controlled per-layer via TIMING_BEHAVIOR inside loop.

        // Apply JSON timings
        var appliedAny = false;
        for (var i = 1; i <= comp.numLayers; i++) {
            var ly = comp.layer(i);
            var nm = String(ly.name || "");
            // Logo matching (handle logo_anim first to avoid generic 'logo' contains-match)
            var isLogoAnim = (matchesExact(nm, LAYER_NAME_CONFIG.logoAnim.exact) || matchesContains(nm, LAYER_NAME_CONFIG.logoAnim.contains));
            var logoExact = matchesExact(nm, LAYER_NAME_CONFIG.logo.exact);
            var logoContains = matchesContains(nm, LAYER_NAME_CONFIG.logo.contains);
            var logoContainsOk = logoContains && (!LAYER_NAME_CONFIG.logo.imageOnlyForContains || isImageFootageLayer(ly));
            var isGenericLogo = (logoExact || logoContainsOk) && !isLogoAnim;
            // Dedicated match for logo_02 group
            var isLogo02 = (matchesExact(nm, (LAYER_NAME_CONFIG.logo_02 && LAYER_NAME_CONFIG.logo_02.exact) ? LAYER_NAME_CONFIG.logo_02.exact : []) || matchesContains(nm, (LAYER_NAME_CONFIG.logo_02 && LAYER_NAME_CONFIG.logo_02.contains) ? LAYER_NAME_CONFIG.logo_02.contains : []));

            // Apply for logo_anim first
            if (logoMM && isLogoAnim) {
                // Unified timing via helper to honor APPLY_INPOINT_TO_LAYER_STARTTIME consistently
                setLayerInOut(ly, logoMM.tin, logoMM.tout, comp.duration);
                log("Set logo_anim layer '" + nm + "' to [" + logoMM.tin + ", " + logoMM.tout + ")");
                // Debug: report startTime alignment state immediately after timing application
                try { log("logo_anim startTime alignment gate=" + (APPLY_INPOINT_TO_LAYER_STARTTIME ? "ON" : "OFF") + " | startTime=" + ly.startTime + " | inPoint=" + ly.inPoint); } catch(eDbgLA) {}
                // Optional gated stretch: speed up content while keeping outPoint at target time
                try {
                    if (ENABLE_LOGO_ANIM_TIMESTRETCH === true) {
                        var span = ly.outPoint - ly.inPoint;
                        if (span > 0 && span <= LOGO_ANIM_STRETCH_GATE_MAX_DURATION) {
                            // Compute desired stretch so that the first LOGO_ANIM_SOURCE_ANIM_DURATION seconds
                            // fit into (LOGO_ANIM_ANIM_END_FRACTION * span) seconds.
                            var targetAnimTime = LOGO_ANIM_ANIM_END_FRACTION * span;
                            // desired stretch percent = (target duration / source anim duration) * 100
                            var desiredPercent = (targetAnimTime / LOGO_ANIM_SOURCE_ANIM_DURATION) * 100.0;
                            // Base cap: do not exceed the configured base speed-up (i.e., do not go above LOGO_ANIM_STRETCH_PERCENT)
                            var basePercent = LOGO_ANIM_STRETCH_PERCENT;
                            // We want to make content faster (percent < 100). Use the smaller percent to be faster or equal to base.
                            // If desiredPercent is greater (slower) than basePercent, cap at basePercent; else use desiredPercent.
                            var finalPercent = desiredPercent;
                            if (finalPercent > basePercent) finalPercent = basePercent;
                            if (finalPercent < 1) finalPercent = 1; // avoid pathological values
                            // Apply stretch: prefer ly.stretch if available (UI property), fallback to ly.timeStretch
                            // 100 = normal speed, 50 = 2x speed
                            var beforeIn = ly.inPoint;
                            var beforeOut = ly.outPoint;
                            var appliedProp = null;
                            // Warn if time remap is enabled; AE may ignore stretch behavior with timeRemap
                            try { if (ly.timeRemapEnabled === true) { log("Note: timeRemapEnabled on '" + nm + "' — stretch may have no visible effect."); } } catch (eTR) {}
                            try { ly.stretch = finalPercent; appliedProp = 'stretch'; } catch (eS) {
                                try { ly.timeStretch = finalPercent; appliedProp = 'timeStretch'; } catch (eTS) {
                                    log("Stretch application failed for '"+nm+"' (no stretch property): " + eTS);
                                }
                            }
                            // Re-apply endpoints to keep target timing intact
                            try { ly.inPoint = beforeIn; } catch (eRI) {}
                            try { ly.outPoint = beforeOut; } catch (eRO) {}
                            if (APPLY_INPOINT_TO_LAYER_STARTTIME) { try { ly.startTime = beforeIn; } catch (eRS) {} }
                            // Readback and log
                            var rb = null; try { rb = (typeof ly.stretch !== 'undefined') ? ly.stretch : ((typeof ly.timeStretch !== 'undefined') ? ly.timeStretch : null); } catch (eRB) { rb = null; }
                            log("Applied gated stretch to '" + nm + "': span=" + span.toFixed(3) + "s, desired=" + desiredPercent.toFixed(2) + "%, final=" + finalPercent.toFixed(2) + "% (base=" + basePercent + "%)" + (rb!==null? (", readback=" + rb + "% via " + (appliedProp||"?")) : ""));
                        } else {
                            log("Stretch gated OFF for '" + nm + "' (span=" + (span>0?span.toFixed(3):span) + "s, gate max=" + LOGO_ANIM_STRETCH_GATE_MAX_DURATION + "s)");
                        }
                    }
                } catch (eStr) { log("Stretch application failed for '"+nm+"': " + eStr); }
                // visibility toggle: ON => logo_anim ON, logo OFF; OFF => logo_anim OFF, logo ON
                try { ly.enabled = (effectiveLogoAnimMode === 'on'); } catch (eAVis) {}
                log("logo_anim_flag => " + effectiveLogoAnimMode.toUpperCase() + " | '"+nm+"' -> " + (ly.enabled ? "ON" : "OFF"));
                // Optional start-time shift (cut beginning frames), preserving in/out
                try {
                    if (ENABLE_LOGO_ANIM_START_SHIFT === true) {
                        var durGate = LOGO_ANIM_START_SHIFT_VIDEO_DURATION_GATE;
                        var progressiveMul = LOGO_ANIM_START_SHIFT_PROGRESSIVE_MULTIPLIER;
                        var baseShift = LOGO_ANIM_START_SHIFT_SECONDS; // expected negative to move start earlier
                        var compDur = comp.duration;
                        if (compDur < durGate) {
                            var shift = baseShift;
                            if (compDur < (durGate / 2.0)) shift = baseShift * progressiveMul;
                            // Preserve in/out, just shift startTime. Clamp so inPoint doesn't underflow comp start.
                            var beforeInP = ly.inPoint;
                            var beforeOutP = ly.outPoint;
                            var targetStart = (typeof ly.startTime === 'number') ? (ly.startTime + shift) : (beforeInP + shift);
                            // Ensure startTime <= inPoint so the visible cut is kept; also keep non-negative
                            if (targetStart > beforeInP) targetStart = beforeInP;
                            if (targetStart < 0) targetStart = 0;
                            try { ly.startTime = targetStart; } catch (eSetS) {}
                            // Restore in/out explicitly
                            try { ly.inPoint = beforeInP; } catch (eSetI) {}
                            try { ly.outPoint = beforeOutP; } catch (eSetO) {}
                            log("Applied start shift to '"+nm+"': shift=" + shift.toFixed(3) + "s, startTime=" + targetStart.toFixed(3) + "s (compDur=" + compDur.toFixed(2) + ")");
                        } else {
                            log("Start shift gated OFF for '"+nm+"' (compDur=" + compDur.toFixed(2) + "s >= gate=" + durGate + "s)");
                        }
                    }
                } catch (eSh) { log("Start shift failed for '"+nm+"': " + eSh); }
                appliedAny = true;
                continue;
            }
            // Apply timing for logo_02 group/layers (if configured as 'timed')
            if (logo02MM && isLogo02) {
                setLayerInOut(ly, logo02MM.tin, logo02MM.tout, comp.duration);
                log("Set logo_02 layer '" + nm + "' to [" + logo02MM.tin + ", " + logo02MM.tout + ")");
            }

            // Apply for generic 'logo'
            if (logoMM && isGenericLogo) {
                if (APPLY_INPOINT_TO_LAYER_STARTTIME) {
                    var tinL = logoMM.tin < 0 ? 0 : logoMM.tin;
                    var toutL = logoMM.tout;
                    if (toutL > comp.duration) toutL = comp.duration;
                    try { ly.startTime = tinL; } catch (eLS) {}
                    try { ly.inPoint = tinL; } catch (eLI) {}
                    try { ly.outPoint = toutL; } catch (eLO) {}
                    log("Set logo layer '" + nm + "' (startTime=inPoint mode) to [" + tinL + ", " + toutL + ")");
                } else {
                    setLayerInOut(ly, logoMM.tin, logoMM.tout, comp.duration);
                    log("Set logo layer '" + nm + "' to [" + logoMM.tin + ", " + logoMM.tout + ")");
                }
                // visibility per logo_anim_flag inverse
                try { ly.enabled = (effectiveLogoAnimMode !== 'on'); } catch (eLVis) {}
                log("logo_anim_flag => " + effectiveLogoAnimMode.toUpperCase() + " | '"+nm+"' -> " + (ly.enabled ? "ON" : "OFF"));
                appliedAny = true;
                continue;
            }
            var timingBeh = resolveTimingBehaviorForLayer(nm) || 'asIs';

            // Claim timing (only when timed behavior)
            if (timingBeh === 'timed' && claimMM && (matchesExact(nm, LAYER_NAME_CONFIG.claim.exact) || matchesContains(nm, LAYER_NAME_CONFIG.claim.contains))) {
                setLayerInOut(ly, claimMM.tin, claimMM.tout, comp.duration);
                log("Set claim layer '" + nm + "' to [" + claimMM.tin + ", " + claimMM.tout + ")");
                appliedAny = true;
            }
            // Disclaimer (timed/span/asIs) + visibility
            var isDisclaimer = (matchesExact(nm, LAYER_NAME_CONFIG.disclaimer.exact) || matchesContains(nm, LAYER_NAME_CONFIG.disclaimer.contains));
            if (isDisclaimer) {
                if (timingBeh === 'timed' && disclaimerMM) {
                    setLayerInOut(ly, disclaimerMM.tin, disclaimerMM.tout, comp.duration);
                    log("Set disclaimer layer '" + nm + "' to [" + disclaimerMM.tin + ", " + disclaimerMM.tout + ")");
                    appliedAny = true;
                } else if (timingBeh === 'span') {
                    setLayerInOut(ly, 0, comp.duration, comp.duration);
                    log("Span disclaimer layer '" + nm + "' to full duration.");
                }
                try { ly.enabled = (effectiveDisclaimerMode === 'on'); } catch (eVis2) { log("Disclaimer visibility failed for '"+nm+"': " + eVis2); }
                if (!__modes.modes.disclaimer && disclaimerFlag) { logUnrecognizedFlag(DISCLAIMER_FLAG_KEY, disclaimerFlag, FLAG_VALUES, nm); }
            }
            // Second disclaimer
            if (nm.toLowerCase() === 'disclaimer_02') {
                if (timingBeh === 'timed' && disclaimerMM) {
                    setLayerInOut(ly, disclaimerMM.tin, disclaimerMM.tout, comp.duration);
                    log("Set disclaimer_02 layer '" + nm + "' to [" + disclaimerMM.tin + ", " + disclaimerMM.tout + ") (timed).");
                    appliedAny = true;
                } else if (timingBeh === 'span') {
                    setLayerInOut(ly, 0, comp.duration, comp.duration);
                    log("Span disclaimer_02 layer '" + nm + "' to full duration.");
                }
                try { ly.enabled = (effectiveDisclaimer02Mode === 'on'); } catch(eVisD2){ log("Disclaimer_02 visibility failed for '"+nm+"': " + eVisD2); }
                if (!__modes.modes.disclaimer02 && disclaimer02Flag) { logUnrecognizedFlag(DISCLAIMER_02_FLAG_KEY, disclaimer02Flag, FLAG_VALUES, nm); }
            }
            // Subtitles
            if (matchesExact(nm, LAYER_NAME_CONFIG.subtitles.exact) || matchesContains(nm, LAYER_NAME_CONFIG.subtitles.contains)) {
                if (timingBeh === 'span') { setLayerInOut(ly, 0, comp.duration, comp.duration); }
                try { ly.enabled = (effectiveSubtitlesMode === 'on'); } catch (eSV) { log("Subtitles visibility failed for '"+nm+"': " + eSV); }
                if (!__modes.modes.subtitles && subtitlesFlag) { logUnrecognizedFlag(SUBTITLES_FLAG_KEY, subtitlesFlag, FLAG_VALUES, nm); }
            }
            // Generic span for remaining groups/literals (excluding those already processed)
            if (timingBeh === 'span' && !isDisclaimer && nm.toLowerCase() !== 'disclaimer_02' && !(matchesExact(nm, LAYER_NAME_CONFIG.subtitles.exact) || matchesContains(nm, LAYER_NAME_CONFIG.subtitles.contains))) {
                setLayerInOut(ly, 0, comp.duration, comp.duration);
                log("Span layer '" + nm + "' to full duration.");
            }
        }
        if (!appliedAny) {
            log("No logo/claim timing applied for " + videoId + " (orientation=" + ids.orientation + ").");
        } else {
            log("Applied timing for videoId=" + videoId + " (orientation=" + ids.orientation + ").");
        }
    }

    // Locate template folder and comp ——————————————————————————
    var templateFolder = findFolderPath(proj.rootFolder, TEMPLATE_FOLDER_PATH);
    if (!templateFolder) {
        alertOnce("Template folder not found at " + pathToString(TEMPLATE_FOLDER_PATH));
        app.endUndoGroup();
        return;
    }

    var templateComps = [];
    collectCompsRecursive(templateFolder, templateComps);
    if (!templateComps.length) {
        alertOnce("No template composition found in " + pathToString(TEMPLATE_FOLDER_PATH));
        app.endUndoGroup();
        return;
    }
    // Partition templates into base vs extra by token match (case-insensitive contains)
    var __extraTokens = (typeof EXTRA_TAG_TOKENS !== 'undefined') ? EXTRA_TAG_TOKENS : [];
    var baseTemplateComps = [];
    var extraTemplateComps = [];
    if (__extraTokens && __extraTokens.length) {
        for (var tc=0; tc<templateComps.length; tc++) {
            var tComp = templateComps[tc];
            var isExtra = false; try { isExtra = nameMatchesAnyTokenContains(tComp.name, __extraTokens); } catch(eNT) { isExtra = false; }
            if (isExtra) extraTemplateComps.push(tComp); else baseTemplateComps.push(tComp);
        }
    } else {
        baseTemplateComps = templateComps.slice(0);
        extraTemplateComps = [];
    }

    var rawTargets = (opts && opts.comps && opts.comps.length) ? opts.comps : getSelectedComps();
    if (!rawTargets.length) {
        alertOnce("Select one or more target compositions.");
        app.endUndoGroup();
        return;
    }
    // Protect templates: skip any selected comps that live under the template folder
    var targets = [];
    var skippedProtectedCount = 0;
    for (var rt = 0; rt < rawTargets.length; rt++) {
        var rtComp = rawTargets[rt];
        if (isDescendantOfFolder(rtComp, templateFolder)) {
            skippedProtectedCount++;
            log("Skipping protected template comp '" + rtComp.name + "' (inside template folder)." );
        } else {
            targets.push(rtComp);
        }
    }
    if (!targets.length) {
        if (skippedProtectedCount > 0) {
            alertOnce("Selection contains only template comps (protected). Aborting.");
        } else {
            alertOnce("Select one or more target compositions.");
        }
        app.endUndoGroup();
        return;
    }

    // Per-target template selection (Solution B)
    // We'll log chosen template per target below.

    // Load JSON once
    var jsonData = loadProjectJSONByName("data.json");
    if (!jsonData) { log("JSON 'data.json' not found or failed to parse. Timing wiring will be skipped."); }

    // Copy layers from template to each target, preserving exact order
    // Strategy: iterate template layers top->bottom (excluding the underlying video),
    // copy each to target (paste inserts at top), then move the newly pasted layer
    // after the previously inserted one. This yields the same stacking as the template.
    var addedTotal = 0;
    var skippedARCount = 0;
    var skippedCopyTotal = 0; // total layers skipped due to skip-copy rules across all comps
    var __concise = [];
    // Track any extra duplicates created so downstream steps can include them
    var extraCreatedComps = [];
    for (var t = 0; t < targets.length; t++) {
        var comp = targets[t];

        // Helper to execute the copy for a given template/target pair and update aggregate counters
        function __doCopy(templateComp, compTarget){
            if (!templateComp || !compTarget) return;
            function __asciiOnly(s){
                try {
                    if (!s || !s.length) return "*";
                    var out = "";
                    for (var i=0; i<s.length; i++) {
                        var code = s.charCodeAt(i);
                        if (code >= 32 && code <= 126) out += s.charAt(i); // printable ASCII
                    }
                    return out.length ? out : "*";
                } catch(e){ return "*"; }
            }
            var __LOGM = __asciiOnly(LOG_MARKER);
            var excludeIdx = findBottomVideoFootageLayerIndex(templateComp);
            var __header = "Using template: " + templateComp.name + " -> target: " + compTarget.name + (excludeIdx > 0 ? (" (excluding layer #" + excludeIdx + ")") : "");
            log("\n" + __header);
            try { __concise.push(__header); } catch(eHC) {}
            var added = 0;
            var skipCopyCount = 0; // per-comp count
            var lastInserted = null;
            var mapNewLayers = [];
            var mapTemplateNames = [];
            var mapExpectedLocalPos = {}; // template child local Position at ref time (while still parented)

            // Resolve and apply reference time to both comps to make copy/unparent deterministic
            function __resolveRefTime(c){
                try {
                    if (!PARENTING_ASSIGN_AT_REF_TIME) return c.time;
                    var mode = String(PARENTING_REF_TIME_MODE||'').toLowerCase();
                    if (mode === 'zero') return 0.0;
                    if (mode === 'inpoint') { try { return (typeof c.displayStartTime==='number')? c.displayStartTime : (typeof c.workAreaStart==='number'? c.workAreaStart : 0.0); } catch(e) { return 0.0; } }
                    if (mode === 'custom') return (typeof PARENTING_REF_TIME_SECONDS==='number') ? PARENTING_REF_TIME_SECONDS : 0.0;
                    return c.time; // 'current'
                } catch(e){ return c.time; }
            }
            var __origTimeTargetCopy = null, __origTimeTplCopy = null, __tRefCopy = compTarget.time;
            try { __tRefCopy = __resolveRefTime(compTarget); } catch(eTR0) {}
            try { __origTimeTargetCopy = compTarget.time; if (PARENTING_ASSIGN_AT_REF_TIME) compTarget.time = __tRefCopy; } catch(eSetT) {}
            try { __origTimeTplCopy = templateComp.time; if (PARENTING_ASSIGN_AT_REF_TIME) templateComp.time = __tRefCopy; } catch(eSetTp) {}

            // Resolve flags for this comp ahead of copying to allow skip-copy behavior
            var ids = buildOrientedVideoId(compTarget);
            var vRec = null; if (ids.oriented) vRec = findVideoById(jsonData, ids.oriented); if (!vRec) vRec = findVideoById(jsonData, ids.base);
            function _extractFlagLocal(vobj, key) {
                if (!vobj || !key) return null;
                try {
                    if (vobj.hasOwnProperty(key) && vobj[key] !== undefined && vobj[key] !== null && vobj[key] !== '') return String(vobj[key]).toLowerCase();
                    if (vobj.metadata && vobj.metadata.hasOwnProperty(key) && vobj.metadata[key] !== undefined && vobj.metadata[key] !== null && vobj.metadata[key] !== '') return String(vobj.metadata[key]).toLowerCase();
                } catch (eF) {}
                return null;
            }
            function _interpret(raw, cfg) {
                if (!raw) return null; var val = String(raw).toLowerCase();
                function inList(list){ if(!list||!list.length) return false; for(var i=0;i<list.length;i++) if(val===String(list[i]).toLowerCase()) return true; return false; }
                if (inList(FLAG_VALUES.ON) && cfg===FLAG_VALUES) return 'on';
                if (inList(FLAG_VALUES.ON) && cfg===FLAG_VALUES) return 'on';
                if (inList(FLAG_VALUES.ON) && cfg===FLAG_VALUES) return 'on';
                if (inList(FLAG_VALUES.OFF) && cfg===FLAG_VALUES) return 'off';
                if (inList(FLAG_VALUES.OFF) && cfg===FLAG_VALUES) return 'off';
                if (inList(FLAG_VALUES.OFF) && cfg===FLAG_VALUES) return 'off';
                return null;
            }
            var _discMode = 'off', _disc02Mode = 'off', _subtMode = 'off', _logoAnimMode = 'off', _logo02Mode = 'off', _claim01Mode = 'off', _claim02Mode = 'off';
            if (vRec) {
                var __modes = getModesForVideo(vRec);
                _discMode = __modes.effective.disclaimer;
                _disc02Mode = __modes.effective.disclaimer02;
                _subtMode = __modes.effective.subtitles;
                _logoAnimMode = __modes.effective.logoAnim;
                _logo02Mode = __modes.effective.logo02;
                _claim01Mode = __modes.effective.claim01;
                _claim02Mode = __modes.effective.claim02;
            }

            // Helper: collect current layer references to detect the newly inserted one reliably
            function __collectLayerRefs(c){ var arr=[]; try { for(var ii=1; ii<=c.numLayers; ii++){ arr.push(c.layer(ii)); } } catch(e){} return arr; }

            // Iterate top -> bottom to mirror order precisely
            for (var li = 1; li <= templateComp.numLayers; li++) {
                if (li === excludeIdx) continue;
                var srcLayer = templateComp.layer(li);
                try {
                    var lname = String(srcLayer.name || "");
                    mapTemplateNames[li] = lname;
                    var isLogoAnim = nameMatchesGroup(lname, 'logoAnim');
                    var isLogoGeneric = nameMatchesGroup(lname, 'logo') && !isLogoAnim;
                    var isDisclaimer = nameMatchesGroup(lname, 'disclaimer');
                    var isDisclaimer02 = nameMatchesGroup(lname, 'disclaimer02') || (lname.toLowerCase() === 'disclaimer_02');
                    var isLogo02 = nameMatchesGroup(lname, 'logo_02') || (lname.toLowerCase() === 'logo_02');
                    var isClaim01 = (lname.toLowerCase() === 'claim_01');
                    var isClaim02 = (lname.toLowerCase() === 'claim_02');
                    var isSubtitles = nameMatchesGroup(lname, 'subtitles');
                    var alwaysCopyBaseLogo = nameInListCaseInsensitive(lname, (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.alwaysCopyLogoBaseNames) ? SKIP_COPY_CONFIG.alwaysCopyLogoBaseNames : []);
                    if (isLogoAnim && alwaysCopyBaseLogo) { isLogoAnim = false; isLogoGeneric = true; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.logoAnimOff) {
                        if (isLogoAnim && _logoAnimMode !== 'on') { log("Skip copy: '"+lname+"' (logo_anim OFF)" ); skipCopyCount++; continue; }
                        if (isLogoGeneric && _logoAnimMode === 'on' && !alwaysCopyBaseLogo) { log("Skip copy: '"+lname+"' (logo generic OFF due to logo_anim ON)" ); skipCopyCount++; continue; }
                    }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.disclaimerOff && isDisclaimer && _discMode !== 'on') { log("Skip copy: '"+lname+"' (disclaimer OFF)"); skipCopyCount++; continue; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.disclaimer02Off && isDisclaimer02 && _disc02Mode !== 'on') { log("Skip copy: '"+lname+"' (disclaimer_02 OFF)"); skipCopyCount++; continue; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.subtitlesOff && isSubtitles && _subtMode !== 'on') { log("Skip copy: '"+lname+"' (subtitles OFF)"); skipCopyCount++; continue; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.logo02Off && isLogo02 && _logo02Mode !== 'on') { log("Skip copy: '"+lname+"' (logo_02 OFF)"); skipCopyCount++; continue; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.claim01Off && isClaim01 && _claim01Mode !== 'on') { log("Skip copy: '"+lname+"' (claim_01 OFF)"); skipCopyCount++; continue; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.claim02Off && isClaim02 && _claim02Mode !== 'on') { log("Skip copy: '"+lname+"' (claim_02 OFF)"); skipCopyCount++; continue; }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.groups && SKIP_COPY_CONFIG.groups.enabled && SKIP_COPY_CONFIG.groups.keys && SKIP_COPY_CONFIG.groups.keys.length) {
                        var groupSkipped = false;
                        for (var gk = 0; gk < SKIP_COPY_CONFIG.groups.keys.length; gk++) {
                            var key = SKIP_COPY_CONFIG.groups.keys[gk]; if (!key) continue;
                            if (alwaysCopyBaseLogo && (key === 'logo' || key === 'logoAnim')) continue;
                            if (nameMatchesGroup(lname, key)) { log("Skip copy: '"+lname+"' (group skip: " + key + ")"); groupSkipped = true; break; }
                        }
                        if (groupSkipped) { skipCopyCount++; continue; }
                    }
                    if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.adHoc && SKIP_COPY_CONFIG.adHoc.enabled && SKIP_COPY_CONFIG.adHoc.tokens && SKIP_COPY_CONFIG.adHoc.tokens.length) {
                        if (!alwaysCopyBaseLogo && nameMatchesAnyTokenContains(lname, SKIP_COPY_CONFIG.adHoc.tokens)) { log("Skip copy: '"+lname+"' (ad-hoc skip)"); skipCopyCount++; continue; }
                    }

                    var origParent = null; var hadParent = false; var parentIdx = null;
                    // Capture expected local Position at ref time before altering parenting
                    try {
                        if (srcLayer.parent) {
                            var trSL = srcLayer.property("ADBE Transform Group");
                            var posSL = trSL ? trSL.property("ADBE Position") : null;
                            var px = null; var py = null; var pz = 0;
                            if (posSL) {
                                var v = posSL.value; if (v && v.length>=2) { px=v[0]; py=v[1]; if (v.length>2) pz=v[2]; }
                            } else if (trSL) {
                                try { px = trSL.property("ADBE Position_0").value; } catch(ePX) {}
                                try { py = trSL.property("ADBE Position_1").value; } catch(ePY) {}
                            }
                            if (px!==null && py!==null) mapExpectedLocalPos[li] = [px, py, pz];
                        }
                    } catch(eExpPos) {}
                    // Temporarily unparent at ref time so we don't bake animated offsets
                    try { if (srcLayer.parent) { origParent = srcLayer.parent; hadParent = true; parentIdx = origParent.index; srcLayer.parent = null; } } catch (ePar) {}

                    // Copy and detect the inserted layer robustly
                    var beforeRefs = __collectLayerRefs(compTarget);
                    var ret = null; try { ret = srcLayer.copyToComp(compTarget); } catch (eCp) { ret = null; }
                    var newLayer = null;
                    // Prefer API return when it's a valid Layer
                    try { if (ret && ret instanceof Layer) newLayer = ret; } catch (eRT) {}
                    if (!newLayer) {
                        try {
                            // Find the first layer reference not present before
                            for (var si=1; si<=compTarget.numLayers; si++){
                                var cand = compTarget.layer(si);
                                var found=false;
                                for (var bj=0; bj<beforeRefs.length; bj++){ if (beforeRefs[bj] === cand) { found=true; break; } }
                                if (!found) { newLayer = cand; break; }
                            }
                        } catch (eFind) { newLayer = null; }
                    }
                    if (!newLayer) { try { newLayer = compTarget.layer(1); } catch (eNL) {} }
                    try { if (hadParent) srcLayer.parent = origParent; } catch (eParR) {}
                    if (newLayer && lastInserted && newLayer !== lastInserted) {
                        var newWasLocked = false, lastWasLocked = false;
                        try { newWasLocked = (newLayer.locked === true); } catch (eNLk) {}
                        try { lastWasLocked = (lastInserted.locked === true); } catch (eLLk) {}
                        try { if (newWasLocked) newLayer.locked = false; } catch (eNul) {}
                        try { if (lastWasLocked) lastInserted.locked = false; } catch (eLul) {}
                        try { newLayer.moveAfter(lastInserted); } catch (eMove) {}
                        try { if (lastWasLocked) lastInserted.locked = true; } catch (eLrl) {}
                        try { if (newWasLocked) newLayer.locked = true; } catch (eNrl) {}
                    }
                    if (newLayer) lastInserted = newLayer;
                    mapNewLayers[li] = { newLayer: newLayer, parentIdx: parentIdx };
                    added++;
                } catch (eCopy) {
                    log("Skip layer #" + li + " ('" + srcLayer.name + "') — " + (eCopy && eCopy.message ? eCopy.message : eCopy));
                }
            }
            // Restore times after copy phase
            try { if (__origTimeTplCopy !== null && PARENTING_ASSIGN_AT_REF_TIME) templateComp.time = __origTimeTplCopy; } catch(eRtp) {}
            try { if (__origTimeTargetCopy !== null && PARENTING_ASSIGN_AT_REF_TIME) compTarget.time = __origTimeTargetCopy; } catch(eRtt) {}
            // Optional one-off parenting dump (planned relationships) before assignment
            function __shouldDumpParentingFor(compX){
                if (!DEBUG_PARENTING_DUMP) return false;
                if (!DEBUG_PARENTING_DUMP_ONLY_COMPS || !DEBUG_PARENTING_DUMP_ONLY_COMPS.length) return true;
                var nm = String((compX && compX.name) || "");
                for (var i=0;i<DEBUG_PARENTING_DUMP_ONLY_COMPS.length;i++) { if (nm === String(DEBUG_PARENTING_DUMP_ONLY_COMPS[i])) return true; }
                return false;
            }
            if (__shouldDumpParentingFor(compTarget)) {
                try {
                    log("\n[PARENTING DUMP planned] template='" + templateComp.name + "' -> target='" + compTarget.name + "'");
                    for (var di=1; di<=templateComp.numLayers; di++) {
                        if (di === excludeIdx) continue;
                        var tName = mapTemplateNames[di] || (templateComp.layer(di) ? templateComp.layer(di).name : "?");
                        var planned = mapNewLayers[di];
                        var pIdx0 = planned ? planned.parentIdx : null;
                        var pName0 = (pIdx0 && mapTemplateNames[pIdx0]) ? mapTemplateNames[pIdx0] : (pIdx0? (templateComp.layer(pIdx0)? templateComp.layer(pIdx0).name : "?") : null);
                        var childTgt0 = planned ? planned.newLayer : null;
                        var childIdxTgt0 = childTgt0 ? childTgt0.index : null;
                        log("  " + __LOGM + " [#"+di+"] '" + tName + "' parentIdx=" + (pIdx0===null||pIdx0===undefined?"-":("#"+pIdx0+" ('"+(pName0||"?")+"')")) + " -> targetIdx=" + (childIdxTgt0||"-") + " ('" + (childTgt0?childTgt0.name:"?") + "')");
                    }
                } catch(ePD) { log("[PARENTING DUMP error] " + ePD); }
            }
            // Optionally assign parenting at a stable reference time to avoid time-dependent offsets
            var __origTime = null;
            var __tRef = compTarget.time;
            function __resolveParentingRefTime(c){
                try {
                    if (!PARENTING_ASSIGN_AT_REF_TIME) return c.time;
                    var mode = String(PARENTING_REF_TIME_MODE||'').toLowerCase();
                    if (mode === 'zero') return 0.0;
                    if (mode === 'inpoint') { try { return (typeof c.displayStartTime==='number')? c.displayStartTime : (typeof c.workAreaStart==='number'? c.workAreaStart : 0.0); } catch(e) { return 0.0; } }
                    if (mode === 'custom') return (typeof PARENTING_REF_TIME_SECONDS==='number') ? PARENTING_REF_TIME_SECONDS : 0.0;
                    // 'current' or unknown
                    return c.time;
                } catch(e) { return c.time; }
            }
            try { __origTime = compTarget.time; __tRef = __resolveParentingRefTime(compTarget); if (PARENTING_ASSIGN_AT_REF_TIME) compTarget.time = __tRef; } catch(eTime) {}

            try {
                for (var li2 = 1; li2 <= templateComp.numLayers; li2++) {
                    if (li2 === excludeIdx) continue;
                    var entry = mapNewLayers[li2];
                    if (!entry || !entry.newLayer) continue;
                    var pIdx = entry.parentIdx;
                    if (pIdx === null || pIdx === undefined || pIdx === excludeIdx) continue;
                    var pEntry = mapNewLayers[pIdx];
                    if (!pEntry || !pEntry.newLayer) continue;
                    try {
                        var child = entry.newLayer;
                        var parent = pEntry.newLayer;
                        var beforePos = null, beforePosSep = null;
                        if (!child || !parent) { /* nothing to do */ }
                        else if (child === parent) {
                            try {
                                log("Skip parenting '" + child.name + "' to itself.");
                                if (__shouldDumpParentingFor(compTarget)) {
                                    log("  " + __LOGM + " Reason: template parentIdx=#" + pIdx + " maps to the same target layer.");
                                }
                            } catch (eLog0) {}
                        } else {
                            // Prevent cycles: parent cannot be one of child's descendants
                            var parentWasLocked = false, childWasLocked = false;
                            try { parentWasLocked = (parent.locked === true); } catch (ePLk) {}
                            try { childWasLocked = (child.locked === true); } catch (eCLk) {}
                            try { if (parentWasLocked) parent.locked = false; } catch (ePu) {}
                            try { if (childWasLocked) child.locked = false; } catch (eCu) {}

                            var safe = true;
                            try {
                                var cur = parent; var hops = 0;
                                while (cur && hops < 1024) {
                                    if (cur === child) { safe = false; break; }
                                    try { cur = cur.parent; } catch (ePP) { break; }
                                    hops++;
                                }
                            } catch (eChk) {}

                            if (DEBUG_PARENTING_DUMP_WITH_TRANSFORM && __shouldDumpParentingFor(compTarget)) {
                                try {
                                    var trC = child.property("ADBE Transform Group");
                                    var posC = trC ? trC.property("ADBE Position") : null;
                                    if (posC) beforePos = posC.value;
                                    else if (trC) beforePosSep = [ trC.property("ADBE Position_0") ? trC.property("ADBE Position_0").value : null, trC.property("ADBE Position_1") ? trC.property("ADBE Position_1").value : null ];
                                } catch (eBP) {}
                            }

                            if (!safe) {
                                try { log("Skip parenting '" + (child.name||"?") + "' to '" + (parent.name||"?") + "' to avoid cyclic parent/child."); } catch (eLog) {}
                            } else {
                                try {
                                    child.parent = parent;
                                    if (__shouldDumpParentingFor(compTarget)) {
                                        log("Parented: '" + (child.name||"?") + "' (#" + child.index + ") -> '" + (parent.name||"?") + "' (#" + parent.index + ") [template idx #" + li2 + " -> parentIdx #" + pIdx + "]" + (PARENTING_ASSIGN_AT_REF_TIME? (" @t=" + __tRef.toFixed(3) + "s") : ""));
                                    }
                                } catch (eSet) {
                                    try { log("Parenting failed for '" + (child.name||"?") + "' -> '" + (parent.name||"?") + "': " + eSet); } catch (eLog2) {}
                                }
                            }

                            // Restore locks
                            try { if (childWasLocked) child.locked = true; } catch (eCr) {}
                            try { if (parentWasLocked) parent.locked = true; } catch (ePr) {}
                            if (DEBUG_PARENTING_DUMP_WITH_TRANSFORM && __shouldDumpParentingFor(compTarget)) {
                                try {
                                    var trC2 = child.property("ADBE Transform Group");
                                    var posC2 = trC2 ? trC2.property("ADBE Position") : null;
                                    var afterPos = posC2 ? posC2.value : null;
                                    var beforeStr = beforePos ? ("["+beforePos.join(", ")+"]") : (beforePosSep ? ("["+beforePosSep.join(", ")+"]") : "-");
                                    var afterStr = afterPos ? ("["+afterPos.join(", ")+"]") : "-";
                                    log("  " + __LOGM + " Pos: before=" + beforeStr + ", after=" + afterStr);
                                    if (DEBUG_PARENTING_COMPARE_TEMPLATE_TARGET) {
                                        var exp = mapExpectedLocalPos[li2];
                                        if (exp && afterPos && afterPos.length>=2) {
                                            log("  " + __LOGM + " Compare template vs target (local Position @ref): template=["+exp[0]+", "+exp[1]+(exp.length>2? (", "+exp[2]) : "")+"] vs target=["+afterPos[0]+", "+afterPos[1]+(afterPos.length>2? (", "+afterPos[2]) : "")+"]");
                                        }
                                    }
                                } catch (eAP) {}
                            }
                        }
                    } catch (eSetP) {}
                }
            } catch (eMap) {}
            // Restore comp time
            try { if (__origTime !== null && PARENTING_ASSIGN_AT_REF_TIME) compTarget.time = __origTime; } catch(eRt) {}
            if (ENABLE_AUTOCENTER_ON_AR_MISMATCH && arMismatch(templateComp, compTarget)) {
                try { recenterUnparentedLayers(compTarget); } catch (eRC) { log("Auto-center failed for '" + compTarget.name + "': " + eRC); }
            }
            addedTotal += added;
            skippedCopyTotal += skipCopyCount;
            log("Skipped " + skipCopyCount + " layer(s) (copy) in '" + compTarget.name + "'.");
            log("Inserted " + added + " layer(s) into '" + compTarget.name + "'.");
            if (jsonData) { applyJSONTimingToComp(compTarget, jsonData); }
        }

        // Simple mode: insert the selected template comp as a single layer into the target
        function __doSimpleInsert(templateComp, compTarget) {
            if (!templateComp || !compTarget) return;
            function __asciiOnly(s){
                try {
                    if (!s || !s.length) return "*";
                    var out = "";
                    for (var i=0; i<s.length; i++) {
                        var code = s.charCodeAt(i);
                        if (code >= 32 && code <= 126) out += s.charAt(i); // printable ASCII
                    }
                    return out.length ? out : "*";
                } catch(e){ return "*"; }
            }
            var __LOGM = __asciiOnly(LOG_MARKER);
            var __header = "Simple mode: inserting template as layer: " + templateComp.name + " -> target: " + compTarget.name;
            log("\n" + __header);
            try { __concise.push(__header); } catch(eHC2) {}
            // Pre-insert adjustments in target comp
            try {
                if (SIMPLE_PREP_REMOVE_ALL_LAYERS) {
                    var removed = 0;
                    for (var ri = compTarget.numLayers; ri >= 1; ri--) {
                        try {
                            var lyR = compTarget.layer(ri);
                            var wasLocked = false; try { wasLocked = (lyR.locked === true); } catch(eLr) {}
                            try { if (wasLocked) lyR.locked = false; } catch(eUlR) {}
                            try { lyR.remove(); removed++; } catch(eRem) {}
                        } catch(eLoopR) {}
                    }
                    log("Simple prep: removed " + removed + " layer(s) in '" + compTarget.name + "'.");
                } else {
                    var changedVid = 0, changedAud = 0;
                    for (var pi = 1; pi <= compTarget.numLayers; pi++) {
                        var ly = compTarget.layer(pi);
                        var isFootage = false, hasVid = false, hasAud = false;
                        try { isFootage = (ly && ly.source && (ly.source instanceof FootageItem)); } catch(eF) { isFootage = false; }
                        if (!isFootage) continue;
                        try { hasVid = (ly.source.hasVideo === true); } catch(eV) {}
                        try { hasAud = (ly.source.hasAudio === true); } catch(eA) {}
                        if (SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO && hasVid) { try { ly.enabled = false; changedVid++; } catch(eEn) {} }
                        if (SIMPLE_PREP_MUTE_FOOTAGE_AUDIO && hasAud) { try { ly.audioEnabled = false; changedAud++; } catch(eAu) {} }
                    }
                    if (SIMPLE_PREP_DISABLE_FOOTAGE_VIDEO) log("Simple prep: disabled visibility on " + changedVid + " footage layer(s) in '" + compTarget.name + "'.");
                    if (SIMPLE_PREP_MUTE_FOOTAGE_AUDIO) log("Simple prep: muted audio on " + changedAud + " footage layer(s) in '" + compTarget.name + "'.");
                }
            } catch(ePrep) { log("Simple prep error for '" + compTarget.name + "': " + ePrep); }
            var newLayer = null;
            try { newLayer = compTarget.layers.add(templateComp); } catch (eAdd) { newLayer = null; }
            if (!newLayer) {
                log("Insert failed for '" + compTarget.name + "'.");
                return;
            }
            // Place above bottom-most video footage layer if present, else leave at top
            try {
                var botVidIdx = findBottomVideoFootageLayerIndex(compTarget);
                if (botVidIdx > 0) { try { newLayer.moveBefore(compTarget.layer(botVidIdx)); } catch(eMv) {} }
            } catch (eIdx) {}
            // Optionally mute audio on the inserted precomp layer
            var didMute = false;
            if (SIMPLE_MUTE_TEMPLATE_AUDIO === true) {
                try {
                    if (typeof newLayer.audioEnabled !== 'undefined') { newLayer.audioEnabled = false; didMute = true; }
                } catch (eAud) {}
            }
            // Optionally solo the inserted layer
            if (SIMPLE_SOLO_INSERTED_LAYER === true) {
                try { newLayer.solo = true; } catch(eSolo) {}
            }
            addedTotal += 1;
            log("Inserted 1 layer into '" + compTarget.name + "'." + (SIMPLE_MUTE_TEMPLATE_AUDIO ? " Audio muted." : " Audio left as-is.") + (SIMPLE_SOLO_INSERTED_LAYER ? " Solo ON." : ""));
        }

        // Prepare base template set (avoid picking an extra for the base run)
        var baseCandidates = baseTemplateComps && baseTemplateComps.length ? baseTemplateComps : templateComps;
        var templateComp = pickBestTemplateCompForTarget(baseCandidates, comp);
        if (!templateComp) {
            var requireAR = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch === true);
            var durStrict = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.enableDurationMatch === true && TEMPLATE_MATCH_CONFIG.requireDurationMatch === true);
            if (requireAR) {
                var tolMsg = (TEMPLATE_MATCH_CONFIG && typeof TEMPLATE_MATCH_CONFIG.arTolerance === 'number') ? TEMPLATE_MATCH_CONFIG.arTolerance : 0.001;
                log("No template matches AR within tolerance (±" + tolMsg + ") for '" + comp.name + "'. Skipping.");
                if (!__AR_SKIP_ALERT_SHOWN) {
                    try { alert("Some selected comps were skipped because no template matched their aspect ratio within tolerance (±" + tolMsg + "). You can adjust TEMPLATE_MATCH_CONFIG.arTolerance or disable TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch."); } catch (eA) {}
                    __AR_SKIP_ALERT_SHOWN = true;
                }
                skippedARCount++; // counts strict skips
                continue;
            }
            if (durStrict) {
                var dTol = (TEMPLATE_MATCH_CONFIG && typeof TEMPLATE_MATCH_CONFIG.durationToleranceSeconds === 'number') ? TEMPLATE_MATCH_CONFIG.durationToleranceSeconds : 0.5;
                log("No template matches duration within tolerance (±" + dTol + "s) for '" + comp.name + "'. Skipping.");
                if (!__DUR_SKIP_ALERT_SHOWN) {
                    try { alert("Some selected comps were skipped because no template matched their duration within tolerance (±" + dTol + "s). You can adjust TEMPLATE_MATCH_CONFIG.durationToleranceSeconds or disable TEMPLATE_MATCH_CONFIG.requireDurationMatch."); } catch (eAD) {}
                    __DUR_SKIP_ALERT_SHOWN = true;
                }
                skippedARCount++; // reuse counter for processed count; represents strict skips (AR or duration)
                continue;
            }
            templateComp = pickBestTemplateComp(baseCandidates);
        }
        // Optionally create and process EXTRA duplicate first to avoid inheriting base layers
        var createdExtra = false;
        var extraEligible = (typeof EXTRA_ENABLE !== 'undefined' && EXTRA_ENABLE === true) && isExtraAllowedForComp(comp, (typeof EXTRA_ALLOWED_AR !== 'undefined') ? EXTRA_ALLOWED_AR : []);
        if (extraEligible && extraTemplateComps && extraTemplateComps.length) {
            try {
                var dup = comp.duplicate();
                var desiredName = comp.name + (typeof EXTRA_OUTPUT_SUFFIX !== 'undefined' ? EXTRA_OUTPUT_SUFFIX : "_extra");
                var uniqueName = pickUniqueName(desiredName);
                try { dup.name = uniqueName; } catch(eRN) {}
                // Temporarily override duration strictness if extras provided overrides
                var savedEnableDur = TEMPLATE_MATCH_CONFIG.enableDurationMatch;
                var savedRequireDur = TEMPLATE_MATCH_CONFIG.requireDurationMatch;
                var savedDurTol    = TEMPLATE_MATCH_CONFIG.durationToleranceSeconds;
                var hadOverride = false;
                try {
                    if (EXTRA_REQUIRE_DURATION !== null || EXTRA_DURATION_TOL !== null) {
                        TEMPLATE_MATCH_CONFIG.enableDurationMatch = true;
                        if (EXTRA_REQUIRE_DURATION !== null) TEMPLATE_MATCH_CONFIG.requireDurationMatch = !!EXTRA_REQUIRE_DURATION;
                        if (EXTRA_DURATION_TOL !== null) TEMPLATE_MATCH_CONFIG.durationToleranceSeconds = EXTRA_DURATION_TOL;
                        hadOverride = true;
                    }
                } catch(eOV) {}
                var extraTpl = pickBestTemplateCompForTarget(extraTemplateComps, dup);
                // Restore immediately
                if (hadOverride) {
                    TEMPLATE_MATCH_CONFIG.enableDurationMatch = savedEnableDur;
                    TEMPLATE_MATCH_CONFIG.requireDurationMatch = savedRequireDur;
                    TEMPLATE_MATCH_CONFIG.durationToleranceSeconds = savedDurTol;
                }
                if (extraTpl) {
                    if (SIMPLE_INSERT_TEMPLATE_AS_LAYER) { __doSimpleInsert(extraTpl, dup); }
                    else { __doCopy(extraTpl, dup); }
                    extraCreatedComps.push(dup);
                    createdExtra = true;
                } else {
                    log("No EXTRA template matched for duplicate '" + dup.name + "' (tokens present but no candidate matched). Skipping extra.");
                    try { dup.remove(); } catch(eRmD) {}
                }
            } catch(eDup) { log("Extra duplicate failed for '" + comp.name + "': " + eDup); }
        } else if (extraEligible && (!extraTemplateComps || !extraTemplateComps.length)) {
            log("No EXTRA templates available by TAG_TOKENS; skipping extra for '" + comp.name + "'.");
        }

        // Now process the base/original comp
        if (SIMPLE_INSERT_TEMPLATE_AS_LAYER) { __doSimpleInsert(templateComp, comp); }
        else { __doCopy(templateComp, comp); }
    }

    var processedAll = targets.slice(0).concat(extraCreatedComps);
    var processedCount = processedAll.length - skippedARCount;
    var __summaryMsg = "Processed " + processedCount + " (including extras:" + extraCreatedComps.length + "), skipped " + skippedARCount + " due to AR/duration strict, skipped " + skippedProtectedCount + " protected template comps. Total layers added: " + addedTotal + ". Total layers skipped (copy): " + skippedCopyTotal + ".";
    log("\n" + __summaryMsg); // add the complete summarising alert at the end to the log as well
    alertOnce(__summaryMsg);
    app.endUndoGroup();
    return { processed: processedAll, addedTotal: addedTotal, pipelineConcise: __concise, pipelineSummary: __summaryMsg };
}

AE_AddLayers.run = function(opts){ return __AddLayers_coreRun(opts || {}); };

// Standalone auto-run only when not in pipeline
if (!__AE_PIPE__) {
    (function addLayersFromTemplate_IIFE(){ __AddLayers_coreRun({}); })();
}
