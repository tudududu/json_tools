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
(function packOutputComps() {
    app.beginUndoGroup("Pack Output Comps");

    function log(msg) { try { $.writeln(msg); } catch (e) {} }
    function alertOnce(msg) { try { alert(msg); } catch (e) {} }

    var proj = app.project;
    if (!proj) { alertOnce("No project open."); app.endUndoGroup(); return; }

    var sel = proj.selection;
    if (!sel || !sel.length) { alertOnce("Select one or more compositions."); app.endUndoGroup(); return; }

    // Config ------------------------------------------------
    var OUTPUT_ROOT_PATH = ["project", "out"];   // Base output path
    var ANCHOR_SOURCE_FOLDER = "comps";           // Mirror segments AFTER this folder
    var SKIP_IF_ALREADY_IN_OUTPUT = true;          // Avoid recursion
    var APPEND_SUFFIX = "_OUT";                   // Suffix for delivery/export comps
    var ENSURE_UNIQUE_NAME = true;                 // If a name collision occurs, append numeric counter
    var SKIP_IF_OUTPUT_ALREADY_EXISTS = true;      // NEW: If an output comp with the expected base name already exists in dest folder, skip instead of creating _01

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

    for (var s = 0; s < sel.length; s++) {
        var item = sel[s];
        if (!(item instanceof CompItem)) { skipped.push(item.name + " (not comp)" ); log("Skip: '"+item.name+"' not a comp"); continue; }

        // Determine destination folder early (so we can test existence)
        var relSegs = relativeSegmentsAfterAnchor(item, ANCHOR_SOURCE_FOLDER.toLowerCase());
        var destFolder = relSegs.length ? ensurePath(outputRoot, relSegs) : outputRoot;
        var expectedBaseName = baseOutputName(item.name);

        log("Considering: '" + item.name + "' -> dest path segments: " + (relSegs.length ? relSegs.join("/") : "(root)") + ", expected output name: " + expectedBaseName);

        if (SKIP_IF_ALREADY_IN_OUTPUT && (isDescendantOf(item, outputRoot) || isInOutputPath(item))) {
            skipped.push(item.name + " (already in output)");
            log("Skip: source comp already under output root -> '"+item.name+"'");
            continue;
        }

        // Check if an output comp already exists with the expected base name (without uniqueness increment)
        if (SKIP_IF_OUTPUT_ALREADY_EXISTS) {
            var foundExisting = false;
            try {
                for (var di = 1; di <= destFolder.numItems; di++) {
                    var dfItem = destFolder.items[di];
                    if (dfItem instanceof CompItem && String(dfItem.name) === expectedBaseName) { foundExisting = true; break; }
                }
            } catch (eChk) { log("Existence check error for '"+item.name+"': " + eChk); }
            if (foundExisting) {
                skipped.push(item.name + " (export exists)");
                log("Skip: export already exists as '" + expectedBaseName + "' in folder '" + destFolder.name + "'");
                continue;
            }
        }

        // Create new export comp (not duplicate) using same settings
        var w = item.width, h = item.height, dur = item.duration, fps = item.frameRate, pa = 1.0;
        try { if (item.pixelAspect) pa = item.pixelAspect; } catch (ePA) {}
        if (!fps || fps <= 0) fps = 25;
        if (!dur || dur <= 0) dur = 1;
        var outName = makeUniqueName(expectedBaseName);
        var exportComp = null;
        try { exportComp = proj.items.addComp(outName, w, h, pa, dur, fps); } catch (eAdd) { skipped.push(item.name + " (create failed)" ); log("Create failed for '"+item.name+"': "+eAdd); continue; }
        if (!exportComp) { skipped.push(item.name + " (create null)" ); log("Create returned null for '"+item.name+"'"); continue; }
        try { exportComp.displayStartTime = item.displayStartTime; } catch (eDST) {}

        // Add the source comp as a layer (precomp inclusion)
        try { exportComp.layers.add(item); } catch (eLayer) { log("Layer add failed for " + outName + ": " + eLayer); }

        // Assign destination folder (already ensured)
        try { exportComp.parentFolder = destFolder; } catch (ePF) {}

        created++;
        log("Created export comp '" + exportComp.name + "' -> " + destFolder.name + (relSegs.length ? (" (" + relSegs.join("/") + ")") : ""));
    }

    var summary = "Created " + created + " export comp(s).";
    if (skipped.length) summary += "\nSkipped: " + skipped.join(", ");
    log(summary);
    alertOnce(summary);

    app.endUndoGroup();
})();

