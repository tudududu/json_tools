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
    var AUTO_QUEUE_IN_AME = false;   // Set true to add RQ items to AME after path updates
    var START_AME_ENCODING = false;  // When queuing to AME, true attempts to auto-start encoding

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

    // ————— Iterate Render Queue —————
    var rq = app.project.renderQueue;
    if (!rq || rq.numItems < 1) {
        alertOnce("No items in Render Queue.");
        app.endUndoGroup();
        return;
    }

    var processed = 0, skipped = 0, unsorted = 0;
    for (var i = 1; i <= rq.numItems; i++) {
        var rqi = rq.item(i);
        if (!rqi || !rqi.comp) { skipped++; continue; }

        // Skip if already rendering or done
        try {
            if (rqi.status === RQItemStatus.DONE || rqi.status === RQItemStatus.RENDERING) { skipped++; continue; }
        } catch (e) {}

        var om = null;
        try { om = rqi.outputModule(1); } catch (eOM) { om = null; }
        if (!om) { skipped++; continue; }

        var compName = rqi.comp.name;
        var curFile = om.file; // File object, may be null if not set yet
        var ext = ".mov"; // default fallback
        var baseName = compName;
        if (curFile && curFile.name) {
            var parts = splitBaseExt(curFile.name);
            ext = parts.ext || ext;
            baseName = parts.base || baseName;
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

        // Preserve existing baseName, only change path
        var destPath = joinPath(destParent.fsName, baseName + ext);
        try {
            om.file = new File(destPath);
            processed++;
            log("Set output: " + rqi.comp.name + " -> " + destPath);
        } catch (eSet) {
            skipped++;
            log("Skip (cannot set output for '" + rqi.comp.name + "'): " + eSet);
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

    var msg = "Output paths updated. Processed: " + processed + ", Skipped: " + skipped + 
              (unsorted ? (", Unsorted: " + unsorted) : "") + "\nBase: " + dateFolder.fsName;
    log(msg);
    alertOnce(msg);

    app.endUndoGroup();
})();
