// Script for Adobe After Effects — Import newest SOUND folder and place under project/in/sound
// ——————————————————————————————————————————————————————————————
// 
// 1) Inspect the IN/SOUND folder located relative to the saved project
//    Expected layout:
//      ./POST/WORK/<project>.aep   ← current project file
//      ./POST/IN/SOUND/<YYMMDD>    ← source sound folders
// 2) Find YYMMDD-named folders (6 digits) under SOUND and pick the newest (max by number)
// 3) Import that folder into the open project
// 4) Move the imported folder to: project/in/sound/
// 5) Relink "data.json" footage file (auto/manual)
//
// Usage:
// 1 Save your project to POST/WORK
// 2 Select compositions.
// 3 Run this script.

// Pipeline detection and API namespace
var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_InsertRelink === 'undefined') { var AE_InsertRelink = {}; }

function __InsertRelink_coreRun(opts) {
    app.beginUndoGroup("Import Newest SOUND Folder");

    // Tagged logger
    var __logger = null;
    try { if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') { __logger = __AE_PIPE__.getLogger('insert_relink'); } } catch(eLG) {}

    function log(msg) {
        if (__logger) { try { __logger.info(msg); } catch(e) {} return; }
        try { $.writeln(msg); } catch (e2) {}
    }
    function alertOnce(msg) {
        if (__AE_PIPE__) { log(msg); return; }
        try { alert(msg); } catch (e) {}
    }
    function alertAlways(msg) {
        try { alert(msg); } catch (e) {}
    }

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
    var ENABLE_REMOVE_EXISTING_AUDIO_LAYERS = true; // When true, remove all pre-existing audio-only layers (FootageItem with audio, no video) after inserting the new one
    var ENABLE_MUTE_EXISTING_AUDIO_LAYERS = true; // When true (and removal is false), mute (audioEnabled=false) on any other audio-capable layers
    var CLEAR_EXISTING_PROJECT_SOUND_FOLDER = true; // When true, BEFORE importing, clear AE Project panel folder project/in/sound/ (its contents only)
    // When true, import from ISO-named subfolder under SOUND/<YYMMDD>/ matching the project ISO
    var SOUND_USE_ISO_SUBFOLDER = false;
    // New: JSON data relink settings
    var ENABLE_RELINK_DATA_JSON = true;            // Master switch for data.json relink/import
    var DATA_JSON_ISO_CODE_MANUAL = "SAU";        // Manual fallback 3-letter ISO country code (used if auto-detect fails)
    var DATA_JSON_ISO_CODE = null;                 // Actual ISO code used (auto-detected first, fallback to manual)
    var DATA_JSON_ISO_MODE = "manual";              // "auto" = try auto-detect then fallback to manual; "manual" = force manual only
    var DATA_JSON_PROJECT_FOLDER = ["project","in","data"]; // Project panel target folder path
    var DATA_JSON_PROJECT_ITEM_NAME = "data.json"; // Desired item name inside AE project
    var DATA_JSON_FS_SUBPATH = ["IN","data"];    // Relative path under POST where data files live
    var DATA_JSON_FILE_PREFIX = "data_";          // Prefix before ISO code
    var DATA_JSON_FILE_SUFFIX = ".json";         // Suffix/extension
    var DATA_JSON_IMPORT_IF_MISSING = true;       // Import if project item missing
    var DATA_JSON_RENAME_IMPORTED_TO_CANONICAL = true; // Rename imported item to data.json even if file name differs
    var DATA_JSON_LOG_VERBOSE = true;             // Extra logging for relink process
    // New: audio filename ISO check options
    var ENABLE_CHECK_AUDIO_ISO = false;            // Phase 1: toggle checking
    var CHECK_AUDIO_ISO_STRICT = false;            // Phase 2: strict mode => alert + abort pipeline

    // Options overrides
    try {
        var o = opts && opts.options ? opts.options : null;
        if (o) {
            if (o.ENABLE_FILE_LOG !== undefined) ENABLE_FILE_LOG = !!o.ENABLE_FILE_LOG;
            if (o.ENABLE_ALIGN_AUDIO_TO_MARKERS !== undefined) ENABLE_ALIGN_AUDIO_TO_MARKERS = !!o.ENABLE_ALIGN_AUDIO_TO_MARKERS;
            if (o.ENABLE_REMOVE_EXISTING_AUDIO_LAYERS !== undefined) ENABLE_REMOVE_EXISTING_AUDIO_LAYERS = !!o.ENABLE_REMOVE_EXISTING_AUDIO_LAYERS;
            if (o.ENABLE_MUTE_EXISTING_AUDIO_LAYERS !== undefined) ENABLE_MUTE_EXISTING_AUDIO_LAYERS = !!o.ENABLE_MUTE_EXISTING_AUDIO_LAYERS;
            if (o.CLEAR_EXISTING_PROJECT_SOUND_FOLDER !== undefined) CLEAR_EXISTING_PROJECT_SOUND_FOLDER = !!o.CLEAR_EXISTING_PROJECT_SOUND_FOLDER;
            if (o.ENABLE_RELINK_DATA_JSON !== undefined) ENABLE_RELINK_DATA_JSON = !!o.ENABLE_RELINK_DATA_JSON;
            if (o.hasOwnProperty('DATA_JSON_ISO_MODE')) DATA_JSON_ISO_MODE = String(o.DATA_JSON_ISO_MODE);
            if (o.hasOwnProperty('DATA_JSON_ISO_CODE_MANUAL')) DATA_JSON_ISO_CODE_MANUAL = String(o.DATA_JSON_ISO_CODE_MANUAL);
            if (o.DATA_JSON_PROJECT_FOLDER) DATA_JSON_PROJECT_FOLDER = o.DATA_JSON_PROJECT_FOLDER;
            if (o.DATA_JSON_PROJECT_ITEM_NAME) DATA_JSON_PROJECT_ITEM_NAME = String(o.DATA_JSON_PROJECT_ITEM_NAME);
            if (o.DATA_JSON_IMPORT_IF_MISSING !== undefined) DATA_JSON_IMPORT_IF_MISSING = !!o.DATA_JSON_IMPORT_IF_MISSING;
            if (o.DATA_JSON_RENAME_IMPORTED_TO_CANONICAL !== undefined) DATA_JSON_RENAME_IMPORTED_TO_CANONICAL = !!o.DATA_JSON_RENAME_IMPORTED_TO_CANONICAL;
            if (o.DATA_JSON_LOG_VERBOSE !== undefined) DATA_JSON_LOG_VERBOSE = !!o.DATA_JSON_LOG_VERBOSE;
            if (o.ENABLE_CHECK_AUDIO_ISO !== undefined) ENABLE_CHECK_AUDIO_ISO = !!o.ENABLE_CHECK_AUDIO_ISO;
            if (o.CHECK_AUDIO_ISO_STRICT !== undefined) CHECK_AUDIO_ISO_STRICT = !!o.CHECK_AUDIO_ISO_STRICT;
            if (o.SOUND_USE_ISO_SUBFOLDER !== undefined) SOUND_USE_ISO_SUBFOLDER = !!o.SOUND_USE_ISO_SUBFOLDER;
        }
        try { if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASE_FILE_LOGS_MASTER_ENABLE === false) { ENABLE_FILE_LOG = false; } } catch(eMSIR) {}
    } catch (eOpt) {}

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

    function isAudioFootageLayer(ly) {
        // True only for layers whose source is an audio-only FootageItem (unlinked included)
        try {
            if (!ly || !ly.source) return false;
            var src = ly.source;
            if (!(src instanceof FootageItem)) return false;
            // Prefer property check: audio-only means hasAudio true and hasVideo false
            try {
                if (src.hasAudio === true && src.hasVideo === false) return true;
            } catch (e1) {}
            // Fallback: check name/extension (handles missing footage)
            var nm = String((src.name || ly.name || "")).toLowerCase();
            if (/\.(wav|aif|aiff|mp3|m4a|aac|ogg)$/.test(nm)) return true;
            try {
                var f = (src.mainSource && src.mainSource.file) ? src.mainSource.file : null;
                if (f) {
                    var fn = String((f.name || f.fsName || "")).toLowerCase();
                    if (/\.(wav|aif|aiff|mp3|m4a|aac|ogg)$/.test(fn)) return true;
                }
            } catch (e2) {}
        } catch (e) {}
        return false;
    }

    function toLower(s) { return String(s || "").toLowerCase(); }

    function normalizeForMatch(s) {
        // Lowercase and remove common diacritics for accent-insensitive matching
        var x = toLower(s);
        // Slovak/Czech and general Latin diacritics
        x = x.replace(/[àáâãäåāăą]/g, 'a');
        x = x.replace(/[çćč]/g, 'c');
        x = x.replace(/[ďđ]/g, 'd');
        x = x.replace(/[èéêëēĕėęě]/g, 'e');
        x = x.replace(/[ìíîïīĭįı]/g, 'i');
        x = x.replace(/[ñň]/g, 'n');
        x = x.replace(/[òóôõöøōŏő]/g, 'o');
        x = x.replace(/[ŕř]/g, 'r');
        x = x.replace(/[śšş]/g, 's');
        x = x.replace(/[ťțţ]/g, 't');
        x = x.replace(/[ùúûüūŭůű]/g, 'u');
        x = x.replace(/[ýÿ]/g, 'y');
        x = x.replace(/[žźż]/g, 'z');
        x = x.replace(/[ľĺł]/g, 'l');
        return x;
    }

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

    function parseDurationToken(tok) {
        if (!tok) return null;
        var m = String(tok).match(/^(\d{1,4})s$/i);
        if (!m) return null;
        return parseInt(m[1], 10);
    }

    function pickBestAudioMatch(items, tokenPair) {
        // Filter items whose names contain tokenPair (case-insensitive) and that have audio
        var matches = [];
        var normPair = normalizeForMatch(tokenPair);
        var t1 = null, t2 = null;
        var usIdx = tokenPair.indexOf('_');
        if (usIdx > 0) {
            t1 = tokenPair.substring(0, usIdx);
            t2 = tokenPair.substring(usIdx + 1);
        }
        var normT1 = t1 ? normalizeForMatch(t1) : null;
        var normT2 = t2 ? normalizeForMatch(t2) : null;
        var t2Num = parseDurationToken(t2);
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var nameNorm = normalizeForMatch(it.name);
            // Primary: direct tokenPair match (accent/case-insensitive)
            var primaryHit = (nameNorm.indexOf(normPair) !== -1);
            // Secondary: mixed token scenario token1 ... token2 in order
            var secondaryHit = false;
            if (!primaryHit && normT1) {
                var p1 = nameNorm.indexOf(normT1);
                if (p1 !== -1) {
                    var tail = nameNorm.substring(p1 + normT1.length);
                    if (normT2) {
                        // Exact t2 token order check
                        if (tail.indexOf(normT2) !== -1) secondaryHit = true;
                    }
                    if (!secondaryHit && t2Num !== null) {
                        // Accept any duration token NN..Ns after t1 with same numeric value (ignores leading zeros)
                        var re = /(\d{1,4})s/g;
                        var m;
                        while ((m = re.exec(tail)) !== null) {
                            var nn = parseInt(m[1], 10);
                            if (nn === t2Num) { secondaryHit = true; break; }
                        }
                    }
                }
            }
            if (primaryHit || secondaryHit) {
                // Prefer actual audio: hasAudio true OR extension in known audio list
                var ext = nameNorm.replace(/^.*\./, "");
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

    // ------------------------------------------------------------
    // File logging (writes to ./POST/WORK/log/insert_and_relink_footage_<timestamp>.log)
    // Inspired by pack_output_comps.jsx pattern (simplified)
    // ------------------------------------------------------------
    // Respect options override parsed above; default to true only if not explicitly set to false
    if (ENABLE_FILE_LOG !== false) { var ENABLE_FILE_LOG = true; } // Master toggle
    var FILE_LOG_SUBFOLDER = "log";     // Folder name under POST/WORK
    var __fileLog = null;
    function __buildTimestamp() {
        var d = new Date();
        function p(n){ return (n<10?'0':'')+n; }
        return d.getFullYear()+ p(d.getMonth()+1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }
    if (ENABLE_FILE_LOG && workFolder && workFolder.exists) {
        try {
            var logFolder = new Folder(joinPath(workFolder.fsName, FILE_LOG_SUBFOLDER));
            if (!logFolder.exists) { logFolder.create(); }
            if (logFolder.exists) {
                var lfName = "insert_and_relink_footage_" + __buildTimestamp() + ".log";
                __fileLog = new File(joinPath(logFolder.fsName, lfName));
            }
        } catch (eLF) {}
    }
    function __writeFileLine(f, line) {
        if (!f) return;
        try { if (f.open('a')) { f.write(line + "\n"); f.close(); } } catch (eWL) {}
    }
    // Wrap existing log to also write to file
    if (__fileLog) {
        try {
            var __origLogFn = log;
            log = function(msg){
                __origLogFn(msg);
                __writeFileLine(__fileLog, msg);
            };
            log("[log] File logging started: " + __fileLog.fsName);
        } catch (eWrap) {}
    }

    // Auto-detect ISO code from parent of POST: parentFolderName pattern "jobNumber - ISO"
    // Example path: /.../<Parent>/<POST>/WORK/project.aep, we need <Parent> folder name.
    var __isoOrigin = "manual"; // default assumption
    var parentOfPost = postFolder ? postFolder.parent : null;
    if (DATA_JSON_ISO_MODE !== "manual") {
        if (parentOfPost && parentOfPost.exists) {
            var parentNameRaw = parentOfPost.name || "";
            var decodedName = parentNameRaw;
            // Attempt URI decode (handles %20 etc.)
            try { decodedName = decodeURIComponent(parentNameRaw); } catch (eDec) {
                // Fallback simple replacement for %20 only
                decodedName = parentNameRaw.replace(/%20/g, ' ');
            }
            // Also replace remaining %XX sequences generically if not decoded
            if (decodedName === parentNameRaw && /%[0-9A-Fa-f]{2}/.test(parentNameRaw)) {
                decodedName = parentNameRaw.replace(/%([0-9A-Fa-f]{2})/g, function(m,h){
                    try { return String.fromCharCode(parseInt(h,16)); } catch(eC){ return m; }
                });
            }
            // Normalize whitespace
            var normalizedName = decodedName.replace(/\s+/g,' ').replace(/\s*-\s*/,' - ').replace(/^\s+|\s+$/g,'');
            if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) {
                log("[data.json] Parent of POST folder name (raw): '" + parentNameRaw + "'");
                if (parentNameRaw !== decodedName) log("[data.json] Decoded name: '" + decodedName + "'");
                if (decodedName !== normalizedName) log("[data.json] Normalized name: '" + normalizedName + "'");
            }
            var workName = normalizedName || decodedName || parentNameRaw;
            var mIso = null;
            // Primary pattern: anything - ISO (3 letters at end)
            var m1 = workName.match(/-\s*([A-Za-z]{3})$/);
            if (m1) mIso = m1;
            // Secondary: last whitespace separated token is 3 letters
            if (!mIso) {
                var parts = workName.split(/[\s_]+/);
                if (parts.length) {
                    var last = parts[parts.length - 1];
                    if (/^[A-Za-z]{3}$/.test(last)) mIso = [null, last];
                }
            }
            // Tertiary: dash-split last trimmed token of length 3
            if (!mIso) {
                var dashParts = workName.split('-');
                if (dashParts.length >= 2) {
                    var cand = dashParts[dashParts.length - 1].replace(/\s+/g,'');
                    if (/^[A-Za-z]{3}$/.test(cand)) mIso = [null, cand];
                }
            }
            if (mIso && mIso[1]) {
                DATA_JSON_ISO_CODE = mIso[1].toUpperCase();
                __isoOrigin = "auto";
                if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) log("[data.json] Auto-detected ISO from parent folder: " + DATA_JSON_ISO_CODE);
            } else {
                if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) log("[data.json] Could not auto-detect ISO from parent folder name (after decoding/normalizing); will use manual fallback.");
            }
        }
    }
    if (!DATA_JSON_ISO_CODE) { // either manual mode or auto failed
        DATA_JSON_ISO_CODE = (DATA_JSON_ISO_CODE_MANUAL || "XXX").toUpperCase();
        __isoOrigin = (DATA_JSON_ISO_MODE === "manual") ? "manual(forced)" : "manual(fallback)";
    }
    if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) {
        log("[data.json] ISO code used: " + DATA_JSON_ISO_CODE + " (" + __isoOrigin + ")");
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

    // Determine actual folder to import (optionally pick ISO subfolder)
    var soundImportFolder = dateFolder;
    if (SOUND_USE_ISO_SUBFOLDER) {
        var __projISO = null;
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) __projISO = String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(ePI) {}
        if (!__projISO) { try { if (DATA_JSON_ISO_CODE) __projISO = String(DATA_JSON_ISO_CODE).toUpperCase(); } catch(ePF) {} }
        if (__projISO) {
            var subs = dateFolder.getFiles(function(f){ return f instanceof Folder; });
            var matched = null;
            for (var s=0; s<subs.length; s++) {
                var nm = String(subs[s].name||"").toUpperCase();
                if (nm === __projISO) { matched = subs[s]; break; }
            }
            if (matched) {
                soundImportFolder = matched;
            } else {
                log("[warn] ISO subfolder '" + __projISO + "' not found under " + dateFolder.fsName + "; importing from date folder.");
            }
        } else {
            log("[warn] Project ISO unavailable; cannot select ISO subfolder. Importing from date folder.");
        }
    }

    log("Importing SOUND folder: " + soundImportFolder.fsName);

    // Optional Step 0: Clear existing AE project folder project/in/sound/ before new import
    if (CLEAR_EXISTING_PROJECT_SOUND_FOLDER) {
        var projSoundFolder = ensureProjectPath(["project", "in", "sound"]); // ensures path exists
        var removedCount = 0;
        if (projSoundFolder && projSoundFolder.numItems > 0) {
            for (var cf = projSoundFolder.numItems; cf >= 1; cf--) {
                try { projSoundFolder.items[cf].remove(); removedCount++; } catch (eClr) {}
            }
        }
        log("Cleared project/in/sound/ contents (" + removedCount + " item(s) removed)");
    }

    // Import the folder (as a folder). If direct import fails, do a recursive manual import fallback.
    var importedFolderItem = null;
    var importError = null;
    try {
        var io = new ImportOptions();
    io.file = new Folder(soundImportFolder.fsName);
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
    var container = createChildFolder(destForFallback, soundImportFolder.name);
    importFolderRecursive(soundImportFolder, container);
        // If at least one item was imported under container, treat it as success
        if (container && container.numItems > 0) {
            importedFolderItem = container;
            log("Imported via fallback into project/in/sound/" + container.name);
        } else {
            var emsg = "Import failed" + (importError ? (": " + (importError.message || importError)) : ".") +
                       " Path: " + soundImportFolder.fsName;
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
            if (it && it instanceof FolderItem && it.name === (soundImportFolder ? soundImportFolder.name : dateFolder.name)) { fallback = it; break; }
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

    // ————— Relink JSON data file (data_<ISO>.json -> project/in/data/data.json) —————
    if (ENABLE_RELINK_DATA_JSON) {
        try {
            function findOrCreateProjectFolder(segments) {
                var cur = proj.rootFolder;
                for (var i = 0; i < segments.length; i++) {
                    var seg = segments[i];
                    if (!seg) continue;
                    var found = null;
                    for (var j = 1; j <= cur.numItems; j++) {
                        var it = cur.items[j];
                        if (it && it instanceof FolderItem && it.name === seg) { found = it; break; }
                    }
                    if (!found) { // create
                        found = proj.items.addFolder(seg); found.parentFolder = cur;
                    }
                    cur = found;
                }
                return cur;
            }
            function findItemByNameInFolder(folderItem, name) {
                if (!folderItem) return null;
                for (var i = 1; i <= folderItem.numItems; i++) {
                    var it = folderItem.items[i];
                    if (it && it.name === name) return it;
                }
                return null;
            }
            var iso = String(DATA_JSON_ISO_CODE || "").toUpperCase(); // already auto-detected or manual fallback earlier
            var dataFolderFS = new Folder(joinPath(postFolder.fsName, joinPath(DATA_JSON_FS_SUBPATH[0], DATA_JSON_FS_SUBPATH[1])));
            var fsFile = new File(joinPath(dataFolderFS.fsName, DATA_JSON_FILE_PREFIX + iso + DATA_JSON_FILE_SUFFIX));
            if (!fsFile.exists) {
                log("[data.json] Source file not found: " + fsFile.fsName);
            } else {
                var projDataFolder = findOrCreateProjectFolder(DATA_JSON_PROJECT_FOLDER);
                var existing = findItemByNameInFolder(projDataFolder, DATA_JSON_PROJECT_ITEM_NAME);
                if (existing && existing instanceof FootageItem) {
                    // Attempt relink
                    try {
                        existing.replace(fsFile);
                        if (DATA_JSON_LOG_VERBOSE) log("[data.json] Relinked existing item to " + fsFile.fsName);
                    } catch (eRep) {
                        log("[data.json] Relink failed: " + eRep);
                    }
                } else if (DATA_JSON_IMPORT_IF_MISSING) {
                    try {
                        var ioData = new ImportOptions(fsFile);
                        var importedData = proj.importFile(ioData);
                        if (importedData) {
                            importedData.parentFolder = projDataFolder;
                            if (DATA_JSON_RENAME_IMPORTED_TO_CANONICAL) {
                                try { importedData.name = DATA_JSON_PROJECT_ITEM_NAME; } catch (eNm) {}
                            }
                            if (DATA_JSON_LOG_VERBOSE) log("[data.json] Imported new JSON: " + fsFile.fsName);
                        } else {
                            log("[data.json] Import returned null for: " + fsFile.fsName);
                        }
                    } catch (eImp) {
                        log("[data.json] Import failed: " + eImp);
                    }
                } else {
                    log("[data.json] Project item missing and import disabled.");
                }
            }
        } catch (eData) {
            log("[data.json] Unexpected error: " + eData);
        }
    }

    // Step 2: Insert audio into selected comps
    var comps = (opts && opts.comps && opts.comps.length) ? opts.comps : getSelectedComps();
    if (!comps.length) {
        log("No selected comps. Skipping audio insertion.");
        app.endUndoGroup();
        return { processed: [] };
    }

    // Collect all footage items under the imported folder (recursively)
    var allFootage = [];
    if (importedFolderItem instanceof FolderItem) {
        collectFootageItemsRecursiveFolderItem(importedFolderItem, allFootage);
    }
    var inserted = 0, missed = [];
    function __extractISOFromAudioName(name){
        // Robustly extract a 3-letter ISO token from common filename patterns.
        // Handles both: Title_06s_ENG_... and Title_NEW_06s_ENG_...
        try {
            var base = String(name||"");
            var parts = base.split(/[_\s]+/);
            if (!parts || !parts.length) return null;
            // Helper: clean token (strip extension) and upper
            function cleanTok(tok){
                var t = String(tok||"");
                // drop extension if present
                t = t.replace(/\.[^.]+$/, "");
                return t.toUpperCase();
            }
            // Find index of first duration token like NN..Ns
            var durIdx = -1;
            for (var i=0; i<parts.length; i++) {
                var p = cleanTok(parts[i]);
                if (/^\d{1,4}S$/.test(p)) { durIdx = i; break; }
            }
            // Candidates to ignore as non-ISO 3-letter tokens
            var IGNORE = { "NEW": true };
            // Prefer the first 3-letter token after duration
            if (durIdx >= 0) {
                for (var j = durIdx + 1; j < parts.length; j++) {
                    var pj = cleanTok(parts[j]);
                    if (/^[A-Z]{3}$/.test(pj) && !IGNORE[pj]) {
                        return pj;
                    }
                }
            }
            // Fallback: any standalone 3-letter token in the name (skip ignored and obvious non-ISO patterns)
            for (var k=0; k<parts.length; k++) {
                var pk = cleanTok(parts[k]);
                if (/^[A-Z]{3}$/.test(pk) && !IGNORE[pk]) {
                    return pk;
                }
            }
        } catch(eNI) {}
        return null;
    }
    function __getProjectISO(){
        // Prefer Step 1 result
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) return String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(e1){}
        try { if (DATA_JSON_ISO_CODE) return String(DATA_JSON_ISO_CODE).toUpperCase(); } catch(e2){}
        return null;
    }

    for (var ci = 0; ci < comps.length; ci++) {
        var comp = comps[ci];
        var tokenPair = getTokenPairFromCompName(comp.name);
        if (!tokenPair) {
            missed.push(comp.name + " (no tokens)");
            continue;
        }
    var match = pickBestAudioMatch(allFootage, tokenPair);
        if (!match) {
            missed.push(comp.name + " (no audio for '" + tokenPair + "')");
            continue;
        }
        // Optional: validate ISO token in audio filename
        if (ENABLE_CHECK_AUDIO_ISO) {
            var audioISO = __extractISOFromAudioName(match.name);
            var projectISO = __getProjectISO();
            if (projectISO && audioISO && audioISO !== projectISO) {
                var msg = "Audio ISO mismatch: audio='" + audioISO + "' vs project='" + projectISO + "' (comp='" + comp.name + "', file='" + match.name + "')";
                if (CHECK_AUDIO_ISO_STRICT) {
                    // Log as warning as well for consistent tagging
                    log("[warn] " + msg);
                    // Mark fatal for pipeline orchestrator and force a visible alert even in pipeline mode
                    try { if (__AE_PIPE__) { __AE_PIPE__.__fatal = msg; } } catch(eF) {}
                    alertAlways(msg);
                    app.endUndoGroup();
                    return { processed: [] };
                } else {
                    log("[warn] " + msg);
                }
            }
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

            // Step 3: Optionally remove existing audio-only footage layers (takes precedence over mute)
            if (ENABLE_REMOVE_EXISTING_AUDIO_LAYERS) {
                for (var r = comp.numLayers; r >= 1; r--) {
                    var rl = comp.layer(r);
                    if (rl === layer) continue;
                    try {
                        if (isAudioFootageLayer(rl)) {
                            rl.remove();
                        }
                    } catch (eRem) {}
                }
            } if (ENABLE_MUTE_EXISTING_AUDIO_LAYERS) {
                // Step 4: Mute any other audio-capable layers (including precomps with audio)
                for (var li = 1; li <= comp.numLayers; li++) {
                    var ly = comp.layer(li);
                    if (ly === layer) continue;
                    try {
                        var hasAud2 = false;
                        try { hasAud2 = !!ly.hasAudio; } catch (eHA2) { hasAud2 = (ly.audioEnabled !== undefined); }
                        if (hasAud2 && ly.audioEnabled !== undefined) {
                            ly.audioEnabled = false;
                        }
                    } catch (eMute2) {}
                }
            }
        } catch (eIns) {
            missed.push(comp.name + " (insert failed: " + (eIns && eIns.message ? eIns.message : eIns) + ")");
        }
    }

    var summary = "Audio insert: " + inserted + " added" + (missed.length ? ", missed: " + missed.length : "");
    log(summary + (missed.length ? "\n- " + missed.join("\n- ") : ""));
    alertOnce(summary);
    app.endUndoGroup();
    return { processed: comps };
}

AE_InsertRelink.run = function(opts) { return __InsertRelink_coreRun(opts || {}); };

// Standalone auto-run only when not in pipeline
if (!__AE_PIPE__) {
    (function importNewestSoundFolderAndInsert_IIFE(){ __InsertRelink_coreRun({}); })();
}
