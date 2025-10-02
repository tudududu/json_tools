// After Effects — Set AME output paths before export (based on comp name tokens)
// ——————————————————————————————————————————————————————————————
// What it does
// 1) Resolves POST folder from the current AE project (else prompts)
// 2) Ensures OUT/MASTER/YYMMDD exists (today’s date)
// 3) Goes through Render Queue items and sets Output Module(1).file per item to:
//    POST/OUT/MASTER/<YYMMDD>/<AR>/<DURATION>/<originalName>.<ext>
//    where AR is like 1x1, 16x9, 9x16 and DURATION is like 06s, 15s, 120s
// 4) Optionally queues the items into AME (toggle at top)
//
// Notes
// - This does NOT change format/codec; it only changes output path/filename. The existing
//   Output Module’s format decides the final extension and encoding.
// - Unmatched items (no AR or duration token) go to OUT/MASTER/<YYMMDD>/unsorted.
// - If you already have items in AME, After Effects cannot reliably update their paths; re-queue from AE
//   after running this script.

(function setAMEOutputPaths() {
    app.beginUndoGroup("Set AME Output Paths");

    // ————— Settings —————
    // 1. Source selection mode
    var PROCESS_SELECTION = true;          // If true: take currently selected CompItems in Project panel and add them to the Render Queue
    var PROCESS_EXISTING_RQ = true;         // If true: also process existing (non-rendering, non-done) Render Queue items
    var ALLOW_DUPLICATE_RQ_ITEMS = false;   // If false: skip adding a comp if it already exists in RQ (status not DONE)

    // 2. Templates (optional)
    var RENDER_SETTINGS_TEMPLATE = "";     // e.g. "Best Settings" (leave empty for AE default)
    var OUTPUT_MODULE_TEMPLATE = "";       // e.g. "Lossless" or custom template name (leave empty for current default)
    var ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION = true; // If true, choose OM template per comp via mappings below
    // Map by Aspect Ratio token -> Output Module template name (must exist in AE's Output Module Templates)
    var OUTPUT_MODULE_TEMPLATE_BY_AR = {
        // Define your mappings. Example names must match templates you created in AE (Edit > Templates > Output Module)
        "1x1": "25Mbs",
        "16x9": "25Mbs",
        "9x16": "25Mbs",
        "4x5": "25Mbs"
    };
    // Optional: Map by Aspect Ratio + Duration combo (AR|DUR) -> template (overrides AR-only mapping if present)
    // Example key: "1x1|06s": "H264_Square_Short"
    var OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION = { };

    // 3. AME automation
    var AUTO_QUEUE_IN_AME = true;           // After setting output paths, queue all eligible items into AME
    var START_AME_ENCODING = false;         // If true, attempt to auto-start encoding in AME (may be ignored by some versions)
    var AME_MAX_QUEUE_ATTEMPTS = 3;         // Retry attempts if Dynamic Link not ready
    var AME_RETRY_DELAY_MS = 650;           // Delay between attempts (ms)
    var QUEUE_ONLY_WHEN_NEW_OR_CHANGED = true; // If true, only queue to AME when new items were added OR output paths changed
    var FORCE_QUEUE_ALWAYS = false;            // Override: queue every run regardless (takes precedence)

    // 4. Naming / extension fallback
    var DEFAULT_EXTENSION_FALLBACK = ".mov"; // Used only if output module has no file name yet

    // 4b. Date folder ISO suffix feature
    var ENABLE_DATE_FOLDER_ISO_SUFFIX = true;      // When true, append _<ISO> to date folder (e.g. 251002_DEU)
    var DATE_FOLDER_ISO_FALLBACK = "XXX";          // Fallback ISO if extraction fails (used only if ENABLE_DATE_FOLDER_ISO_SUFFIX && REQUIRE_VALID_ISO)
    var REQUIRE_VALID_ISO = false;                 // If true, use fallback when extracted not 3 letters; if false, silently skip suffix
    var DATE_FOLDER_ISO_UPPERCASE = true;          // Force uppercase
    var LOG_ISO_EXTRACTION = true;                 // Extra logging about ISO extraction
    var DATA_JSON_PROJECT_PATH = ["project","in","data"]; // Path in AE project panel where data.json expected
    var DATA_JSON_ITEM_NAME = "data.json";         // Footage item name
    var DATA_JSON_COUNTRY_KEY_PATH = ["metadataGlobal","country"]; // JSON path to ISO

    // 4c. File logging options (applies only if file logging enabled later)
    var FILE_LOG_APPEND_MODE = false;          // When true, append to a single persistent file (set_ame_output_paths.log)
    var FILE_LOG_PRUNE_ENABLED = true;         // When true, prune old log files (pattern set_ame_output_paths_*.log) beyond max
    var FILE_LOG_MAX_FILES = 12;               // Keep at most this many timestamped log files (ignored if append mode only and no rotation needed)
    var LOG_ENV_HEADER = true;                 // Write environment header (project, counts baseline) at start of each run (or section marker if append)
    var LOG_SUMMARY_SECTION = true;            // Emit compact summary section at end (in addition to main message)

    // 4d. Debug instrumentation (set TRUE to enable temporary diagnostics)
    var DEBUG_DUMP_PROJECT_TREE = true;       // When true, dumps the Project panel folder tree (top-down) to the log
    var DEBUG_DUMP_PROJECT_TREE_MAX_DEPTH = 6; // Limit recursion depth for tree dump
    var DEBUG_DUMP_PROJECT_TREE_MAX_ITEMS = 60;// Max children listed per folder
    var DEBUG_VERBOSE_ISO_STEPS = true;        // Extra step-by-step logs inside ISO extraction


    // 5. Logging verbosity
    var MAX_DETAIL_LINES = 80;             // Limit detail lines logged
    var APPLY_TEMPLATE_TO_EXISTING_ITEMS = false; // If true, try to apply dynamic template to existing (non-newly-added) RQ items too
    var DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES = true; // Re-apply template just before AME queue (improves reliability of inheritance)
    var INJECT_PRESET_TOKEN_IN_FILENAME = false; // Append __TemplateName to filename before extension (lets you see which preset intended)
    var FILENAME_TEMPLATE_SANITIZE = true; // Sanitize token when injecting
    var VERBOSE_TEMPLATE_DEBUG = false; // Extra logging for template reapplication

    // ————— Utils —————
    function log(msg) { try { $.writeln(msg); } catch (e) {} }
    function alertOnce(msg) { try { alert(msg); } catch (e) {} }

    function joinPath(a, b) {
        if (!a) return b || "";
        if (!b) return a || "";
        var sep = (/\\$/.test(a) || /\/$/.test(a)) ? "" : "/";
        return a + sep + b;
    }

    function pad2(n) { return (n < 10 ? "0" + n : String(n)); }

    function todayYYMMDD() {
        var d = new Date();
        var yy = String(d.getFullYear()).slice(-2);
        var mm = pad2(d.getMonth() + 1);
        var dd = pad2(d.getDate());
        return yy + mm + dd;
    }

    function ensureFolderExists(folder) {
        if (!folder) return false;
        if (folder.exists) return true;
        var parent = folder.parent;
        if (parent && !parent.exists) ensureFolderExists(parent);
        return folder.create();
    }

    function splitBaseExt(name) {
        var s = String(name || "");
        var dot = s.lastIndexOf(".");
        if (dot > 0) return { base: s.substring(0, dot), ext: s.substring(dot) };
        return { base: s, ext: "" };
    }

    function normalizeDuration(tok) {
        if (!tok) return null;
        var m = String(tok).match(/^(\d{1,4})s$/i);
        if (!m) return null;
        var n = parseInt(m[1], 10);
        if (isNaN(n)) return null;
        return (n < 100 ? pad2(n) : String(n)) + "s";
    }

    function parseTokensFromName(nameBase) {
        var ar = null;        // e.g. 16x9, 9x16, 1x1
        var dur = null;       // e.g. 06s, 15s, 120s
        // Find AR token (x or X)
        var mAR = String(nameBase).match(/(?:^|[_\-\s])(\d{1,2})[xX](\d{1,2})(?:$|[_\-\s])/);
        if (mAR) ar = mAR[1] + "x" + mAR[2];
        // Find duration token NN..Ns
        var mDur = String(nameBase).match(/(?:^|[_\-\s])(\d{1,4}s)(?:$|[_\-\s])/i);
        if (mDur) dur = normalizeDuration(mDur[1]);
        return { ar: ar, duration: dur };
    }

    function pickOutputModuleTemplate(tokens) {
        if (!ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION || !tokens) return OUTPUT_MODULE_TEMPLATE || "";
        var ar = tokens.ar || "";
        var dur = tokens.duration || "";
        if (ar && dur) {
            var key = ar + "|" + dur;
            if (OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION[key]) return OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION[key];
        }
        if (ar && OUTPUT_MODULE_TEMPLATE_BY_AR[ar]) return OUTPUT_MODULE_TEMPLATE_BY_AR[ar];
        return OUTPUT_MODULE_TEMPLATE || ""; // fallback
    }

    // ————— data.json ISO extraction helpers —————
    function findProjectFolderPath(pathSegments) {
        var cur = app.project.rootFolder;
        for (var i=0;i<pathSegments.length;i++) {
            var seg = pathSegments[i]; if (!seg) continue;
            if (!cur || typeof cur.numItems !== 'number') { if (LOG_ISO_EXTRACTION) log("ISO: findProjectFolderPath abort (no numItems at segment '"+seg+"')"); return null; }
            var found = null;
            try {
                // AE collections are 1-based and accessed via item(index), not items[index]
                for (var j=1;j<=cur.numItems;j++) {
                    var it = null;
                    try { it = cur.item(j); } catch(innerErr) { it = null; }
                    if (it instanceof FolderItem && it.name === seg) { found = it; break; }
                }
            } catch(loopErr) {
                if (LOG_ISO_EXTRACTION) log("ISO: loop error at segment '"+seg+"' -> " + loopErr);
                return null;
            }
            if (!found) return null; // Must already exist (we only read)
            cur = found;
        }
        return cur;
    }
    function findItemInFolderByName(folderItem, name) {
        if (!folderItem) return null;
        for (var i=1;i<=folderItem.numItems;i++) {
            var it = null;
            try { it = folderItem.item(i); } catch(innerErr) { it = null; }
            if (it && it.name === name) return it;
        }
        return null;
    }
    function readTextFile(file) {
        if (!file || !file.exists) return null;
        var txt = null; try { file.encoding = 'UTF-8'; if (file.open('r')) { txt = file.read(); file.close(); } } catch(e){ try{ file.close(); }catch(e2){} }
        return txt;
    }
    function parseJSONSafe(str) {
        if (!str) return null; try { if (typeof JSON !== 'undefined' && JSON.parse) return JSON.parse(str); } catch(e){}
        try { return eval('(' + str + ')'); } catch(e2){ return null; }
    }
    function extractNested(obj, pathArr) {
        var cur = obj; for (var i=0;i<pathArr.length;i++){ if(!cur) return null; cur = cur[pathArr[i]]; }
        return cur;
    }
    function deriveISOFromDataJSON() {
        try {
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: derive start");
            var folder = findProjectFolderPath(DATA_JSON_PROJECT_PATH);
            if (!folder) { if (LOG_ISO_EXTRACTION) log("ISO: data folder path missing: " + DATA_JSON_PROJECT_PATH.join('/')); return null; }
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: folder resolved '"+folder.name+"'");
            var item = findItemInFolderByName(folder, DATA_JSON_ITEM_NAME);
            if (!item || !(item instanceof FootageItem)) { if (LOG_ISO_EXTRACTION) log("ISO: data.json item not found"); return null; }
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: data.json footage item located");
            var srcFile = null; try { srcFile = item.mainSource ? item.mainSource.file : null; } catch(eMS) {}
            if (!srcFile || !srcFile.exists) { if (LOG_ISO_EXTRACTION) log("ISO: data.json file missing on disk"); return null; }
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: file exists -> " + srcFile.fsName);
            var txt = readTextFile(srcFile); if (!txt) { if (LOG_ISO_EXTRACTION) log("ISO: data.json read failed"); return null; }
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: read text length=" + txt.length);
            var parsed = parseJSONSafe(txt); if (!parsed) { if (LOG_ISO_EXTRACTION) log("ISO: data.json parse failed"); return null; }
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: JSON parsed ok");
            var iso = null;
            try {
                iso = extractNested(parsed, DATA_JSON_COUNTRY_KEY_PATH);
                if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG: extractNested returned type=" + (typeof iso));
            } catch(exN){ if (LOG_ISO_EXTRACTION) log("ISO DBG: extractNested threw: " + exN); return null; }
            try {
                if (typeof iso !== 'string') { if (LOG_ISO_EXTRACTION) log("ISO: country path not string"); return null; }
                iso = iso.replace(/\s+/g,'').trim();
            } catch(exPP){ if (LOG_ISO_EXTRACTION) log("ISO DBG: post-process replace/trim error: " + exPP); return null; }
            try {
                if (DATE_FOLDER_ISO_UPPERCASE) iso = iso.toUpperCase();
            } catch(exUp){ if (LOG_ISO_EXTRACTION) log("ISO DBG: uppercase step error: " + exUp); return null; }
            try {
                if (!/^[A-Za-z]{3}$/.test(iso)) {
                    if (LOG_ISO_EXTRACTION) log("ISO: value invalid '" + iso + "'");
                    return null;
                }
            } catch(exVal){ if (LOG_ISO_EXTRACTION) log("ISO DBG: validation regex error: " + exVal); return null; }
            if (LOG_ISO_EXTRACTION) log("ISO: extracted '" + iso + "' from data.json");
            return iso;
        } catch(eD){ if (LOG_ISO_EXTRACTION) log("ISO: extraction error: " + eD); return null; }
    }

    // Debug: dump project tree if enabled
    function dumpProjectTree() {
        if (!DEBUG_DUMP_PROJECT_TREE) return;
        try {
            log("--- PROJECT TREE DUMP BEGIN ---");
            var root = app.project.rootFolder;
            function nodeKind(it){
                if (it instanceof CompItem) return "[Comp]";
                if (it instanceof FolderItem) return "[Folder]";
                if (it instanceof FootageItem) return "[Footage]";
                return "[Item]";
            }
            function walk(folder, depth){
                if (!folder) return; if (depth > DEBUG_DUMP_PROJECT_TREE_MAX_DEPTH) return;
                var prefix = new Array(depth+1).join("  ");
                log(prefix + nodeKind(folder) + " " + folder.name + (folder.numItems?" ("+folder.numItems+")":""));
                if (!(folder instanceof FolderItem)) return;
                var limit = Math.min(folder.numItems, DEBUG_DUMP_PROJECT_TREE_MAX_ITEMS);
                for (var i=1;i<=limit;i++) {
                    var child = null; try { child = folder.item(i); } catch(eC){ child = null; }
                    if (!child) continue;
                    if (child instanceof FolderItem) {
                        walk(child, depth+1);
                    } else {
                        log(prefix + "  " + nodeKind(child) + " " + child.name);
                    }
                }
                if (folder.numItems > limit) log(prefix + "  ... (" + (folder.numItems - limit) + " more items truncated) ...");
            }
            walk(root, 0);
            log("--- PROJECT TREE DUMP END ---");
        } catch(ePT) { log("PROJECT TREE DUMP ERROR: " + ePT); }
    }

    // ————— Resolve POST and OUT/MASTER/YYMMDD —————
    var postFolder = null;
    if (app.project && app.project.file && app.project.file.parent && app.project.file.parent.parent) {
        postFolder = app.project.file.parent.parent; // .../POST
        if (!postFolder || !postFolder.exists) postFolder = null;
    }
    if (!postFolder) {
        postFolder = Folder.selectDialog("Select POST folder (containing WORK and OUT)");
        if (!postFolder) {
            alertOnce("Cancelled: POST folder not selected.");
            app.endUndoGroup();
            return;
        }
    }

    var outMaster = new Folder(joinPath(postFolder.fsName, joinPath("OUT", "MASTER")));
    if (!ensureFolderExists(outMaster)) {
        alertOnce("Cannot create OUT/MASTER under: " + postFolder.fsName);
        app.endUndoGroup();
        return;
    }

    // -------- File logging (POST/WORK/log) --------
    var ENABLE_FILE_LOG = true;             // Master toggle for file log
    var FILE_LOG_SUBFOLDER = "log";        // Subfolder under POST/WORK
    var __fileLog = null;                   // File handle
    function __ts() {
        var d=new Date(); function p(n){return (n<10?'0':'')+n;} return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
    }
    function __tsHuman(){ var d=new Date(); function p(n){return (n<10?'0':'')+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" " + p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }
    if (ENABLE_FILE_LOG) {
        try {
            var workFolder = new Folder(joinPath(postFolder.fsName, "WORK"));
            if (workFolder.exists) {
                var logFolder = new Folder(joinPath(workFolder.fsName, FILE_LOG_SUBFOLDER));
                if (!logFolder.exists) logFolder.create();
                if (logFolder.exists) {
                    var logName = FILE_LOG_APPEND_MODE ? "set_ame_output_paths.log" : ("set_ame_output_paths_" + __ts() + ".log");
                    __fileLog = new File(joinPath(logFolder.fsName, logName));
                    // Prune old logs if enabled and not in pure append (we still can prune timestamped files while appending)
                    if (FILE_LOG_PRUNE_ENABLED) {
                        try {
                            var all = logFolder.getFiles(function(f){ return (f instanceof File) && /set_ame_output_paths_\d{8}_\d{6}\.log$/i.test(f.name); });
                            if (all && all.length && FILE_LOG_MAX_FILES > 0) {
                                // Sort by name ascending (timestamp in name ensures chronological)
                                all.sort(function(a,b){ if(a.name < b.name) return -1; if(a.name > b.name) return 1; return 0; });
                                while (all.length > FILE_LOG_MAX_FILES) { var oldF = all.shift(); try { oldF.remove(); } catch(prErr) {} }
                            }
                        } catch(pruneErr) {}
                    }
                }
            }
        } catch (eFL) {}
    }
    function __writeFileLine(f,line){ if(!f) return; try{ if(f.open('a')){ f.write(line+"\n"); f.close(); } }catch(e){}}
    if (__fileLog) {
        try {
            var __origLogFn = log;
            log = function(msg){ __origLogFn(msg); __writeFileLine(__fileLog,msg); };
            log("[log] File logging started: " + __fileLog.fsName + (FILE_LOG_APPEND_MODE ? " (append mode)" : ""));
            if (LOG_ENV_HEADER) {
                log("--- ENV HEADER BEGIN ---");
                try {
                    var pjPath = (app.project && app.project.file) ? app.project.file.fsName : "(unsaved)";
                    log("ProjectPath: " + pjPath);
                    log("ProjectName: " + ((app.project && app.project.file) ? app.project.file.name : "(unsaved)"));
                } catch(ePH) { log("ProjectPath: (error)" ); }
                log("RunTimestamp: " + __tsHuman());
                log("Settings: PROCESS_SELECTION="+PROCESS_SELECTION+", PROCESS_EXISTING_RQ="+PROCESS_EXISTING_RQ+", DYN_TEMPLATES="+ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION+", AUTO_QUEUE="+AUTO_QUEUE_IN_AME);
                log("DateFolderSuffixISO=" + ENABLE_DATE_FOLDER_ISO_SUFFIX + ", REQUIRE_VALID_ISO=" + REQUIRE_VALID_ISO);
                log("AppendMode=" + FILE_LOG_APPEND_MODE + ", PruneEnabled=" + FILE_LOG_PRUNE_ENABLED + ", MaxFiles=" + FILE_LOG_MAX_FILES);
                log("--- ENV HEADER END ---");
            }
            // Optional debug tree dump
            dumpProjectTree();
        } catch(eWrap) {}
    }
    if (!__fileLog) {
        // Still allow debug tree dump to console if logging not active
        dumpProjectTree();
    }
    var baseDateName = todayYYMMDD();
    var dateFolderName = baseDateName;
    try {
        if (ENABLE_DATE_FOLDER_ISO_SUFFIX) {
            var isoVal = deriveISOFromDataJSON();
            if (!isoVal) {
                if (REQUIRE_VALID_ISO) {
                    isoVal = DATE_FOLDER_ISO_FALLBACK;
                    if (LOG_ISO_EXTRACTION) log("ISO: using fallback '" + isoVal + "'");
                }
            }
            if (isoVal && /^[A-Za-z]{3}$/.test(isoVal)) {
                dateFolderName = baseDateName + "_" + (DATE_FOLDER_ISO_UPPERCASE ? isoVal.toUpperCase() : isoVal);
            } else if (LOG_ISO_EXTRACTION) {
                log("ISO: no valid ISO append; using plain date folder");
            }
        }
    } catch(eISOBlock) { if (LOG_ISO_EXTRACTION) log("ISO: suffix block error: " + eISOBlock); }
    var dateFolder = new Folder(joinPath(outMaster.fsName, dateFolderName));
    if (!ensureFolderExists(dateFolder)) {
        alertOnce("Cannot create date folder: " + dateFolder.fsName);
        app.endUndoGroup();
        return;
    }

    // ————— Gather / Create Render Queue Items —————
    var rq = app.project.renderQueue;
    if (!rq) {
        alertOnce("Render Queue not available.");
        app.endUndoGroup();
        return;
    }

    var detailLines = [];

    function rqItemStatusString(st) {
        try {
            if (st === RQItemStatus.QUEUED) return "QUEUED";
            if (st === RQItemStatus.NEEDS_OUTPUT) return "NEEDS_OUTPUT";
            if (st === RQItemStatus.UNQUEUED) return "UNQUEUED";
            if (st === RQItemStatus.RENDERING) return "RENDERING";
            if (st === RQItemStatus.DONE) return "DONE";
            if (st === RQItemStatus.ERR_STOPPED) return "ERR_STOPPED";
        } catch (e) {}
        return "?";
    }

    function compAlreadyInRQ(comp) {
        if (!comp) return false;
        for (var i = 1; i <= rq.numItems; i++) {
            var rqi = rq.item(i);
            if (rqi && rqi.comp === comp) {
                // Skip only if item is not DONE (we can reuse to change output path)
                try { if (rqi.status !== RQItemStatus.DONE) return true; } catch (e) { return true; }
            }
        }
        return false;
    }

    var itemsToProcess = []; // Array of { rqi: RenderQueueItem, newlyAdded: bool }
    var addedCount = 0;

    // A) Process selection: add selected comps to RQ
    if (PROCESS_SELECTION) {
        var sel = app.project.selection;
        if (sel && sel.length) {
            for (var s = 0; s < sel.length; s++) {
                var it = sel[s];
                if (!(it instanceof CompItem)) continue;
                if (!ALLOW_DUPLICATE_RQ_ITEMS && compAlreadyInRQ(it)) {
                    detailLines.push("Skip add (exists) " + it.name);
                    continue;
                }
                var newRQI = null;
                try { newRQI = rq.items.add(it); } catch (eAdd) { detailLines.push("Failed add " + it.name + ": " + eAdd); }
                if (newRQI) {
                    // Apply templates if configured
                    if (RENDER_SETTINGS_TEMPLATE) {
                        try { newRQI.setRenderSettings(RENDER_SETTINGS_TEMPLATE); } catch (eRS) { detailLines.push("Render settings template fail " + it.name + ": " + eRS); }
                    }
                    var omNew = null;
                    try { omNew = newRQI.outputModule(1); } catch (eOMn) {}
                    if (omNew && OUTPUT_MODULE_TEMPLATE) {
                        try { omNew.applyTemplate(OUTPUT_MODULE_TEMPLATE); } catch (eOMt) { detailLines.push("OM template fail " + it.name + ": " + eOMt); }
                    }
                    var chosenDynTemplate = null;
                    if (omNew && ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION) {
                        var toks = parseTokensFromName(it.name);
                        var dynTemplate = pickOutputModuleTemplate(toks);
                        if (dynTemplate && dynTemplate.length) {
                            try { omNew.applyTemplate(dynTemplate); detailLines.push("OM dyn template '" + dynTemplate + "' -> " + it.name); chosenDynTemplate = dynTemplate; } catch (eDyn) { detailLines.push("OM dyn template fail " + it.name + ": " + eDyn); }
                        }
                    }
                    itemsToProcess.push({ rqi: newRQI, newlyAdded: true, dynTemplate: chosenDynTemplate });
                    addedCount++;
                }
            }
        }
    }

    // B) Include existing RQ items
    if (PROCESS_EXISTING_RQ) {
        for (var iExist = 1; iExist <= rq.numItems; iExist++) {
            var existingRQI = rq.item(iExist);
            if (!existingRQI || !existingRQI.comp) continue;
            // Avoid duplicates: if we already added this rqi instance, skip
            var already = false;
            for (var c = 0; c < itemsToProcess.length; c++) {
                if (itemsToProcess[c].rqi === existingRQI) { already = true; break; }
            }
            if (already) continue;
            // Skip DONE or RENDERING
            try { if (existingRQI.status === RQItemStatus.DONE || existingRQI.status === RQItemStatus.RENDERING) continue; } catch (eSt) {}
            itemsToProcess.push({ rqi: existingRQI, newlyAdded: false });
        }
    }

    if (!itemsToProcess.length) {
        alertOnce("No eligible Render Queue items (after selection + existing check)." );
        app.endUndoGroup();
        return;
    }

    // ————— Assign Output Paths —————
    var processed = 0, skipped = 0, unsorted = 0, changedCount = 0;
    for (var idx = 0; idx < itemsToProcess.length; idx++) {
        var entry = itemsToProcess[idx];
        var rqi = entry.rqi;
        if (!rqi || !rqi.comp) { skipped++; continue; }
        // Re-skip status DONE / RENDERING safeguard
        try { if (rqi.status === RQItemStatus.DONE || rqi.status === RQItemStatus.RENDERING) { skipped++; continue; } } catch (eS2) {}

        var om = null;
        try { om = rqi.outputModule(1); } catch (eOM2) { om = null; }
        if (!om) { skipped++; detailLines.push("No OM " + rqi.comp.name); continue; }

        var compName = rqi.comp.name;
        var curFile = om.file;
        var ext = DEFAULT_EXTENSION_FALLBACK;
        var baseName = compName;
        if (curFile && curFile.name) {
            var parts2 = splitBaseExt(curFile.name);
            if (parts2.ext) ext = parts2.ext;
            if (parts2.base) baseName = parts2.base;
        }

        var tokens = parseTokensFromName(compName);
        var dynTemplateUsed = entry.dynTemplate || null;
        if (ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION && (entry.newlyAdded || APPLY_TEMPLATE_TO_EXISTING_ITEMS)) {
            var dynT = pickOutputModuleTemplate(tokens);
            if (dynT && dynT.length) {
                try { om.applyTemplate(dynT); dynTemplateUsed = dynT; if (detailLines.length < MAX_DETAIL_LINES) detailLines.push("TEMPLATE -> " + compName + " => " + dynT); }
                catch (eTpl) { if (detailLines.length < MAX_DETAIL_LINES) detailLines.push("TEMPLATE FAIL " + compName + ": " + eTpl); }
            }
        }
        var destParent = dateFolder;
        if (tokens.ar && tokens.duration) {
            destParent = new Folder(joinPath(joinPath(dateFolder.fsName, tokens.ar), tokens.duration));
        } else {
            destParent = new Folder(joinPath(dateFolder.fsName, "unsorted"));
            unsorted++;
        }
        ensureFolderExists(destParent);
        var destPath = joinPath(destParent.fsName, baseName + ext);
        var originalPath = curFile && curFile.fsName ? String(curFile.fsName) : null;
        if (INJECT_PRESET_TOKEN_IN_FILENAME && dynTemplateUsed) {
            var token = dynTemplateUsed;
            if (FILENAME_TEMPLATE_SANITIZE) token = token.replace(/[^A-Za-z0-9_\-]+/g, "_");
            var injectedBase = baseName + "__" + token;
            destPath = joinPath(destParent.fsName, injectedBase + ext);
        }
        try {
            om.file = new File(destPath);
            processed++;
            var changed = false;
            if (!entry.newlyAdded && originalPath) {
                // Compare normalized lower-case paths for change detection
                try { if (originalPath.toLowerCase() !== destPath.toLowerCase()) { changed = true; changedCount++; } } catch (eCmp) {}
            }
            var tag = entry.newlyAdded ? "ADD" : (changed ? "CHG" : "SET");
            if (detailLines.length < MAX_DETAIL_LINES) detailLines.push(tag + " -> " + compName + " => " + destPath);
        } catch (eSet2) {
            skipped++;
            detailLines.push("FAIL set " + compName + ": " + eSet2);
        }
    }

    // --- End of preparation phase: close undo group early ---
    // We'll now verify and queue outside of the undo context to reduce mismatch risk.
    try { app.endUndoGroup(); } catch (eUG) {}

    // Verification: ensure items actually exist (AE can silently rollback on first run after launch)
    var verifiedAdded = 0;
    try {
        for (var va = 0; va < itemsToProcess.length; va++) {
            var vrqi = itemsToProcess[va].rqi;
            if (vrqi && vrqi.comp) {
                try { if (vrqi.status !== RQItemStatus.DONE) verifiedAdded++; } catch (eVA) { verifiedAdded++; }
            }
        }
    } catch (eChk) {}

    // Queue to AME with retry logic (in case Dynamic Link server not yet ready)
    var ameQueued = false;
    // Optional second-pass: reapply templates right before queueing (helps AME pick up correct format)
    if (DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES && ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION) {
        for (var ra = 0; ra < itemsToProcess.length; ra++) {
            var ent = itemsToProcess[ra];
            if (!ent || !ent.rqi) continue;
            try {
                var omRe = ent.rqi.outputModule(1);
                if (!omRe) continue;
                var rTok = parseTokensFromName(ent.rqi.comp.name);
                var rTpl = pickOutputModuleTemplate(rTok);
                if (rTpl && rTpl.length) {
                    try { omRe.applyTemplate(rTpl); if (VERBOSE_TEMPLATE_DEBUG && detailLines.length < MAX_DETAIL_LINES) detailLines.push("REAPPLY -> " + ent.rqi.comp.name + " => " + rTpl); }
                    catch (eRA) { if (detailLines.length < MAX_DETAIL_LINES) detailLines.push("REAPPLY FAIL " + ent.rqi.comp.name + ": " + eRA); }
                }
            } catch (eOuter) {}
        }
    }
    function sleep(ms) { try { $.sleep(ms); } catch (e) {} }
    function attemptQueue(start) {
        try {
            if (start) {
                try { app.project.renderQueue.queueInAME(true); }
                catch (e1) { app.project.renderQueue.queueInAME(); }
            } else {
                try { app.project.renderQueue.queueInAME(false); }
                catch (e2) { app.project.renderQueue.queueInAME(); }
            }
            return true;
        } catch (eQ) {
            log("QueueInAME failed: " + eQ);
            return false;
        }
    }
    var shouldQueue = AUTO_QUEUE_IN_AME && itemsToProcess.length > 0;
    if (shouldQueue && QUEUE_ONLY_WHEN_NEW_OR_CHANGED && !FORCE_QUEUE_ALWAYS) {
        if (addedCount === 0 && changedCount === 0) {
            shouldQueue = false; // Nothing new or changed; skip re-queue
        }
    }
    if (FORCE_QUEUE_ALWAYS) shouldQueue = AUTO_QUEUE_IN_AME && itemsToProcess.length > 0;

    if (shouldQueue) {
        for (var qa = 0; qa < AME_MAX_QUEUE_ATTEMPTS && !ameQueued; qa++) {
            ameQueued = attemptQueue(START_AME_ENCODING);
            if (!ameQueued) sleep(AME_RETRY_DELAY_MS);
        }
    }

    var mismatchNote = "";
    if (addedCount > 0 && verifiedAdded === 0) {
        mismatchNote = "\nWARNING: No Render Queue items verified after addition. Re-run script or disable undo grouping.";
    }

    var msg = "Output paths updated. Added:" + addedCount + " (verified:" + verifiedAdded + ") Changed:" + changedCount + " Processed:" + processed + " Skipped:" + skipped +
              (unsorted ? (" Unsorted:" + unsorted) : "") + (AUTO_QUEUE_IN_AME ? (" AMEQueued:" + (shouldQueue ? (ameQueued ? "yes" : "fail") : "skipped")) : "") +
              "\nBase: " + dateFolder.fsName +
              (detailLines.length ? ("\nDetails (" + detailLines.length + ") — showing up to " + MAX_DETAIL_LINES + ":\n" + detailLines.slice(0, MAX_DETAIL_LINES).join("\n")) : "") +
              mismatchNote +
              (AUTO_QUEUE_IN_AME && shouldQueue && !ameQueued ? "\nHint: Launch Media Encoder manually once, then rerun or increase AME_RETRY_DELAY_MS." : "") +
              (!shouldQueue && AUTO_QUEUE_IN_AME && QUEUE_ONLY_WHEN_NEW_OR_CHANGED ? "\n(AME queue skipped: no new or changed outputs)" : "");
    log(msg);
    if (LOG_SUMMARY_SECTION) {
        log("--- SUMMARY BEGIN ---");
        log("DateFolder: " + dateFolder.fsName);
        log("Added: " + addedCount + ", Changed: " + changedCount + ", Processed: " + processed + ", Skipped: " + skipped + (unsorted?", Unsorted: "+unsorted:""));
        log("VerifiedAdded: " + verifiedAdded + ", AMEQueued: " + (AUTO_QUEUE_IN_AME ? (shouldQueue ? (ameQueued?"yes":"fail") : "skipped") : "disabled"));
        log("DynamicTemplates: " + ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION + ", DoubleApply: " + DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES);
        log("QueueOnlyWhenNewOrChanged: " + QUEUE_ONLY_WHEN_NEW_OR_CHANGED + ", ForceQueueAlways: " + FORCE_QUEUE_ALWAYS);
        log("--- SUMMARY END ---");
    }
    alertOnce(msg);

})();
