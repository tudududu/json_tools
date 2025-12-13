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
// (data.json relink logic moved to Step 1: link_data.jsx; removed here)
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

    // File filters to avoid importing system/hidden or non-audio files (e.g., .DS_Store)
    function __isHiddenOrSystemName(nm) {
        var n = String(nm||"");
        if (!n) return false;
        // macOS and Windows common metadata files
        if (n.charAt(0) === '.') return true; // .DS_Store, ._ResourceFork, etc.
        var low = n.toLowerCase();
        if (low === 'thumbs.db' || low === 'desktop.ini') return true;
        return false;
    }
    function __isAllowedAudioFsName(nm) {
        var low = String(nm||"").toLowerCase();
        return /\.(wav|aif|aiff|mp3|m4a|aac|ogg)$/.test(low);
    }

    // Settings
    var ENABLE_ALIGN_AUDIO_TO_MARKERS = false; // Set true to align audio start to first comp marker; false = place at 0s
    var ENABLE_REMOVE_EXISTING_AUDIO_LAYERS = true; // When true, remove all pre-existing audio-only layers (FootageItem with audio, no video) after inserting the new one
    var ENABLE_MUTE_EXISTING_AUDIO_LAYERS = true; // When true (and removal is false), mute (audioEnabled=false) on any other audio-capable layers
    var CLEAR_EXISTING_PROJECT_SOUND_FOLDER = true; // When true, BEFORE importing, clear AE Project panel folder project/in/sound/ (its contents only)
    // When true, import from ISO-named subfolder under SOUND/<YYMMDD>/ matching the project ISO
    var SOUND_USE_ISO_SUBFOLDER = false;
    // Manual audio ISO/LANG fallback for standalone (non-pipeline) execution
    var AUDIO_ISO_MANUAL = "SAU";   // Change as needed when running outside pipeline
    var AUDIO_LANG_MANUAL = null;    // e.g., "FRA" if language-specific filtering desired standalone
    // New: audio filename ISO check options
    var ENABLE_CHECK_AUDIO_ISO = false;            // Phase 1: toggle checking
    var CHECK_AUDIO_ISO_STRICT = false;            // Phase 2: strict mode => alert + abort pipeline
    // Flat-mode fallback: if no top-level files in YYMMDD and enabled, try ISO-named subfolder
    var SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER = false;
    // Flat-mode strict: if no top-level files and ISO subfolder is not available, abort pipeline
    var SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER = false;
    // New: configurable title token count (1–4) required immediately before duration for audio matching
    var AUDIO_TITLE_TOKEN_COUNT = 2; // default keeps backward compatibility (token01_token02_duration)
    // New: optional strict adjacency for tokens (require tokens to appear contiguously with underscores before duration)
    var AUDIO_TOKENS_REQUIRE_ADJACENT = false; // default false preserves lenient matching

    // Options overrides
    try {
        var o = opts && opts.options ? opts.options : null;
        if (o) {
            if (o.ENABLE_FILE_LOG !== undefined) ENABLE_FILE_LOG = !!o.ENABLE_FILE_LOG;
            if (o.ENABLE_ALIGN_AUDIO_TO_MARKERS !== undefined) ENABLE_ALIGN_AUDIO_TO_MARKERS = !!o.ENABLE_ALIGN_AUDIO_TO_MARKERS;
            if (o.ENABLE_REMOVE_EXISTING_AUDIO_LAYERS !== undefined) ENABLE_REMOVE_EXISTING_AUDIO_LAYERS = !!o.ENABLE_REMOVE_EXISTING_AUDIO_LAYERS;
            if (o.ENABLE_MUTE_EXISTING_AUDIO_LAYERS !== undefined) ENABLE_MUTE_EXISTING_AUDIO_LAYERS = !!o.ENABLE_MUTE_EXISTING_AUDIO_LAYERS;
            if (o.CLEAR_EXISTING_PROJECT_SOUND_FOLDER !== undefined) CLEAR_EXISTING_PROJECT_SOUND_FOLDER = !!o.CLEAR_EXISTING_PROJECT_SOUND_FOLDER;
            if (o.ENABLE_CHECK_AUDIO_ISO !== undefined) ENABLE_CHECK_AUDIO_ISO = !!o.ENABLE_CHECK_AUDIO_ISO;
            if (o.CHECK_AUDIO_ISO_STRICT !== undefined) CHECK_AUDIO_ISO_STRICT = !!o.CHECK_AUDIO_ISO_STRICT;
            if (o.SOUND_USE_ISO_SUBFOLDER !== undefined) SOUND_USE_ISO_SUBFOLDER = !!o.SOUND_USE_ISO_SUBFOLDER;
            if (o.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER !== undefined) SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER = !!o.SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER;
            if (o.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER !== undefined) SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER = !!o.SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER;
            if (typeof o.AUDIO_TITLE_TOKEN_COUNT === 'number') {
                var nt = Math.floor(o.AUDIO_TITLE_TOKEN_COUNT);
                if (nt < 1) nt = 1; if (nt > 4) nt = 4; AUDIO_TITLE_TOKEN_COUNT = nt;
            }
            if (o.AUDIO_TOKENS_REQUIRE_ADJACENT !== undefined) AUDIO_TOKENS_REQUIRE_ADJACENT = !!o.AUDIO_TOKENS_REQUIRE_ADJACENT;
        }
        try { if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASE_FILE_LOGS_MASTER_ENABLE === false) { ENABLE_FILE_LOG = false; } } catch(eMSIR) {}
        // Allow pipeline-global override for token count and adjacency when provided
        try {
            if (__AE_PIPE__ && __AE_PIPE__.optionsEffective) {
                var pe = __AE_PIPE__.optionsEffective;
                if (typeof pe.AUDIO_TITLE_TOKEN_COUNT === 'number') {
                    var nt2 = Math.floor(pe.AUDIO_TITLE_TOKEN_COUNT);
                    if (nt2 < 1) nt2 = 1; if (nt2 > 4) nt2 = 4; AUDIO_TITLE_TOKEN_COUNT = nt2;
                }
                if (pe.AUDIO_TOKENS_REQUIRE_ADJACENT !== undefined) AUDIO_TOKENS_REQUIRE_ADJACENT = !!pe.AUDIO_TOKENS_REQUIRE_ADJACENT;
            }
        } catch(ePipeTok) {}
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

    function importFolderRecursive(fsFolder, aeParentFolder, expectedISO, expectedLANG) {
        // Recursively import files and subfolders under fsFolder into AE under aeParentFolder
        if (!fsFolder || !fsFolder.exists) return;
        var entries = fsFolder.getFiles();
        var importedCnt = 0, skippedCnt = 0;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry instanceof Folder) {
                var childAEFolder = createChildFolder(aeParentFolder, entry.name);
                importFolderRecursive(entry, childAEFolder, expectedISO, expectedLANG);
            } else if (entry instanceof File) {
                // Skip hidden/system files and non-audio files to avoid AE errors (e.g., .DS_Store)
                if (__isHiddenOrSystemName(entry.name) || !__isAllowedAudioFsName(entry.name)) {
                    continue;
                }
                // Optional token filter: only import files that match expected ISO or ISO_LANG
                var okByToken = true;
                try {
                    if (expectedISO) {
                        var at = __extractISOLangAfterDuration(entry.name);
                        if (expectedLANG) {
                            okByToken = (at && at.iso === String(expectedISO).toUpperCase() && at.lang === String(expectedLANG).toUpperCase());
                        } else {
                            // STRICT ISO-only: require ISO match and no LANG token
                            okByToken = (at && at.iso === String(expectedISO).toUpperCase() && !at.lang);
                        }
                    }
                } catch(__tokRec) { okByToken = true; }
                if (!okByToken) { skippedCnt++; continue; }
                try {
                    var ioFile = new ImportOptions(entry);
                    try { if (typeof ImportAsType !== 'undefined' && ImportAsType && ImportAsType.FOOTAGE !== undefined) { ioFile.importAs = ImportAsType.FOOTAGE; } } catch(eIAS1) {}
                    var imported = proj.importFile(ioFile);
                    if (imported) { imported.parentFolder = aeParentFolder; importedCnt++; }
                } catch (eFile) {
                    log("Skip file '" + entry.fsName + "' (" + (eFile && eFile.message ? eFile.message : eFile) + ")");
                }
            }
        }
        try {
            if (expectedISO) {
                var tag = expectedISO + (expectedLANG ? ("_"+expectedLANG) : "");
                var strictNote = expectedLANG ? "" : " (strict ISO-only)";
                log("Imported recursive: matched '"+tag+"' => " + importedCnt + " file(s), skipped " + skippedCnt + "." + strictNote);
            }
        } catch(__tokLog) {}
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

    function getTokensBeforeDuration(name, count) {
        // Extract N title tokens immediately before duration and the duration token
        var base = String(name || "");
        var parts = base.split(/[_\s]+/);
        if (!parts.length) return null;
        var durIdx = -1;
        for (var i = 0; i < parts.length; i++) { if (/^\d{1,4}s$/i.test(parts[i])) { durIdx = i; break; } }
        if (durIdx === -1) return null;
        var duration = parts[durIdx];
        var need = Math.max(1, Math.min(4, Math.floor(count||1)));
        var tokens = [];
        for (var k = 1; k <= need; k++) {
            var idx = durIdx - k;
            if (idx < 0) { return null; }
            tokens.unshift(parts[idx]);
        }
        return { tokens: tokens, duration: duration };
    }

    function parseDurationToken(tok) {
        if (!tok) return null;
        var m = String(tok).match(/^(\d{1,4})s$/i);
        if (!m) return null;
        return parseInt(m[1], 10);
    }

    function pickBestAudioMatch(items, tok) {
        // Filter items whose names contain N title tokens in order before the same duration (case-insensitive) and that have audio
        var matches = [];
        if (!tok || !tok.tokens || !tok.tokens.length || !tok.duration) return null;
        var durNum = parseDurationToken(tok.duration);
        if (durNum === null) return null;
        var norms = [];
        for (var ni=0; ni<tok.tokens.length; ni++) norms.push(normalizeForMatch(tok.tokens[ni]));
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var nameNorm = normalizeForMatch(it.name);
            var hit = false;
            var pos = 0; var ok = true;
            for (var ti=0; ti<norms.length; ti++) {
                var tnorm = norms[ti];
                var found = nameNorm.indexOf(tnorm, pos);
                if (found === -1) { ok = false; break; }
                if (AUDIO_TOKENS_REQUIRE_ADJACENT && ti < norms.length - 1) {
                    var after = found + tnorm.length;
                    if (nameNorm.charAt(after) !== '_') { ok = false; break; }
                    pos = after + 1;
                } else {
                    pos = found + tnorm.length;
                }
            }
            if (ok) {
                var tail = nameNorm.substring(pos);
                var re = /(\d{1,4})s/gi; var m;
                while ((m = re.exec(tail)) !== null) {
                    var nn = parseInt(m[1], 10);
                    if (!isNaN(nn) && nn === durNum) { hit = true; break; }
                }
            }
            if (hit) {
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

    // (Removed parent folder ISO auto-detection; rely on pipeline or manual audio constants)

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

    // Audit hint: echo expected audio token
    try {
        var __auditISO = null, __auditLANG = null;
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) __auditISO = String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(_al1){}
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) __auditLANG = String(__AE_PIPE__.results.linkData.lang).toUpperCase(); } catch(_al2){}
        if (!__auditISO && AUDIO_ISO_MANUAL) { __auditISO = String(AUDIO_ISO_MANUAL).toUpperCase(); }
        if (__auditISO) {
            if (__auditLANG) log("Expecting AUDIO token: ISO_LANG=" + __auditISO + "_" + __auditLANG);
            else log("Expecting AUDIO token: ISO=" + __auditISO);
        }
    } catch(_alAny){}

    // Determine actual folder to import (optionally pick ISO[/LANG] subfolder)
    var soundImportFolder = dateFolder;
    if (SOUND_USE_ISO_SUBFOLDER) {
        var __projISO = null, __projLANG = null;
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) __projISO = String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(ePI) {}
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) __projLANG = String(__AE_PIPE__.results.linkData.lang).toUpperCase(); } catch(ePL) {}
        if (!__projISO && AUDIO_ISO_MANUAL) { __projISO = String(AUDIO_ISO_MANUAL).toUpperCase(); }
        if (__projISO) {
            var subs = dateFolder.getFiles(function(f){ return f instanceof Folder; });
            var matched = null;
            var candidates = [];
            if (__projLANG) candidates.push(__projISO + "_" + __projLANG);
            candidates.push(__projISO);
            // First pass: exact match against candidates
            for (var c=0; c<candidates.length && !matched; c++) {
                var want = candidates[c];
                for (var s=0; s<subs.length; s++) {
                    var nm = String(subs[s].name||"").toUpperCase();
                    if (nm === want) { matched = subs[s]; break; }
                }
            }
            if (matched) {
                soundImportFolder = matched;
                log("Using SOUND subfolder: '" + matched.name + "'");
            } else {
                var wantStr = candidates.join(" or ");
                log("[warn] ISO subfolder '" + wantStr + "' not found under " + dateFolder.fsName + "; importing from date folder.");
            }
        } else {
            log("[warn] Project ISO unavailable; cannot select ISO/ISO_LANG subfolder. Importing from date folder.");
        }
    }

    // One-line summary to tighten audit trail right after expectation line
    try { log("Using SOUND folder: " + (soundImportFolder ? soundImportFolder.fsName : "(unknown)")); } catch(__lfAny) {}

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

    // Import strategy:
    // - When SOUND_USE_ISO_SUBFOLDER=false, import ONLY top-level files from the YYMMDD folder (skip all subfolders).
    // - Otherwise (true), import the folder recursively (existing behavior).
    var importedFolderItem = null;
    var __didImportAny = false;
    if (!SOUND_USE_ISO_SUBFOLDER) {
        // Flat import (no subfolders)
        var destFlat = ensureProjectPath(["project", "in", "sound"]);
        var flatContainer = createChildFolder(destFlat, soundImportFolder.name);
        var entries = [];
        try {
            entries = soundImportFolder.getFiles(function(f){
                return (f instanceof File) && !__isHiddenOrSystemName(f.name) && __isAllowedAudioFsName(f.name);
            });
        } catch(eGF) { entries = []; }
        // Determine expected token (ISO or ISO_LANG)
        var __expectedISO = null, __expectedLANG = null;
        try { __expectedISO = __getProjectISO(); } catch(__gpi) {}
        try { __expectedLANG = __getProjectLANG(); } catch(__gpl) {}
        if (__expectedISO) {
            try {
                var __isStrict = !!CHECK_AUDIO_ISO_STRICT;
                var __strictNote = __expectedLANG ? "" : (__isStrict ? " (strict ISO-only)" : " (preferred ISO-only; lenient fallback)");
                log("Filter AUDIO by token: '" + __expectedISO + ( __expectedLANG ? ("_"+__expectedLANG) : "") + "'" + __strictNote);
            } catch(__flog) {}
        }
        var importedCount = 0, skippedCount = 0;
        for (var ei = 0; ei < entries.length; ei++) {
            var f = entries[ei];
            try {
                // Optional token filter in flat mode
                var allow = true;
                if (__expectedISO) {
                    var tk = __extractISOLangAfterDuration(f.name);
                    if (__expectedLANG) { allow = (tk && tk.iso === __expectedISO && tk.lang === __expectedLANG); }
                    else { allow = (tk && tk.iso === __expectedISO && !tk.lang); }
                }
                if (!allow) { skippedCount++; continue; }
                var ioFile = new ImportOptions(f);
                try { if (typeof ImportAsType !== 'undefined' && ImportAsType && ImportAsType.FOOTAGE !== undefined) { ioFile.importAs = ImportAsType.FOOTAGE; } } catch(eIAS2) {}
                var imported = proj.importFile(ioFile);
                if (imported) { imported.parentFolder = flatContainer; importedCount++; }
            } catch (eImpFile) {
                log("Skip file '" + f.fsName + "' (" + (eImpFile && eImpFile.message ? eImpFile.message : eImpFile) + ")");
            }
        }
        if (__expectedISO) {
            try {
                var __strictNote2 = __expectedLANG ? "" : " (strict ISO-only)";
                log("Imported flat: matched '" + __expectedISO + ( __expectedLANG ? ("_"+__expectedLANG) : "") + "' => " + importedCount + " file(s), skipped " + skippedCount + "." + __strictNote2);
            } catch(__fl2) {}
        }
        if (importedCount > 0) {
            importedFolderItem = flatContainer;
            log("Imported flat (no subfolders) into project/in/sound/" + flatContainer.name);
            __didImportAny = true;
        } else {
            // No top-level files imported; attempt ISO subfolder fallback if enabled.
            var subs2 = [];
            try { subs2 = dateFolder.getFiles(function(f){ return f instanceof Folder; }); } catch(eSubs2) { subs2 = []; }
            var didFallback = false;
            if (SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER) {
                var __projISO2 = null, __projLANG2 = null;
                try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) __projISO2 = String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(ePI2) {}
                try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) __projLANG2 = String(__AE_PIPE__.results.linkData.lang).toUpperCase(); } catch(ePL2) {}
                if (!__projISO2 && AUDIO_ISO_MANUAL) { __projISO2 = String(AUDIO_ISO_MANUAL).toUpperCase(); }
                if (__projISO2) {
                    var matched2 = null;
                    var candidates2 = [];
                    if (__projLANG2) candidates2.push(__projISO2 + "_" + __projLANG2);
                    candidates2.push(__projISO2);
                    for (var cc=0; cc<candidates2.length && !matched2; cc++) {
                        var want2 = candidates2[cc];
                        for (var s2=0; s2<subs2.length; s2++) {
                            var nm2 = String(subs2[s2].name||"").toUpperCase();
                            if (nm2 === want2) { matched2 = subs2[s2]; break; }
                        }
                    }
                    if (matched2) {
                        log("[warn] Flat import empty; falling back to ISO/ISO_LANG subfolder '" + matched2.name + "'.");
                        var destFB = ensureProjectPath(["project", "in", "sound"]);
                        var contFB = createChildFolder(destFB, matched2.name);
                        try { if (__projISO2) { var __strictNoteFB = __projLANG2 ? "" : (CHECK_AUDIO_ISO_STRICT ? " (strict ISO-only)" : " (preferred ISO-only; lenient fallback)"); log("Filter AUDIO by token: '" + __projISO2 + ( __projLANG2 ? ("_"+__projLANG2) : "") + "'" + __strictNoteFB); } } catch(__flFB) {}
                        importFolderRecursive(matched2, contFB, __projISO2, __projLANG2);
                        if (contFB && contFB.numItems > 0) {
                            importedFolderItem = contFB;
                            log("Imported via fallback into project/in/sound/" + contFB.name);
                            __didImportAny = true;
                            didFallback = true;
                        }
                    }
                }
            }
            // Lenient subfolder fallback when abort flag is false and ISO-specific subfolder absent.
            if (!didFallback && !SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER && !CHECK_AUDIO_ISO_STRICT) {
                var fallbackSub = null;
                // Prefer 'GBL'
                for (var gs=0; gs<subs2.length; gs++) { var nmG = String(subs2[gs].name||"").toUpperCase(); if (nmG === 'GBL') { fallbackSub = subs2[gs]; break; } }
                // If not GBL and exactly one subfolder, use it
                if (!fallbackSub && subs2.length === 1) fallbackSub = subs2[0];
                // Else pick first subfolder containing at least one audio file directly
                if (!fallbackSub) {
                    for (var as=0; as<subs2.length; as++) {
                        var filesTest = [];
                        try { filesTest = subs2[as].getFiles(function(f){ return f instanceof File; }); } catch(eFT) { filesTest = []; }
                        var hasAudio = false;
                        for (var ft=0; ft<filesTest.length; ft++) { if (__isAllowedAudioFsName(filesTest[ft].name)) { hasAudio = true; break; } }
                        if (hasAudio) { fallbackSub = subs2[as]; break; }
                    }
                }
                if (fallbackSub) {
                    log("[warn] ISO subfolder not found; lenient fallback to subfolder '" + fallbackSub.name + "' (importing all audio, mismatch warnings expected)." );
                    var destLF = ensureProjectPath(["project", "in", "sound"]);
                    var contLF = createChildFolder(destLF, fallbackSub.name);
                    importFolderRecursive(fallbackSub, contLF, null, null); // import all audio in fallback
                    if (contLF && contLF.numItems > 0) {
                        importedFolderItem = contLF;
                        log("Imported via lenient fallback into project/in/sound/" + contLF.name);
                        __didImportAny = true;
                        didFallback = true;
                    }
                }
            }
            if (!didFallback) {
                try { flatContainer.remove(); } catch(eRm) {}
                var wantedISO = null, wantedLANG = null;
                try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) wantedISO = String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(eW1) {}
                try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) wantedLANG = String(__AE_PIPE__.results.linkData.lang).toUpperCase(); } catch(eW1b) {}
                if (!wantedISO && AUDIO_ISO_MANUAL) { wantedISO = String(AUDIO_ISO_MANUAL).toUpperCase(); }
                var emsgFlat = "No suitable audio found under: " + soundImportFolder.fsName + ".";
                if (SOUND_FLAT_FALLBACK_TO_ISO_SUBFOLDER) {
                    var wantStr2 = wantedISO ? (wantedLANG ? ("'"+wantedISO+"_"+wantedLANG+"' or '"+wantedISO+"'") : ("'"+wantedISO+"'")) : "(unknown)";
                    emsgFlat += " ISO subfolder " + wantStr2 + " not found.";
                }
                if (SOUND_FLAT_ABORT_IF_NO_ISO_SUBFOLDER || CHECK_AUDIO_ISO_STRICT) {
                    var fatalMsg = emsgFlat + " Aborting (flat-mode strict).";
                    log("[warn] " + fatalMsg);
                    try { if (__AE_PIPE__) { __AE_PIPE__.__fatal = fatalMsg; } } catch(eSetF) {}
                    alertAlways(fatalMsg);
                    app.endUndoGroup();
                    return;
                } else {
                    // Non-strict and abort disabled: warn and continue without audio (insert step will produce misses)
                    log("[warn] " + emsgFlat + " Continuing without audio.");
                }
            }
        }
    } else {
        // Recursive import using manual scan (avoid ImportOptions on Folder)
        var destForFallback = ensureProjectPath(["project", "in", "sound"]);
        var container = createChildFolder(destForFallback, soundImportFolder.name);
        // Determine expected token (ISO or ISO_LANG)
        var __expectedISO3 = null, __expectedLANG3 = null;
        try { __expectedISO3 = __getProjectISO(); } catch(__gp3) {}
        try { __expectedLANG3 = __getProjectLANG(); } catch(__gl3) {}
        if (__expectedISO3) { try { var __strictNote3 = __expectedLANG3 ? "" : (CHECK_AUDIO_ISO_STRICT ? " (strict ISO-only)" : " (preferred ISO-only; lenient fallback)"); log("Filter AUDIO by token: '" + __expectedISO3 + ( __expectedLANG3 ? ("_"+__expectedLANG3) : "") + "'" + __strictNote3); } catch(__fl3) {} }
        importFolderRecursive(soundImportFolder, container, __expectedISO3, __expectedLANG3);
        if (container && container.numItems > 0) {
            importedFolderItem = container;
            log("Imported via recursive scan into project/in/sound/" + container.name);
            __didImportAny = true;
        } else {
            // Lenient fallback for recursive mode if strict check is off
            if (__expectedISO3 && !CHECK_AUDIO_ISO_STRICT) {
                try { log("No token matches; lenient mode importing all audio recursively (will warn on insert)."); } catch(__lnr1) {}
                importFolderRecursive(soundImportFolder, container, null, null);
                if (container && container.numItems > 0) {
                    importedFolderItem = container;
                    log("Imported via recursive scan (lenient) into project/in/sound/" + container.name);
                    __didImportAny = true;
                }
            }
            if (!importedFolderItem) {
                var emsg = "Import failed. Path: " + soundImportFolder.fsName;
                alertOnce(emsg);
                log(emsg);
                try { if (__AE_PIPE__) { __AE_PIPE__.__fatal = emsg; } } catch(eFRec) {}
                app.endUndoGroup();
                return;
            }
        }
    }

    if (__didImportAny && (!importedFolderItem || !(importedFolderItem instanceof FolderItem))) {
        // AE may import top item differently; attempt to resolve by name
        var fallback = null;
        for (var k = proj.numItems; k >= 1; k--) {
            var it = proj.items[k];
            if (it && it instanceof FolderItem && it.name === (soundImportFolder ? soundImportFolder.name : dateFolder.name)) { fallback = it; break; }
        }
        importedFolderItem = fallback || importedFolderItem;
    }

    if (!importedFolderItem) {
        if (__didImportAny) {
            alertOnce("Imported folder not found in project.");
            app.endUndoGroup();
            return;
        } else {
            // Nothing imported: continue gracefully without affecting project structure
            log("[warn] No SOUND audio imported; continuing without audio.");
        }
    }

    // Move to project/in/sound (if not already placed there by fallback)
    if (__didImportAny && importedFolderItem) {
        var dest = ensureProjectPath(["project", "in", "sound"]);
        if (importedFolderItem.parentFolder !== dest) {
            importedFolderItem.parentFolder = dest;
            log("Moved imported folder '" + importedFolderItem.name + "' to project/in/sound");
        }
        alertOnce("Imported SOUND folder '" + importedFolderItem.name + "' into project/in/sound.");
    }

    // (Removed data.json relink block; handled earlier in pipeline Step 1.)

    // Step 2: Insert audio into selected comps
    var comps = (opts && opts.comps && opts.comps.length) ? opts.comps : getSelectedComps();
    if (!comps.length) {
        log("No selected comps. Skipping audio insertion.");
        app.endUndoGroup();
        return { processed: [] };
    }

    // Collect all footage items under the imported folder (recursively)
    var allFootage = [];
    if (importedFolderItem instanceof FolderItem && __didImportAny) {
        collectFootageItemsRecursiveFolderItem(importedFolderItem, allFootage);
    }
    var inserted = 0, missed = [];
    function __extractISOLangAfterDuration(name){
        // Extract ISO or ISO_LANG tokens immediately after duration token (e.g., 06s_BEL or 06s_BEL_FRA)
        try {
            var base = String(name||"");
            var parts = base.split(/[_\s]+/);
            if (!parts || !parts.length) return { iso:null, lang:null, token:null };
            function cleanTok(tok){ var t = String(tok||""); t = t.replace(/\.[^.]+$/, ""); return t.toUpperCase(); }
            var durIdx = -1;
            for (var i=0; i<parts.length; i++) { var p = cleanTok(parts[i]); if (/^\d{1,4}S$/.test(p)) { durIdx = i; break; } }
            var IGNORE = { "NEW": true };
            if (durIdx >= 0) {
                var first = null, second = null;
                if (durIdx + 1 < parts.length) {
                    var t1 = cleanTok(parts[durIdx+1]);
                    if (/^[A-Z]{3}$/.test(t1) && !IGNORE[t1]) first = t1;
                }
                if (first && durIdx + 2 < parts.length) {
                    var t2 = cleanTok(parts[durIdx+2]);
                    if (/^[A-Z]{3}$/.test(t2) && !IGNORE[t2]) second = t2;
                }
                if (first && second) { return { iso:first, lang:second, token:first+"_"+second }; }
                if (first) { return { iso:first, lang:null, token:first }; }
            }
            // Fallback: scan any 3-letter token if no duration found
            for (var k=0; k<parts.length; k++) { var pk = cleanTok(parts[k]); if (/^[A-Z]{3}$/.test(pk) && !IGNORE[pk]) { return { iso:pk, lang:null, token:pk }; } }
        } catch(eNI) {}
        return { iso:null, lang:null, token:null };
    }
    function __getProjectISO(){
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.iso) return String(__AE_PIPE__.results.linkData.iso).toUpperCase(); } catch(e1){}
        if (AUDIO_ISO_MANUAL) return String(AUDIO_ISO_MANUAL).toUpperCase();
        return null;
    }
    function __getProjectLANG(){
        try { if (__AE_PIPE__ && __AE_PIPE__.results && __AE_PIPE__.results.linkData && __AE_PIPE__.results.linkData.lang) return String(__AE_PIPE__.results.linkData.lang).toUpperCase(); } catch(eL){}
        if (AUDIO_LANG_MANUAL) return String(AUDIO_LANG_MANUAL).toUpperCase();
        return null;
    }

    for (var ci = 0; ci < comps.length; ci++) {
        var comp = comps[ci];
        var tokStruct = getTokensBeforeDuration(comp.name, AUDIO_TITLE_TOKEN_COUNT);
        if (!tokStruct) {
            missed.push(comp.name + " (no tokens)");
            try { log("[debug] insert_relink: expected title tokens before duration: " + AUDIO_TITLE_TOKEN_COUNT + " (comp '" + comp.name + "')"); } catch(eDbg1) {}
            continue;
        }
        try { log("[debug] insert_relink: matching tokens '" + tokStruct.tokens.join(',') + "' + duration '" + tokStruct.duration + "' (N=" + tokStruct.tokens.length + ") for comp '" + comp.name + "'"); } catch(eDbg2) {}
        var match = pickBestAudioMatch(allFootage, tokStruct);
        if (!match) {
            missed.push(comp.name + " (no audio for '" + tokStruct.tokens[0] + "_" + tokStruct.duration + "')");
            try { log("[debug] insert_relink: no audio for tokens=[" + tokStruct.tokens.join(',') + "], duration=" + tokStruct.duration + " (comp '" + comp.name + "')"); } catch(eDbg3) {}
            continue;
        }
        // Optional: validate ISO token in audio filename
        if (ENABLE_CHECK_AUDIO_ISO) {
            var audioTok = __extractISOLangAfterDuration(match.name); // {iso, lang, token}
            var projectISO = __getProjectISO();
            var projectLANG = __getProjectLANG();
            if (projectISO) {
                var mismatch = false;
                var reason = "";
                if (projectLANG) {
                    // Project expects ISO_LANG
                    if (!audioTok.iso) { mismatch = true; reason = "audio missing ISO token"; }
                    else if (audioTok.iso !== projectISO) { mismatch = true; reason = "ISO mismatch (audio='"+audioTok.iso+"' vs project='"+projectISO+"')"; }
                    else {
                        if (!audioTok.lang) { mismatch = true; reason = "audio missing LANG token (project='"+projectISO+"_"+projectLANG+"')"; }
                        else if (audioTok.lang !== projectLANG) { mismatch = true; reason = "LANG mismatch (audio='"+audioTok.lang+"' vs project='"+projectLANG+"')"; }
                    }
                } else {
                    // Project expects ISO only
                    if (!audioTok.iso) { mismatch = true; reason = "audio missing ISO token"; }
                    else if (audioTok.iso !== projectISO) { mismatch = true; reason = "ISO mismatch (audio='"+audioTok.iso+"' vs project='"+projectISO+"')"; }
                }
                if (mismatch) {
                    var projTag = projectISO + (projectLANG? ("_"+projectLANG) : "");
                    var audTag = audioTok.token || "(none)";
                    var msg = "Audio ISO/LANG mismatch: audio='" + audTag + "' vs project='" + projTag + "' (" + reason + ") (comp='" + comp.name + "', file='" + match.name + "')";
                    if (CHECK_AUDIO_ISO_STRICT) {
                        log("[warn] " + msg);
                        try { if (__AE_PIPE__) { __AE_PIPE__.__fatal = msg; } } catch(eF) {}
                        alertAlways(msg);
                        app.endUndoGroup();
                        return { processed: [] };
                    } else {
                        log("[warn] " + msg);
                    }
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
