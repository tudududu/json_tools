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

// Pipeline detection and API namespace
var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_AME === 'undefined') { var AE_AME = {}; }

function __AME_coreRun(opts) {
    var __openedUndo = false;
    if (!__AE_PIPE__) { try { app.beginUndoGroup("Set AME Output Paths"); __openedUndo = true; } catch(eUGB) {} }

    // ————— Settings —————
    // 1. Source selection mode
    var PROCESS_SELECTION = true;          // If true: take currently selected CompItems in Project panel and add them to the Render Queue
    var PROCESS_EXISTING_RQ = true;         // If true: also process existing (non-rendering, non-done) Render Queue items
    var ALLOW_DUPLICATE_RQ_ITEMS = false;   // If false: skip adding a comp if it already exists in RQ (status not DONE)

    // 2. Templates (optional)
    var RENDER_SETTINGS_TEMPLATE = "";     // e.g. "Best Settings" (leave empty for AE default)
    var OUTPUT_MODULE_TEMPLATE = "";       // e.g. "Lossless" or custom template name (leave empty for current default)
    var ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION = true; // If true, choose OM template per comp via mappings below
    var APPLY_TEMPLATES = true;             // Master toggle: when false, skip applying any Output Module templates
    var AUTO_DISABLE_REAPPLY_ON_MISSING = true; // If any template is missing, skip the reapply pass to reduce log noise
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
    var AUTO_DELETE_RQ_AFTER_AME_QUEUE = true; // If true, remove newly-added RQ items after they were queued into AME (best-effort: queueInAME did not throw)

    // 4. Naming / extension fallback
    var DEFAULT_EXTENSION_FALLBACK = ".mov"; // Used only if output module has no file name yet

    // 4b. Date folder ISO suffix feature & parent folder customization
    var ENABLE_DATE_FOLDER_ISO_SUFFIX = true;      // When true, append _<ISO> to date folder (e.g. 251002_DEU)
    var DATE_FOLDER_ISO_FALLBACK = "XXX";          // Fallback ISO if extraction fails (used only if ENABLE_DATE_FOLDER_ISO_SUFFIX && REQUIRE_VALID_ISO)
    var REQUIRE_VALID_ISO = false;                 // If true, use fallback when extracted not 3 letters; if false, silently skip suffix
    var DATE_FOLDER_ISO_UPPERCASE = true;          // Force uppercase
    var LOG_ISO_EXTRACTION = true;                 // Extra logging about ISO extraction
    var DATE_PARENT_FOLDER_NAME = "PREVIEWS";        // Legacy default parent under OUT (kept for standalone default)
    var DATA_JSON_PROJECT_PATH = ["project","in","data"]; // Path in AE project panel where data.json expected
    var DATA_JSON_ITEM_NAME = "data.json";         // Footage item name
    // (Removed legacy JSON country key path; ISO now derived only from file name or disk scan)

    // 4c. File logging options (applies only if file logging enabled later)
    var FILE_LOG_APPEND_MODE = false;          // When true, append to a single persistent file (set_ame_output_paths.log)
    var FILE_LOG_PRUNE_ENABLED = true;         // When true, prune old log files (pattern set_ame_output_paths_*.log) beyond max
    var FILE_LOG_MAX_FILES = 12;               // Keep at most this many timestamped log files (ignored if append mode only and no rotation needed)
    var LOG_ENV_HEADER = true;                 // Write environment header (project, counts baseline) at start of each run (or section marker if append)
    var LOG_SUMMARY_SECTION = true;            // Emit compact summary section at end (in addition to main message)

    // 4d. Debug instrumentation (set TRUE to enable temporary diagnostics)
    var DEBUG_DUMP_PROJECT_TREE = false;       // When true, dumps the Project panel folder tree (top-down) to the log
    var DEBUG_DUMP_PROJECT_TREE_MAX_DEPTH = 6; // Limit recursion depth for tree dump
    var DEBUG_DUMP_PROJECT_TREE_MAX_ITEMS = 60;// Max children listed per folder
    var DEBUG_VERBOSE_ISO_STEPS = true;        // Extra step-by-step logs inside ISO extraction

    // 4e. ISO extraction simplified: filename-based only (+ optional directory scan fallback)
    var ISO_SCAN_DATA_FOLDER_FALLBACK = true; // If filename lookup fails, scan POST/IN/data for data_XXX.json

    // 5. Logging verbosity
    var MAX_DETAIL_LINES = 80;              // Limit detail lines logged in the DETAIL section
    var VERBOSE_TEMPLATE_DEBUG = false;     // Extra logging for template reapplication
    var VERBOSE_DEBUG = true;               // Gates selection/RQ add phase logs and the DETAIL section output
    var COMPACT_ITEM_DETAIL = true;        // When true, log one compact per-item line (ASSIGN+DEST [+tpl]) instead of multi-line details
    var APPLY_TEMPLATE_TO_EXISTING_ITEMS = false;   // If true, try to apply dynamic template to existing (non-newly-added) RQ items too
    var DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES = true; // Re-apply template just before AME queue (improves reliability of inheritance)
    var INJECT_PRESET_TOKEN_IN_FILENAME = false;    // Append __TemplateName to filename before extension (lets you see which preset intended)
    var FILENAME_TEMPLATE_SANITIZE = true;          // Sanitize token when injecting
    // 5b. Extras routing: when true, route extras into a subfolder named "<AR>_<extraName>"
    var EXTRA_EXPORT_SUBFOLDER = false;
    var EXTRA_OUTPUT_SUFFIX = "_extra";            // source of extraName (leading underscore removed)
    var EXTRA_TAG_TOKENS = [];                      // optional tokens to detect extras in names (e.g., ["TIKTOK"])    
    // 5c. Duration-level subfolder toggle (AR-first mode only)
    var ENABLE_DURATION_SUBFOLDER = true;           // When false, place exports directly under <AR> (or <AR>_<extra>) without <duration>
    // 5c.1 Duration-first ordering toggle
    var DURATION_FIRST_ORDER = false;               // When true, use <duration>/<AR?> ordering (unless mimic is enabled)
    var ENABLE_AR_SUBFOLDER = true;                 // Duration-first only: when true, use <duration>/<AR>; when false, use <duration> only
    // 5d. Language-level subfolder toggle (Integration 166)
    var USE_LANGUAGE_SUBFOLDER = false;             // When true, insert <LANG> subfolder under <date[_ISO]> when language is known
    var USE_OM_FILENAME_AS_BASE = true;             // When true, reuse existing OM file base as baseName; when false, always use compName

    // 5e. Mimic AE project panel folder structure under date folder
    // Derive physical export path segments from the comp's Project panel path AFTER the anchor folder name
    // Example: project/out/4x5/06s/MyComp -> physical: <date>/4x5/06s/MyComp.ext
    var MIMIC_PROJECT_FOLDER_STRUCTURE = true;
    var PROJECT_FOLDER_ANCHOR_NAME = "out"; // anchor folder name to cut at (case-insensitive)

    // Options overrides
    try {
        var o = opts && opts.options ? opts.options : null;
        if (o) {
            if (o.ENABLE_FILE_LOG !== undefined) ENABLE_FILE_LOG = !!o.ENABLE_FILE_LOG;
            // 1. Source selection mode
            if (o.PROCESS_SELECTION !== undefined) PROCESS_SELECTION = !!o.PROCESS_SELECTION;
            if (o.PROCESS_EXISTING_RQ !== undefined) PROCESS_EXISTING_RQ = !!o.PROCESS_EXISTING_RQ;
            // 2. Template application
            if (o.APPLY_TEMPLATES !== undefined) APPLY_TEMPLATES = !!o.APPLY_TEMPLATES;
            if (o.ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION !== undefined) ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION = !!o.ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION;
            if (o.OUTPUT_MODULE_TEMPLATE_BY_AR !== undefined) OUTPUT_MODULE_TEMPLATE_BY_AR = o.OUTPUT_MODULE_TEMPLATE_BY_AR;
            // 3. AME automation
            if (o.AUTO_QUEUE_IN_AME !== undefined) AUTO_QUEUE_IN_AME = !!o.AUTO_QUEUE_IN_AME;
            if (o.AUTO_DELETE_RQ_AFTER_AME_QUEUE !== undefined) AUTO_DELETE_RQ_AFTER_AME_QUEUE = !!o.AUTO_DELETE_RQ_AFTER_AME_QUEUE;
            if (o.AME_MAX_QUEUE_ATTEMPTS !== undefined) AME_MAX_QUEUE_ATTEMPTS = parseInt(o.AME_MAX_QUEUE_ATTEMPTS, 10);
            if (o.AME_RETRY_DELAY_MS !== undefined) AME_RETRY_DELAY_MS = parseInt(o.AME_RETRY_DELAY_MS, 10);
            // 4. Naming / extension fallback
            // 4b. Date folder ISO suffix feature & parent folder customization
            if (o.ENABLE_DATE_FOLDER_ISO_SUFFIX !== undefined) ENABLE_DATE_FOLDER_ISO_SUFFIX = !!o.ENABLE_DATE_FOLDER_ISO_SUFFIX;
            // 4c. File logging options
            if (o.FILE_LOG_APPEND_MODE !== undefined) FILE_LOG_APPEND_MODE = !!o.FILE_LOG_APPEND_MODE;
            if (o.FILE_LOG_MAX_FILES !== undefined) FILE_LOG_MAX_FILES = parseInt(o.FILE_LOG_MAX_FILES, 10);
            if (o.FILE_LOG_PRUNE_ENABLED !== undefined) FILE_LOG_PRUNE_ENABLED = !!o.FILE_LOG_PRUNE_ENABLED;
            // 4d. Debug instrumentation
            if (o.DEBUG_VERBOSE_ISO_STEPS !== undefined) DEBUG_VERBOSE_ISO_STEPS = !!o.DEBUG_VERBOSE_ISO_STEPS;
            // 4e. ISO extraction simplified: filename-based only
            if (o.ISO_SCAN_DATA_FOLDER_FALLBACK !== undefined) ISO_SCAN_DATA_FOLDER_FALLBACK = !!o.ISO_SCAN_DATA_FOLDER_FALLBACK;
            // 5. Logging verbosity
            if (o.VERBOSE_DEBUG !== undefined) VERBOSE_DEBUG = !!o.VERBOSE_DEBUG;
            if (o.COMPACT_ITEM_DETAIL !== undefined) COMPACT_ITEM_DETAIL = !!o.COMPACT_ITEM_DETAIL;
            // Capture export subpath if provided (string or array). Root 'POST' is implicit and not included here.
            var __EXPORT_SUBPATH_OPT = o.EXPORT_SUBPATH;
            if (o.EXTRA_EXPORT_SUBFOLDER !== undefined) EXTRA_EXPORT_SUBFOLDER = !!o.EXTRA_EXPORT_SUBFOLDER;
            if (o.ENABLE_DURATION_SUBFOLDER !== undefined) ENABLE_DURATION_SUBFOLDER = !!o.ENABLE_DURATION_SUBFOLDER;
            if (o.DURATION_FIRST_ORDER !== undefined) DURATION_FIRST_ORDER = !!o.DURATION_FIRST_ORDER;
            if (o.ENABLE_AR_SUBFOLDER !== undefined) ENABLE_AR_SUBFOLDER = !!o.ENABLE_AR_SUBFOLDER;
            if (o.USE_LANGUAGE_SUBFOLDER !== undefined) USE_LANGUAGE_SUBFOLDER = !!o.USE_LANGUAGE_SUBFOLDER;
            if (o.USE_OM_FILENAME_AS_BASE !== undefined) USE_OM_FILENAME_AS_BASE = !!o.USE_OM_FILENAME_AS_BASE;
            // 5e. Mimic AE project panel folder structure
            if (o.MIMIC_PROJECT_FOLDER_STRUCTURE !== undefined) MIMIC_PROJECT_FOLDER_STRUCTURE = !!o.MIMIC_PROJECT_FOLDER_STRUCTURE;
            if (o.PROJECT_FOLDER_ANCHOR_NAME !== undefined) PROJECT_FOLDER_ANCHOR_NAME = String(o.PROJECT_FOLDER_ANCHOR_NAME);
        }
        try { if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASE_FILE_LOGS_MASTER_ENABLE === false) { ENABLE_FILE_LOG = false; } } catch(eMSAME) {}
    } catch(eOpt){}


    // ————— Utils —————
    // Tagged logger
    var __logger = null;
    try { if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') { __logger = __AE_PIPE__.getLogger('ame'); } } catch(eLG) {}

    function log(msg) {
        if (__logger) { try { __logger.info(msg); } catch(e) {} return; }
        try { $.writeln(msg); } catch (e2) {}
    }
    function alertOnce(msg) { if (__AE_PIPE__) { log(msg); return; } try { alert(msg); } catch (e) {} }

    // Robust error-to-string to avoid AE host Error object issues during concatenation
    function safeErrStr(err) {
        try {
            if (!err) return "(error)";
            // ExtendScript Error often has toString and message; prefer message
            try { if (err.message) return String(err.message); } catch (_) {}
            try { return String(err); } catch (e2) { return "(error stringify failed)"; }
        } catch (e3) { return "(error)"; }
    }

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

    // Project panel path helpers: derive folder segments after an anchor (e.g., 'out')
    function collectAncestorItems(item) {
        var items = [];
        try {
            var f = item && item.parentFolder ? item.parentFolder : null;
            while (f && f !== app.project.rootFolder) {
                items.unshift(f);
                f = f.parentFolder;
            }
        } catch (e) {}
        return items;
    }
    function collectAncestorNames(item) {
        var names = [];
        try {
            var items = collectAncestorItems(item);
            for (var i = 0; i < items.length; i++) {
                names.push(String(items[i].name || ''));
            }
        } catch (e) {}
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
        // Skip pure YYMMDD date segments after the anchor; the physical path already
        // uses the YYMMDD_ISO date folder at the root (e.g., '251219_GBL').
        var reDate6 = /^\d{6}$/;
        for (var j = idx + 1; j < ancestors.length; j++) {
            var seg = ancestors[j];
            if (!seg) continue;
            if (reDate6.test(String(seg))) continue; // drop duplicate short date folders like '251216'
            out.push(seg);
        }
        return out;
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

    // Extras helpers — derive configured extra suffix from pipeline options when available
    try {
        var addL = (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.addLayers) ? __AE_PIPE__.optionsEffective.addLayers : null;
        if (addL && addL.EXTRA_TEMPLATES) {
            if (typeof addL.EXTRA_TEMPLATES.OUTPUT_NAME_SUFFIX === 'string' && addL.EXTRA_TEMPLATES.OUTPUT_NAME_SUFFIX.length) {
                EXTRA_OUTPUT_SUFFIX = addL.EXTRA_TEMPLATES.OUTPUT_NAME_SUFFIX;
            }
            if (addL.EXTRA_TEMPLATES.TAG_TOKENS instanceof Array) {
                EXTRA_TAG_TOKENS = addL.EXTRA_TEMPLATES.TAG_TOKENS.slice(0);
            }
        }
    } catch(eGetSuffix) {}

    // Selection-based cut: use selected folder (or selected comp's parent folder) as path root
    function getSelectionCutInfo() {
        var info = { folders: [], hasComp: false };
        try {
            var sel = app.project ? app.project.selection : null;
            if (!sel || !sel.length) return info;
            for (var i = 0; i < sel.length; i++) {
                var it = null; try { it = sel[i]; } catch (eSel) { it = null; }
                if (it && (it instanceof FolderItem)) { info.folders.push(it); }
            }
            for (var j = 0; j < sel.length; j++) {
                var it2 = null; try { it2 = sel[j]; } catch (eSel2) { it2 = null; }
                if (it2 && (it2 instanceof CompItem)) { info.hasComp = true; }
            }
        } catch (eGSR) {}
        return info;
    }
    function folderPathKey(folder) {
        try {
            if (!folder || folder === app.project.rootFolder) return "";
            var parts = [];
            var f = folder;
            while (f && f !== app.project.rootFolder) {
                parts.unshift(String(f.name || ""));
                f = f.parentFolder;
            }
            return parts.join("/").toLowerCase();
        } catch (eFP) { return ""; }
    }
    function relativeSegmentsAfterSelection(item, selectionRoot) {
        if (!selectionRoot) return [];
        if (selectionRoot === app.project.rootFolder) return [];
        var ancestors = collectAncestorItems(item);
        if (!ancestors || !ancestors.length) return [];
        var idx = -1;
        for (var i = ancestors.length - 1; i >= 0; i--) {
            if (ancestors[i] === selectionRoot) { idx = i; break; }
        }
        if (idx < 0) return [];
        var out = [];
        for (var j = idx; j < ancestors.length; j++) {
            out.push(String(ancestors[j].name || ''));
        }
        return out;
    }

    function findMatchingSelectionRoot(item, folders) {
        if (!folders || !folders.length) return null;
        var ancestors = collectAncestorItems(item);
        if (!ancestors || !ancestors.length) return null;
        var selMap = {};
        for (var s = 0; s < folders.length; s++) {
            var k = folderPathKey(folders[s]);
            if (k) selMap[k] = folders[s];
        }
        var best = null;
        var bestIdx = null;
        for (var i = 0; i < ancestors.length; i++) {
            var keyA = folderPathKey(ancestors[i]);
            if (keyA && selMap[keyA]) {
                if (bestIdx === null || i < bestIdx) { best = selMap[keyA]; bestIdx = i; }
            }
        }
        return best;
    }
    function __normToken(s){ try { return String(s||"").replace(/[^A-Za-z0-9]+/g, "").toLowerCase(); } catch(e){ return ""; } }
    function detectExtraInfo(compName) {
        try {
            var nm = String(compName||"");
            var parts = nm.split(/[_\-\s]+/);
            var tokens = [];
            for (var i=0;i<parts.length;i++){ var t=__normToken(parts[i]); if(t) tokens.push(t); }
            // 1) Try suffix token presence anywhere in name
            var suf = String(EXTRA_OUTPUT_SUFFIX||"");
            if (suf && suf.length) {
                var sufTok = __normToken(suf.charAt(0) === '_' ? suf.substring(1) : suf);
                if (sufTok) {
                    for (var j=0;j<tokens.length;j++){ if (tokens[j] === sufTok) return { isExtra:true, name: sufTok }; }
                }
            }
            // 2) Try TAG_TOKENS match anywhere
            if (EXTRA_TAG_TOKENS && EXTRA_TAG_TOKENS.length) {
                for (var k=0;k<EXTRA_TAG_TOKENS.length;k++){
                    var cand = __normToken(EXTRA_TAG_TOKENS[k]); if(!cand) continue;
                    for (var m=0;m<tokens.length;m++){ if (tokens[m] === cand) return { isExtra:true, name: cand }; }
                }
            }
            // 3) Fallback: strict suffix at end of string
            if (suf && suf.length) {
                if (nm.length >= suf.length && nm.lastIndexOf(suf) === (nm.length - suf.length)) {
                    var en = suf.charAt(0) === '_' ? suf.substring(1) : suf; // strip leading underscore
                    return { isExtra:true, name: __normToken(en) || en };
                }
            }
        } catch(eX) {}
        return { isExtra:false, name:null };
    }

    // ————— data.json ISO extraction helpers —————
    function findProjectFolderPath(pathSegments) {
        var cur = app.project.rootFolder;
        for (var i = 0; i < pathSegments.length; i++) {
            var seg = pathSegments[i];
            if (!seg) continue;
            if (!cur || typeof cur.numItems !== 'number') {
                if (LOG_ISO_EXTRACTION) log("ISO: findProjectFolderPath abort (no numItems at segment '" + seg + "')");
                return null;
            }
            var found = null;
            try {
                var n = cur.numItems;
                for (var j = 1; j <= n; j++) {
                    var child = null; try { child = cur.item(j); } catch (eIt) { child = null; }
                    if (child && (child instanceof FolderItem) && child.name === seg) { found = child; break; }
                }
            } catch (eLoop) { found = null; }
            if (!found) return null;
            cur = found;
        }
        return cur;
    }
    function findItemInFolderByName(folderItem, name) {
        if (!folderItem) return null;
        try {
            var n = 0; try { n = folderItem.numItems; } catch(eN) { n = 0; }
            for (var i=1;i<=n;i++) {
                var it = null;
                try { it = folderItem.item(i); } catch(innerErr) { it = null; }
                try { if (it && it.name === name) return it; } catch(eNm) {}
            }
        } catch(eFF) {}
        return null;
    }

    // (Removed legacy JSON parsing helpers: parseJSONSafe, extractNested, deriveISOFromDataJSON)

    // Simpler: derive ISO from underlying file name (no JSON parse)
    function deriveISOFromDataFileName() {
        try {
            if (DEBUG_VERBOSE_ISO_STEPS && LOG_ISO_EXTRACTION) log("ISO DBG(FN): derive start");
            var folder = findProjectFolderPath(DATA_JSON_PROJECT_PATH);
            if (!folder) { if (LOG_ISO_EXTRACTION) log("ISO(FN): data folder path missing"); return null; }
            var item = findItemInFolderByName(folder, DATA_JSON_ITEM_NAME);
            if (!item) { if (LOG_ISO_EXTRACTION) log("ISO(FN): data.json item not found"); return null; }
            var srcFile = null;
            try { if (item.mainSource && item.mainSource.file) srcFile = item.mainSource.file; } catch(eMS) { srcFile = null; }
            if (!srcFile || !srcFile.exists) { if (LOG_ISO_EXTRACTION) log("ISO(FN): underlying file missing"); return null; }
            var fname = "";
            try { fname = srcFile.name || ""; } catch(eNm) { fname = ""; }
            var m = fname.match(/^data_([A-Za-z]{3})\.json$/);
            if (!m) { if (LOG_ISO_EXTRACTION) log("ISO(FN): filename pattern mismatch '"+fname+"'"); return null; }
            var iso = m[1];
            if (DATE_FOLDER_ISO_UPPERCASE) iso = iso.toUpperCase();
            if (LOG_ISO_EXTRACTION) log("ISO(FN): extracted '"+iso+"' from filename '"+fname+"'");
            return iso;
        } catch(eFN) { if (LOG_ISO_EXTRACTION) log("ISO(FN): error: " + eFN); return null; }
    }

    // Fallback: scan POST/IN/data directory for data_XXX.json files
    function scanISOFromDataDirectory(postFolderRef) {
        try {
            if (!postFolderRef || !postFolderRef.exists) return null;
            var inFolder = new Folder(joinPath(postFolderRef.fsName, 'IN'));
            if (!inFolder.exists) return null;
            var dataFolder = new Folder(joinPath(inFolder.fsName, 'data'));
            if (!dataFolder.exists) return null;
            var files = dataFolder.getFiles(function(f){ return (f instanceof File) && /^data_[A-Za-z]{3}\.json$/i.test(f.name); });
            if (!files || !files.length) return null;
            // If multiple, choose the most recently modified
            files.sort(function(a,b){ try { return b.modified.getTime() - a.modified.getTime(); } catch(e){ return 0; } });
            var top = files[0];
            var m = top.name.match(/^data_([A-Za-z]{3})\.json$/i);
            if (m) {
                var iso = m[1];
                if (DATE_FOLDER_ISO_UPPERCASE) iso = iso.toUpperCase();
                if (LOG_ISO_EXTRACTION) log("ISO(SCAN): picked '"+iso+"' from file '"+top.name+"'");
                return iso;
            }
            return null;
        } catch(eScan){ if (LOG_ISO_EXTRACTION) log("ISO(SCAN): error: " + eScan); return null; }
    }

    // Debug: dump project tree if enabled
    function dumpProjectTree() {
        if (!DEBUG_DUMP_PROJECT_TREE) return;
        try {
                    if (o.APPLY_TEMPLATES !== undefined) APPLY_TEMPLATES = !!o.APPLY_TEMPLATES;
                    if (o.AUTO_DISABLE_REAPPLY_ON_MISSING !== undefined) AUTO_DISABLE_REAPPLY_ON_MISSING = !!o.AUTO_DISABLE_REAPPLY_ON_MISSING;
                    if (o.ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION !== undefined) ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION = !!o.ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION;
                    if (o.DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES !== undefined) DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES = !!o.DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES;
                    if (o.OUTPUT_MODULE_TEMPLATE !== undefined) OUTPUT_MODULE_TEMPLATE = String(o.OUTPUT_MODULE_TEMPLATE);
                    if (o.OUTPUT_MODULE_TEMPLATE_BY_AR !== undefined && typeof o.OUTPUT_MODULE_TEMPLATE_BY_AR === 'object') OUTPUT_MODULE_TEMPLATE_BY_AR = o.OUTPUT_MODULE_TEMPLATE_BY_AR;
                    if (o.OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION !== undefined && typeof o.OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION === 'object') OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION = o.OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION;
            log("--- PROJECT TREE DUMP BEGIN ---");
            var root = app.project.rootFolder;
            function nodeKind(it){
                if (it instanceof CompItem) return "[Comp]";
                // Pull overrides also from pipeline ame namespace when available
                try {
                    var ameOpts = (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.ame) ? __AE_PIPE__.optionsEffective.ame : null;
                    if (ameOpts) {
                        if (ameOpts.APPLY_TEMPLATES !== undefined) APPLY_TEMPLATES = !!ameOpts.APPLY_TEMPLATES;
                        if (ameOpts.AUTO_DISABLE_REAPPLY_ON_MISSING !== undefined) AUTO_DISABLE_REAPPLY_ON_MISSING = !!ameOpts.AUTO_DISABLE_REAPPLY_ON_MISSING;
                        if (ameOpts.ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION !== undefined) ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION = !!ameOpts.ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION;
                        if (ameOpts.DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES !== undefined) DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES = !!ameOpts.DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES;
                        if (ameOpts.OUTPUT_MODULE_TEMPLATE !== undefined) OUTPUT_MODULE_TEMPLATE = String(ameOpts.OUTPUT_MODULE_TEMPLATE);
                        if (ameOpts.OUTPUT_MODULE_TEMPLATE_BY_AR && typeof ameOpts.OUTPUT_MODULE_TEMPLATE_BY_AR === 'object') OUTPUT_MODULE_TEMPLATE_BY_AR = ameOpts.OUTPUT_MODULE_TEMPLATE_BY_AR;
                        if (ameOpts.OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION && typeof ameOpts.OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION === 'object') OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION = ameOpts.OUTPUT_MODULE_TEMPLATE_BY_AR_AND_DURATION;
                        if (ameOpts.VERBOSE_DEBUG !== undefined) VERBOSE_DEBUG = !!ameOpts.VERBOSE_DEBUG;
                        if (ameOpts.COMPACT_ITEM_DETAIL !== undefined) COMPACT_ITEM_DETAIL = !!ameOpts.COMPACT_ITEM_DETAIL;
                    }
                } catch(eAMEOpts) {}
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

    // ————— Resolve POST and export base —————
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

    // Determine export base under POST using configured subpath (default OUT/PREVIEWS)
    function toSegments(p){
        try {
            if (!p) return null;
            if (p instanceof Array) return p;
            var s = String(p);
            if (!s.length) return null;
            var parts = s.split(/[\\\/]+/);
            var segs = [];
            for (var i=0;i<parts.length;i++){ var seg = parts[i]; if(seg && seg.length) segs.push(seg); }
            return segs;
        } catch(e) { return null; }
    }
    var __exportSegs = null;
    try {
        if (typeof __EXPORT_SUBPATH_OPT !== 'undefined' && __EXPORT_SUBPATH_OPT !== null) {
            __exportSegs = toSegments(__EXPORT_SUBPATH_OPT);
        } else if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.ame && __AE_PIPE__.optionsEffective.ame.EXPORT_SUBPATH !== undefined) {
            __exportSegs = toSegments(__AE_PIPE__.optionsEffective.ame.EXPORT_SUBPATH);
        }
    } catch(eES) { __exportSegs = null; }
    if (!__exportSegs || !__exportSegs.length) { __exportSegs = ["OUT", DATE_PARENT_FOLDER_NAME]; }
    var exportBasePath = postFolder.fsName;
    for (var es=0; es<__exportSegs.length; es++) { exportBasePath = joinPath(exportBasePath, __exportSegs[es]); }
    var exportBase = new Folder(exportBasePath);
    if (!ensureFolderExists(exportBase)) {
        alertOnce("Cannot create export base under POST: " + exportBase.fsName);
        app.endUndoGroup();
        return;
    }

    // -------- File logging (POST/WORK/log) --------
    // Respect options override parsed above; default to true only if not explicitly set to false
    if (ENABLE_FILE_LOG !== false) { var ENABLE_FILE_LOG = true; }             // Master toggle for file log
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
            // Always place a delimiter line so consecutive runs are visually separated even if header disabled
            log("==== RUN DELIMITER ==== " + __tsHuman());
            if (LOG_ENV_HEADER) {
                log("--- ENV HEADER BEGIN ---");
                try {
                    var pjPath = (app.project && app.project.file) ? app.project.file.fsName : "(unsaved)";
                    log("ProjectPath: " + pjPath);
                    log("ProjectName: " + ((app.project && app.project.file) ? app.project.file.name : "(unsaved)"));
                } catch(ePH) { log("ProjectPath: (error)" ); }
                log("RunTimestamp: " + __tsHuman());
                log("Settings: PROCESS_SELECTION="+PROCESS_SELECTION+", PROCESS_EXISTING_RQ="+PROCESS_EXISTING_RQ+", DYN_TEMPLATES="+ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION+", AUTO_QUEUE="+AUTO_QUEUE_IN_AME+", AUTO_DELETE_RQ="+AUTO_DELETE_RQ_AFTER_AME_QUEUE);
                log("DateFolderSuffixISO=" + ENABLE_DATE_FOLDER_ISO_SUFFIX + ", REQUIRE_VALID_ISO=" + REQUIRE_VALID_ISO);
                log("ExportSubpath=" + __exportSegs.join("/"));
                log("MimicProjectFolders=" + MIMIC_PROJECT_FOLDER_STRUCTURE + (MIMIC_PROJECT_FOLDER_STRUCTURE? (" (anchor='" + PROJECT_FOLDER_ANCHOR_NAME + "')") : ""));
                log("SortOrder=" + (MIMIC_PROJECT_FOLDER_STRUCTURE ? "mimic" : (DURATION_FIRST_ORDER ? "duration-first" : "ar-first")) + ", DurationSubfolders=" + ENABLE_DURATION_SUBFOLDER + ", ARSubfolders=" + ENABLE_AR_SUBFOLDER);
                log("SortNote=" + (MIMIC_PROJECT_FOLDER_STRUCTURE ? "mimic uses project panel path" : (DURATION_FIRST_ORDER ? "duration-first requires duration token" : "ar-first uses ENABLE_DURATION_SUBFOLDER")));
                log("LanguageSubfolder=" + USE_LANGUAGE_SUBFOLDER);
                log("AppendMode=" + FILE_LOG_APPEND_MODE + ", PruneEnabled=" + FILE_LOG_PRUNE_ENABLED + ", MaxFiles=" + FILE_LOG_MAX_FILES);
                log("--- ENV HEADER END ---");
                var __ameEnvHeaderLogged = true;
            }
            // Optional debug tree dump
            dumpProjectTree();
        } catch(eWrap) {}
    }
    if (!__fileLog) {
        // Still allow debug tree dump to console if logging not active
        dumpProjectTree();
        // Fallback: emit ENV HEADER to pipeline log even when file logging disabled
        if (LOG_ENV_HEADER) {
            log("==== RUN DELIMITER ==== " + __tsHuman());
            log("--- ENV HEADER BEGIN ---");
            try {
                var pjPath2 = (app.project && app.project.file) ? app.project.file.fsName : "(unsaved)";
                log("ProjectPath: " + pjPath2);
                log("ProjectName: " + ((app.project && app.project.file) ? app.project.file.name : "(unsaved)"));
            } catch(ePH2) { log("ProjectPath: (error)" ); }
            log("RunTimestamp: " + __tsHuman());
            log("Settings: PROCESS_SELECTION="+PROCESS_SELECTION+", PROCESS_EXISTING_RQ="+PROCESS_EXISTING_RQ+", DYN_TEMPLATES="+ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION+", AUTO_QUEUE="+AUTO_QUEUE_IN_AME+", AUTO_DELETE_RQ="+AUTO_DELETE_RQ_AFTER_AME_QUEUE);
            log("DateFolderSuffixISO=" + ENABLE_DATE_FOLDER_ISO_SUFFIX + ", REQUIRE_VALID_ISO=" + REQUIRE_VALID_ISO);
            log("ExportSubpath=" + __exportSegs.join("/"));
            log("SortOrder=" + (MIMIC_PROJECT_FOLDER_STRUCTURE ? "mimic" : (DURATION_FIRST_ORDER ? "duration-first" : "ar-first")) + ", DurationSubfolders=" + ENABLE_DURATION_SUBFOLDER + ", ARSubfolders=" + ENABLE_AR_SUBFOLDER);
            log("SortNote=" + (MIMIC_PROJECT_FOLDER_STRUCTURE ? "mimic uses project panel path" : (DURATION_FIRST_ORDER ? "duration-first requires duration token" : "ar-first uses ENABLE_DURATION_SUBFOLDER")));
            log("LanguageSubfolder=" + USE_LANGUAGE_SUBFOLDER);
            log("AppendMode=" + FILE_LOG_APPEND_MODE + ", PruneEnabled=" + FILE_LOG_PRUNE_ENABLED + ", MaxFiles=" + FILE_LOG_MAX_FILES);
            log("--- ENV HEADER END ---");
        }
    }
    var baseDateName = todayYYMMDD();
    var dateFolderName = baseDateName;
    try {
        if (ENABLE_DATE_FOLDER_ISO_SUFFIX) {
            var isoVal = null;
            // 1) Prefer ISO determined in Step 1 (link_data phase)
            try {
                if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) {
                    var __iso1 = String(__AE_PIPE__.results.linkData.iso);
                    if (/^[A-Za-z]{3}$/.test(__iso1)) {
                        isoVal = DATE_FOLDER_ISO_UPPERCASE ? __iso1.toUpperCase() : __iso1;
                        if (LOG_ISO_EXTRACTION) {
                            var __origin = null; try { __origin = String(__AE_PIPE__.results.linkData.origin||"link_data"); } catch(eOr) {}
                            log("ISO(LINK_DATA): using '" + isoVal + "' from Step 1" + (__origin?(" ("+__origin+")") : ""));
                        }
                    }
                }
            } catch(eLD) { if (LOG_ISO_EXTRACTION) log("ISO(LINK_DATA): early error: " + eLD); }
            // 2) Fallback to project-panel derive from the currently linked data.json
            try { if (!isoVal) isoVal = deriveISOFromDataFileName(); } catch(eDerive) { if (LOG_ISO_EXTRACTION) log("ISO(FN): early error: " + eDerive); }
            // 3) Last resort: scan disk for any data_XXX.json (may pick a different ISO if multiple exist)
            try { if (!isoVal && ISO_SCAN_DATA_FOLDER_FALLBACK) isoVal = scanISOFromDataDirectory(postFolder); } catch(eScan) { if (LOG_ISO_EXTRACTION) log("ISO(SCAN): early error: " + eScan); }
            // 4) Optional strict fallback
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

    // Append language token to the date folder name when not using a separate subfolder
    try {
        if (!USE_LANGUAGE_SUBFOLDER) {
            var __langCodeForDate = null;
            try {
                if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) {
                    __langCodeForDate = String(__AE_PIPE__.results.linkData.lang || '').toUpperCase();
                }
            } catch(eLangRd) { __langCodeForDate = null; }
            if (__langCodeForDate && /^[A-Za-z]{3}$/.test(__langCodeForDate)) {
                dateFolderName = dateFolderName + "_" + __langCodeForDate;
                if (LOG_ISO_EXTRACTION) log("LANG: appended to date folder name -> '" + dateFolderName + "'");
            }
        }
    } catch(eLangDate){ try { log("LANG: date folder append error: " + eLangDate); } catch(_){} }
    // Defensive: ensure export base is valid before composing date folder
    try { if (!exportBase || !(exportBase instanceof Folder)) { throw new Error("Export base invalid"); } } catch(eEB) { log("Export base sanity check failed: " + eEB); }
    var dateFolder = new Folder(joinPath(exportBase.fsName, dateFolderName));
    // Track folders touched/ensured this run for summary output (AR and duration leaves), de-duplicated
    var __touchedFolders = [];
    var __touchedMap = {};
    function __normWithSlash(p){ try{ if(!p) return p; return (/\/$/.test(p) || /\\$/.test(p)) ? p : (p + "/"); }catch(eN){ return p; } }
    function __markTouched(pathStr){ try{ if(!pathStr) return; var key = __normWithSlash(pathStr); if(!__touchedMap[key]){ __touchedMap[key] = true; __touchedFolders.push(key); } }catch(eMC){} }
    var __dateExisted = dateFolder.exists;
    if (!ensureFolderExists(dateFolder)) {
        alertOnce("Cannot create date folder: " + dateFolder.fsName);
        app.endUndoGroup();
        return;
    }
    // Always list the date folder as base (with trailing slash)
    __markTouched(dateFolder.fsName);

    // Optional: insert language subfolder under date folder when known
    try {
        if (USE_LANGUAGE_SUBFOLDER) {
            var __langCode = null;
            try {
                if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) {
                    __langCode = String(__AE_PIPE__.results.linkData.lang || '').toUpperCase();
                }
            } catch(eLang) { __langCode = null; }
            if (__langCode && /^[A-Za-z]{3}$/.test(__langCode)) {
                var langFolder = new Folder(joinPath(dateFolder.fsName, __langCode));
                if (!ensureFolderExists(langFolder)) {
                    alertOnce("Cannot create language folder: " + langFolder.fsName);
                    app.endUndoGroup();
                    return;
                }
                __markTouched(langFolder.fsName);
                dateFolder = langFolder; // from now on, place under <date[_ISO]>/<LANG>/...
                if (LOG_ISO_EXTRACTION) log("LANG: using language subfolder '" + __langCode + "'");
            } else if (USE_LANGUAGE_SUBFOLDER) {
                if (LOG_ISO_EXTRACTION) log("LANG: language not available; skipping subfolder");
            }
        }
    } catch(eLangBlock) { try { log("LANG: subfolder block error: " + eLangBlock); } catch(_){} }

    // ————— Gather / Create Render Queue Items —————
    var rq = app.project.renderQueue;
    if (!rq) {
        alertOnce("Render Queue not available.");
        app.endUndoGroup();
        return;
    }

    // Debug checkpoint: base paths established
    try {
        if (LOG_ENV_HEADER) {
            log("DateFolderResolved: " + (dateFolder && dateFolder.fsName ? dateFolder.fsName : "(unknown)"));
        }
    } catch(eDbg0) {}

    var detailLines = [];
    var __detailOverflow = 0;     // Count of suppressed detail lines due to cap
    var __detailCapped = false;   // True when cap was reached at least once
    function pushDetail(msg) {
        if (COMPACT_ITEM_DETAIL) return; // Suppress normal multi-line details in compact mode
        if (detailLines.length < MAX_DETAIL_LINES) {
            detailLines.push(msg);
        } else {
            __detailOverflow++;
            __detailCapped = true;
        }
    }
    function pushCompact(msg) {
        // Always allow compact per-item summary to use the same cap counters
        if (detailLines.length < MAX_DETAIL_LINES) {
            detailLines.push(msg);
        } else {
            __detailOverflow++;
            __detailCapped = true;
        }
    }
    // Track template install issues to surface concise summary hints and disable reapply if desired
    var __templateMissingObserved = false;
    var __firstMissingPresetName = null;
    var __reapplySkippedDueToMissing = false;

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

    function __safeRQCount(rqObj){ try { var n = rqObj ? rqObj.numItems : 0; return (typeof n === 'number' && n >= 0) ? n : 0; } catch(e){ try{ log("RQ numItems error: "+e); }catch(_){} return 0; } }
    function compAlreadyInRQ(comp) {
        if (!comp) return false;
        try {
            var n = __safeRQCount(rq);
            for (var i = 1; i <= n; i++) {
                var rqi = null; try { rqi = rq.item(i); } catch(eIt) { rqi = null; }
                var same = false;
                try { same = (!!rqi && rqi.comp === comp); } catch(eCmpAcc) { same = false; }
                if (same) {
                    // Skip only if item is not DONE (we can reuse to change output path)
                    try { if (rqi.status !== RQItemStatus.DONE) return true; } catch (e) { return true; }
                }
            }
        } catch(eCRQ) { try { log("compAlreadyInRQ error: "+eCRQ); } catch(_){} }
        return false;
    }

    var itemsToProcess = []; // Array of { rqi: RenderQueueItem, newlyAdded: bool }
    var addedCount = 0;
    // Safe type render helper to avoid poking at host Error objects
    function __safeTypeStr(x){
        try {
            if (x && x.constructor && x.constructor.name) return String(x.constructor.name);
        } catch(e1) {}
        try {
            if (x && typeof x.toString === 'function') return String(x.toString());
        } catch(e2) {}
        try { return typeof x; } catch(e3) { return "(unknown)"; }
    }

    // Selection-based mimic cut info (folders preferred; fallback to comps)
    var __selectionCutInfo = { folders: [], hasComp: false };
    try { __selectionCutInfo = getSelectionCutInfo(); } catch (eSCR) { __selectionCutInfo = { folders: [], hasComp: false }; }

    // A) Process selection: add selected comps to RQ
    try { if (VERBOSE_DEBUG && LOG_ENV_HEADER) log("Checkpoint: begin selection/RQ add phase (providedComps=" + ((opts && opts.comps && opts.comps.length)||0) + ")"); } catch(eDbgA) {}
    var providedComps = (opts && opts.comps && opts.comps.length) ? opts.comps : null;
    if (PROCESS_SELECTION || providedComps) {
        try {
            var sel = providedComps || app.project.selection;
            if (sel && sel.length) {
                for (var s = 0; s < sel.length; s++) {
                    var it = null; try { it = sel[s]; } catch(eSel) { it = null; }
                    if (!(it instanceof CompItem)) continue;
                    // Trace comp under consideration (verbose only)
                    try { if (VERBOSE_DEBUG) log("Sel-> considering " + it.name); } catch(eLogC) {}
                    var isDup = false;
                    try { isDup = (!ALLOW_DUPLICATE_RQ_ITEMS && compAlreadyInRQ(it)); } catch(eDup){ isDup = false; }
                    if (isDup) {
                        try { if (VERBOSE_DEBUG) log("Sel-> skip (exists) " + it.name); } catch(eDL1) {}
                        continue;
                    }
                    var newRQI = null;
                    try { newRQI = rq.items.add(it); } catch (eAdd) { try { var _eAdd = safeErrStr(eAdd); if (VERBOSE_DEBUG) log("Sel-> failed add " + it.name + ": " + _eAdd); } catch(eDL2) {} newRQI = null; }
                    // Validate the returned object is actually a RenderQueueItem (AE sometimes can yield an Error object in rare cases)
                    var isValidRQI = false;
                    if (newRQI) {
                        try {
                            // Heuristic: must have a 'comp' property referencing the same comp and an 'outputModule' function
                            if (newRQI.comp === it && typeof newRQI.outputModule === 'function') {
                                isValidRQI = true;
                            }
                        } catch (eVal) { isValidRQI = false; }
                    }
                    if (newRQI && !isValidRQI) {
                        var tstr = __safeTypeStr(newRQI);
                        try { if (VERBOSE_DEBUG) log("Sel-> invalid RQI type for " + it.name + ": " + tstr); } catch(eDL) {}
                        newRQI = null;
                    }
                    if (newRQI) {
                        try { if (VERBOSE_DEBUG) log("Sel-> added RQ -> " + it.name); } catch(eAddLine) {}
                        // Apply templates if configured
                        if (RENDER_SETTINGS_TEMPLATE) {
                            try { newRQI.setRenderSettings(RENDER_SETTINGS_TEMPLATE); } catch (eRS) { try { pushDetail("Render settings template fail " + it.name + ": " + eRS); } catch(_) {} }
                        }
                        var omNew = null;
                        try { omNew = newRQI.outputModule(1); } catch (eOMn) { omNew = null; }
                        if (omNew && APPLY_TEMPLATES && OUTPUT_MODULE_TEMPLATE) {
                            try { omNew.applyTemplate(OUTPUT_MODULE_TEMPLATE); } catch (eOMt) { try { pushDetail("OM template fail " + it.name + ": " + safeErrStr(eOMt)); } catch(_) {} }
                        }
                        var chosenDynTemplate = null;
                        if (omNew && APPLY_TEMPLATES && ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION) {
                            var toks = parseTokensFromName(it.name);
                            var dynTemplate = pickOutputModuleTemplate(toks);
                            if (dynTemplate && dynTemplate.length) {
                                try { omNew.applyTemplate(dynTemplate); try { pushDetail("OM dyn template '" + dynTemplate + "' -> " + it.name); } catch(_) {} chosenDynTemplate = dynTemplate; }
                                catch (eDyn) {
                                    try { pushDetail("OM dyn template fail " + it.name + ": " + safeErrStr(eDyn)); } catch(_) {}
                                    try { if (!__templateMissingObserved) { __templateMissingObserved = true; __firstMissingPresetName = dynTemplate; } } catch(_) {}
                                }
                            }
                        }
                        itemsToProcess.push({ rqi: newRQI, newlyAdded: true, dynTemplate: chosenDynTemplate });
                        addedCount++;
                    }
                }
            }
        } catch(eSelPhase) {
            log("Selection phase error: " + safeErrStr(eSelPhase));
        }
    }

    // B) Include existing RQ items
    if (PROCESS_EXISTING_RQ) {
        try {
            var total = __safeRQCount(rq);
            for (var iExist = 1; iExist <= total; iExist++) {
                var existingRQI = null;
                try { existingRQI = rq.item(iExist); } catch(eIdx) { existingRQI = null; }
                // Validate existing item shape
                try {
                    if (existingRQI && (typeof existingRQI.outputModule !== 'function' || !existingRQI.comp)) {
                        detailLines.push("Skip non-standard RQ entry index=" + iExist);
                        continue;
                    }
                } catch(eValExist) { continue; }
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
    } catch(ePRQ) { try { log("PROCESS_EXISTING_RQ error: " + safeErrStr(ePRQ)); } catch(_){} }
    }

    if (!itemsToProcess.length) {
        alertOnce("No eligible Render Queue items (after selection + existing check)." );
        app.endUndoGroup();
        return;
    }

    // ————— Assign Output Paths —————
    var processed = 0, skipped = 0, unsorted = 0, changedCount = 0;
    try { log("RQ summary before assign: added=" + addedCount + ", itemsToProcess=" + itemsToProcess.length + ", rqCount=" + __safeRQCount(rq)); } catch(eSum1) {}
    try {
    for (var idx = 0; idx < itemsToProcess.length; idx++) {
        var entry = itemsToProcess[idx];
        var rqi = entry.rqi;
    if (!rqi || !rqi.comp || typeof rqi.outputModule !== 'function') { skipped++; pushDetail("Skip invalid RQI idx="+idx); continue; }
        // Re-skip status DONE / RENDERING safeguard
        try { if (rqi.status === RQItemStatus.DONE || rqi.status === RQItemStatus.RENDERING) { skipped++; continue; } } catch (eS2) {}

        var om = null;
        try { om = rqi.outputModule(1); } catch (eOM2) { om = null; }
    if (!om) { skipped++; try { pushDetail("No OM " + (rqi && rqi.comp && rqi.comp.name ? rqi.comp.name : "(unnamed)")); } catch(eNoOM) { try { pushDetail("No OM (unnamed)"); } catch(_) {} } continue; }

        var compName = "(unnamed)";
        try { if (rqi && rqi.comp && rqi.comp.name) compName = rqi.comp.name; } catch(eCN) { compName = "(unnamed)"; }
    pushDetail("ASSIGN start -> " + compName);

        try {
            // Some AE versions can throw when accessing om.file (e.g., uninitialized state); guard it
            var curFile = null;
            try { curFile = om.file; }
            catch (eFileGet) {
                curFile = null;
                if (detailLines.length < MAX_DETAIL_LINES) detailLines.push("OM has no file (safe to set new): " + compName + " -> " + eFileGet);
            }
            var ext = DEFAULT_EXTENSION_FALLBACK;
                var baseName = compName;
                if (curFile && curFile.name) {
                    var parts2 = splitBaseExt(curFile.name);
                    if (parts2.ext) ext = parts2.ext;
                    if (USE_OM_FILENAME_AS_BASE && parts2.base) baseName = parts2.base;
                }

            var tokens = parseTokensFromName(compName);
            pushDetail("TOKENS -> ar=" + (tokens.ar||"-") + ", dur=" + (tokens.duration||"-") );
            var extraInfo = detectExtraInfo(compName);

            // 1) Create folders and set output path FIRST (independent of templates)
            var destParent = dateFolder;
            // Option A: mimic AE project folder structure under the date folder
            var usedMimic = false;
            if (MIMIC_PROJECT_FOLDER_STRUCTURE) {
                try {
                    var anchorSegs = relativeSegmentsAfterAnchor(rqi.comp, String(PROJECT_FOLDER_ANCHOR_NAME||'out').toLowerCase());
                    var segs = anchorSegs;
                    // Anchor wins; only use selection-cut when anchor not found
                    if ((!segs || !segs.length)) {
                        if (__selectionCutInfo && __selectionCutInfo.folders && __selectionCutInfo.folders.length) {
                            var matchRoot = findMatchingSelectionRoot(rqi.comp, __selectionCutInfo.folders);
                            if (matchRoot) segs = relativeSegmentsAfterSelection(rqi.comp, matchRoot);
                        }
                        if ((!segs || !segs.length) && __selectionCutInfo && __selectionCutInfo.hasComp) {
                            try { segs = relativeSegmentsAfterSelection(rqi.comp, rqi.comp ? rqi.comp.parentFolder : null); } catch (eSelComp) { segs = []; }
                        }
                    }
                    if (segs && segs.length) {
                        var cur = dateFolder;
                        for (var ms=0; ms<segs.length; ms++) {
                            var segName = segs[ms]; if (!segName) continue;
                            var nF = new Folder(joinPath(cur.fsName, segName));
                            ensureFolderExists(nF);
                            __markTouched(nF.fsName);
                            cur = nF;
                        }
                        destParent = cur;
                        usedMimic = true;
                        if ((!anchorSegs || !anchorSegs.length) && (__selectionCutInfo && ((__selectionCutInfo.folders && __selectionCutInfo.folders.length) || __selectionCutInfo.hasComp))) {
                            pushDetail("MIMIC PATH (selection) -> " + cur.fsName);
                        } else {
                            pushDetail("MIMIC PATH -> " + cur.fsName);
                        }
                    }
                } catch(eMimic) { pushDetail("MIMIC error -> " + safeErrStr(eMimic)); }
            }
            if (!usedMimic) {
            if (DURATION_FIRST_ORDER) {
                // Duration-first: require duration token; AR token is optional (based on ENABLE_AR_SUBFOLDER)
                if (tokens.duration) {
                    var durRoot = new Folder(joinPath(dateFolder.fsName, tokens.duration));
                    try { ensureFolderExists(durRoot); } catch(eD0) { pushDetail("FOLDER CREATE FAIL -> " + durRoot.fsName + ": " + eD0); }
                    __markTouched(durRoot.fsName);
                    if (EXTRA_EXPORT_SUBFOLDER && extraInfo && extraInfo.isExtra) {
                        if (ENABLE_AR_SUBFOLDER) {
                            if (tokens.ar) {
                                var extraRootNameDF = tokens.ar + "_" + extraInfo.name;
                                var extraRootFolderDF = new Folder(joinPath(durRoot.fsName, extraRootNameDF));
                                try { ensureFolderExists(extraRootFolderDF); } catch(eED0) { pushDetail("FOLDER CREATE FAIL -> " + extraRootFolderDF.fsName + ": " + eED0); }
                                __markTouched(extraRootFolderDF.fsName);
                                destParent = extraRootFolderDF;
                                pushDetail("EXTRA PATH -> " + extraRootFolderDF.fsName);
                            } else {
                                var unsortedFolderDF0 = new Folder(joinPath(dateFolder.fsName, "unsorted"));
                                try { ensureFolderExists(unsortedFolderDF0); } catch(eUDF0) { pushDetail("FOLDER CREATE FAIL -> " + unsortedFolderDF0.fsName + ": " + eUDF0); }
                                __markTouched(unsortedFolderDF0.fsName);
                                destParent = unsortedFolderDF0;
                                unsorted++;
                            }
                        } else {
                            var extraRootFolderDF2 = new Folder(joinPath(durRoot.fsName, "Extras"));
                            try { ensureFolderExists(extraRootFolderDF2); } catch(eED2) { pushDetail("FOLDER CREATE FAIL -> " + extraRootFolderDF2.fsName + ": " + eED2); }
                            __markTouched(extraRootFolderDF2.fsName);
                            destParent = extraRootFolderDF2;
                            pushDetail("EXTRA PATH -> " + extraRootFolderDF2.fsName);
                        }
                    } else {
                        if (ENABLE_AR_SUBFOLDER) {
                            if (tokens.ar) {
                                var arFolderDF = new Folder(joinPath(durRoot.fsName, tokens.ar));
                                try { ensureFolderExists(arFolderDF); } catch(eFD1) { pushDetail("FOLDER CREATE FAIL -> " + arFolderDF.fsName + ": " + eFD1); }
                                __markTouched(arFolderDF.fsName);
                                destParent = arFolderDF;
                            } else {
                                var unsortedFolderDF1 = new Folder(joinPath(dateFolder.fsName, "unsorted"));
                                try { ensureFolderExists(unsortedFolderDF1); } catch(eUDF1) { pushDetail("FOLDER CREATE FAIL -> " + unsortedFolderDF1.fsName + ": " + eUDF1); }
                                __markTouched(unsortedFolderDF1.fsName);
                                destParent = unsortedFolderDF1;
                                unsorted++;
                            }
                        } else {
                            destParent = durRoot;
                        }
                    }
                } else {
                    var unsortedFolderDF2 = new Folder(joinPath(dateFolder.fsName, "unsorted"));
                    try { ensureFolderExists(unsortedFolderDF2); } catch(eUDF2) { pushDetail("FOLDER CREATE FAIL -> " + unsortedFolderDF2.fsName + ": " + eUDF2); }
                    __markTouched(unsortedFolderDF2.fsName);
                    destParent = unsortedFolderDF2;
                    unsorted++;
                }
            } else if (ENABLE_DURATION_SUBFOLDER) {
                // Require both AR and duration when nesting by duration
                if (tokens.ar && tokens.duration) {
                    if (EXTRA_EXPORT_SUBFOLDER && extraInfo && extraInfo.isExtra) {
                        // Extras: <date>/<AR>_<extra>/<duration>/
                        var extraRootName = tokens.ar + "_" + extraInfo.name; // e.g., 9x16_tiktok
                        var extraRootFolder = new Folder(joinPath(dateFolder.fsName, extraRootName));
                        try { ensureFolderExists(extraRootFolder); } catch(eER) { pushDetail("FOLDER CREATE FAIL -> " + extraRootFolder.fsName + ": " + eER); }
                        __markTouched(extraRootFolder.fsName);
                        var extraDurFolder = new Folder(joinPath(extraRootFolder.fsName, tokens.duration));
                        try { ensureFolderExists(extraDurFolder); } catch(eED) { pushDetail("FOLDER CREATE FAIL -> " + extraDurFolder.fsName + ": " + eED); }
                        __markTouched(extraDurFolder.fsName);
                        destParent = extraDurFolder;
                        pushDetail("EXTRA PATH -> " + extraDurFolder.fsName);
                    } else {
                        // Normal: <date>/<AR>/<duration>/
                        var arFolder = new Folder(joinPath(dateFolder.fsName, tokens.ar));
                        var durFolder = new Folder(joinPath(arFolder.fsName, tokens.duration));
                        try { ensureFolderExists(durFolder); } catch(eFD) { pushDetail("FOLDER CREATE FAIL -> " + durFolder.fsName + ": " + eFD); }
                        __markTouched(arFolder.fsName);
                        __markTouched(durFolder.fsName);
                        destParent = durFolder;
                    }
                } else {
                    // Not enough tokens -> unsorted
                    var unsortedFolder = new Folder(joinPath(dateFolder.fsName, "unsorted"));
                    try { ensureFolderExists(unsortedFolder); } catch(eFU) { pushDetail("FOLDER CREATE FAIL -> " + unsortedFolder.fsName + ": " + eFU); }
                    __markTouched(unsortedFolder.fsName);
                    destParent = unsortedFolder;
                    unsorted++;
                }
            } else {
                // Duration disabled: only require AR (AR-first)
                if (tokens.ar) {
                    if (EXTRA_EXPORT_SUBFOLDER && extraInfo && extraInfo.isExtra) {
                        // Extras: <date>/<AR>_<extra>/
                        var extraRootName2 = tokens.ar + "_" + extraInfo.name;
                        var extraRootFolder2 = new Folder(joinPath(dateFolder.fsName, extraRootName2));
                        try { ensureFolderExists(extraRootFolder2); } catch(eER2) { pushDetail("FOLDER CREATE FAIL -> " + extraRootFolder2.fsName + ": " + eER2); }
                        __markTouched(extraRootFolder2.fsName);
                        destParent = extraRootFolder2;
                        pushDetail("EXTRA PATH -> " + extraRootFolder2.fsName);
                    } else {
                        // Normal: <date>/<AR>/
                        var arFolder2 = new Folder(joinPath(dateFolder.fsName, tokens.ar));
                        try { ensureFolderExists(arFolder2); } catch(eFA2) { pushDetail("FOLDER CREATE FAIL -> " + arFolder2.fsName + ": " + eFA2); }
                        __markTouched(arFolder2.fsName);
                        destParent = arFolder2;
                    }
                } else {
                    var unsortedFolder2 = new Folder(joinPath(dateFolder.fsName, "unsorted"));
                    try { ensureFolderExists(unsortedFolder2); } catch(eFU2) { pushDetail("FOLDER CREATE FAIL -> " + unsortedFolder2.fsName + ": " + eFU2); }
                    __markTouched(unsortedFolder2.fsName);
                    destParent = unsortedFolder2;
                    unsorted++;
                }
            }
            } // end non-mimic path builder
            var destPath = joinPath(destParent.fsName, baseName + ext);
            pushDetail("DEST -> " + destPath);
            var originalPath = curFile && curFile.fsName ? String(curFile.fsName) : null;
            var finalPath = destPath;
            try {
                om.file = new File(destPath);
                processed++;
                var changed = false;
                if (!entry.newlyAdded && originalPath) {
                    // Compare normalized lower-case paths for change detection
                    try { if (originalPath.toLowerCase() !== destPath.toLowerCase()) { changed = true; changedCount++; } } catch (eCmp) {}
                }
                var tag = entry.newlyAdded ? "ADD" : (changed ? "CHG" : "SET");
                pushDetail(tag + " -> " + compName + " => " + destPath);
            } catch (eSet2) {
                skipped++;
                try { pushDetail("FAIL set " + compName + ": " + safeErrStr(eSet2)); } catch(_) {}
            }

            // 2) Apply templates AFTER setting path, so path is independent of preset availability
            var dynTemplateUsed = entry.dynTemplate || null;
            var tplInfo = null; // capture compact-mode note
            if (APPLY_TEMPLATES && ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION && (entry.newlyAdded || APPLY_TEMPLATE_TO_EXISTING_ITEMS)) {
                var dynT = pickOutputModuleTemplate(tokens);
                var fallbackTpl2 = OUTPUT_MODULE_TEMPLATE || "";
                if (dynT && dynT.length) {
                    try { om.applyTemplate(dynT); dynTemplateUsed = dynT; pushDetail("TEMPLATE -> " + compName + " => " + dynT); tplInfo = dynT; }
                    catch (eTpl) {
                        pushDetail("TEMPLATE FAIL " + compName + ": " + safeErrStr(eTpl)); tplInfo = "fail:" + dynT;
                        try { if (!__templateMissingObserved) { __templateMissingObserved = true; __firstMissingPresetName = dynT; } } catch(_) {}
                        // Fallback to default if configured
                        if (fallbackTpl2 && fallbackTpl2.length) {
                            try { om.applyTemplate(fallbackTpl2); dynTemplateUsed = fallbackTpl2; pushDetail("TEMPLATE FALLBACK -> " + compName + " => " + fallbackTpl2); tplInfo = fallbackTpl2; }
                            catch(eFB2) { pushDetail("TEMPLATE FALLBACK FAIL " + compName + ": " + safeErrStr(eFB2)); try { if (!__templateMissingObserved) { __templateMissingObserved = true; __firstMissingPresetName = fallbackTpl2; } } catch(_) {} }
                        } else {
                            pushDetail("TEMPLATE NONE (no fallback) -> " + compName); if (!tplInfo) tplInfo = "none";
                        }
                    }
                } else {
                    pushDetail("TEMPLATE SKIP (no map) -> " + compName); if (!tplInfo) tplInfo = "none";
                    // Apply default template if available
                    if (fallbackTpl2 && fallbackTpl2.length) {
                        try { om.applyTemplate(fallbackTpl2); dynTemplateUsed = fallbackTpl2; pushDetail("TEMPLATE DEFAULT -> " + compName + " => " + fallbackTpl2); tplInfo = fallbackTpl2; }
                        catch(eDF) { pushDetail("TEMPLATE DEFAULT FAIL " + compName + ": " + safeErrStr(eDF)); try { if (!__templateMissingObserved) { __templateMissingObserved = true; __firstMissingPresetName = fallbackTpl2; } } catch(_) {} }
                    } else {
                        pushDetail("TEMPLATE NONE (no default) -> " + compName); if (!tplInfo) tplInfo = "none";
                    }
                }
            } else if (!APPLY_TEMPLATES) {
                pushDetail("TEMPLATE SKIP (disabled by config) -> " + compName); tplInfo = "skip";
            }
            if (!dynTemplateUsed && APPLY_TEMPLATES) pushDetail("TEMPLATE NONE -> " + compName + " (proceeding)");

            // 3) Optional filename injection happens last; if enabled, update path again
            if (INJECT_PRESET_TOKEN_IN_FILENAME && dynTemplateUsed) {
                var token = dynTemplateUsed;
                if (FILENAME_TEMPLATE_SANITIZE) token = token.replace(/[^A-Za-z0-9_\-]+/g, "_");
                var injectedBase = baseName + "__" + token;
                var injectedPath = joinPath(destParent.fsName, injectedBase + ext);
                pushDetail("DEST(inject) -> " + injectedPath);
                try {
                    om.file = new File(injectedPath);
                    var tag2 = entry.newlyAdded ? "SET" : "CHG"; // second set considered change
                    pushDetail(tag2 + " -> " + compName + " => " + injectedPath);
                    finalPath = injectedPath;
                } catch(eReSet) {
                    pushDetail("FAIL set (inject) " + compName + ": " + safeErrStr(eReSet));
                }
            }

            // Compact per-item summary
            if (COMPACT_ITEM_DETAIL) {
                var arC = tokens.ar || "-";
                var duC = tokens.duration || "-";
                var tplC = tplInfo ? (" | tpl:" + tplInfo) : (dynTemplateUsed ? (" | tpl:" + dynTemplateUsed) : "");
                pushCompact("ITEM -> " + compName + " [" + arC + "," + duC + "] " + tag + " => " + finalPath + tplC);
            }
        } catch (eItemAssign) {
            skipped++;
            if (detailLines.length < MAX_DETAIL_LINES) detailLines.push("ASSIGN ERROR -> " + compName + ": " + safeErrStr(eItemAssign));
        }
    }
    } catch(eAssignPhase) {
        try { log("Assign paths phase error: " + safeErrStr(eAssignPhase)); } catch(eLogAP) {}
    }

    // --- End of preparation phase: close undo group early (only if we opened one) ---
    // We'll now verify and queue outside of the undo context to reduce mismatch risk.
    if (__openedUndo) { try { app.endUndoGroup(); __openedUndo = false; } catch (eUG) {} }

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
    if (DOUBLE_APPLY_OUTPUT_MODULE_TEMPLATES && APPLY_TEMPLATES && ENABLE_DYNAMIC_OUTPUT_MODULE_SELECTION) {
        if (AUTO_DISABLE_REAPPLY_ON_MISSING && __templateMissingObserved) {
            __reapplySkippedDueToMissing = true;
        } else {
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
                    catch (eRA) { if (detailLines.length < MAX_DETAIL_LINES) detailLines.push("REAPPLY FAIL " + ent.rqi.comp.name + ": " + safeErrStr(eRA)); }
                }
            } catch (eOuter) {}
        }
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
            log("QueueInAME failed: " + safeErrStr(eQ));
            return false;
        }
    }
    // Allow pipeline to disable queueing this run
    if (opts && (opts.noQueue === true)) { AUTO_QUEUE_IN_AME = false; }
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

    // Optional: remove RQ items after they were queued into AME.
    // Safety: delete only items newly added by this run, and only when queueInAME succeeded (best-effort).
    var rqAutoDeleted = 0;
    var rqAutoDeleteFailed = 0;
    var rqAutoDeleteSkipped = 0;
    if (AUTO_DELETE_RQ_AFTER_AME_QUEUE && AUTO_QUEUE_IN_AME && shouldQueue && ameQueued) {
        try {
            for (var rd = 0; rd < itemsToProcess.length; rd++) {
                var delEnt = itemsToProcess[rd];
                if (!delEnt || !delEnt.newlyAdded) { rqAutoDeleteSkipped++; continue; }
                var delItem = delEnt.rqi;
                if (!delItem) { rqAutoDeleteFailed++; continue; }
                // Do not remove rendering items.
                try { if (delItem.status === RQItemStatus.RENDERING) { rqAutoDeleteSkipped++; continue; } } catch(eSt) {}
                try {
                    delItem.remove();
                    rqAutoDeleted++;
                } catch(eRem) {
                    rqAutoDeleteFailed++;
                    try { if (VERBOSE_DEBUG && detailLines.length < MAX_DETAIL_LINES) detailLines.push("RQ DELETE FAIL: " + safeErrStr(eRem)); } catch(_) {}
                }
            }
            try { if (VERBOSE_DEBUG) detailLines.push("RQ AUTO-DELETE: deleted=" + rqAutoDeleted + " skipped=" + rqAutoDeleteSkipped + " failed=" + rqAutoDeleteFailed); } catch(_) {}
        } catch(eDel) {
            try { log("RQ auto-delete error: " + safeErrStr(eDel)); } catch(_) {}
        }
    }

    var mismatchNote = "";
    if (addedCount > 0 && verifiedAdded === 0) {
        mismatchNote = "\nWARNING: No Render Queue items verified after addition. Re-run script or disable undo grouping.";
    }

    // Optionally emit detail lines for diagnostics (clipped to MAX_DETAIL_LINES)
    try {
        if ((VERBOSE_DEBUG || COMPACT_ITEM_DETAIL) && detailLines && detailLines.length) {
            log("--- DETAIL BEGIN ---");
            var cap = MAX_DETAIL_LINES;
            for (var dl=0; dl<detailLines.length && dl<cap; dl++) { log(detailLines[dl]); }
            if (__detailCapped || __detailOverflow > 0 || detailLines.length >= cap) {
                var more = __detailOverflow;
                log("... (" + more + " more) ...");
            }
            log("--- DETAIL END ---");
        }
    } catch(eDet) {}

    // Build concise summary (alert should only show summary now)
    var summaryLines = [];
    summaryLines.push("Added:" + addedCount + " (verified:" + verifiedAdded + ") Changed:" + changedCount + " Processed:" + processed + " Skipped:" + skipped + (unsorted?" Unsorted:"+unsorted:""));
    if (AUTO_QUEUE_IN_AME) summaryLines.push("AMEQueued:" + (shouldQueue ? (ameQueued?"yes":"fail") : (QUEUE_ONLY_WHEN_NEW_OR_CHANGED?"skipped-no-change":"skipped")) );
    if (AUTO_DELETE_RQ_AFTER_AME_QUEUE) summaryLines.push("RQAutoDeleted:" + (AUTO_QUEUE_IN_AME && shouldQueue && ameQueued ? (rqAutoDeleted + (rqAutoDeleteFailed? (" (failed:"+rqAutoDeleteFailed+")"):"")) : "skipped") );
    if (mismatchNote) summaryLines.push(mismatchNote.replace(/^\n/,''));
    if (AUTO_QUEUE_IN_AME && shouldQueue && !ameQueued) summaryLines.push("Hint: Launch Media Encoder once or raise retry delay.");
    // Concise hints about templates/presets
    if (__templateMissingObserved) {
        var hintName = __firstMissingPresetName ? (" (e.g., '" + __firstMissingPresetName + "')") : "";
        summaryLines.push("Hint: Preset not found" + hintName + ". Configure ame.OUTPUT_MODULE_TEMPLATE* in preset or set ame.APPLY_TEMPLATES=false.");
    }
    if (__reapplySkippedDueToMissing) {
        summaryLines.push("Note: Reapply skipped due to missing preset(s).");
    }
    summaryLines.push("" ); // blank line before path
    summaryLines.push("DateFolder: " + dateFolder.fsName);
    // Append the list of touched/ensured folders (absolute paths, with trailing slash)
    if (__touchedFolders && __touchedFolders.length) {
        // Skip the date folder itself in this repeated list to avoid duplication, as DateFolder is already printed above
        for (var cf=0; cf<__touchedFolders.length; cf++) {
            var fp = __touchedFolders[cf];
            if (fp === __normWithSlash(dateFolder.fsName)) continue;
            summaryLines.push("CreatedFolder: " + fp);
        }
    }
    var summaryMsg = summaryLines.join("\n");
    if (LOG_SUMMARY_SECTION) {
        log("--- SUMMARY BEGIN ---");
        for (var sl=0; sl<summaryLines.length; sl++) { if (summaryLines[sl].length) log(summaryLines[sl]); }
        log("--- SUMMARY END ---");
    }
    // Show alert only in standalone mode (avoid duplicate logs in pipeline)
    if (!__AE_PIPE__) { try { alert(summaryMsg); } catch(eAL) {} }
    // Return comps that have RQ items
    var configured = [];
    try { var rq2 = app.project.renderQueue; for (var i2=1;i2<=rq2.numItems;i2++){ var rqi2=rq2.item(i2); if (rqi2 && rqi2.comp) configured.push(rqi2.comp); } } catch(eRQ) {}
    return { configured: configured };
}

AE_AME.run = function(opts){ return __AME_coreRun(opts || {}); };

// ——————————————————————————————————————————————————————————————
// Standalone dockable UI panel
// ——————————————————————————————————————————————————————————————
function __AME_buildPanel(thisObj) {
    var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Set AME Output Paths", undefined, { resizeable: true });
    if (!pal) return null;

    pal.orientation = "column";
    pal.alignChildren = ["fill", "top"];

    // Export target group
    var grpTarget = pal.add("panel", undefined, "Export target (under POST)");
    grpTarget.orientation = "column";
    grpTarget.alignChildren = ["left", "top"];

    var rbMasters = grpTarget.add("radiobutton", undefined, "MASTERS");
    var rbDeliveries = grpTarget.add("radiobutton", undefined, "DELIVERIES");
    var rbPreviews = grpTarget.add("radiobutton", undefined, "PREVIEWS");
    var grpCustom = grpTarget.add("group");
    grpCustom.orientation = "row";
    grpCustom.alignChildren = ["left", "center"];
    var rbCustom = grpCustom.add("radiobutton", undefined, "Custom:");
    var etCustom = grpCustom.add("edittext", undefined, "OUT/MASTERS");
    etCustom.characters = 24;
    etCustom.enabled = false;

    rbPreviews.value = true; // default

    function updateCustomEnabled() {
        etCustom.enabled = rbCustom.value === true;
    }
    rbMasters.onClick = rbDeliveries.onClick = rbPreviews.onClick = rbCustom.onClick = updateCustomEnabled;

    // Sorting mode group
    var grpSort = pal.add("panel", undefined, "Sorting mode");
    grpSort.orientation = "column";
    grpSort.alignChildren = ["left", "top"];
    var rbSortMimic = grpSort.add("radiobutton", undefined, "mimic folder structure");
    var rbSortArFirst = grpSort.add("radiobutton", undefined, "sorting: AR-first");
    var rbSortDurationFirst = grpSort.add("radiobutton", undefined, "sorting: duration-first");

    var cbDuration = grpSort.add("checkbox", undefined, "ENABLE_DURATION_SUBFOLDER (AR-first)");
    var cbArSubfolder = grpSort.add("checkbox", undefined, "ENABLE_AR_SUBFOLDER (duration-first)");

    // Options checkboxes
    var grpOpts = pal.add("panel", undefined, "Options");
    grpOpts.orientation = "column";
    grpOpts.alignChildren = ["left", "top"];

    var cbAutoDelete = grpOpts.add("checkbox", undefined, "AUTO_DELETE_RQ_AFTER_AME_QUEUE");
    var cbIsoSuffix = grpOpts.add("checkbox", undefined, "ENABLE_DATE_FOLDER_ISO_SUFFIX");
    var cbLang = grpOpts.add("checkbox", undefined, "USE_LANGUAGE_SUBFOLDER");

    cbAutoDelete.value = true;
    cbIsoSuffix.value = true;
    cbLang.value = false;
    rbSortMimic.value = true;
    cbDuration.value = true;
    cbArSubfolder.value = true;

    function updateSortControls() {
        var isMimic = rbSortMimic.value === true;
        var isArFirst = rbSortArFirst.value === true;
        var isDurationFirst = rbSortDurationFirst.value === true;
        cbDuration.enabled = isArFirst;
        cbArSubfolder.enabled = isDurationFirst;
    }
    rbSortMimic.onClick = rbSortArFirst.onClick = rbSortDurationFirst.onClick = updateSortControls;
    updateSortControls();

    // Action button
    var grpAction = pal.add("group");
    grpAction.alignment = ["fill", "top"];
    grpAction.orientation = "row";
    grpAction.alignChildren = ["fill", "center"];
    var btnSend = grpAction.add("button", undefined, "Send to AME");

    function resolveExportSubpath() {
        if (rbMasters.value) return "OUT/MASTERS";
        if (rbDeliveries.value) return "OUT/DELIVERIES";
        if (rbPreviews.value) return "OUT/PREVIEWS";
        if (rbCustom.value) {
            var t = String(etCustom.text || "");
            t = t.replace(/^\s+|\s+$/g, "");
            return t;
        }
        return "OUT/PREVIEWS";
    }

    btnSend.onClick = function() {
        try {
            if (!app.project) { alert("Open a project first."); return; }
            var exportSubpath = resolveExportSubpath();
            if (!exportSubpath || !exportSubpath.length) {
                alert("Custom export subpath is empty.");
                return;
            }

            var opts = {
                options: {
                    AUTO_QUEUE_IN_AME: true,
                    AUTO_DELETE_RQ_AFTER_AME_QUEUE: cbAutoDelete.value === true,
                    ENABLE_DATE_FOLDER_ISO_SUFFIX: cbIsoSuffix.value === true,
                    ENABLE_DURATION_SUBFOLDER: cbDuration.value === true,
                    DURATION_FIRST_ORDER: rbSortDurationFirst.value === true,
                    ENABLE_AR_SUBFOLDER: cbArSubfolder.value === true,
                    USE_LANGUAGE_SUBFOLDER: cbLang.value === true,
                    MIMIC_PROJECT_FOLDER_STRUCTURE: rbSortMimic.value === true,
                    EXPORT_SUBPATH: exportSubpath
                },
                noQueue: false
            };
            AE_AME.run(opts);
        } catch (e) {
            try { alert("Failed: " + e); } catch(_) {}
        }
    };

    // Resize handling
    pal.onResizing = pal.onResize = function () { try { this.layout.resize(); } catch(e) {} };

    return pal;
}

// Show panel when not in pipeline
if (!__AE_PIPE__) {
    var __amePal = __AME_buildPanel(this);
    if (__amePal instanceof Window) {
        __amePal.center();
        __amePal.show();
    } else if (__amePal) {
        try { __amePal.layout.layout(true); } catch(e) {}
    }
}
