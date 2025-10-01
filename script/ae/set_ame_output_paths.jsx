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

    // 3. AME automation
    var AUTO_QUEUE_IN_AME = true;           // After setting output paths, queue all eligible items into AME
    var START_AME_ENCODING = false;         // If true, attempt to auto-start encoding in AME (may be ignored by some versions)

    // 4. Naming / extension fallback
    var DEFAULT_EXTENSION_FALLBACK = ".mov"; // Used only if output module has no file name yet

    // 5. Logging verbosity
    var MAX_DETAIL_LINES = 80;             // Limit detail lines logged

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
    var dateFolder = new Folder(joinPath(outMaster.fsName, todayYYMMDD()));
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
                    itemsToProcess.push({ rqi: newRQI, newlyAdded: true });
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
    var processed = 0, skipped = 0, unsorted = 0;
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
        var destParent = dateFolder;
        if (tokens.ar && tokens.duration) {
            destParent = new Folder(joinPath(joinPath(dateFolder.fsName, tokens.ar), tokens.duration));
        } else {
            destParent = new Folder(joinPath(dateFolder.fsName, "unsorted"));
            unsorted++;
        }
        ensureFolderExists(destParent);
        var destPath = joinPath(destParent.fsName, baseName + ext);
        try {
            om.file = new File(destPath);
            processed++;
            if (detailLines.length < MAX_DETAIL_LINES) detailLines.push((entry.newlyAdded ? "ADD" : "SET") + " -> " + compName + " => " + destPath);
        } catch (eSet2) {
            skipped++;
            detailLines.push("FAIL set " + compName + ": " + eSet2);
        }
    }

    // Optionally queue to AME
    if (AUTO_QUEUE_IN_AME) {
        try {
            // Some AE versions accept a boolean to auto-start; some ignore params
            if (START_AME_ENCODING) {
                try { app.project.renderQueue.queueInAME(true); }
                catch (e1) { try { app.project.renderQueue.queueInAME(); } catch (e2) {} }
            } else {
                try { app.project.renderQueue.queueInAME(false); }
                catch (e3) { try { app.project.renderQueue.queueInAME(); } catch (e4) {} }
            }
        } catch (eQ) {
            log("Failed to queue in AME: " + eQ);
        }
    }

    var msg = "Output paths updated. Added:" + addedCount + " Processed:" + processed + " Skipped:" + skipped +
              (unsorted ? (" Unsorted:" + unsorted) : "") + "\nBase: " + dateFolder.fsName +
              (detailLines.length ? ("\nDetails (" + detailLines.length + ") — showing up to " + MAX_DETAIL_LINES + ":\n" + detailLines.slice(0, MAX_DETAIL_LINES).join("\n")) : "");
    log(msg);
    alertOnce(msg);

    app.endUndoGroup();
})();
