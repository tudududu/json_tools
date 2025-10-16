// AE Pipeline Phase — Link Data (data.json relink + ISO detection)
// Extracted from insert_and_relink_footage.jsx — can run standalone or in pipeline

var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_LinkData === 'undefined') { var AE_LinkData = {}; }

function __LinkData_coreRun(opts) {
    app.beginUndoGroup("Link data.json");

    // logger: route through pipeline logger when available so messages land in the pipeline file log
    var __logger = null;
    try {
        if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') {
            // ensure baseLogFn is set to pipeline log to avoid silent logs
            __logger = __AE_PIPE__.getLogger('link_data', { baseLogFn: __AE_PIPE__.log, forwardToPipeline: false, withTimestamps: false });
        }
    } catch(eLG) {}
    function log(msg) { if (__logger) { try { __logger.info(msg); } catch(e){} return; } try { $.writeln(msg); } catch(e2) {} }
    function alertOnce(msg){ if (__AE_PIPE__) { log(msg); return; } try { alert(msg); } catch(e){} }

    var proj = app.project;
    if (!proj || !proj.file) { alertOnce("Please save the project under POST/WORK before running."); app.endUndoGroup(); return { ok:false }; }

    // Options: read from opts.options or pipeline defaults (linkData), fallback to insertRelink keys for compatibility
    var o = (opts && opts.options) ? opts.options : null;
    var eff = (__AE_PIPE__ && __AE_PIPE__.optionsEffective) ? __AE_PIPE__.optionsEffective : {};
    var oPhase = (o && o.linkData) ? o.linkData : (eff.linkData || {});
    // Back-compat: allow using insertRelink.* overrides too
    var oCompat = (o && o.insertRelink) ? o.insertRelink : (eff.insertRelink || {});

    function pick(key, def) {
        if (oPhase && oPhase.hasOwnProperty(key)) return oPhase[key];
        if (o && o.hasOwnProperty(key)) return o[key];
        if (oCompat && oCompat.hasOwnProperty(key)) return oCompat[key];
        return def;
    }

    var ENABLE_RELINK_DATA_JSON = !!pick('ENABLE_RELINK_DATA_JSON', true);
    var DATA_JSON_ISO_MODE = String(pick('DATA_JSON_ISO_MODE', 'manual'));     // 'auto' | 'manual'
    var DATA_JSON_ISO_CODE_MANUAL = String(pick('DATA_JSON_ISO_CODE_MANUAL', 'SAU'));
    var DATA_JSON_PROJECT_FOLDER = pick('DATA_JSON_PROJECT_FOLDER', ['project','in','data']);
    var DATA_JSON_PROJECT_ITEM_NAME = String(pick('DATA_JSON_PROJECT_ITEM_NAME', 'data.json'));
    var DATA_JSON_FS_SUBPATH = pick('DATA_JSON_FS_SUBPATH', ['IN','data']);   // under POST
    var DATA_JSON_FILE_PREFIX = String(pick('DATA_JSON_FILE_PREFIX', 'data_'));
    var DATA_JSON_FILE_SUFFIX = String(pick('DATA_JSON_FILE_SUFFIX', '.json'));
    var DATA_JSON_IMPORT_IF_MISSING = !!pick('DATA_JSON_IMPORT_IF_MISSING', true);
    var DATA_JSON_RENAME_IMPORTED_TO_CANONICAL = !!pick('DATA_JSON_RENAME_IMPORTED_TO_CANONICAL', true);
    var DATA_JSON_LOG_VERBOSE = !!pick('DATA_JSON_LOG_VERBOSE', true);

    if (!ENABLE_RELINK_DATA_JSON) { log("[data.json] disabled by options"); app.endUndoGroup(); return { ok:true, relinked:false, imported:false }; }

    // Resolve POST folder from project path
    var workFolder = proj.file.parent;           // .../POST/WORK
    var postFolder = workFolder ? workFolder.parent : null; // .../POST
    if (!postFolder || !postFolder.exists) { alertOnce("Could not resolve POST folder from project path (expected project under POST/WORK)." ); app.endUndoGroup(); return { ok:false }; }

    // Helpers
    function joinPath(a, b) {
        if (!a) return b || "";
        if (!b) return a || "";
        var sep = (/\\$/.test(a) || /\/$/.test(a)) ? "" : "/";
        return a + sep + b;
    }
    function findOrCreateProjectFolder(segments) {
        var cur = proj.rootFolder;
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i]; if (!seg) continue;
            var found = null;
            for (var j = 1; j <= cur.numItems; j++) {
                var it = cur.items[j];
                if (it && it instanceof FolderItem && it.name === seg) { found = it; break; }
            }
            if (!found) { found = proj.items.addFolder(seg); found.parentFolder = cur; }
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

    // Auto-detect ISO from parent of POST folder (same logic as insert_and_relink_footage.jsx)
    var DATA_JSON_ISO_CODE = null;
    var __isoOrigin = "manual";
    if (DATA_JSON_ISO_MODE !== "manual") {
        var parentOfPost = postFolder ? postFolder.parent : null;
        if (parentOfPost && parentOfPost.exists) {
            var parentNameRaw = parentOfPost.name || "";
            var decodedName = parentNameRaw;
            try { decodedName = decodeURIComponent(parentNameRaw); } catch (eDec) { decodedName = parentNameRaw.replace(/%20/g, ' '); }
            if (decodedName === parentNameRaw && /%[0-9A-Fa-f]{2}/.test(parentNameRaw)) {
                decodedName = parentNameRaw.replace(/%([0-9A-Fa-f]{2})/g, function(m,h){ try { return String.fromCharCode(parseInt(h,16)); } catch(eC){ return m; } });
            }
            var normalizedName = decodedName.replace(/\s+/g,' ').replace(/\s*-\s*/,' - ').replace(/^\s+|\s+$/g,'');
            if (DATA_JSON_LOG_VERBOSE) {
                log("[data.json] Parent of POST folder name (raw): '" + parentNameRaw + "'");
                if (parentNameRaw !== decodedName) log("[data.json] Decoded name: '" + decodedName + "'");
                if (decodedName !== normalizedName) log("[data.json] Normalized name: '" + normalizedName + "'");
            }
            var workName = normalizedName || decodedName || parentNameRaw;
            var mIso = null;
            var m1 = workName.match(/-\s*([A-Za-z]{3})$/);
            if (m1) mIso = m1;
            if (!mIso) {
                var parts = workName.split(/[\s_]+/);
                if (parts.length) {
                    var last = parts[parts.length - 1];
                    if (/^[A-Za-z]{3}$/.test(last)) mIso = [null, last];
                }
            }
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
                if (DATA_JSON_LOG_VERBOSE) log("[data.json] Auto-detected ISO from parent folder: " + DATA_JSON_ISO_CODE);
            } else {
                if (DATA_JSON_LOG_VERBOSE) log("[data.json] Could not auto-detect ISO from parent folder; will use manual fallback.");
            }
        }
    }
    if (!DATA_JSON_ISO_CODE) {
        DATA_JSON_ISO_CODE = (DATA_JSON_ISO_CODE_MANUAL || "XXX").toUpperCase();
        __isoOrigin = (DATA_JSON_ISO_MODE === "manual") ? "manual(forced)" : "manual(fallback)";
    }
    if (DATA_JSON_LOG_VERBOSE) log("[data.json] ISO code used: " + DATA_JSON_ISO_CODE + " (" + __isoOrigin + ")");

    // Build FS path to data_<ISO>.json
    var sub0 = DATA_JSON_FS_SUBPATH && DATA_JSON_FS_SUBPATH.length ? DATA_JSON_FS_SUBPATH[0] : "IN";
    var sub1 = DATA_JSON_FS_SUBPATH && DATA_JSON_FS_SUBPATH.length > 1 ? DATA_JSON_FS_SUBPATH[1] : "data";
    var dataFolderFS = new Folder(joinPath(postFolder.fsName, joinPath(sub0, sub1)));
    var fsFile = new File(joinPath(dataFolderFS.fsName, DATA_JSON_FILE_PREFIX + DATA_JSON_ISO_CODE + DATA_JSON_FILE_SUFFIX));
    if (!fsFile.exists) {
        log("[data.json] Source file not found: " + fsFile.fsName);
        app.endUndoGroup();
        return { ok:true, relinked:false, imported:false, iso:DATA_JSON_ISO_CODE, origin:__isoOrigin, projectItem:null };
    }

    // Ensure AE project folder exists
    var projDataFolder = findOrCreateProjectFolder(DATA_JSON_PROJECT_FOLDER);
    var existing = findItemByNameInFolder(projDataFolder, DATA_JSON_PROJECT_ITEM_NAME);
    var relinked = false, imported = false, projectItem = null;

    if (existing && existing instanceof FootageItem) {
        try { existing.replace(fsFile); relinked = true; projectItem = existing; if (DATA_JSON_LOG_VERBOSE) log("[data.json] Relinked existing item to " + fsFile.fsName); }
        catch (eRep) { log("[data.json] Relink failed: " + eRep); }
    } else if (DATA_JSON_IMPORT_IF_MISSING) {
        try {
            var ioData = new ImportOptions(fsFile);
            var importedData = proj.importFile(ioData);
            if (importedData) {
                importedData.parentFolder = projDataFolder;
                if (DATA_JSON_RENAME_IMPORTED_TO_CANONICAL) { try { importedData.name = DATA_JSON_PROJECT_ITEM_NAME; } catch(eNm){} }
                imported = true; projectItem = importedData;
                if (DATA_JSON_LOG_VERBOSE) log("[data.json] Imported new JSON: " + fsFile.fsName);
            } else {
                log("[data.json] Import returned null for: " + fsFile.fsName);
            }
        } catch (eImp) { log("[data.json] Import failed: " + eImp); }
    } else {
        log("[data.json] Project item missing and import disabled.");
    }

    var summary = "[data.json] Link summary: iso=" + DATA_JSON_ISO_CODE + " origin=" + __isoOrigin + " relinked=" + relinked + " imported=" + imported;
    log(summary);
    if (!__AE_PIPE__) { try { alert(summary); } catch(eA){} }

    app.endUndoGroup();
    return { ok:true, relinked:relinked, imported:imported, iso:DATA_JSON_ISO_CODE, origin:__isoOrigin, projectItem:projectItem };
}

AE_LinkData.run = function(opts) { return __LinkData_coreRun(opts || {}); };

// Standalone run
if (!__AE_PIPE__) { (function(){ __LinkData_coreRun({}); })(); }
