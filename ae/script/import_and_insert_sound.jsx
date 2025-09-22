// Script for Adobe After Effects — Import newest SOUND folder and place under project/in/sound
// ——————————————————————————————————————————————————————————————
// Step 1:
// 1) Inspect the IN/SOUND folder located relative to the saved project
//    Expected layout:
//      ./POST/WORK/<project>.aep   ← current project file
//      ./POST/IN/SOUND/<YYMMDD>    ← source sound folders
// 2) Find YYMMDD-named folders (6 digits) under SOUND and pick the newest (max by number)
// 3) Import that folder into the open project
// 4) Move the imported folder to: project/in/sound/
//
// Usage:
// - Save your project to POST/WORK first, then run this script.

(function importNewestSoundFolderAndInsert() {
    app.beginUndoGroup("Import Newest SOUND Folder");

    function log(msg) { try { $.writeln(msg); } catch (e) {} }
    function alertOnce(msg) { try { alert(msg); } catch (e) {} }

    var proj = app.project;
    if (!proj) {
        alertOnce("No project open.");
        app.endUndoGroup();
        return;
    }

    if (!proj.file) {
        alertOnce("Please save the project under POST/WORK before running.\nExpected layout: POST/WORK/<project>.aep and POST/IN/SOUND/<YYMMDD>");
        app.endUndoGroup();
        return;
    }

    // Helpers ————————————————————————————————————————————————
    function joinPath(a, b) {
        if (!a) return b || "";
        if (!b) return a || "";
        var sep = (/\\$/.test(a) || /\/$/.test(a)) ? "" : "/";
        return a + sep + b;
    }

    // Settings
    var ENABLE_ALIGN_AUDIO_TO_MARKERS = false; // Set true to align audio start to first comp marker; false = place at 0s

    function ensureProjectPath(segments) {
        var cur = proj.rootFolder; // Root
        for (var i = 0; i < segments.length; i++) {
            var name = segments[i];
            if (!name) continue;
            var found = null;
            for (var j = 1; j <= cur.numItems; j++) {
                var it = cur.items[j];
                if (it && it instanceof FolderItem && it.name === name) { found = it; break; }
            }
            if (!found) {
                found = proj.items.addFolder(name);
                found.parentFolder = cur;
            }
            cur = found;
        }
        return cur;
    }

    function createChildFolder(parent, name) {
        var f = proj.items.addFolder(name);
        f.parentFolder = parent;
        return f;
    }

    function importFolderRecursive(fsFolder, aeParentFolder) {
        // Recursively import files and subfolders under fsFolder into AE under aeParentFolder
        if (!fsFolder || !fsFolder.exists) return;
        var entries = fsFolder.getFiles();
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry instanceof Folder) {
                var childAEFolder = createChildFolder(aeParentFolder, entry.name);
                importFolderRecursive(entry, childAEFolder);
            } else if (entry instanceof File) {
                try {
                    var ioFile = new ImportOptions(entry);
                    var imported = proj.importFile(ioFile);
                    if (imported) imported.parentFolder = aeParentFolder;
                } catch (eFile) {
                    log("Skip file '" + entry.fsName + "' (" + (eFile && eFile.message ? eFile.message : eFile) + ")");
                }
            }
        }
    }

    function newestYYMMDDSubfolder(soundFolder) {
        if (!soundFolder || !soundFolder.exists) return null;
        var subs = soundFolder.getFiles(function(f) { return f instanceof Folder; });
        var best = null;
        var bestNum = -1;
        for (var i = 0; i < subs.length; i++) {
            var sf = subs[i];
            var name = String(sf.name || "");
            if (/^\d{6}$/.test(name)) {
                var num = parseInt(name, 10);
                if (num > bestNum) { bestNum = num; best = sf; }
            }
        }
        return best;
    }

    function collectFootageItemsRecursiveFolderItem(folderItem, outArr) {
        for (var i = 1; i <= folderItem.numItems; i++) {
            var it = folderItem.items[i];
            if (it instanceof FolderItem) {
                collectFootageItemsRecursiveFolderItem(it, outArr);
            } else if (it instanceof FootageItem) {
                outArr.push(it);
            }
        }
    }

    function toLower(s) { return String(s || "").toLowerCase(); }

    function getTokenPairFromCompName(name) {
        // Extract title (first token) and a duration token like '15s' from comp name
        var base = String(name || "");
        var parts = base.split(/[_\s]+/);
        if (!parts.length) return null;
        var title = parts[0];
        var duration = null;
        for (var i = 1; i < parts.length; i++) {
            if (/^\d{1,4}s$/i.test(parts[i])) { duration = parts[i]; break; }
        }
        if (!title || !duration) return null;
        return title + "_" + duration;
    }

    function pickBestAudioMatch(items, tokenPairLC) {
        // Filter items whose names contain tokenPair (case-insensitive) and that have audio
        var matches = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var nameLC = toLower(it.name);
            if (nameLC.indexOf(tokenPairLC) !== -1) {
                // Prefer actual audio: hasAudio true OR extension in known audio list
                var ext = nameLC.replace(/^.*\./, "");
                var isAudio = false;
                try { if (it.hasAudio) isAudio = true; } catch (e) {}
                if (!isAudio) {
                    if (/(wav|aif|aiff|mp3|m4a|aac|ogg)$/i.test(ext)) isAudio = true;
                }
                if (isAudio) matches.push(it);
            }
        }
        if (!matches.length) return null;
        // Sort by extension preference
        function scoreExt(n) {
            var ext = n.replace(/^.*\./, "").toLowerCase();
            if (ext === "wav") return 0;
            if (ext === "aif" || ext === "aiff") return 1;
            if (ext === "m4a" || ext === "aac") return 2;
            if (ext === "mp3") return 3;
            return 10;
        }
        matches.sort(function(a, b) { return scoreExt(a.name) - scoreExt(b.name); });
        return matches[0];
    }

    function firstCompMarkerTime(comp) {
        try {
            if (comp && comp.markerProperty && comp.markerProperty.numKeys > 0) {
                return comp.markerProperty.keyTime(1);
            }
        } catch (e) {}
        return 0;
    }

    function getSelectedComps() {
        var out = [];
        var sel = proj.selection;
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof CompItem) out.push(sel[i]);
            }
        }
        if (!out.length && proj.activeItem && proj.activeItem instanceof CompItem) {
            out.push(proj.activeItem);
        }
        return out;
    }

    // Derive POST/IN/SOUND from project path
    var workFolder = proj.file.parent; // .../POST/WORK
    var postFolder = workFolder ? workFolder.parent : null; // .../POST
    if (!postFolder || !postFolder.exists) {
        alertOnce("Could not resolve POST folder from project path.\nExpected project under POST/WORK.");
        app.endUndoGroup();
        return;
    }

    var inFolder = new Folder(joinPath(postFolder.fsName, joinPath("IN", "SOUND")));
    if (!inFolder.exists) {
        alertOnce("SOUND folder not found: " + inFolder.fsName);
        app.endUndoGroup();
        return;
    }

    var dateFolder = newestYYMMDDSubfolder(inFolder);
    if (!dateFolder) {
        alertOnce("No YYMMDD folder found in: " + inFolder.fsName);
        app.endUndoGroup();
        return;
    }

    log("Importing SOUND folder: " + dateFolder.fsName);

    // Import the folder (as a folder). If direct import fails, do a recursive manual import fallback.
    var importedFolderItem = null;
    var importError = null;
    try {
        var io = new ImportOptions();
        io.file = new Folder(dateFolder.fsName);
        if (typeof ImportAsType !== "undefined") {
            io.importAs = ImportAsType.FOLDER;
        }
        importedFolderItem = proj.importFile(io);
    } catch (e) {
        importError = e;
    }

    // If direct import failed, perform recursive fallback by creating AE folder and importing contents
    if (!importedFolderItem) {
        var destForFallback = ensureProjectPath(["project", "in", "sound"]);
        var container = createChildFolder(destForFallback, dateFolder.name);
        importFolderRecursive(dateFolder, container);
        // If at least one item was imported under container, treat it as success
        if (container && container.numItems > 0) {
            importedFolderItem = container;
            log("Imported via fallback into project/in/sound/" + container.name);
        } else {
            var emsg = "Import failed" + (importError ? (": " + (importError.message || importError)) : ".") +
                       " Path: " + dateFolder.fsName;
            alertOnce(emsg);
            log(emsg);
            app.endUndoGroup();
            return;
        }
    }

    if (!importedFolderItem || !(importedFolderItem instanceof FolderItem)) {
        // AE may import top item differently; attempt to resolve by name
        var fallback = null;
        for (var k = proj.numItems; k >= 1; k--) {
            var it = proj.items[k];
            if (it && it instanceof FolderItem && it.name === dateFolder.name) { fallback = it; break; }
        }
        importedFolderItem = fallback || importedFolderItem;
    }

    if (!importedFolderItem) {
        alertOnce("Imported folder not found in project.");
        app.endUndoGroup();
        return;
    }

    // Move to project/in/sound (if not already placed there by fallback)
    var dest = ensureProjectPath(["project", "in", "sound"]);
    if (importedFolderItem.parentFolder !== dest) {
        importedFolderItem.parentFolder = dest;
        log("Moved imported folder '" + importedFolderItem.name + "' to project/in/sound");
    }

    alertOnce("Imported SOUND folder '" + importedFolderItem.name + "' into project/in/sound.");

    // Step 2: Insert audio into selected comps
    var comps = getSelectedComps();
    if (!comps.length) {
        log("No selected comps. Skipping audio insertion.");
        app.endUndoGroup();
        return;
    }

    // Collect all footage items under the imported folder (recursively)
    var allFootage = [];
    if (importedFolderItem instanceof FolderItem) {
        collectFootageItemsRecursiveFolderItem(importedFolderItem, allFootage);
    }
    var inserted = 0, missed = [];
    for (var ci = 0; ci < comps.length; ci++) {
        var comp = comps[ci];
        var tokenPair = getTokenPairFromCompName(comp.name);
        if (!tokenPair) {
            missed.push(comp.name + " (no tokens)");
            continue;
        }
        var match = pickBestAudioMatch(allFootage, toLower(tokenPair));
        if (!match) {
            missed.push(comp.name + " (no audio for '" + tokenPair + "')");
            continue;
        }
        // Insert audio
        try {
            var layer = comp.layers.add(match);
            layer.audioEnabled = true;
            var t0 = ENABLE_ALIGN_AUDIO_TO_MARKERS ? firstCompMarkerTime(comp) : 0;
            try { layer.startTime = t0; } catch (eST) {}
            try { layer.inPoint = t0; } catch (eIP) {}
            inserted++;
            log("Inserted audio '" + match.name + "' into comp '" + comp.name + "' at " + t0.toFixed(3) + "s");
        } catch (eIns) {
            missed.push(comp.name + " (insert failed: " + (eIns && eIns.message ? eIns.message : eIns) + ")");
        }
    }

    var summary = "Audio insert: " + inserted + " added" + (missed.length ? ", missed: " + missed.length : "");
    log(summary + (missed.length ? "\n- " + missed.join("\n- ") : ""));
    alertOnce(summary);

    app.endUndoGroup();
})();
// Script_ae: Import and insert sound. (01)

// Step 1: 
// 1. We want to inspect a ‘IN/SOUND’ folder located as follows:
// ./POST/WORK/*.aep
// ./POST/IN/SOUND/250922
// 2. Search if there is a YYMMDD style named folder (e.g. ’250922’) in the ’SOUND’ folder.
// 3. Import this folder into the opened AE project. In case of more date named folders in the ‘SOUND’ folder import only the newest one.
// 4. Place the imported folder onto project internal path: ‘project/in/sound/’

