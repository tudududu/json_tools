// AE Pipeline Orchestrator (Steps 1–5)
// 1) create_compositions -> 2) insert_and_relink_footage -> 3) add_layers_to_comp -> 4) pack_output_comps -> 5) set_ame_output_paths

(function runPipelineAll() {

    // Resolve this script's folder to find sibling phase scripts
    function here() { try { return File($.fileName).parent; } catch (e) { return null; } }
    var base = here();
    if (!base) { alert("Cannot resolve script folder."); return; }

    function join(p, rel) { return File(p.fsName + "/" + rel); }

    // Adjust these relative paths to match your repo layout
    var LINK_DATA_PATH     = join(base, "phase/link_data.jsx");
    var SAVE_AS_ISO_PATH   = join(base, "phase/save_as_with_iso.jsx");
    var CREATE_COMPS_PATH  = join(base, "create_compositions.jsx");
    var INSERT_RELINK_PATH = join(base, "insert_and_relink_footage.jsx");
    var ADD_LAYERS_PATH    = join(base, "add_layers_to_comp.jsx");
    var PACK_OUTPUT_PATH   = join(base, "pack_output_comps.jsx");
    var SET_AME_PATH       = join(base, "set_ame_output_paths.jsx");
    var OPTS_UTILS_PATH    = join(base, "options_utils.jsx");
    var PIPELINE_OPTS_PATH = join(base, "pipeline_options.jsx");
    var LOGGER_UTILS_PATH  = join(base, "logger_utils.jsx");

    // Shared logger (console + optional file)
    function timestamp() {
        var d = new Date(); function p(n){return (n<10?'0':'')+n;}
        return d.getFullYear()+""+p(d.getMonth()+1)+""+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
    }
    var RUN_ID = timestamp();

    // Optional: write logs to ./project/log under the AE project root folder
    var ENABLE_FILE_LOG = true;
    var LOG_PATH_SEGMENTS = ["project","log"];
    var LOG_PREFIX = "pipeline_run";
    var __logFile = null;

    // Load options utilities and defaults with hot-reload to pick up changes without restarting AE
    try { if (typeof AE_OPTS_UTILS !== 'undefined') { AE_OPTS_UTILS = undefined; } } catch (eClrU) {}
    try { if (typeof AE_PIPELINE_OPTIONS !== 'undefined') { AE_PIPELINE_OPTIONS = undefined; } } catch (eClrP) {}
    try { $.evalFile(OPTS_UTILS_PATH); } catch (eOU) { /* optional */ }
    try { $.evalFile(PIPELINE_OPTS_PATH); } catch (ePO) { /* optional */ }
    try { if (typeof AE_LOGGER !== 'undefined') { AE_LOGGER = undefined; } } catch (eClrL) {}
    try { $.evalFile(LOGGER_UTILS_PATH); } catch (eLU) { /* optional */ }
    // Build options safely even when AE_PIPE is not defined yet
    // Prefer AE_PIPE.userOptions as the explicit user overrides. Only use AE_PIPE.options if it doesn't
    // look like a full effective bundle from a previous run (prevents sticky options across runs).
    function __looksEffectiveBundle(o) {
        try {
            if (!o || typeof o !== 'object') return false;
            // Heuristic: presence of phase namespaces or top-level pipeline keys indicates a merged effective bundle
            if (o.createComps || o.insertRelink || o.addLayers || o.pack || o.ame) return true;
            if (o.hasOwnProperty('PIPELINE_QUEUE_TO_AME') || o.hasOwnProperty('ENABLE_FILE_LOG')) return true;
        } catch(eLB) {}
        return false;
    }
    var __userOpts = {};
    try {
        if (typeof AE_PIPE !== 'undefined' && AE_PIPE) {
            if (AE_PIPE.userOptions && typeof AE_PIPE.userOptions === 'object') {
                __userOpts = AE_PIPE.userOptions;
            } else if (AE_PIPE.options && typeof AE_PIPE.options === 'object' && !__looksEffectiveBundle(AE_PIPE.options)) {
                __userOpts = AE_PIPE.options; // legacy path: options used as user overrides
            } else if (AE_PIPE.options && __looksEffectiveBundle(AE_PIPE.options)) {
                // Proactively clear stale effective bundle so it doesn't affect subsequent runs
                try { AE_PIPE.options = {}; } catch(eClr) {}
            }
        }
    } catch (eUO) {}
    var OPTS = (typeof AE_PIPELINE_OPTIONS !== 'undefined') ? AE_PIPELINE_OPTIONS.build(__userOpts) : (__userOpts || {});
    // Pipeline toggles (derived from options)
    // When true (default), Step 5 will queue items to AME after setting output paths.
    // When false, only output paths are set (no AME queue).
    var PIPELINE_QUEUE_TO_AME = (typeof AE_OPTS_UTILS !== 'undefined') ? AE_OPTS_UTILS.optBool(OPTS, 'PIPELINE_QUEUE_TO_AME', true) : (OPTS.PIPELINE_QUEUE_TO_AME !== false);
    // Content style: phase tag visibility (controls INFO {phase} prefixes)
    var PIPELINE_SHOW_PHASE_TAGS = true;
    try { if (OPTS && typeof OPTS.PIPELINE_SHOW_PHASE_TAGS !== 'undefined') PIPELINE_SHOW_PHASE_TAGS = (OPTS.PIPELINE_SHOW_PHASE_TAGS !== false); } catch(ePT) {}
    // Master switch controlling all phase independent file logs
    var PHASE_FILE_LOGS_MASTER_ENABLE = true;
    try {
        if (OPTS && typeof OPTS.PHASE_FILE_LOGS_MASTER_ENABLE !== 'undefined') {
            PHASE_FILE_LOGS_MASTER_ENABLE = (OPTS.PHASE_FILE_LOGS_MASTER_ENABLE !== false);
        }
    } catch(eMSW) {}

    function findOrCreateLogFolder() {
        try {
            var root = app.project && app.project.rootFolder ? app.project.rootFolder : null;
            if (!root) return null;
            var f = app.project.file && app.project.file.parent ? app.project.file.parent : null;
            if (!f) return Folder.desktop;
            var phys = f.fsName;
            var startIdx = (LOG_PATH_SEGMENTS[0] === "project") ? 1 : 0;
            for (var i = startIdx; i < LOG_PATH_SEGMENTS.length; i++) {
                phys += "/" + LOG_PATH_SEGMENTS[i];
                var fld = new Folder(phys);
                if (!fld.exists) fld.create();
            }
            var finalFld = new Folder(phys);
            return finalFld.exists ? finalFld : Folder.desktop;
        } catch (e) { return Folder.desktop; }
    }
    function openLogFile() {
        // Allow options to control pipeline file logging
        if (typeof OPTS !== 'undefined') { try { ENABLE_FILE_LOG = (OPTS.ENABLE_FILE_LOG !== false); } catch(eEL){} }
        if (!ENABLE_FILE_LOG) return null;
        var folder = findOrCreateLogFolder();
        var appendMode = false; try { appendMode = !!(OPTS && OPTS.PIPELINE_FILE_LOG_APPEND_MODE); } catch(eAM) {}
        var fname = appendMode ? (LOG_PREFIX + ".log") : (LOG_PREFIX + "_" + RUN_ID + ".log");
        try { return new File(folder.fsName + "/" + fname); } catch (e) { return null; }
    }
    __logFile = openLogFile();
    // Announce file logging path in header region
    try { if (__logFile && __logFile.fsName) { log("[log] File logging started: " + __logFile.fsName); } } catch(eAnn) {}

    function fileLogLine(s) {
        if (!__logFile) return;
        try {
            var line = s;
            try { if (OPTS && OPTS.LOG_WITH_TIMESTAMPS) { line = "[" + (new Date()).toLocaleString() + "] " + s; } } catch(eTS) {}
            if (__logFile.open("a")) { __logFile.write(line + "\n"); __logFile.close(); }
        } catch (e) { try { __logFile.close(); } catch (e2) {} }
    }
    // Optional pruning of older pipeline_run logs
    try {
        if (OPTS && OPTS.PIPELINE_FILE_LOG_PRUNE_ENABLED) {
            var folder = __logFile ? __logFile.parent : findOrCreateLogFolder();
            var files = folder.getFiles(function(f){ return f instanceof File && /^pipeline_run_.*\.log$/i.test(String(f.name||"")); });
            var maxKeep = (typeof OPTS.PIPELINE_FILE_LOG_MAX_FILES === 'number' && OPTS.PIPELINE_FILE_LOG_MAX_FILES > 0) ? OPTS.PIPELINE_FILE_LOG_MAX_FILES : 24;
            if (files && files.length > maxKeep) {
                files.sort(function(a,b){ try { return a.modified - b.modified; } catch(eS){ return 0; } });
                for (var i=0; i<files.length-maxKeep; i++) { try { files[i].remove(); } catch(eRm) {} }
            }
        }
    } catch(ePrune) {}
    function log(s) {
        try { $.writeln(s); } catch (e) {}
        if (ENABLE_FILE_LOG) fileLogLine(s);
    }

    // Shared bus
    if (typeof AE_PIPE === "undefined") { AE_PIPE = {}; }
    AE_PIPE.MODE = "pipeline";
    AE_PIPE.RUN_ID = RUN_ID;
    AE_PIPE.results = { createComps: [], insertRelink: [], addLayers: [], pack: [], ame: [] };
    // Clear any stale fatal flag from a previous run to prevent unintended aborts
    try { AE_PIPE.__fatal = null; } catch(eClrF) {}
    // Preserve user overrides (if provided) and expose effective options for consumers separately
    if (__userOpts && typeof __userOpts === 'object') { AE_PIPE.userOptions = __userOpts; }
    AE_PIPE.optionsEffective = OPTS;
    AE_PIPE.log = log;
    // Expose shared logger helpers if available
    try {
        if (typeof AE_LOGGER !== 'undefined' && AE_LOGGER && typeof AE_LOGGER.getLogger === 'function') {
            AE_PIPE.getLogger = function(tag, cfg){ return AE_LOGGER.getLogger(tag, cfg||{}); };
            // A convenience root logger for this run; phases may call AE_PIPE.getLogger and create children
            AE_PIPE.pipelineLogger = AE_LOGGER.getLogger('pipeline', { baseLogFn: log, forwardToPipeline: false, withTimestamps: false });
        }
    } catch(eExpo) {}
    try { AE_PIPE.pipelineLogPath = (__logFile && __logFile.fsName) ? __logFile.fsName : null; } catch(ePLP) {}

    // Structured header
    try {
        var __projPath = (app.project && app.project.file && app.project.file.fsName) ? app.project.file.fsName : "(unsaved)";
        log("=== PIPELINE RUN BEGIN ===");
        log("RunId=" + RUN_ID);
    log("ProjectPath: " + __projPath);
    log("PhaseFileLogsMasterEnable=" + (PHASE_FILE_LOGS_MASTER_ENABLE?"true":"false"));
    } catch(eHdr) {}
    // If preset metadata is present (from pipeline_preset_loader.jsx), log it for traceability
    try {
        var __meta = (AE_PIPE.userOptions && AE_PIPE.userOptions.__presetMeta) ? AE_PIPE.userOptions.__presetMeta : null;
        if (__meta && (__meta.path || __meta.loadedAt)) {
            log("Preset: " + (__meta.path || "(unknown path)") + (__meta.loadedAt ? (" | loadedAt=" + __meta.loadedAt) : ""));
        }
    } catch(ePM) {}
    try { log("=========================="); } catch(eHdr2) {}
    
    // Diagnostics (moved near header): Verbose flags and full options dump
    try {
        // Verbose flags summary
        if (OPTS && OPTS.VERBOSE) {
            try {
                var v = [];
                v.push("Verbose flags:");
                // Top
                v.push("  ENABLE_FILE_LOG=" + (OPTS.ENABLE_FILE_LOG !== false));
                v.push("  DRY_RUN=" + (OPTS.DRY_RUN === true));
                // createComps
                if (OPTS.createComps) {
                    v.push("  createComps.DEFAULT_STILL_DURATION=" + OPTS.createComps.DEFAULT_STILL_DURATION);
                    v.push("  createComps.ENABLE_MARKER_TRIM=" + (OPTS.createComps.ENABLE_MARKER_TRIM === true));
                    v.push("  createComps.SKIP_IF_COMP_EXISTS=" + (OPTS.createComps.SKIP_IF_COMP_EXISTS !== false));
                }
                // insertRelink
                if (OPTS.insertRelink) {
                    v.push("  insertRelink.ENABLE_RELINK_DATA_JSON=" + (OPTS.insertRelink.ENABLE_RELINK_DATA_JSON !== false));
                    v.push("  insertRelink.DATA_JSON_ISO_MODE=" + (OPTS.insertRelink.DATA_JSON_ISO_MODE||""));
                    v.push("  insertRelink.DATA_JSON_ISO_CODE_MANUAL=" + (OPTS.insertRelink.DATA_JSON_ISO_CODE_MANUAL||""));
                    v.push("  insertRelink.ENABLE_CHECK_AUDIO_ISO=" + (OPTS.insertRelink.ENABLE_CHECK_AUDIO_ISO === true));
                    v.push("  insertRelink.CHECK_AUDIO_ISO_STRICT=" + (OPTS.insertRelink.CHECK_AUDIO_ISO_STRICT === true));
                    v.push("  insertRelink.SOUND_USE_ISO_SUBFOLDER=" + (OPTS.insertRelink.SOUND_USE_ISO_SUBFOLDER === true));
                    v.push("  insertRelink.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER=" + (OPTS.insertRelink.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER === true));
                    v.push("  insertRelink.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER=" + (OPTS.insertRelink.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER === true));
                }
                // saveAsISO
                if (OPTS.saveAsISO) {
                    v.push("  saveAsISO.OVERWRITE=" + (OPTS.saveAsISO.OVERWRITE === true));
                    v.push("  saveAsISO.iso=" + (OPTS.saveAsISO.iso||""));
                }
                // addLayers
                if (OPTS.addLayers) {
                    v.push("  addLayers.ENABLE_FILE_LOG=" + (OPTS.addLayers.ENABLE_FILE_LOG !== false));
                    v.push("  addLayers.ENABLE_JSON_TIMING_FOR_DISCLAIMER=" + (OPTS.addLayers.ENABLE_JSON_TIMING_FOR_DISCLAIMER === true));
                    var tmc = OPTS.addLayers.TEMPLATE_MATCH_CONFIG || {};
                    v.push("  addLayers.TEMPLATE_MATCH_CONFIG.arTolerance=" + (tmc.arTolerance!==undefined?tmc.arTolerance:"") );
                    v.push("  addLayers.TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch=" + (tmc.requireAspectRatioMatch===true));
                }
                // pack
                if (OPTS.pack) {
                    v.push("  pack.DRY_RUN_MODE=" + (OPTS.pack.DRY_RUN_MODE === true));
                    v.push("  pack.SKIP_IF_OUTPUT_ALREADY_EXISTS=" + (OPTS.pack.SKIP_IF_OUTPUT_ALREADY_EXISTS !== false));
                }
                // ame
                if (OPTS.ame) {
                    v.push("  ame.PROCESS_SELECTION=" + (OPTS.ame.PROCESS_SELECTION !== false));
                    v.push("  ame.AUTO_QUEUE_IN_AME=" + (OPTS.ame.AUTO_QUEUE_IN_AME !== false));
                }
                // integrator
                v.push("  sleepBetweenPhasesMs=" + (OPTS.sleepBetweenPhasesMs || 0));
                for (var i=0;i<v.length;i++) log(v[i]);
            } catch(eV) {}
        }
        // Delimiter between sections when both are enabled
        if ((OPTS && OPTS.VERBOSE) && (OPTS && OPTS.DEBUG_DUMP_EFFECTIVE_OPTIONS)) {
            try { log("--------------------------"); } catch(eSep1) {}
        }
        // Full dump: stringify all effective options
        if (OPTS && OPTS.DEBUG_DUMP_EFFECTIVE_OPTIONS) {
            try {
                var __stringify = function(obj, indent) {
                    indent = indent || "";
                    if (obj === null) return "null";
                    var t = typeof obj;
                    if (t === 'undefined') return 'undefined';
                    if (t === 'string' || t === 'number' || t === 'boolean') return String(obj);
                    if (obj instanceof Array) {
                        var outA = ['['];
                        for (var iA=0;iA<obj.length;iA++) outA.push(indent+'  '+__stringify(obj[iA], indent+'  '));
                        outA.push(indent+']');
                        return outA.join('\n');
                    }
                    // plain object
                    var out = ['{'];
                    for (var k in obj) if (obj.hasOwnProperty(k)) {
                        var v2 = obj[k];
                        out.push(indent + '  ' + k + ': ' + __stringify(v2, indent + '  '));
                    }
                    out.push(indent+'}');
                    return out.join('\n');
                };
                log('--- EFFECTIVE OPTIONS (FULL) BEGIN ---');
                var snapshot = OPTS; // already a plain object tree
                var dump = __stringify(snapshot, '');
                var lines = dump.split('\n');
                for (var di=0; di<lines.length; di++) log(lines[di]);
                log('--- EFFECTIVE OPTIONS (FULL) END ---');
            } catch(eFD) {}
        }
    } catch(eDiagTop) {}
    // Trailing delimiter after diagnostics
    try { log("--------------------------"); } catch(eHdr3) {}

    // Helpers - selection management
    var proj = app.project;
    if (!proj) { alert("No project open."); return; }

    function selectedFootageItems() {
        var out = [];
        var sel = proj.selection;
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) {
                var it = sel[i];
                if (it instanceof FootageItem) out.push(it);
            }
        }
        return out;
    }

    // Timing helpers
    function nowMs(){ return (new Date()).getTime(); }
    function sec(ms){ return Math.round(ms/10)/100; }
    function maybeSleep(label){
        try {
            var ms = (OPTS && typeof OPTS.sleepBetweenPhasesMs === 'number') ? OPTS.sleepBetweenPhasesMs : 0;
            if (ms && ms > 0) { log("Stabilize: sleeping " + ms + "ms before " + label + "..."); $.sleep(ms); }
        } catch(eS) {}
    }
    var t0All = nowMs();
    var tLs=0,tLe=0,tS2s=0,tS2e=0,t1s=0,t1e=0,t2s=0,t2e=0,t3s=0,t3e=0,t4s=0,t4e=0,t5s=0,t5e=0;

    // Step 1: Link data.json (ISO auto-detect + relink)
    tLs = nowMs();
    try {
        // Respect per-phase toggle; skip the link-data step entirely when disabled.
        if (OPTS.RUN_link_data === false) {
            log("Step 1 (link_data.jsx): SKIPPED by toggle.");
        } else {
            // Announce phase start in the pipeline log.
            log("Step 1: Link data.json and detect ISO...");
            // Hot-reload safety: clear any previously defined singleton so the next eval loads fresh code.
            try { if (typeof AE_LinkData !== 'undefined') { AE_LinkData = undefined; } } catch(eLDClr) {}
            // Load the phase implementation from disk.
            $.evalFile(LINK_DATA_PATH);
            // Preferred API path: run() should exist on AE_LinkData; otherwise, we log and continue.
            if (typeof AE_LinkData !== 'undefined' && AE_LinkData && typeof AE_LinkData.run === 'function') {
                // Pass the dedicated linkData options slice (phase also handles its own internal defaults).
                var __optsL = (OPTS.linkData || {});
                // Execute with runId and pipeline logger so logs are unified.
                var resL1 = AE_LinkData.run({ runId: RUN_ID, log: log, options: __optsL });
                // Persist the phase result for later steps/summary; tolerate missing or partial results.
                try { AE_PIPE.results.linkData = resL1 || {}; } catch(eSt) {}
            } else {
                log("Step 1: link_data API not available; script evaluated without run().");
            }
        }
    } catch(eL) { 
        log("Step 1 (link_data) error: " + (eL && eL.message ? eL.message : eL)); 
        }
    if (resL1 && resL1.ok) {
    var isoLine = "ISO=" + (resL1.iso||"?") + " (" + (resL1.origin||"?") + "), relinked=" + (!!resL1.relinked) + ", imported=" + (!!resL1.imported);
    log((PIPELINE_SHOW_PHASE_TAGS ? "INFO {link_data} " : "") + "Step 1: Link result: " + isoLine);
    }
    tLe = nowMs();

    // Step 2: Save project as new file with ISO suffix
    maybeSleep("Step 2");
    tS2s = nowMs();
    try {
        if (OPTS.RUN_save_as_iso === false) {
            log("Step 2 (save_as_with_iso.jsx): SKIPPED by toggle.");
        } else {
            log("Step 2: Save project with ISO suffix...");
            try { if (typeof AE_SaveAsISO !== 'undefined') { AE_SaveAsISO = undefined; } } catch(eClrS2) {}
            $.evalFile(SAVE_AS_ISO_PATH);
            if (typeof AE_SaveAsISO !== 'undefined' && AE_SaveAsISO && typeof AE_SaveAsISO.run === 'function') {
                var __optsS2 = (OPTS.saveAsISO || {});
                var resS2 = AE_SaveAsISO.run({ runId: RUN_ID, log: log, options: __optsS2 });
                try { AE_PIPE.results.saveAsISO = resS2 || {}; } catch(eS2st) {}
                if (resS2 && resS2.ok) {
                    var isoMsg = "Saved as (ISO=" + (resS2.iso||'?') + "): " + (resS2.savedPath||'(unknown)');
                    log((PIPELINE_SHOW_PHASE_TAGS ? "INFO {save_as_iso} " : "") + isoMsg);
                }
            } else {
                log("Step 2: save_as_with_iso API not available; script evaluated without run().");
            }
        }
    } catch(eS2) {
        log("Step 2 (save_as_with_iso) error: " + (eS2 && eS2.message ? eS2.message : eS2));
    }
    tS2e = nowMs();

    // Step 3: Create compositions from selected footage
    maybeSleep("Step 3");
    t1s = nowMs();
    if (OPTS.RUN_create_compositions === false) {
        log("Step 3 (create_compositions.jsx): SKIPPED by toggle.");
        t1e = nowMs();
    } else {
        var footageSel = selectedFootageItems();
        // Allow empty selection when AUTO_FROM_PROJECT_FOOTAGE is enabled (top-level or under createComps)
        var __autoCreate = false;
        try {
            __autoCreate = (OPTS && ((OPTS.createComps && OPTS.createComps.AUTO_FROM_PROJECT_FOOTAGE === true) || (OPTS.AUTO_FROM_PROJECT_FOOTAGE === true)));
        } catch(eAC) {}
        if (!footageSel.length && !__autoCreate) {
            alert("Select one or more footage items in the Project panel for Step 3 (create_compositions).");
            return;
        }
        if (__autoCreate && !footageSel.length) {
            log("Step 3: AUTO_FROM_PROJECT_FOOTAGE is ON; proceeding with auto scan in create_compositions.jsx.");
        } else {
            log("Step 3: Creating comps from " + footageSel.length + " selected footage item(s).");
        }

    // API contract (preferred): AE_CreateComps.run({ selection: FootageItem[], runId: RUN_ID, ... })
    var step1UsedAPI = false;
    try {
        // Hot-reload phase singleton then load; script may expose AE_CreateComps
        try { if (typeof AE_CreateComps !== 'undefined') { AE_CreateComps = undefined; } } catch(eCLR1) {}
        $.evalFile(CREATE_COMPS_PATH);
        if (typeof AE_CreateComps !== "undefined" && AE_CreateComps && typeof AE_CreateComps.run === "function") {
            // Normalize options for Step 3: allow top-level synonyms to override createComps defaults
            var __opts1 = (OPTS.createComps || {});
            try {
                function __assignTop(k){ if (OPTS.hasOwnProperty(k)) __opts1[k] = OPTS[k]; }
                __assignTop('AUTO_FROM_PROJECT_FOOTAGE');
                __assignTop('FOOTAGE_PROJECT_PATH');
                __assignTop('FOOTAGE_DATE_YYMMDD');
                __assignTop('INCLUDE_SUBFOLDERS');
            } catch(eNrm) {}
            var selArg = (__autoCreate && !footageSel.length) ? [] : footageSel;
            if (!PHASE_FILE_LOGS_MASTER_ENABLE) { try { __opts1.ENABLE_FILE_LOG = false; } catch(eMS1) {} }
            var res1 = AE_CreateComps.run({ selection: selArg, runId: RUN_ID, log: log, options: __opts1 });
            if (res1 && res1.created && res1.created.length) {
                AE_PIPE.results.createComps = res1.created;
                step1UsedAPI = true;
            }
        }
    } catch (e1) {
        log("Step 3 API path failed, falling back to side-effect mode. Error: " + (e1 && e1.message ? e1.message : e1));
    }
    if (!step1UsedAPI) {
        // Fallback: rely on the script’s default behavior (uses current selection)
        // The script should tag new comps with runId in their comment, or move them to a known folder.
        try { $.evalFile(CREATE_COMPS_PATH); } catch (e1b) { log("create_compositions threw: " + e1b); }
        // Discover results by runId tag in comment
        var created = [];
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (it instanceof CompItem) {
                var cmt = "";
                try { cmt = String(it.comment || ""); } catch (eC) {}
                if (cmt.indexOf("runId=" + RUN_ID) !== -1) created.push(it);
            }
        }
        AE_PIPE.results.createComps = created;
    }
    log("Step 3: Created comps: " + AE_PIPE.results.createComps.length);
        t1e = nowMs();
    }

    if (OPTS.RUN_create_compositions !== false && !AE_PIPE.results.createComps.length) {
        alert("No compositions created in Step 3. Aborting.");
        return;
    }

    // Step 4: Insert & relink into those comps
    maybeSleep("Step 4");
    t2s = nowMs();
    if (OPTS.RUN_insert_and_relink_footage === false) {
        log("Step 4 (insert_and_relink_footage.jsx): SKIPPED by toggle.");
        AE_PIPE.results.insertRelink = AE_PIPE.results.createComps.slice(0);
        t2e = nowMs();
    } else {
        log("Step 4: Insert & relink into " + AE_PIPE.results.createComps.length + " comps.");
    var step2UsedAPI = false;
    try {
        try { if (typeof AE_InsertRelink !== 'undefined') { AE_InsertRelink = undefined; } } catch(eCLR2) {}
        $.evalFile(INSERT_RELINK_PATH);
        if (typeof AE_InsertRelink !== "undefined" && AE_InsertRelink && typeof AE_InsertRelink.run === "function") {
            var __opts2 = (OPTS.insertRelink || {});
            if (!PHASE_FILE_LOGS_MASTER_ENABLE) { try { __opts2.ENABLE_FILE_LOG = false; } catch(eMS2) {} }
            var res2 = AE_InsertRelink.run({ comps: AE_PIPE.results.createComps, runId: RUN_ID, log: log, options: __opts2 });
            // If the phase marked a fatal error (e.g., strict ISO mismatch), emit a concise summary and stop early.
            try {
                if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.__fatal) {
                    // Capture timing for this step before aborting
                    try { t2e = nowMs(); } catch(eTe) {}
                    var totalMsAbort = 0; try { totalMsAbort = nowMs() - t0All; } catch(eTm) {}
                    var summary = [];
                    summary.push("FATAL: Aborting: " + AE_PIPE.__fatal);
                    summary.push("Pipeline aborted.");
                    var layersAddedTotalAbort = 0; try { layersAddedTotalAbort = (AE_PIPE.results.meta && AE_PIPE.results.meta.addLayersAddedTotal) ? AE_PIPE.results.meta.addLayersAddedTotal : 0; } catch(eLTA) {}
                    summary.push("Counts => created=" + AE_PIPE.results.createComps.length + ", insertedRelinked=" + AE_PIPE.results.insertRelink.length + ", addLayers=" + AE_PIPE.results.addLayers.length + ", packed=" + AE_PIPE.results.pack.length + ", ameConfigured=" + AE_PIPE.results.ame.length + ", layersAddedTotal=" + layersAddedTotalAbort);
                    summary.push("Timing (s) => linkData=" + sec(tLe-tLs) + ", saveAsISO=" + sec(tS2e-tS2s) + ", create=" + sec(t1e-t1s) + ", insertRelink=" + sec(t2e-t2s) + ", addLayers=" + sec(t3e-t3s) + ", pack=" + sec(t4e-t4s) + ", ame=" + sec(t5e-t5s) + ", total=" + sec(totalMsAbort));
                    var finalMsgAbort = summary.join("\n");
                    log(finalMsgAbort);
                    try { log("=== PIPELINE RUN END ==="); } catch(eEnd) {}
                    return; // terminate pipeline IIFE
                }
            } catch(eFatal) {}
            if (res2 && res2.processed) AE_PIPE.results.insertRelink = res2.processed;
            step2UsedAPI = true;
        }
    } catch (e2) {
        log("Step 4 API path failed, falling back to selection. Error: " + (e2 && e2.message ? e2.message : e2));
    }
    if (!step2UsedAPI) {
        // Fallback: set current selection to created comps and eval the script as-is
        try { proj.selection = AE_PIPE.results.createComps; } catch (eSel) {}
        try { $.evalFile(INSERT_RELINK_PATH); } catch (e2b) { log("insert_and_relink_footage threw: " + e2b); }
        // Assume success on the selected comps for summary
        AE_PIPE.results.insertRelink = AE_PIPE.results.createComps.slice(0);
    }

        t2e = nowMs();
    }

    // Step 5: Add layers from template to the processed comps
    maybeSleep("Step 5");
    t3s = nowMs();
    if (OPTS.RUN_add_layers_to_comp === false) {
        log("Step 5 (add_layers_to_comp.jsx): SKIPPED by toggle.");
        AE_PIPE.results.addLayers = AE_PIPE.results.insertRelink.slice(0);
        t3e = nowMs();
    } else {
        log("Step 5: Add layers to " + AE_PIPE.results.insertRelink.length + " comps.");
    var step3UsedAPI = false;
    try {
        try { if (typeof AE_AddLayers !== 'undefined') { AE_AddLayers = undefined; } } catch(eCLR3) {}
        $.evalFile(ADD_LAYERS_PATH);
        if (typeof AE_AddLayers !== "undefined" && AE_AddLayers && typeof AE_AddLayers.run === "function") {
            var __opts3 = (OPTS.addLayers || {});
            if (!PHASE_FILE_LOGS_MASTER_ENABLE) { try { __opts3.ENABLE_FILE_LOG = false; } catch(eMS3) {} }
            var res3 = AE_AddLayers.run({ comps: AE_PIPE.results.insertRelink, runId: RUN_ID, log: log, options: __opts3 });
            if (res3 && res3.processed) AE_PIPE.results.addLayers = res3.processed;
            try {
                AE_PIPE.results.meta = AE_PIPE.results.meta || {};
                AE_PIPE.results.meta.addLayersAddedTotal = (res3 && typeof res3.addedTotal === 'number') ? res3.addedTotal : 0;
            } catch(eMeta3) {}
            try {
                var alOpts = OPTS.addLayers || {};
                if (alOpts.PIPELINE_SHOW_CONCISE_LOG !== false) {
                    // Emit concise lines via shared logger; tag/level visibility controlled globally by options
                    var __alLogger = null;
                    try {
                        if (typeof AE_PIPE !== 'undefined' && AE_PIPE && typeof AE_PIPE.getLogger === 'function') {
                            // Route through pipeline's base logger without re-forwarding to avoid duplication
                            __alLogger = AE_PIPE.getLogger('add_layers', { baseLogFn: log, forwardToPipeline: false, withTimestamps: false });
                        }
                    } catch(eGetL) { __alLogger = null; }
                    function logAL(s) {
                        if (__alLogger) { try { __alLogger.info(s); return; } catch(eAL1) {} }
                        try { log(String(s)); } catch(eAL2) { /* ignore */ }
                    }
                    var lines = res3 && res3.pipelineConcise ? res3.pipelineConcise : [];
                    for (var ci=0; ci<lines.length; ci++) logAL(lines[ci]);
                    if (res3 && res3.pipelineSummary) logAL(res3.pipelineSummary);
                }
                if (alOpts.PIPELINE_SHOW_VERBOSE_LOG === true) {
                    // No-op here: verbose already logged by the phase script; leaving switch for future routing
                }
            } catch(eALlog) {}
            step3UsedAPI = true;
        }
    } catch (e3) {
        log("Step 5 API path failed, falling back to selection. Error: " + (e3 && e3.message ? e3.message : e3));
    }
    if (!step3UsedAPI) {
        try { app.project.selection = AE_PIPE.results.insertRelink; } catch (eSel3) {}
        try { $.evalFile(ADD_LAYERS_PATH); } catch (e3b) { log("add_layers_to_comp threw: " + e3b); }
        AE_PIPE.results.addLayers = AE_PIPE.results.insertRelink.slice(0);
    }
    log("Step 5: Add-layers processed comps: " + AE_PIPE.results.addLayers.length);
        t3e = nowMs();
    }

    // Step 6: Pack output comps
    maybeSleep("Step 6");
    t4s = nowMs();
    if (OPTS.RUN_pack_output_comps === false) {
        log("Step 6 (pack_output_comps.jsx): SKIPPED by toggle.");
        AE_PIPE.results.pack = AE_PIPE.results.addLayers.slice(0);
        t4e = nowMs();
    } else {
        log("Step 6: Pack output comps for " + AE_PIPE.results.addLayers.length + " comps.");
    var step4UsedAPI = false;
    try {
        try { if (typeof AE_Pack !== 'undefined') { AE_Pack = undefined; } } catch(eCLR4) {}
        $.evalFile(PACK_OUTPUT_PATH);
        if (typeof AE_Pack !== "undefined" && AE_Pack && typeof AE_Pack.run === "function") {
            var __opts4 = (OPTS.pack || {});
            if (!PHASE_FILE_LOGS_MASTER_ENABLE) { try { __opts4.ENABLE_FILE_LOG = false; } catch(eMS4) {} }
            var res4 = AE_Pack.run({ comps: AE_PIPE.results.addLayers, runId: RUN_ID, log: log, options: __opts4 });
            if (res4 && res4.outputComps) AE_PIPE.results.pack = res4.outputComps;
            // Concise logging for Step 6 (pack): show short summary in pipeline log
            try {
                var pkOpts = OPTS.pack || {};
                if (pkOpts.PIPELINE_SHOW_CONCISE_LOG !== false) {
                    var __pkLogger = null;
                    try {
                        if (typeof AE_PIPE !== 'undefined' && AE_PIPE && typeof AE_PIPE.getLogger === 'function') {
                            __pkLogger = AE_PIPE.getLogger('pack', { baseLogFn: log, forwardToPipeline: false, withTimestamps: false });
                        }
                    } catch(eGetPk) { __pkLogger = null; }
                    function logPK(s){
                        if(__pkLogger){ try{ __pkLogger.info(s); return; }catch(eLpk){} }
                        try { log(String(s)); } catch(eLPK2) { /* ignore */ }
                    }
                    var lines4 = res4 && res4.pipelineConcise ? res4.pipelineConcise : [];
                    for (var pi=0; pi<lines4.length; pi++) logPK(lines4[pi]);
                    if (res4 && res4.pipelineSummary) logPK(res4.pipelineSummary);
                }
            } catch(ePkLog) {}
            step4UsedAPI = true;
        }
    } catch (e4) {
        log("Step 6 API path failed, falling back to default behavior. Error: " + (e4 && e4.message ? e4.message : e4));
    }
    if (!step4UsedAPI) {
        // Fallback: many packing scripts detect and process comps internally; provide selection for best effort
        try { app.project.selection = AE_PIPE.results.addLayers; } catch (eSel4) {}
        try { $.evalFile(PACK_OUTPUT_PATH); } catch (e4b) { log("pack_output_comps threw: " + e4b); }
        // Assume 1:1 packed or internally resolved; keep same count for summary if unknown
        AE_PIPE.results.pack = AE_PIPE.results.addLayers.slice(0);
    }
    log("Step 6: Packed outputs (count proxy): " + AE_PIPE.results.pack.length);
        t4e = nowMs();
    }

    // Step 7: Set AME output paths
    maybeSleep("Step 7");
    t5s = nowMs();
    if (OPTS.RUN_set_ame_output_paths === false) {
        log("Step 7 (set_ame_output_paths.jsx): SKIPPED by toggle.");
        t5e = nowMs();
    } else {
        log("Step 7: Set AME output paths for " + AE_PIPE.results.pack.length + " comps.");
    // Diagnostics for effective options (kept concise here)
    try {
        var __isoEff = (OPTS && OPTS.insertRelink) ? (OPTS.insertRelink.DATA_JSON_ISO_CODE_MANUAL + " [" + (OPTS.insertRelink.DATA_JSON_ISO_MODE||"auto") + "]") : "n/a";
        log("Effective options: PIPELINE_QUEUE_TO_AME=" + (PIPELINE_QUEUE_TO_AME ? "ON" : "OFF") + "; ISO_MANUAL=" + __isoEff);
    } catch(eDiag) {}
    var step5UsedAPI = false;
    try {
        try { if (typeof AE_AME !== 'undefined') { AE_AME = undefined; } } catch(eCLR5) {}
        $.evalFile(SET_AME_PATH);
        if (typeof AE_AME !== "undefined" && AE_AME && typeof AE_AME.run === "function") {
            // Pass comps directly; control queueing via top-level toggle
            log("Step 7: Queue to AME = " + (PIPELINE_QUEUE_TO_AME ? "ON" : "OFF"));
            var __opts5 = (OPTS.ame || {});
            if (!PHASE_FILE_LOGS_MASTER_ENABLE) { try { __opts5.ENABLE_FILE_LOG = false; } catch(eMS5) {} }
            var res5 = AE_AME.run({ comps: AE_PIPE.results.pack, runId: RUN_ID, log: log, noQueue: !PIPELINE_QUEUE_TO_AME, options: __opts5 });
            if (res5 && res5.configured) AE_PIPE.results.ame = res5.configured;
            step5UsedAPI = true;
        }
    } catch (e5) {
        log("Step 7 API path failed, falling back to default behavior. Error: " + (e5 && e5.message ? e5.message : e5));
    }
        // No fallback: avoid double execution and potential undo/queue conflicts
    log("Step 7: AME paths set (count proxy): " + AE_PIPE.results.ame.length);
        t5e = nowMs();
    }

    // Unified summary with per-phase counts and timing
    var totalMs = nowMs() - t0All;
    var summary = [];
    summary.push("Pipeline complete.");
    var layersAddedTotal = 0; try { layersAddedTotal = (AE_PIPE.results.meta && AE_PIPE.results.meta.addLayersAddedTotal) ? AE_PIPE.results.meta.addLayersAddedTotal : 0; } catch(eMT) {}
    summary.push("Counts => created=" + AE_PIPE.results.createComps.length + ", insertedRelinked=" + AE_PIPE.results.insertRelink.length + ", addLayers=" + AE_PIPE.results.addLayers.length + ", packed=" + AE_PIPE.results.pack.length + ", ameConfigured=" + AE_PIPE.results.ame.length + ", layersAddedTotal=" + layersAddedTotal);
    summary.push("Timing (s) => linkData=" + sec(tLe-tLs) + ", saveAsISO=" + sec(tS2e-tS2s) + ", create=" + sec(t1e-t1s) + ", insertRelink=" + sec(t2e-t2s) + ", addLayers=" + sec(t3e-t3s) + ", pack=" + sec(t4e-t4s) + ", ame=" + sec(t5e-t5s) + ", total=" + sec(totalMs));
    var finalMsg = summary.join("\n");
    log(finalMsg);
    try { log("=== PIPELINE RUN END ==="); } catch(eFtr) {}
    try {
        var __doAlert = true;
        try { __doAlert = (OPTS && OPTS.ENABLE_FINAL_ALERT !== false); } catch(eFA) {}
        if (__doAlert) { alert(finalMsg); }
    } catch (eAF) {}
    // Consume non-sticky user options to prevent unintended carry-over across runs
    try {
        if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.options && AE_PIPE.options.__sticky !== true) {
            AE_PIPE.options = {};
        }
    } catch(eClear) {}
})();