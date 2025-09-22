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

(function importNewestSoundFolder() {
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

    // Import the folder (as a folder)
    var importedFolderItem = null;
    try {
        var io = new ImportOptions(dateFolder);
        if (io.canImportAs && (typeof ImportAsType !== "undefined") && io.canImportAs(ImportAsType.FOLDER)) {
            io.importAs = ImportAsType.FOLDER;
        }
        importedFolderItem = proj.importFile(io);
    } catch (e) {
        alertOnce("Import failed: " + e);
        app.endUndoGroup();
        return;
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

    // Move to project/in/sound
    var dest = ensureProjectPath(["project", "in", "sound"]);
    importedFolderItem.parentFolder = dest;
    log("Moved imported folder '" + importedFolderItem.name + "' to project/in/sound");

    alertOnce("Imported SOUND folder '" + importedFolderItem.name + "' into project/in/sound.");
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

