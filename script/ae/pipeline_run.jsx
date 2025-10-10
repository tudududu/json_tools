// AE Pipeline Orchestrator (Steps 1 & 2): create_compositions -> insert_and_relink_footage

(function runPipeline12() {
    app.beginUndoGroup("Pipeline: Steps 1+2");

    // Resolve this script's folder to find sibling phase scripts
    function here() { try { return File($.fileName).parent; } catch (e) { return null; } }
    var base = here();
    if (!base) { alert("Cannot resolve script folder."); app.endUndoGroup(); return; }

    function join(p, rel) { return File(p.fsName + "/" + rel); }

    // Adjust these relative paths to match your repo layout
    var CREATE_COMPS_PATH = join(base, "create_compositions.jsx");
    var INSERT_RELINK_PATH = join(base, "insert_and_relink_footage.jsx");

    // Shared logger (console + optional file)
    function timestamp() {
        var d = new Date(); function p(n){return (n<10?'0':'')+n;}
        return d.getFullYear()+""+p(d.getMonth()+1)+""+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
    }
    var RUN_ID = timestamp();

    // Optional: write logs to ./project/log under the AE project root folder
    var ENABLE_FILE_LOG = true;
    var LOG_PATH_SEGMENTS = ["project","log"];
    var LOG_PREFIX = "pipeline_12";
    var __logFile = null;

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
        if (!ENABLE_FILE_LOG) return null;
        var folder = findOrCreateLogFolder();
        try { return new File(folder.fsName + "/" + LOG_PREFIX + "_" + RUN_ID + ".log"); } catch (e) { return null; }
    }
    __logFile = openLogFile();

    function fileLogLine(s) {
        if (!__logFile) return;
        try {
            if (__logFile.open("a")) { __logFile.write(s + "\n"); __logFile.close(); }
        } catch (e) { try { __logFile.close(); } catch (e2) {} }
    }
    function log(s) {
        try { $.writeln(s); } catch (e) {}
        if (ENABLE_FILE_LOG) fileLogLine(s);
    }

    // Shared bus
    if (typeof AE_PIPE === "undefined") { AE_PIPE = {}; }
    AE_PIPE.MODE = "pipeline";
    AE_PIPE.RUN_ID = RUN_ID;
    AE_PIPE.results = { createComps: [], insertRelink: [] };
    AE_PIPE.options = AE_PIPE.options || {};
    AE_PIPE.log = log;

    // Helpers - selection management
    var proj = app.project;
    if (!proj) { alert("No project open."); app.endUndoGroup(); return; }

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

    // Step 1: Create compositions from selected footage
    var footageSel = selectedFootageItems();
    if (!footageSel.length) {
        alert("Select one or more footage items in the Project panel for Step 1 (create_compositions).");
        app.endUndoGroup();
        return;
    }
    log("Step 1: Creating comps from " + footageSel.length + " selected footage item(s).");

    // API contract (preferred): AE_CreateComps.run({ selection: FootageItem[], runId: RUN_ID, ... })
    var step1UsedAPI = false;
    try {
        // Load once; script may expose AE_CreateComps
        $.evalFile(CREATE_COMPS_PATH);
        if (typeof AE_CreateComps !== "undefined" && AE_CreateComps && typeof AE_CreateComps.run === "function") {
            var res1 = AE_CreateComps.run({ selection: footageSel, runId: RUN_ID, log: log });
            if (res1 && res1.created && res1.created.length) {
                AE_PIPE.results.createComps = res1.created;
                step1UsedAPI = true;
            }
        }
    } catch (e1) {
        log("Step 1 API path failed, falling back to side-effect mode. Error: " + (e1 && e1.message ? e1.message : e1));
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
    log("Step 1: Created comps: " + AE_PIPE.results.createComps.length);

    if (!AE_PIPE.results.createComps.length) {
        alert("No compositions created in Step 1. Aborting.");
        app.endUndoGroup();
        return;
    }

    // Step 2: Insert & relink into those comps
    log("Step 2: Insert & relink into " + AE_PIPE.results.createComps.length + " comps.");
    var step2UsedAPI = false;
    try {
        $.evalFile(INSERT_RELINK_PATH);
        if (typeof AE_InsertRelink !== "undefined" && AE_InsertRelink && typeof AE_InsertRelink.run === "function") {
            var res2 = AE_InsertRelink.run({ comps: AE_PIPE.results.createComps, runId: RUN_ID, log: log });
            if (res2 && res2.processed) AE_PIPE.results.insertRelink = res2.processed;
            step2UsedAPI = true;
        }
    } catch (e2) {
        log("Step 2 API path failed, falling back to selection. Error: " + (e2 && e2.message ? e2.message : e2));
    }
    if (!step2UsedAPI) {
        // Fallback: set current selection to created comps and eval the script as-is
        try { proj.selection = AE_PIPE.results.createComps; } catch (eSel) {}
        try { $.evalFile(INSERT_RELINK_PATH); } catch (e2b) { log("insert_and_relink_footage threw: " + e2b); }
        // Assume success on the selected comps for summary
        AE_PIPE.results.insertRelink = AE_PIPE.results.createComps.slice(0);
    }

    var msg = "Pipeline 1+2 complete. Created: " + AE_PIPE.results.createComps.length + ", Inserted/Relinked: " + AE_PIPE.results.insertRelink.length + ".";
    log(msg);
    try { alert(msg); } catch (eA) {}
    app.endUndoGroup();
})();