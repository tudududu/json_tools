// Script_ae: Pack output compositions.
// ------------------------------------------------------------
// Step 01: Duplicate selected compositions into project/out/ preserving
//           relative folder structure after an anchor folder (default: 'comps').
//           Renaming will be implemented in a later step.
//
// What it does now:
// 1) For every selected CompItem, duplicates it.
// 2) Determines relative path segments after the first ancestor folder named 'comps'.
// 3) Ensures those segments exist under project/out/ and moves the duplicate there.
// 4) Skips comps already inside project/out/ to prevent recursion.
// 5) Produces a summary alert + console log.
//
// Future extensions (not yet implemented):
// - Configurable renaming rules (orientation tags, suffixes, versioning)
// - Collision detection / overwrite strategies
// - Batch selection filters (e.g., only matching a pattern)
// - Metadata stamping (markers / comments)
// ------------------------------------------------------------
// Pipeline detection and API namespace
var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_Pack === 'undefined') { var AE_Pack = {}; }

function __Pack_coreRun(opts) {
    app.beginUndoGroup("Pack Output Comps");

    function buildTimestamp() {
        var d = new Date();
        function p(n){ return (n<10?'0':'')+n; }
        var yy = d.getFullYear();
        var mm = p(d.getMonth()+1);
        var dd = p(d.getDate());
        var HH = p(d.getHours());
        var MM = p(d.getMinutes());
        var SS = p(d.getSeconds());
        return ''+yy+mm+dd+'_'+HH+MM+SS;
    }

    function resolveLogBaseFolder() {
        if (USE_PROJECT_LOG_FOLDER) {
            try {
                if (app.project && app.project.file) {
                    var projFolder = app.project.file.parent; // Folder
                    if (projFolder && projFolder.exists) {
                        var logFolder = new Folder(projFolder.fsName + '/' + PROJECT_LOG_SUBFOLDER);
                        if (!logFolder.exists) { logFolder.create(); }
                        if (logFolder.exists) return logFolder;
                    }
                }
            } catch (eProj) {}
        }
        try { return Folder.desktop; } catch (eD) {}
        try { return Folder.temp; } catch (eT) {}
        return null;
    }

    // Config ------------------------------------------------
    var OUTPUT_ROOT_PATH = ["project", "out"];     // Base output path
    var ANCHOR_SOURCE_FOLDER = "comps";            // Mirror segments AFTER this folder
    var APPEND_SUFFIX = "_OUT";                    // Suffix for delivery/export comps
    var ENABLE_SUFFIX_APPEND = false;              // Toggle: when false, do NOT append APPEND_SUFFIX even if OUTPUT_NAME_CONFIG.appendSuffix is true
    var ENSURE_UNIQUE_NAME = true;                 // If a name collision occurs, append numeric counter
    var SKIP_IF_ALREADY_IN_OUTPUT = true;          // Avoid recursion
    var SKIP_IF_OUTPUT_ALREADY_EXISTS = true;      // If an output comp with the expected base name already exists in dest folder, skip instead of creating _01
    var DATA_JSON_PRIMARY_NAME = 'data.json';      // Primary expected data JSON name (moved here so ordering stays logical)

    // Logging configuration (detailed + summary + suppression + timestamped filenames)
    var ENABLE_FILE_LOG = true;                    // Per-phase master switch for any file logs
    var DRY_RUN_MODE = false;                      // When true: do NOT create folders or comps; only log what would happen
    var ENABLE_DETAILED_FILE_LOG = true;          // Master flag for detailed log
    var SUPPRESS_FILE_LOG_WHEN_NOT_DRY_RUN = false; // If true, disables detailed file log when DRY_RUN_MODE == false
    var DEBUG_NAMING = false;                      // When true: verbose logging for each token (detailed log only)
    var DEBUG_EXTRAS = true;                      // When true: dump normalized extras once
    var ENABLE_SUMMARY_LOG = true;                 // Produce a summary-only log (names list)
    var USE_PROJECT_LOG_FOLDER = true;             // Try to write logs under project ./log/ folder
    var PROJECT_LOG_SUBFOLDER = "log";             // Subfolder name
    var DEV_VIDEOID_SELF_TEST = false;             // Dev-only: when true, logs sample name -> videoId mappings
    var DEV_VIDEOID_SELF_TEST_USE_SELECTION = false; // When true, also log mappings for selected/auto-selected comps
    // Extra outputs naming integration: override MEDIA token for extras (e.g., TikTok)
    var ENABLE_EXTRA_MEDIA_OVERRIDE = true;        // When true, MEDIA token will be replaced by extra tag for extra outputs
    var EXTRA_OUTPUT_SUFFIX = "_tiktok";           // Suffix appended to extra duplicate comp names in Step 5 (case-insensitive)
    // Extra output comps (alternate resolutions)
    var ENABLE_EXTRA_OUTPUT_COMPS = true;         // Master toggle
    var EXTRA_OUTPUT_COMPS = {                     // Map: "AR|NNs" -> "WxH" string
    };
    var EXTRA_OUTPUTS_USE_DATE_SUBFOLDER = false;    // Place extras under out/YYMMDD/AR_WxH
    // Subfolder names for separating regular vs extras when ENABLE_EXTRA_OUTPUT_COMPS is true
    var OUTPUT_ESSENTIALS_DIRNAME = 'essentials';
    var OUTPUT_EXTRAS_DIRNAME = 'extras';
    // FS-based external extras map loading (dev override -> POST path -> prompt)
    var EXTRA_OUTPUTS_LOAD_FROM_FS = true;
    var EXTRA_OUTPUTS_POST_SUBPATH = ["IN","data","config","extra_outputs.json"];
    var EXTRA_OUTPUTS_DEV_FLAG_FILE = ".use_dev_extra_outputs";
    var EXTRA_OUTPUTS_DEV_REL_PATH = ["config","extra_outputs.json"];
    var EXTRA_OUTPUTS_PROMPT_IF_MISSING = false;
    // Data.json-based extras map loading (third source)
    var EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON = false;
    var EXTRA_OUTPUTS_DATA_JSON_PATHS = ["media"]; // array of path segments or list of segment-arrays
    
    // --------------------------------------------------------------
    // OUTPUT NAME CONFIG (modular token-based name builder)
    // Order of tokens here defines default ordering. You can enable/disable tokens individually.
    // Default structure requested:
    // CLIENT_BRAND_COUNTRY_JOBNUMBER_CAMPAIGN_TITLE_DURATION_MEDIA_ASPECTRATIO_RESOLUTION_FRAMERATE_SUBTITLES_SOUNDLEVEL_DATE_VERSION
    // MEDIA and SOUNDLEVEL are placeholders for future data sources (currently disabled by default).
    // DATE: auto-generated, format YYDDMM (Year last 2 digits + Day + Month)
    // VERSION: briefVersion => vXX (pad to 2 digits)
    // DURATION: per-video duration => NN s (pad to 2 digits if <10) plus trailing 's'
    // ASPECTRATIO: simplified ratio (e.g. 16x9)
    // RESOLUTION: WxH (e.g. 1920x1080)
    // FRAMERATE: XXfps
    // SUBTITLES: 'sub' if subtitle_flag == 'Y' (case-insensitive) or inferred from presence of subtitles array; else omitted
    // TITLE: per-video metadata.title (fallback from comp name)
    //
    // You can reorder OUTPUT_NAME_TOKENS, or set enabled:false to omit.
    // --------------------------------------------------------------

    var OUTPUT_NAME_TOKENS = [
        { key: 'CLIENT',       enabled: true },
        { key: 'BRAND',        enabled: true },
        { key: 'COUNTRY',      enabled: true },
        { key: 'LANGUAGE',     enabled: true },
        { key: 'JOBNUMBER',    enabled: true },
        { key: 'CAMPAIGN',     enabled: true },
        { key: 'TITLE',        enabled: true },
        { key: 'DURATION',     enabled: true },
        { key: 'MEDIA',        enabled: true }, // now enabled with default placeholder value
        { key: 'ASPECTRATIO',  enabled: true },
        { key: 'RESOLUTION',   enabled: true },
        { key: 'FRAMERATE',    enabled: true },
        { key: 'SUBTITLES',    enabled: true },
        { key: 'SOUNDLEVEL',   enabled: true }, // now enabled with default placeholder value
        { key: 'DATE',         enabled: true },
        { key: 'VERSION',      enabled: true }
    ];

    // Auto-disable logic: if the resolved BRAND value equals this string (case-insensitive), disable the BRAND token.
    // Set to null/empty string to disable this feature.
    var AUTO_DISABLE_BRAND_IF_VALUE = "noBrand"; // example trigger value
    // Auto-disable logic for TITLE: if resolved per-comp TITLE equals this, suppress it (per comp) without disabling globally.
    var AUTO_DISABLE_TITLE_IF_VALUE = "noTitle"; // example trigger value

    var OUTPUT_NAME_CONFIG = {
        delimiter: '_',
        skipEmpty: true,        // if a token resolves to empty/null, omit it
        appendSuffix: true      // append APPEND_SUFFIX to the built name (if not already there)
    };


    // Options overrides
    try {
        var o = opts && opts.options ? opts.options : null;
        if (o) {
            if (o.OUTPUT_ROOT_PATH !== undefined) OUTPUT_ROOT_PATH = o.OUTPUT_ROOT_PATH;
            if (o.ANCHOR_SOURCE_FOLDER !== undefined) ANCHOR_SOURCE_FOLDER = o.ANCHOR_SOURCE_FOLDER;
            if (o.SKIP_IF_ALREADY_IN_OUTPUT !== undefined) SKIP_IF_ALREADY_IN_OUTPUT = !!o.SKIP_IF_ALREADY_IN_OUTPUT;
            if (o.APPEND_SUFFIX !== undefined) APPEND_SUFFIX = !!o.APPEND_SUFFIX;
            if (o.ENABLE_SUFFIX_APPEND !== undefined) ENABLE_SUFFIX_APPEND = !!o.ENABLE_SUFFIX_APPEND;
            if (o.ENSURE_UNIQUE_NAME !== undefined) ENSURE_UNIQUE_NAME = !!o.ENSURE_UNIQUE_NAME;
            if (o.SKIP_IF_OUTPUT_ALREADY_EXISTS !== undefined) SKIP_IF_OUTPUT_ALREADY_EXISTS = !!o.SKIP_IF_OUTPUT_ALREADY_EXISTS;
            if (o.DATA_JSON_PRIMARY_NAME !== undefined) DATA_JSON_PRIMARY_NAME = o.DATA_JSON_PRIMARY_NAME;
            
            if (o.ENABLE_FILE_LOG !== undefined) ENABLE_FILE_LOG = !!o.ENABLE_FILE_LOG;
            if (o.DRY_RUN_MODE !== undefined) DRY_RUN_MODE = !!o.DRY_RUN_MODE;
            if (o.ENABLE_DETAILED_FILE_LOG !== undefined) ENABLE_DETAILED_FILE_LOG = !!o.ENABLE_DETAILED_FILE_LOG;
            if (o.SUPPRESS_FILE_LOG_WHEN_NOT_DRY_RUN !== undefined) SUPPRESS_FILE_LOG_WHEN_NOT_DRY_RUN = !!o.SUPPRESS_FILE_LOG_WHEN_NOT_DRY_RUN;
            if (o.DEBUG_NAMING !== undefined) DEBUG_NAMING = !!o.DEBUG_NAMING;
            if (o.DEBUG_EXTRAS !== undefined) DEBUG_EXTRAS = !!o.DEBUG_EXTRAS;
            if (o.ENABLE_SUMMARY_LOG !== undefined) ENABLE_SUMMARY_LOG = !!o.ENABLE_SUMMARY_LOG;
            if (o.USE_PROJECT_LOG_FOLDER !== undefined) USE_PROJECT_LOG_FOLDER = !!o.USE_PROJECT_LOG_FOLDER;
            if (o.PROJECT_LOG_SUBFOLDER !== undefined) PROJECT_LOG_SUBFOLDER = o.PROJECT_LOG_SUBFOLDER;
            if (o.DEV_VIDEOID_SELF_TEST !== undefined) DEV_VIDEOID_SELF_TEST = !!o.DEV_VIDEOID_SELF_TEST;
            if (o.DEV_VIDEOID_SELF_TEST_USE_SELECTION !== undefined) DEV_VIDEOID_SELF_TEST_USE_SELECTION = !!o.DEV_VIDEOID_SELF_TEST_USE_SELECTION;
            if (o.ENABLE_EXTRA_MEDIA_OVERRIDE !== undefined) ENABLE_EXTRA_MEDIA_OVERRIDE = !!o.ENABLE_EXTRA_MEDIA_OVERRIDE;
            if (o.EXTRA_OUTPUT_SUFFIX !== undefined) EXTRA_OUTPUT_SUFFIX = o.EXTRA_OUTPUT_SUFFIX;
            if (o.ENABLE_EXTRA_OUTPUT_COMPS !== undefined) ENABLE_EXTRA_OUTPUT_COMPS = !!o.ENABLE_EXTRA_OUTPUT_COMPS;
            if (o.EXTRA_OUTPUT_COMPS !== undefined) EXTRA_OUTPUT_COMPS = o.EXTRA_OUTPUT_COMPS || {};
            if (o.EXTRA_OUTPUTS_USE_DATE_SUBFOLDER !== undefined) EXTRA_OUTPUTS_USE_DATE_SUBFOLDER = !!o.EXTRA_OUTPUTS_USE_DATE_SUBFOLDER;
            if (o.OUTPUT_ESSENTIALS_DIRNAME !== undefined) OUTPUT_ESSENTIALS_DIRNAME = o.OUTPUT_ESSENTIALS_DIRNAME;
            if (o.OUTPUT_EXTRAS_DIRNAME !== undefined) OUTPUT_EXTRAS_DIRNAME = o.OUTPUT_EXTRAS_DIRNAME;
            if (o.EXTRA_OUTPUTS_LOAD_FROM_FS !== undefined) EXTRA_OUTPUTS_LOAD_FROM_FS = !!o.EXTRA_OUTPUTS_LOAD_FROM_FS;
            if (o.EXTRA_OUTPUTS_POST_SUBPATH !== undefined) EXTRA_OUTPUTS_POST_SUBPATH = o.EXTRA_OUTPUTS_POST_SUBPATH;
            if (o.EXTRA_OUTPUTS_DEV_FLAG_FILE !== undefined) EXTRA_OUTPUTS_DEV_FLAG_FILE = o.EXTRA_OUTPUTS_DEV_FLAG_FILE;
            if (o.EXTRA_OUTPUTS_DEV_REL_PATH !== undefined) EXTRA_OUTPUTS_DEV_REL_PATH = o.EXTRA_OUTPUTS_DEV_REL_PATH;
            if (o.EXTRA_OUTPUTS_PROMPT_IF_MISSING !== undefined) EXTRA_OUTPUTS_PROMPT_IF_MISSING = !!o.EXTRA_OUTPUTS_PROMPT_IF_MISSING;
            if (o.EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON !== undefined) EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON = !!o.EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON;
            if (o.EXTRA_OUTPUTS_DATA_JSON_PATHS !== undefined) EXTRA_OUTPUTS_DATA_JSON_PATHS = o.EXTRA_OUTPUTS_DATA_JSON_PATHS;
        }
        try {
            if (__AE_PIPE__ && __AE_PIPE__.optionsEffective) {
                if (__AE_PIPE__.optionsEffective.PHASE_FILE_LOGS_MASTER_ENABLE === false) { ENABLE_FILE_LOG = false; }
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.DEV_VIDEOID_SELF_TEST === true) { DEV_VIDEOID_SELF_TEST = true; } } catch(ePack) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.DEV_VIDEOID_SELF_TEST_USE_SELECTION === true) { DEV_VIDEOID_SELF_TEST_USE_SELECTION = true; } } catch(ePack2) {}
                // Borrow extras suffix from addLayers options if available
                try {
                    var ex = __AE_PIPE__.optionsEffective.addLayers && __AE_PIPE__.optionsEffective.addLayers.EXTRA_TEMPLATES;
                    if (ex && ex.OUTPUT_NAME_SUFFIX) EXTRA_OUTPUT_SUFFIX = ex.OUTPUT_NAME_SUFFIX;
                } catch(eEx) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.ENABLE_EXTRA_OUTPUT_COMPS === true) { ENABLE_EXTRA_OUTPUT_COMPS = true; } } catch(eP1) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUT_COMPS) { EXTRA_OUTPUT_COMPS = __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUT_COMPS; } } catch(eP2) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_USE_DATE_SUBFOLDER !== undefined) { EXTRA_OUTPUTS_USE_DATE_SUBFOLDER = !!__AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_USE_DATE_SUBFOLDER; } } catch(eP3) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.OUTPUT_ESSENTIALS_DIRNAME) { OUTPUT_ESSENTIALS_DIRNAME = __AE_PIPE__.optionsEffective.pack.OUTPUT_ESSENTIALS_DIRNAME; } } catch(eP4) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.OUTPUT_EXTRAS_DIRNAME) { OUTPUT_EXTRAS_DIRNAME = __AE_PIPE__.optionsEffective.pack.OUTPUT_EXTRAS_DIRNAME; } } catch(eP5) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_LOAD_FROM_FS !== undefined) { EXTRA_OUTPUTS_LOAD_FROM_FS = !!__AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_LOAD_FROM_FS; } } catch(eP6) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_POST_SUBPATH) { EXTRA_OUTPUTS_POST_SUBPATH = __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_POST_SUBPATH; } } catch(eP7) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_DEV_FLAG_FILE) { EXTRA_OUTPUTS_DEV_FLAG_FILE = __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_DEV_FLAG_FILE; } } catch(eP8) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_DEV_REL_PATH) { EXTRA_OUTPUTS_DEV_REL_PATH = __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_DEV_REL_PATH; } } catch(eP9) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_PROMPT_IF_MISSING !== undefined) { EXTRA_OUTPUTS_PROMPT_IF_MISSING = !!__AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_PROMPT_IF_MISSING; } } catch(eP10) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON !== undefined) { EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON = !!__AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON; } } catch(eP11) {}
                try { if (__AE_PIPE__.optionsEffective.pack && __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_DATA_JSON_PATHS) { EXTRA_OUTPUTS_DATA_JSON_PATHS = __AE_PIPE__.optionsEffective.pack.EXTRA_OUTPUTS_DATA_JSON_PATHS; } } catch(eP12) {}
            }
        } catch(eMSPK) {}
    } catch(eOpt){}

    // Logging setup ----------------------------------------
    var __timestamp = buildTimestamp();
    var __logBaseFolder = resolveLogBaseFolder();
    var __detailedLogFile = null;
    var __summaryLogFile = null;

    // Determine effective enabling considering suppression setting
    var __detailedEnabled = ENABLE_FILE_LOG && ENABLE_DETAILED_FILE_LOG && (DRY_RUN_MODE || !SUPPRESS_FILE_LOG_WHEN_NOT_DRY_RUN);

    if (__logBaseFolder && ENABLE_FILE_LOG) {
        if (__detailedEnabled) {
            try { __detailedLogFile = new File(__logBaseFolder.fsName + "/pack_output_comps_debug_" + __timestamp + ".log"); } catch(eDF) {}
        }
        if (ENABLE_SUMMARY_LOG) {
            try { __summaryLogFile = new File(__logBaseFolder.fsName + "/pack_output_comps_summary_" + __timestamp + ".log"); } catch(eSF) {}
        }
    }

    function writeFileLine(f, line) {
        if (!f) return;
        try { if (f.open('a')) { f.write(line + "\n"); f.close(); } } catch (eW) {}
    }

    // Tagged logger with gated forwarding of verbose lines into pipeline
    var __logger = null;
    function __bool(v, d){ try{ if(typeof v==='boolean') return v; if(typeof v==='string'){ var s=v.toLowerCase(); if(s==='true'||s==='1'||s==='yes'||s==='on') return true; if(s==='false'||s==='0'||s==='no'||s==='off') return false; } }catch(e){} return d; }
    function __shouldForwardVerbose(){
        try {
            var share = __AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASES_SHARE_PIPELINE_LOG === true;
            var p = (opts && opts.options && opts.options.PIPELINE_SHOW_VERBOSE_LOG !== undefined) ? __bool(opts.options.PIPELINE_SHOW_VERBOSE_LOG, false) : (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.pack ? __bool(__AE_PIPE__.optionsEffective.pack.PIPELINE_SHOW_VERBOSE_LOG, false) : false);
            return !!(share && p);
        } catch(e){ return false; }
    }
    try {
        if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') {
            __logger = __AE_PIPE__.getLogger('pack', { forwardToPipeline: __shouldForwardVerbose(), withTimestamps: false });
        }
    } catch(eLG) {}

    function log(msg) {
        // Write detailed file log if enabled
        if (__detailedEnabled && __detailedLogFile) writeFileLine(__detailedLogFile, msg);
        if (__logger) { try { __logger.info(msg); } catch(e) {} return; }
        try { $.writeln(msg); } catch (e1) {}
    }

    // Unified log marker (global from pipeline, ASCII-safe)
    var __LOGM = (function(){
        function asciiOnly(s){ try{ if(!s||!s.length) return "*"; var out=""; for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i); if(c>=32 && c<=126) out+=s.charAt(i);} return out.length?out:"*"; }catch(e){ return "*"; } }
        try { if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && typeof __AE_PIPE__.optionsEffective.LOG_MARKER === 'string') return asciiOnly(__AE_PIPE__.optionsEffective.LOG_MARKER); } catch(e){}
        try { if (opts && opts.options && typeof opts.options.LOG_MARKER === 'string') return asciiOnly(opts.options.LOG_MARKER); } catch(e2){}
        return "*";
    })();

    // Collect concise lines for pipeline
    var __conciseLines = [];
    function logConcise(msg){ try { __conciseLines.push(String(msg)); } catch(e){} }

    var __createdNames = [];      // for summary
    var __skippedNames = [];      // raw skipped entries
    var __skipCategories = {};    // tag -> array of entries
    var INCLUDE_NOT_COMP_REASON_IN_SUMMARY = false; // when false: hide individual '(not comp)' entries from the plain Skipped list, but STILL include their counts in categories
    var INCLUDE_TIMING_METRICS = true;             // timing section toggle
    var __scriptStartTime = new Date();

    function _extractReasonTag(full) {
        if (!full) return '';
        var li = full.lastIndexOf('(');
        var ri = full.lastIndexOf(')');
        if (li !== -1 && ri !== -1 && ri > li) return full.substring(li + 1, ri);
        return '';
    }
    function recordSkip(fullReason) {
        var tag = _extractReasonTag(fullReason);
        if (!__skipCategories[tag]) __skipCategories[tag] = [];
        __skipCategories[tag].push(fullReason); // always record for counts/categories
    }
    function flushSummary(createdCount, skippedArr) {
    if (!ENABLE_FILE_LOG || !ENABLE_SUMMARY_LOG || !__summaryLogFile) return;
        var lines = [];
        lines.push("Summary:");
        lines.push("Created " + createdCount + " composition(s)." + (DRY_RUN_MODE ? " (dry-run: not actually created)" : ""));
        if (__createdNames.length) {
            lines.push("Names:");
            for (var i=0;i<__createdNames.length;i++) lines.push(__createdNames[i]);
        }
        if (skippedArr && skippedArr.length) {
            var filtered = [];
            for (var sI=0; sI<skippedArr.length; sI++) {
                var entry = skippedArr[sI];
                if (!INCLUDE_NOT_COMP_REASON_IN_SUMMARY && entry.indexOf('(not comp)') !== -1) continue; // suppress listing, keep counts
                filtered.push(entry);
            }
            lines.push("Skipped (" + filtered.length + "):");
            for (var fI=0; fI<filtered.length; fI++) lines.push(filtered[fI]);
        }
        var catKeys = [];
        for (var k in __skipCategories) if (__skipCategories.hasOwnProperty(k)) catKeys.push(k);
        if (catKeys.length) {
            lines.push("Skip categories (counts):");
            for (var c=0;c<catKeys.length;c++) { var ck = catKeys[c]; lines.push(" " + __LOGM + " " + (ck || 'unknown') + ": " + __skipCategories[ck].length); }
        }
        if (INCLUDE_TIMING_METRICS) {
            var end = new Date();
            var ms = end.getTime() - __scriptStartTime.getTime();
            var sec = Math.round(ms/10)/100;
            var avgCreated = createdCount ? Math.round((ms/createdCount)/10)/100 : null;
            var totalSel = sel ? sel.length : 0;
            var avgSel = totalSel ? Math.round((ms/totalSel)/10)/100 : null;
            function __isoLike(d){ if(!d) return ''; function p(n){ return (n<10?'0':'')+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }
            lines.push("Timing:");
            lines.push(" start=" + __isoLike(__scriptStartTime));
            lines.push(" end=" + __isoLike(end));
            lines.push(" elapsedSeconds=" + sec);
            if (avgCreated !== null) lines.push(" avgPerCreatedSeconds=" + avgCreated);
            if (avgSel !== null) lines.push(" avgPerSelectedSeconds=" + avgSel);
        }
        for (var li=0; li<lines.length; li++) writeFileLine(__summaryLogFile, lines[li]);
    }

    function alertOnce(msg) { if (__AE_PIPE__) { log(msg); return; } try { alert(msg); } catch (e) {} }
    function alertOnce(msg) { if (__AE_PIPE__) { log(msg); return; } try { alert(msg); } catch (e) {} }

    // Optional dev-only self-test runs early; computes selection internally
    if (DEV_VIDEOID_SELF_TEST) {
        try { runDevVideoIdSelfTest(opts); } catch(eST) { try { log('[dev-self-test] error: ' + eST); } catch(eL) {} }
    }

    var proj = app.project;
    if (!proj) { alertOnce("No project open."); app.endUndoGroup(); return; }

    var sel = (opts && opts.comps && opts.comps.length) ? opts.comps : proj.selection;
    if (!sel || !sel.length) { alertOnce("Select one or more compositions."); app.endUndoGroup(); return { outputComps: [] }; }

    function findChildFolderByName(parent, name) {
        for (var i = 1; i <= parent.numItems; i++) {
            var it = parent.items[i];
            if (it && it instanceof FolderItem && it.name === name) return it;
        }
        return null;
    }
    function ensureChildFolder(parent, name) {
        var f = findChildFolderByName(parent, name);
        if (f) return f;
        var nf = app.project.items.addFolder(name); nf.parentFolder = parent; return nf;
    }
    function ensurePath(root, segments) {
        var cur = root;
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (!seg) continue;
            cur = ensureChildFolder(cur, seg);
        }
        return cur;
    }
    function ensureOutputRoot() {
        var cur = proj.rootFolder;
        for (var i = 0; i < OUTPUT_ROOT_PATH.length; i++) {
            cur = ensureChildFolder(cur, OUTPUT_ROOT_PATH[i]);
        }
        return cur;
    }
    function collectAncestorNames(item) {
        var names = [];
        try {
            var f = item.parentFolder;
            while (f && f !== proj.rootFolder) {
                names.push(String(f.name || ""));
                f = f.parentFolder;
            }
        } catch (e) {}
        names.reverse(); // top-down
        return names;
    }
    function relativeSegmentsAfterAnchor(item, anchorLower) {
        var ancestors = collectAncestorNames(item);
        var idx = -1;
        for (var i = 0; i < ancestors.length; i++) {
            if (String(ancestors[i]).toLowerCase() === anchorLower) { idx = i; break; }
        }
        if (idx < 0) return [];
        var out = [];
        for (var j = idx + 1; j < ancestors.length; j++) out.push(ancestors[j]);
        return out;
    }
    function isDescendantOf(item, folder) {
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

    // More robust check: item is inside a folder named 'out' whose direct parent is named 'project' (case-insensitive)
    function isInOutputPath(item) {
        if (!item) return false;
        try {
            var f = item.parentFolder;
            while (f && f !== proj.rootFolder) {
                var fname = String(f.name || "").toLowerCase();
                if (fname === "out") {
                    var parent = f.parentFolder;
                    if (parent && String(parent.name || "").toLowerCase() === "project") return true;
                }
                f = f.parentFolder;
            }
        } catch (e) {}
        return false;
    }

    function baseOutputName(sourceName) {
        var nm = String(sourceName || "");
        var suffix = APPEND_SUFFIX;
        if (!suffix) return nm;
        var lower = nm.toLowerCase();
        var suffLower = suffix.toLowerCase();
        // Manual endsWith (ExtendScript lacks String.prototype.endsWith)
        if (lower.length >= suffLower.length) {
            if (lower.indexOf(suffLower, lower.length - suffLower.length) !== -1) {
                return nm; // already ends with suffix
            }
        }
        return nm + suffix;
    }

    function __stringEndsWith(str, suf){
        if(!str || !suf) return false;
        var s = String(str); var t = String(suf);
        var sl = s.length; var tl = t.length; if (tl === 0) return false; if (sl < tl) return false;
        return s.indexOf(t, sl - tl) !== -1;
    }

    // Detect extras from comp.name using configured suffix; return label (e.g., 'TIKTOK') or null
    function getExtraMediaLabelForComp(comp){
        if(!ENABLE_EXTRA_MEDIA_OVERRIDE || !comp) return null;
        var nm = String(comp.name || '');
        var suf = EXTRA_OUTPUT_SUFFIX ? String(EXTRA_OUTPUT_SUFFIX) : '';
        if(!suf) return null;
        var nmL = nm.toLowerCase();
        var sufL = suf.toLowerCase();
        if(__stringEndsWith(nmL, sufL)){
            // Derive label from suffix by stripping leading separators and uppercasing
            var raw = suf.replace(/^[_\-\s]+/, '');
            if(!raw) return null;
            return raw.toUpperCase();
        }
        return null;
    }

    // ------------------ JSON + video metadata helpers ------------------
    function findProjectItemByName(name) {
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (it && String(it.name) === String(name)) return it;
        }
        return null;
    }
    function readTextFile(file) {
        if (!file || !file.exists) return null;
        var txt = null;
        try {
            file.encoding = 'UTF-8';
            if (file.open('r')) { txt = file.read(); file.close(); }
        } catch (e) { try { file.close(); } catch (e2) {} }
        return txt;
    }
    function parseJSONSafe(text) {
        if (!text) return null;
        try { if (typeof JSON !== 'undefined' && JSON.parse) return JSON.parse(text); } catch (e) {}
        try { return eval('(' + text + ')'); } catch (e2) { return null; }
    }
    function loadProjectJSONByName(name) {
        var it = findProjectItemByName(name);
        if (!it || !(it instanceof FootageItem) || !it.mainSource) return null;
        var f = null; try { f = it.mainSource.file; } catch (e) {}
        if (!f) return null;
        var txt = readTextFile(f);
        if (!txt) return null;
        return parseJSONSafe(txt);
    }

    // -------- FS-based extra_outputs.json loader (dev -> POST -> optional prompt) --------
    function __joinFs(a,b){ if(!a) return b||""; if(!b) return a||""; var sep = (/\\$/.test(a)||/\/$/.test(a))?"":"/"; return a+sep+b; }
    function __resolveDevExtrasFile(){
        try {
            var here = File($.fileName).parent;                 // .../script/ae/phase
            var aeFolder = here ? here.parent : null;           // .../script/ae
            var cfgDir = aeFolder ? new Folder(__joinFs(aeFolder.fsName, "config")) : null;
            if (!cfgDir || !cfgDir.exists) return null;
            var flagName = EXTRA_OUTPUTS_DEV_FLAG_FILE ? String(EXTRA_OUTPUTS_DEV_FLAG_FILE) : ".use_dev_extra_outputs";
            var flag = new File(__joinFs(cfgDir.fsName, flagName));
            if (!flag.exists) return null;
            // Resolve dev extras path RELATIVE TO script/ae to avoid double 'config' joining
            var devSegs = (EXTRA_OUTPUTS_DEV_REL_PATH && EXTRA_OUTPUTS_DEV_REL_PATH.length) ? EXTRA_OUTPUTS_DEV_REL_PATH : ["config","extra_outputs.json"];
            var devRel = devSegs.join("/");
            var baseRel = aeFolder ? aeFolder.fsName : cfgDir.fsName; // prefer script/ae root
            var fullPath = __joinFs(baseRel, devRel);
            var f = new File(fullPath);
            if (!f.exists) { try { log("Extras config: DEV flag present, missing file at " + fullPath); } catch(eL) {} }
            return (f && f.exists) ? f : null;
        } catch(e){ return null; }
    }
    function __resolvePostExtrasFile(){
        try {
            var proj = app.project;
            if (!proj || !proj.file) return null;
            var work = proj.file.parent, post = work ? work.parent : null;
            if (!post || !post.exists) return null;
            var segs = (EXTRA_OUTPUTS_POST_SUBPATH && EXTRA_OUTPUTS_POST_SUBPATH.length) ? EXTRA_OUTPUTS_POST_SUBPATH : ["IN","data","config","extra_outputs.json"];
            var p = post.fsName;
            for (var i=0;i<segs.length;i++) p = __joinFs(p, segs[i]);
            var f = new File(p);
            return (f && f.exists) ? f : null;
        } catch(e){ return null; }
    }
    function __readTextFileSafe(file){
        if (!file || !file.exists) return null;
        var txt = null;
        try { if (file.open('r')) { txt = file.read(); file.close(); } } catch(e){ try{ file.close(); }catch(e2){} }
        return txt;
    }
    // Resolve extras map from data.json using configured paths
    function __resolveFromDataJson(json){
        try {
            if (!EXTRA_OUTPUTS_LOAD_FROM_DATA_JSON || !json) return null;
            var paths = EXTRA_OUTPUTS_DATA_JSON_PATHS;
            if (!paths) return null;
            function getBySegments(obj, segs){ var cur = obj; for (var i=0;i<segs.length;i++){ var k = segs[i]; if(!cur || typeof cur !== 'object' || !(k in cur)) return null; cur = cur[k]; } return (cur && typeof cur === 'object') ? cur : null; }
            // Support both a single path array or a list of arrays/strings
            if (paths instanceof Array) {
                // If first element is string and rest not arrays, treat as single path
                var treatAsList = false;
                for (var pi=0; pi<paths.length; pi++) { if (paths[pi] instanceof Array) { treatAsList = true; break; } }
                if (!treatAsList) {
                    // Single-level: could be ["media"] or ["metadataGlobal","extra_outputs"]
                    var segs = [];
                    for (var si=0; si<paths.length; si++) segs.push(String(paths[si]));
                    var v1 = getBySegments(json, segs);
                    if (v1) { try { log("Extras config: data.json -> " + segs.join("/")); } catch(eL) {} return v1; }
                } else {
                    // List of candidate paths
                    for (var li=0; li<paths.length; li++) {
                        var pth = paths[li];
                        var segs2 = (pth instanceof Array) ? pth : [String(pth)];
                        var v2 = getBySegments(json, segs2);
                        if (v2) { try { log("Extras config: data.json -> " + segs2.join("/")); } catch(eL2) {} return v2; }
                    }
                }
            }
        } catch(eDJ){ /* ignore */ }
        return null;
    }
    function loadExtrasMapFromFs(){
        try {
            if (!EXTRA_OUTPUTS_LOAD_FROM_FS) return null;
            var devF = __resolveDevExtrasFile();
            if (devF) {
                var txtD = __readTextFileSafe(devF);
                var objD = parseJSONSafe(txtD);
                if (objD && typeof objD === 'object') { try{ log("Extras config: DEV -> " + devF.fsName); }catch(eL){} return objD; }
            }
            var postF = __resolvePostExtrasFile();
            if (postF) {
                var txtP = __readTextFileSafe(postF);
                var objP = parseJSONSafe(txtP);
                if (objP && typeof objP === 'object') { try{ log("Extras config: POST -> " + postF.fsName); }catch(eL2){} return objP; }
            }
            if (EXTRA_OUTPUTS_PROMPT_IF_MISSING) {
                try {
                    var picked = File.openDialog("Select extra_outputs.json", "JSON:*.json");
                    if (picked) {
                        var txtX = __readTextFileSafe(picked);
                        var objX = parseJSONSafe(txtX);
                        if (objX && typeof objX === 'object') { try{ log("Extras config: Prompt -> " + picked.fsName); }catch(eL3){} return objX; }
                    }
                } catch(ePd){}
            }
        } catch(eL){ try{ log("Extras config: FS load error: " + eL); }catch(eLog){} }
        return null;
    }

    function tryLoadAnyDataJSON() {
        // Scan project for any .json footage with metadataGlobal/meta_global keys
        var best = null;
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (!(it instanceof FootageItem)) continue;
            var nm = String(it.name || '');
            if (nm.toLowerCase().indexOf('.json') === -1) continue;
            var f = null; try { f = it.mainSource.file; } catch (eF) {}
            if (!f || !f.exists) continue;
            var txt = readTextFile(f);
            if (!txt) continue;
            var parsed = parseJSONSafe(txt);
            if (!parsed) continue;
            if (parsed.metadataGlobal || parsed.meta_global) {
                // prefer one with more videos entries
                if (!best) best = { data: parsed, name: nm, videos: (parsed.videos && parsed.videos.length) ? parsed.videos.length : 0 };
                else {
                    var count = (parsed.videos && parsed.videos.length) ? parsed.videos.length : 0;
                    if (count > best.videos) best = { data: parsed, name: nm, videos: count };
                }
            }
        }
        return best;
    }

    function pad2(n) { n = parseInt(n,10); if (isNaN(n)) return '00'; return (n < 10 ? '0' + n : '' + n); }

    function gcd(a,b){ a=Math.abs(a); b=Math.abs(b); while(b){ var t=a%b; a=b; b=t;} return a||1; }
    function aspectRatioString(w,h){ if(!w||!h) return ''; var g=gcd(w,h); var aw=w/g; var ah=h/g; return aw + 'x' + ah; }

    // -------- Extra outputs helpers --------
    function __normalizeDurToken(tok){
        if(!tok) return null;
        var m = String(tok).match(/^(\d{1,4})s$/i);
        if(m) { var nn = parseInt(m[1],10); return (nn<10?('0'+nn):(''+nn)) + 's'; }
        var m2 = String(tok).match(/(\d{1,4})s/i);
        if(m2) { var nn2 = parseInt(m2[1],10); return (nn2<10?('0'+nn2):(''+nn2)) + 's'; }
        return null;
    }
    function __parseWxH(val){
        if(!val) return null;
        var s = String(val);
        var m = s.match(/^(\d{2,5})x(\d{2,5})$/);
        if(!m) return null;
        var w = parseInt(m[1],10), h = parseInt(m[2],10);
        if(isNaN(w) || isNaN(h) || w<=0 || h<=0) return null;
        return {w:w, h:h};
    }
    // Sanitize media label to be filesystem-safe while preserving case
    function __sanitizeMediaLabel(lbl){
        if(lbl === undefined || lbl === null) return null;
        var s = String(lbl);
        s = s.replace(/^\s+|\s+$/g, '');
        if(!s) return null;
        s = s.replace(/\s+/g, '');
        s = s.replace(/[\\\/:*?"<>|]/g, '');
        s = s.replace(/__+/g, '');
        return s;
    }
    function __safeSanMedia(lbl){
        try { return __sanitizeMediaLabel(lbl); } catch(e) {
            try {
                if(lbl === undefined || lbl === null) return null;
                var s = String(lbl);
                s = s.replace(/^\s+|\s+$/g, '');
                if(!s) return null;
                s = s.replace(/\s+/g, '_');
                s = s.replace(/[\\\/:*?"<>|]/g, '_');
                s = s.replace(/__+/g, '_');
                return s;
            } catch(e2) { return null; }
        }
    }
    // Normalize extra key (from config or source suffix) for case-insensitive matching and filesystem-safe usage
    function __normalizeExtraKey(k){
        if(k === undefined || k === null) return null;
        var s = String(k);
        // strip leading separators/spaces
        s = s.replace(/^[\s_\-]+/, '');
        try { s = __sanitizeMediaLabel(s); } catch(eNK) { s = __safeSanMedia(s); }
        if(!s) return null;
        return s.toLowerCase();
    }
    function parseExtraOutputConfig(map){
        var out = [];
        try {
            if (!map) return out;
            for (var k in map) {
                if (!map.hasOwnProperty(k)) continue;
                var keyStr = String(k);
                var parts = keyStr.split('|');
                if (parts.length !== 2) { recordSkip("EXTRA config '"+k+"' (config invalid)"); continue; }
                var arKeyRaw = String(parts[0]);
                var extraKey = null;
                var arKey = arKeyRaw;
                var usIdx = arKeyRaw.indexOf('_');
                if (usIdx !== -1) {
                    arKey = arKeyRaw.substring(0, usIdx);
                    extraKey = __normalizeExtraKey(arKeyRaw.substring(usIdx + 1));
                }
                var durTok = __normalizeDurToken(parts[1]);
                if (!durTok) { recordSkip("EXTRA config '"+k+"' (config invalid)"); continue; }
                var seconds = parseInt(String(durTok).replace(/s$/i,''),10);
                if(isNaN(seconds) || seconds<=0) { recordSkip("EXTRA config '"+k+"' (duration invalid)"); continue; }

                var val = map[k];
                // Allow arrays of values per key; flatten to multiple entries
                if (val && (val instanceof Array)) {
                    for (var ai = 0; ai < val.length; ai++) {
                        var elem = val[ai];
                        var mediaLabel = null;
                        var dim = null;
                        if (elem && typeof elem === 'object' && !(elem instanceof Array)) {
                            if (elem.size) dim = __parseWxH(elem.size);
                            if (!dim && (elem.w || elem.h)) {
                                var wNumA = parseInt(elem.w,10), hNumA = parseInt(elem.h,10);
                                if(!isNaN(wNumA) && !isNaN(hNumA) && wNumA>0 && hNumA>0) dim = { w: wNumA, h: hNumA };
                            }
                            try { mediaLabel = __sanitizeMediaLabel(elem.media || elem.label); } catch(eSanArr) { mediaLabel = __safeSanMedia(elem.media || elem.label); }
                        } else if (typeof elem === 'string') {
                            var sValA = String(elem);
                            var atIdxA = sValA.indexOf('@');
                            if (atIdxA !== -1) {
                                var sizePartA = sValA.substring(0, atIdxA);
                                var mediaPartA = sValA.substring(atIdxA+1);
                                dim = __parseWxH(sizePartA);
                                try { mediaLabel = __sanitizeMediaLabel(mediaPartA); } catch(eSanArr2) { mediaLabel = __safeSanMedia(mediaPartA); }
                            } else {
                                dim = __parseWxH(sValA);
                            }
                        } else {
                            recordSkip("EXTRA config '"+k+"' (array element unsupported)");
                            continue;
                        }
                        if(!dim) { recordSkip("EXTRA config '"+k+"' (array element size invalid)"); continue; }
                        out.push({ arKey: arKey, extraKey: extraKey, durToken: durTok, seconds: seconds, width: dim.w, height: dim.h, mediaLabel: mediaLabel, sourceKey: keyStr });
                    }
                } else {
                    var mediaLabel = null;
                    var dim = null;
                    if (val && typeof val === 'object' && !(val instanceof Array)) {
                        // Object form: { size: "WxH", media: "TikTok" } or { w:720, h:1280, media: "TikTok" }
                        if (val.size) dim = __parseWxH(val.size);
                        if (!dim && (val.w || val.h)) {
                            var wNum = parseInt(val.w,10), hNum = parseInt(val.h,10);
                            if(!isNaN(wNum) && !isNaN(hNum) && wNum>0 && hNum>0) dim = { w: wNum, h: hNum };
                        }
                        try { mediaLabel = __sanitizeMediaLabel(val.media || val.label); } catch(eSan1) { mediaLabel = __safeSanMedia(val.media || val.label); }
                    } else if (typeof val === 'string') {
                        // String form: "WxH" or compact "WxH@Media"
                        var sVal = String(val);
                        var atIdx = sVal.indexOf('@');
                        if (atIdx !== -1) {
                            var sizePart = sVal.substring(0, atIdx);
                            var mediaPart = sVal.substring(atIdx+1);
                            dim = __parseWxH(sizePart);
                            try { mediaLabel = __sanitizeMediaLabel(mediaPart); } catch(eSan2) { mediaLabel = __safeSanMedia(mediaPart); }
                        } else {
                            dim = __parseWxH(sVal);
                        }
                    } else {
                        recordSkip("EXTRA config '"+k+"' (unsupported value type)");
                        continue;
                    }
                    if(!dim) { recordSkip("EXTRA config '"+k+"' (size invalid)"); continue; }
                    out.push({ arKey: arKey, extraKey: extraKey, durToken: durTok, seconds: seconds, width: dim.w, height: dim.h, mediaLabel: mediaLabel, sourceKey: keyStr });
                }
            }
        } catch(eCfg) { /* ignore */ }
        return out;
    }
    function scaleLayerToFit(layer, targetW, targetH, sourceW, sourceH){
        try {
            var k = Math.min(targetW/sourceW, targetH/sourceH) * 100.0; // allow upscaling
            var cx = targetW/2.0, cy = targetH/2.0;
            layer.property('Position').setValue([cx, cy]);
            var sc = layer.property('Scale'); if (sc && sc.numProperties === undefined) { sc.setValue([k, k]); }
        } catch(eSc) {}
    }

    // Build base videoId ("<title>_<NNs>") by taking the token immediately BEFORE the first duration token.
    // This allows arbitrary leading tokens (e.g., token1_token2_title_30s_...).
    // Fallback: if no standalone duration token is found, scan from the end for any token containing /\d{1,4}s/ and use that.
    function buildBaseVideoIdFromCompName(name){
        if(!name) return null;
        var parts = String(name).split(/[_\s]+/);
        if(!parts.length) return null;
        var durIdx = -1;
        var durToken = null;
        // Pass 1: strict token match
        for(var i=0;i<parts.length;i++){
            var p1 = parts[i];
            if(/^\d{1,4}s$/i.test(p1)){ durIdx = i; durToken = String(p1).toLowerCase(); break; }
        }
        // Pass 2 (fallback): find last token containing a duration-like substring (e.g., "06s_v01")
        if(durIdx === -1){
            for(var j=parts.length-1; j>=0; j--){
                var p2 = parts[j];
                var m = String(p2).match(/(\d{1,4})s/i);
                if(m){ durIdx = j; durToken = String(m[1]).toLowerCase() + 's'; break; }
            }
        }
        if(durIdx <= 0) return null; // need a token before duration
        var title = parts[durIdx - 1];
        if(!title || !durToken) return null;
        return title + '_' + durToken; // e.g., JBL_BensonBoone_TourPro3_30s
    }

    // Dev helper: log how sample and (optionally) selected comp names map to base videoIds
    function runDevVideoIdSelfTest(runOpts){
        try { log('[dev-self-test] videoId mapping (pack): begin'); } catch(eH) {}
        var samples = [
            'Title_30s',
            'token1_token2_Title_30s_v01',
            'Title_06s_v02',
            'Some Campaign Title 15s Final',
            'Title_(30s)',
            'Intro_Title_45s_extra',
            'pref-Title-45s',
            'Foo Bar Baz v01 06s'
        ];
        for (var i=0;i<samples.length;i++){
            var nm = samples[i];
            var base = buildBaseVideoIdFromCompName(nm);
            try { log('[dev-self-test] ' + nm + ' -> ' + (base ? base : 'null')); } catch(eL) {}
        }
        // Optionally include actual selected or auto-selected comps
        if (DEV_VIDEOID_SELF_TEST_USE_SELECTION) {
            try {
                var s = null;
                try { s = (runOpts && runOpts.comps && runOpts.comps.length) ? runOpts.comps : (app.project ? app.project.selection : null); } catch(eSel) { s = null; }
                if (s && s.length) {
                    try { log('[dev-self-test] selection: begin'); } catch(eSH) {}
                    for (var si = 0; si < s.length; si++) {
                        var it = s[si];
                        if (!(it && it instanceof CompItem)) continue;
                        var nm2 = String(it.name || '');
                        var base2 = buildBaseVideoIdFromCompName(nm2);
                        try { log('[dev-self-test] sel ' + nm2 + ' -> ' + (base2 ? base2 : 'null')); } catch(eSL) {}
                    }
                    try { log('[dev-self-test] selection: end'); } catch(eSF) {}
                } else {
                    try { log('[dev-self-test] selection: none'); } catch(eSN) {}
                }
            } catch(eBlock) { try { log('[dev-self-test] selection block error: ' + eBlock); } catch(eBL) {} }
        }
        try { log('[dev-self-test] videoId mapping (pack): end'); } catch(eT) {}
    }
    function getCompOrientation(comp){ try { if(comp && comp.width>comp.height) return 'landscape'; } catch(e){} return 'portrait'; }

    function findVideoRecord(data, comp){
        if(!data || !data.videos || !data.videos.length) return null;
        var baseId = buildBaseVideoIdFromCompName(comp ? comp.name : null);
        if(!baseId) return null;
        var orient = getCompOrientation(comp);
        var orientedId = baseId + '_' + orient;
        var videos = data.videos;
        var candidate = null;
        for(var i=0;i<videos.length;i++){ if(String(videos[i].videoId) === orientedId){ candidate = videos[i]; break; } }
        if(candidate) return candidate; // oriented match first
        // Fallback exact baseId (for future JSON variant without orientation)
        for(var j=0;j<videos.length;j++){ if(String(videos[j].videoId) === baseId){ return videos[j]; } }
        // Fallback: first video whose id starts with baseId
        for(var k=0;k<videos.length;k++){ var vid = String(videos[k].videoId||''); if(vid.indexOf(baseId)===0){ return videos[k]; } }
        return null;
    }

    function __isTokenEnabled(key){
        try {
            for (var i=0;i<OUTPUT_NAME_TOKENS.length;i++){
                var t = OUTPUT_NAME_TOKENS[i];
                if (t && t.key === key) return !!t.enabled;
            }
        } catch(e) {}
        return false;
    }

    function buildTokenValue(tokenKey, ctx){
        var meta = ctx.meta;
        var video = ctx.video;
        var comp = ctx.comp;
        switch(tokenKey){
            case 'CLIENT': return meta && meta.client ? meta.client : '';
            case 'BRAND': return meta && meta.brand ? meta.brand : '';
            case 'COUNTRY':
                // Integration 169: COUNTRY yields ISO only; LANGUAGE is emitted separately right after COUNTRY.
                // Prefer pipeline Step 1 (link_data) ISO; fallback to metadataGlobal.country.
                try {
                    if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.results && AE_PIPE.results.linkData && AE_PIPE.results.linkData.iso) {
                        return String(AE_PIPE.results.linkData.iso).toUpperCase();
                    }
                } catch(eCtry) {}
                return meta && meta.country ? meta.country : '';
            case 'LANGUAGE':
                // Language token inherits COUNTRY behavior:
                // - If COUNTRY token is disabled, suppress LANGUAGE as well.
                // - If no ISO available, suppress LANGUAGE (ties to country presence).
                try {
                    if (!__isTokenEnabled('COUNTRY')) return '';
                    if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.results && AE_PIPE.results.linkData) {
                        var ld2 = AE_PIPE.results.linkData;
                        var iso2 = ld2 && ld2.iso ? String(ld2.iso) : null;
                        var lang2 = ld2 && ld2.lang ? String(ld2.lang) : null;
                        if (!iso2) return '';
                        if (lang2) return String(lang2).toUpperCase();
                    }
                } catch(eLang) {}
                return '';
            case 'JOBNUMBER': return meta && meta.jobNumber ? meta.jobNumber : '';
            case 'CAMPAIGN': return meta && meta.campaign ? meta.campaign : '';
            case 'TITLE':
                if(video && video.metadata && video.metadata.title) return video.metadata.title;
                // fallback from comp name first token
                var n = comp ? comp.name : ''; var p = n.split(/[_\s]+/); return p.length? p[0]:'';
            case 'DURATION':
                var d = null;
                if(video && video.metadata && video.metadata.duration) d = video.metadata.duration;
                else if(comp) d = Math.round(comp.duration);
                if(d===null || d===undefined || d==='') return '';
                var dn = parseInt(d,10); if(isNaN(dn)) return '';
                return (dn < 10 ? '0'+dn : ''+dn) + 's';
            case 'MEDIA':
                // Prefer explicit extra media label provided by caller when enabled
                try {
                    if (ENABLE_EXTRA_MEDIA_OVERRIDE && ctx && ctx.extraMediaLabel) {
                        var ml = __sanitizeMediaLabel(ctx.extraMediaLabel);
                        if (ml) return ml;
                    }
                } catch(eML) {}
                // Fallback: derive from comp name suffix
                var extraLbl = getExtraMediaLabelForComp(comp);
                if (extraLbl) return extraLbl;
                return 'OLV'; // default placeholder until wired to data
            case 'ASPECTRATIO':
                return comp ? aspectRatioString(comp.width, comp.height) : '';
            case 'RESOLUTION':
                return comp ? (comp.width + 'x' + comp.height) : '';
            case 'FRAMERATE':
                if(!comp) return '';
                var fr = comp.frameRate; if(!fr || fr<=0) fr = 25; // default
                // Show integer if close to int, else keep one decimal
                var frInt = Math.round(fr);
                if(Math.abs(fr - frInt) < 0.01) return frInt + 'fps';
                return fr.toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + 'fps';
            case 'SUBTITLES':
                var flag = null;
                try { if(video && video.metadata && video.metadata.subtitle_flag) flag = String(video.metadata.subtitle_flag); } catch(e){}
                if(flag){ if(/^y$/i.test(flag)) return 'sub'; else return ''; }
                // infer from subtitles array length
                try { if(video && video.subtitles && video.subtitles.length) return 'sub'; } catch(eInf){}
                return '';
            case 'SOUNDLEVEL':
                return 'webMix'; // default placeholder until wired to data
            case 'DATE':
                var now = new Date();
                var yy = now.getFullYear() % 100;
                var dd = now.getDate();
                var mm = now.getMonth()+1; // 1-based
                // Corrected to YYMMDD (Year, Month, Day)
                return pad2(yy) + pad2(mm) + pad2(dd);
            case 'VERSION':
                var bv = meta && meta.briefVersion ? String(meta.briefVersion) : null;
                if(!bv) return '';
                var bvi = parseInt(bv,10);
                if(isNaN(bvi)) return 'v' + bv;
                return 'v' + (bvi < 10 ? '0'+bvi : ''+bvi);
            default: return '';
        }
    }

    function ensureSuffix(name){
        if(!ENABLE_SUFFIX_APPEND) return name;
        if(!OUTPUT_NAME_CONFIG.appendSuffix) return name;
        if(!APPEND_SUFFIX) return name;
        var lower = String(name).toLowerCase();
        var suffLower = APPEND_SUFFIX.toLowerCase();
        if(lower.length >= suffLower.length && lower.indexOf(suffLower, lower.length - suffLower.length) !== -1) return name;
        return name + APPEND_SUFFIX;
    }

    function buildOutputCompName(comp, jsonData){
        if(!comp) return null;
        var meta = null;
        // metadataGlobal (support legacy key 'meta_global')
        if(jsonData){
            if(jsonData.metadataGlobal) meta = jsonData.metadataGlobal;
            else if(jsonData.meta_global) meta = jsonData.meta_global;
        }
        var video = jsonData ? findVideoRecord(jsonData, comp) : null;
        if(!video){ log("No video metadata match for comp '" + comp.name + "' (will fallback)" ); }
        var ctx = { comp: comp, meta: meta, video: video };
        // Allow extras to inject media label via a synthetic property on the comp-like context
        try { if (comp && comp.extraMediaLabel) ctx.extraMediaLabel = comp.extraMediaLabel; } catch(eEML) {}
        var parts = [];
        for(var i=0;i<OUTPUT_NAME_TOKENS.length;i++){
            var tk = OUTPUT_NAME_TOKENS[i];
            if(!tk.enabled) continue;
            var val = buildTokenValue(tk.key, ctx);
            // Per-comp suppression for TITLE value when matching trigger
            if (tk.key === 'TITLE' && AUTO_DISABLE_TITLE_IF_VALUE && val && val.toLowerCase() === String(AUTO_DISABLE_TITLE_IF_VALUE).toLowerCase()) {
                if (DEBUG_NAMING) log("TITLE value '" + val + "' suppressed (matches AUTO_DISABLE_TITLE_IF_VALUE)");
                val = '';
            }
            if(DEBUG_NAMING) log("Token " + tk.key + " => '" + val + "'");
            if(!val){ if(OUTPUT_NAME_CONFIG.skipEmpty) continue; else val=''; }
            parts.push(val);
        }
        if(!parts.length) return null;
        var rawName = parts.join(OUTPUT_NAME_CONFIG.delimiter || '_');
        return ensureSuffix(rawName);
    }

    function makeUniqueName(desired) {
        if (!ENSURE_UNIQUE_NAME) return desired;
        var existing = {};
        for (var i = 1; i <= proj.numItems; i++) {
            try { existing[String(proj.items[i].name)] = true; } catch (e) {}
        }
        if (!existing[desired]) return desired;
        var idx = 1;
        var base = desired;
        while (idx < 10000) { // hard cap safety
            var candidate = base + "_" + (idx < 10 ? ("0" + idx) : idx);
            if (!existing[candidate]) return candidate;
            idx++;
        }
        return desired + "_X"; // fallback
    }

    var outputRoot = ensureOutputRoot();
    var created = 0;
    var skipped = [];
    log("Output root located at path: " + OUTPUT_ROOT_PATH.join("/"));
    // Load JSON once for naming (primary + fallback scan)
    var jsonData = loadProjectJSONByName(DATA_JSON_PRIMARY_NAME);
    if(!jsonData){
        var alt = tryLoadAnyDataJSON();
        if(alt){ jsonData = alt.data; log("Naming: primary '"+DATA_JSON_PRIMARY_NAME+"' not found; using '"+alt.name+"' with "+alt.videos+" video entries."); }
        else { log("Naming: no suitable data JSON found (looked for '"+DATA_JSON_PRIMARY_NAME+"')."); }
    } else { if(jsonData && jsonData.metadataGlobal) { var mg = jsonData.metadataGlobal; log("Naming JSON loaded: client=" + (mg.client||'') + ", campaign=" + (mg.campaign||'') + ", briefVersion=" + (mg.briefVersion||'') ); } }

    // After JSON load, evaluate BRAND auto-disable rule
    if (AUTO_DISABLE_BRAND_IF_VALUE) {
        var metaForBrand = null;
        if (jsonData) {
            if (jsonData.metadataGlobal) metaForBrand = jsonData.metadataGlobal;
            else if (jsonData.meta_global) metaForBrand = jsonData.meta_global;
        }
        var brandVal = metaForBrand && metaForBrand.brand ? String(metaForBrand.brand) : '';
        if (brandVal && brandVal.toLowerCase() === String(AUTO_DISABLE_BRAND_IF_VALUE).toLowerCase()) {
            // Find BRAND token and disable it
            for (var bt = 0; bt < OUTPUT_NAME_TOKENS.length; bt++) {
                var t = OUTPUT_NAME_TOKENS[bt];
                if (t.key === 'BRAND') { if (t.enabled) { t.enabled = false; log("Brand token disabled automatically (value='" + brandVal + "')."); } break; }
            }
        }
    }

    for (var s = 0; s < sel.length; s++) {
        var item = sel[s];
    if (!(item instanceof CompItem)) { var rsn = item.name + " (not comp)"; skipped.push(rsn); __skippedNames.push(rsn); recordSkip(rsn); log("Skip: '"+item.name+"' not a comp"); continue; }

        // Determine destination folder early (so we can test existence)
        var relSegs = relativeSegmentsAfterAnchor(item, ANCHOR_SOURCE_FOLDER.toLowerCase());
        // Destination folder (avoid mutating project in dry-run)
        var destFolder = null;
        if(DRY_RUN_MODE){
            destFolder = outputRoot; // best-effort: we won't traverse creation to avoid complexity
        } else {
            // Insert 'essentials' when extras are enabled; place after YYMMDD when present
            var firstSegIsDate = (relSegs.length > 0) && /^\d{6}$/.test(String(relSegs[0]));
            var segsEss = relSegs;
            if (ENABLE_EXTRA_OUTPUT_COMPS) {
                segsEss = firstSegIsDate ? [relSegs[0], OUTPUT_ESSENTIALS_DIRNAME].concat(relSegs.slice(1)) : [OUTPUT_ESSENTIALS_DIRNAME].concat(relSegs);
            }
            destFolder = segsEss.length ? ensurePath(outputRoot, segsEss) : outputRoot;
        }
        var expectedBaseName = buildOutputCompName(item, jsonData);
        if(!expectedBaseName){
            expectedBaseName = baseOutputName(item.name); // fallback to original behavior
        }
        log("   -> Proposed output name: " + expectedBaseName);

        log("Considering: '" + item.name + "' -> dest path segments: " + (relSegs.length ? relSegs.join("/") : "(root)") + ", expected output name: " + expectedBaseName);

        if (SKIP_IF_ALREADY_IN_OUTPUT && (isDescendantOf(item, outputRoot) || isInOutputPath(item))) {
            var rsn2 = item.name + " (already in output)"; skipped.push(rsn2); __skippedNames.push(rsn2); recordSkip(rsn2);
            log("Skip: source comp already under output root -> '"+item.name+"'");
            continue;
        }

        // Check if an output comp already exists with the expected base name (without uniqueness increment)
        if (SKIP_IF_OUTPUT_ALREADY_EXISTS && !DRY_RUN_MODE) {
            var foundExisting = false;
            try {
                for (var di = 1; di <= destFolder.numItems; di++) {
                    var dfItem = destFolder.items[di];
                    if (dfItem instanceof CompItem && String(dfItem.name) === expectedBaseName) { foundExisting = true; break; }
                }
            } catch (eChk) { log("Existence check error for '"+item.name+"': " + eChk); }
            if (foundExisting) {
                var rsn3 = item.name + " (export exists)"; skipped.push(rsn3); __skippedNames.push(rsn3); recordSkip(rsn3);
                log("Skip: export already exists as '" + expectedBaseName + "' in folder '" + destFolder.name + "'");
                continue;
            }
        }

        if(DRY_RUN_MODE){
            log("DRY-RUN: would create export comp '" + expectedBaseName + "' (rel path: " + (relSegs.length?relSegs.join('/'):'(root)') + ")");
            __createdNames.push(expectedBaseName);
            continue; // do not actually create
        }

        // Create new export comp (not duplicate) using same settings
        var w = item.width, h = item.height, dur = item.duration, fps = item.frameRate, pa = 1.0;
        try { if (item.pixelAspect) pa = item.pixelAspect; } catch (ePA) {}
        if (!fps || fps <= 0) fps = 25;
        if (!dur || dur <= 0) dur = 1;
        var outName = makeUniqueName(expectedBaseName);
        var exportComp = null;
    try { exportComp = proj.items.addComp(outName, w, h, pa, dur, fps); } catch (eAdd) { var rsn5 = item.name + " (create failed)"; skipped.push(rsn5); __skippedNames.push(rsn5); recordSkip(rsn5); log("Create failed for '"+item.name+"': "+eAdd); continue; }
    if (!exportComp) { var rsn4 = item.name + " (create null)"; skipped.push(rsn4); __skippedNames.push(rsn4); recordSkip(rsn4); log("Create returned null for '"+item.name+"'"); continue; }
        try { exportComp.displayStartTime = item.displayStartTime; } catch (eDST) {}

        // Add the source comp as a layer (precomp inclusion)
        try { exportComp.layers.add(item); } catch (eLayer) { log("Layer add failed for " + outName + ": " + eLayer); }

        // Assign destination folder (already ensured)
        try { exportComp.parentFolder = destFolder; } catch (ePF) {}

        created++;
        __createdNames.push(exportComp.name);
        log("Created export comp '" + exportComp.name + "' -> " + destFolder.name + (relSegs.length ? (" (" + relSegs.join("/") + ")") : ""));

        // ---- Extra output comps (alternate resolutions) ----
        if (ENABLE_EXTRA_OUTPUT_COMPS) {
            try {
            var extrasSourceTag = null;
            var extrasMapEffective = null;
            var fsMap = loadExtrasMapFromFs();
            if (fsMap) { extrasMapEffective = fsMap; extrasSourceTag = 'fs'; }
            else {
                var djMap = __resolveFromDataJson(jsonData);
                if (djMap) { extrasMapEffective = djMap; extrasSourceTag = 'data_json'; }
                else { extrasMapEffective = EXTRA_OUTPUT_COMPS || {}; extrasSourceTag = 'preset'; }
            }
            var extras = parseExtraOutputConfig(extrasMapEffective);
            // Optional DEBUG: dump normalized extras once
            try {
                if (typeof DEBUG_EXTRAS !== 'undefined' ? DEBUG_EXTRAS : false) {
                    try { log("[debug] extras: source=" + (extrasSourceTag || (extrasMapEffective === EXTRA_OUTPUT_COMPS ? "preset" : "fs"))); } catch(eSrc) {}
                    var __srcExtraKeyOnce = __normalizeExtraKey(getExtraMediaLabelForComp(item));
                    if (__srcExtraKeyOnce) { log("[debug] extras: extraKey filtering active: source=" + __srcExtraKeyOnce); }
                    log("Extras parsed: count=" + (extras ? extras.length : 0));
                    if (extras && extras.length) {
                        for (var di=0; di<extras.length; di++) {
                            var e1 = extras[di];
                            var keyInfo = e1.sourceKey ? (" key="+e1.sourceKey) : "";
                            log("  ex["+di+"]"+keyInfo+" => AR="+e1.arKey+", DUR="+e1.durToken+", size="+e1.width+"x"+e1.height+", media="+(e1.mediaLabel||'-')+", extraKey="+(e1.extraKey||'-'));
                        }
                    }
                }
            } catch(eDbgEx) {}
            if (extras && extras.length) {
                // Match rule: AR and DURATION token of base comp
                var baseAR = aspectRatioString(item.width, item.height);
                var baseDurTok = buildTokenValue('DURATION', { comp: item, meta: (jsonData && (jsonData.metadataGlobal||jsonData.meta_global)) ? (jsonData.metadataGlobal||jsonData.meta_global) : null, video: null });
                var srcExtraKey = __normalizeExtraKey(getExtraMediaLabelForComp(item));
                for (var exi=0; exi<extras.length; exi++) {
                    try {
                    var ex = extras[exi];
                    var arMatch = String(ex.arKey).toLowerCase() === String(baseAR).toLowerCase();
                    var durMatch = String(ex.durToken).toLowerCase() === String(baseDurTok).toLowerCase();
                    if (!arMatch || !durMatch) continue;
                    // Hardened rule: regular entries (no ex.extraKey) must NOT match extra-sourced comps
                    if (!ex.extraKey && srcExtraKey) {
                        try { if (typeof DEBUG_EXTRAS !== 'undefined' ? DEBUG_EXTRAS : false) log("[debug] extras: skip regular entry for extra source '" + srcExtraKey + "' (" + ex.sourceKey + ")"); } catch(eDbgSkip) {}
                        continue;
                    }
                    if (ex.extraKey) {
                        var exKeyLower = String(ex.extraKey).toLowerCase();
                        if (!srcExtraKey || srcExtraKey !== exKeyLower) continue;
                    }
                    var arPrefix = ex.arKey;
                    if (srcExtraKey) arPrefix = ex.arKey + '_' + srcExtraKey;
                    var arSeg = arPrefix + '_' + ex.width + 'x' + ex.height;
                    // Determine media label: prefer config value, else fallback to suffix-derived label
                    var cfgMedia = ex.mediaLabel;
                    var fallbackMedia = getExtraMediaLabelForComp(item);
                    var mediaSeg = cfgMedia ? cfgMedia : (fallbackMedia ? (function(x){
                        try {
                            // Prefer defined sanitizer if available
                            if (typeof __sanitizeMediaLabel === 'function') return __sanitizeMediaLabel(x);
                        } catch(eSanAvail) {}
                        try {
                            if(x === undefined || x === null) return null;
                            var s = String(x);
                            s = s.replace(/^\s+|\s+$/g, '');
                            if(!s) return null;
                            s = s.replace(/\s+/g, '_');
                            s = s.replace(/[\\\/:*?"<>|]/g, '_');
                            s = s.replace(/__+/g, '_');
                            return s;
                        } catch(eSan) { return null; }
                    })(fallbackMedia) : null);
                    var arSegWithMedia = mediaSeg ? (arSeg + '_' + mediaSeg) : arSeg;
                    // Place extras under outputRoot with mirrored segments, inserting 'extras' after date when present
                    var extraDest = null;
                    if (DRY_RUN_MODE) {
                        // Do not create folders in dry-run; only compute names
                        extraDest = destFolder;
                    } else {
                        var firstSegIsDateEx = (relSegs.length > 0) && /^\d{6}$/.test(String(relSegs[0]));
                        var segsEx = firstSegIsDateEx ? [relSegs[0], OUTPUT_EXTRAS_DIRNAME].concat(relSegs.slice(1)) : [OUTPUT_EXTRAS_DIRNAME].concat(relSegs);
                        var extrasBase = segsEx.length ? ensurePath(outputRoot, segsEx) : ensureChildFolder(outputRoot, OUTPUT_EXTRAS_DIRNAME);
                        extraDest = ensurePath(extrasBase, [arSegWithMedia]);
                    }
                    // Compute desired name for extra based on target WxH and duration, using PRIMARY comp context to preserve MEDIA
                    var fps2 = item.frameRate || 25;
                    var pa2 = 1.0; try { if (item.pixelAspect) pa2 = item.pixelAspect; } catch(ePA2) {}
                    if (DRY_RUN_MODE) {
                        var tempCtxComp = { name: item.name, width: ex.width, height: ex.height, duration: ex.seconds, frameRate: fps2, pixelAspect: pa2 };
                        var wouldName = buildOutputCompName(tempCtxComp, jsonData) || baseOutputName(item.name);
                        log("DRY-RUN: would create EXTRA comp '" + wouldName + "' at " + arSegWithMedia);
                        __createdNames.push(wouldName);
                        continue;
                    }
                    // Create with provisional unique name derived from primary comp
                    var provisionalName = makeUniqueName(item.name + "_EXTRA");
                    var extraComp = null;
                    try { extraComp = proj.items.addComp(provisionalName, ex.width, ex.height, pa2, ex.seconds, fps2); } catch(eAddEx) { var rsnEx = item.name + " (extra create failed)"; skipped.push(rsnEx); __skippedNames.push(rsnEx); recordSkip(rsnEx); log("Extra create failed for '"+item.name+"': "+eAddEx); continue; }
                    try { extraComp.displayStartTime = item.displayStartTime; } catch(eDST2) {}
                    // Add PRIMARY comp as layer and scale-to-fit
                    var lyr = null; try { lyr = extraComp.layers.add(item); } catch(eLEx) { log("Extra layer add failed for " + provisionalName + ": " + eLEx); }
                    if (lyr) { scaleLayerToFit(lyr, ex.width, ex.height, item.width, item.height); try { lyr.inPoint = 0; lyr.outPoint = ex.seconds; } catch(eIO) {} }
                    // Assign destination
                    try { extraComp.parentFolder = extraDest; } catch(ePDF2) {}
                    // Compute final name using a naming context that preserves MEDIA from the primary comp
                    var namingCtx = { name: item.name, width: ex.width, height: ex.height, duration: ex.seconds, frameRate: fps2, pixelAspect: pa2, extraMediaLabel: (cfgMedia || fallbackMedia || null) };
                    var desiredName = null;
                    try { desiredName = buildOutputCompName(namingCtx, jsonData); } catch(eNm) { desiredName = null; }
                    if (!desiredName) desiredName = baseOutputName(item.name);
                    // No extra suffix appended to names; MEDIA token reflects config when enabled
                    var finalName = makeUniqueName(desiredName);
                    try { extraComp.name = finalName; } catch(eRN) {}
                    created++;
                    __createdNames.push(finalName);
                    log("Created EXTRA comp '" + finalName + "' -> " + (extraDest ? extraDest.name : '(unknown)') + " (" + arSegWithMedia + ")");
                    } catch(eExOne) { try { log("EXTRA creation error for '" + item.name + "' ("+ (ex ? ex.arKey+'|'+ex.durToken : '?') + "): " + eExOne); } catch(ee) {} }
                }
            }
            } catch(eEx) { try { log("EXTRA block error (parse or loop): " + eEx); } catch(ee2) {} }
        }
    }

    var summary = "Created " + created + " export comp(s).";
    if (skipped.length) summary += "\nSkipped: " + skipped.join(", ");
    log(summary);
    alertOnce(summary);
    flushSummary(created, __skippedNames);

    app.endUndoGroup();
    // Return created comps by resolving by names under outputRoot
    var outComps = [];
    try {
        var outputRoot = ensureOutputRoot();
        // Collect comps under outputRoot whose names are in __createdNames
        var nameSet = {}; for (var ni=0; ni<__createdNames.length; ni++) nameSet[__createdNames[ni]] = true;
        function collectUnder(folder){
            for (var i=1;i<=folder.numItems;i++){
                var it = folder.items[i];
                if (it instanceof FolderItem) collectUnder(it);
                else if (it instanceof CompItem) { if (nameSet[it.name]) outComps.push(it); }
            }
        }
        collectUnder(outputRoot);
    } catch(eCol) {}
    // Prepare concise lines for pipeline log (optional gating handled by orchestrator)
    var concise = [];
    try {
        // Summary block similar to file summary log
        concise.push("Summary:");
        var head = "Created " + created + " composition(s).";
        concise.push(head);
        if (__createdNames.length) {
            concise.push("Names:");
            for (var ci=0; ci<__createdNames.length; ci++) concise.push(__createdNames[ci]);
        }
        // Include Skipped section (mirror of phase summary log)
        if (__skippedNames && __skippedNames.length) {
            var filteredSkips = [];
            for (var si = 0; si < __skippedNames.length; si++) {
                var se = __skippedNames[si];
                if (!INCLUDE_NOT_COMP_REASON_IN_SUMMARY && se.indexOf('(not comp)') !== -1) continue;
                filteredSkips.push(se);
            }
            concise.push("Skipped (" + filteredSkips.length + "):");
            for (var fsI = 0; fsI < filteredSkips.length; fsI++) concise.push(filteredSkips[fsI]);
        }
        // Include skip categories with counts
        var __catKeys = [];
        for (var __k in __skipCategories) if (__skipCategories.hasOwnProperty(__k)) __catKeys.push(__k);
        if (__catKeys.length) {
            concise.push("Skip categories (counts):");
            for (var ckI = 0; ckI < __catKeys.length; ckI++) {
                var __ck = __catKeys[ckI];
                var __arr = __skipCategories[__ck];
                var __count = (__arr && __arr.length) ? __arr.length : 0;
                concise.push(" " + __LOGM + " " + (__ck || 'unknown') + ": " + __count);
            }
        }
        if (INCLUDE_TIMING_METRICS) {
            var end2 = new Date();
            var ms2 = end2.getTime() - __scriptStartTime.getTime();
            var sec2 = Math.round(ms2/10)/100;
            var avgCreated2 = created ? Math.round((ms2/created)/10)/100 : null;
            var totalSel2 = sel ? sel.length : 0;
            var avgSel2 = totalSel2 ? Math.round((ms2/totalSel2)/10)/100 : null;
            function __isoLike2(d){ if(!d) return ''; function p(n){ return (n<10?'0':'')+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }
            concise.push("Timing:");
            concise.push(" start=" + __isoLike2(__scriptStartTime));
            concise.push(" end=" + __isoLike2(end2));
            concise.push(" elapsedSeconds=" + sec2);
            if (avgCreated2 !== null) concise.push(" avgPerCreatedSeconds=" + avgCreated2);
            if (avgSel2 !== null) concise.push(" avgPerSelectedSeconds=" + avgSel2);
        }
    } catch(eCL) {}

    return { outputComps: outComps, pipelineConcise: concise, pipelineSummary: ("Created " + created + " export comp(s).") };
}

AE_Pack.run = function(opts){ return __Pack_coreRun(opts || {}); };

// Standalone auto-run only when not in pipeline
if (!__AE_PIPE__) {
    (function packOutputComps_IIFE(){ __Pack_coreRun({}); })();
}

