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
    var OUTPUT_ROOT_PATH = ["project", "out"];  // Base output path
    var ANCHOR_SOURCE_FOLDER = "comps";          // Mirror segments AFTER this folder
    var SKIP_IF_ALREADY_IN_OUTPUT = true;         // Avoid duplicating inside output

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

    // Placeholder renaming logic (future step)
    function deriveOutputName(sourceComp, dupComp) {
        return dupComp.name; // Keep original name for now
    }

    var outputRoot = ensureOutputRoot();
    var created = 0;
    var skipped = [];

    for (var s = 0; s < sel.length; s++) {
        var item = sel[s];
        if (!(item instanceof CompItem)) { skipped.push(item.name + " (not comp)"); continue; }
        if (SKIP_IF_ALREADY_IN_OUTPUT && isDescendantOf(item, outputRoot)) { skipped.push(item.name + " (already in output)" ); continue; }

        var dup = null;
        try { dup = item.duplicate(); } catch (eDup) { skipped.push(item.name + " (duplicate failed)" ); continue; }
        if (!dup) { skipped.push(item.name + " (duplicate null)" ); continue; }

        // Renaming placeholder
        try {
            var newName = deriveOutputName(item, dup);
            if (newName && newName !== dup.name) dup.name = newName;
        } catch (eRN) {}

        // Determine relative subpath after anchor
        var relSegs = relativeSegmentsAfterAnchor(item, ANCHOR_SOURCE_FOLDER.toLowerCase());
        var destFolder = relSegs.length ? ensurePath(outputRoot, relSegs) : outputRoot;
        try { dup.parentFolder = destFolder; } catch (ePF) {}

        created++;
        log("Packed comp '" + dup.name + "' -> " + destFolder.name + (relSegs.length ? (" (" + relSegs.join("/") + ")") : ""));
    }

    var summary = "Packed " + created + " output comp(s).";
    if (skipped.length) summary += "\nSkipped: " + skipped.join(", ");
    log(summary);
    alertOnce(summary);

    app.endUndoGroup();
})();

