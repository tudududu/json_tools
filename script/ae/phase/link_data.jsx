// AE Pipeline Phase — Link Data (data.json relink + ISO detection)
// Extracted from insert_and_relink_footage.jsx — can run standalone or in pipeline

var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_LinkData === 'undefined') { var AE_LinkData = {}; }

AE_LinkData.run = function(opts){
    var proj = app.project;
    if (!proj) { try { alert("No project open."); } catch(e) {} return { linked:false }; }
    if (!proj.file) { try { alert("Please save the project under POST/WORK before running."); } catch(e) {} return { linked:false }; }

    var __logger = null;
    try { if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') { __logger = __AE_PIPE__.getLogger('link_data'); } } catch(eLG) {}
    function log(msg){ if(__logger){ try{ __logger.info(msg); }catch(e){} return;} try{ $.writeln(msg);}catch(e2){} }

    function joinPath(a,b){ if(!a) return b||""; if(!b) return a||""; var sep=(/\\$/.test(a)||/\/$/.test(a))?"":"/"; return a+sep+b; }

    // Defaults (mirroring insert_and_relink_footage.jsx)
    var ENABLE_RELINK_DATA_JSON = true;
    var DATA_JSON_ISO_CODE_MANUAL = "SAU";
    var DATA_JSON_ISO_CODE = null;
    var DATA_JSON_ISO_MODE = "manual"; // "auto" or "manual"
    var DATA_JSON_PROJECT_FOLDER = ["project","in","data"];
    var DATA_JSON_PROJECT_ITEM_NAME = "data.json";
    var DATA_JSON_FS_SUBPATH = ["IN","data"]; // under POST
    var DATA_JSON_FILE_PREFIX = "data_";
    var DATA_JSON_FILE_SUFFIX = ".json";
    var DATA_JSON_IMPORT_IF_MISSING = true;
    var DATA_JSON_RENAME_IMPORTED_TO_CANONICAL = true;
    var DATA_JSON_LOG_VERBOSE = true;

    try{
        var o = opts && opts.options ? opts.options : null;
        if(o){
            if (o.ENABLE_RELINK_DATA_JSON !== undefined) ENABLE_RELINK_DATA_JSON = !!o.ENABLE_RELINK_DATA_JSON;
            if (o.hasOwnProperty('DATA_JSON_ISO_MODE')) DATA_JSON_ISO_MODE = String(o.DATA_JSON_ISO_MODE);
            if (o.hasOwnProperty('DATA_JSON_ISO_CODE_MANUAL')) DATA_JSON_ISO_CODE_MANUAL = String(o.DATA_JSON_ISO_CODE_MANUAL);
            if (o.DATA_JSON_PROJECT_FOLDER) DATA_JSON_PROJECT_FOLDER = o.DATA_JSON_PROJECT_FOLDER;
            if (o.DATA_JSON_PROJECT_ITEM_NAME) DATA_JSON_PROJECT_ITEM_NAME = String(o.DATA_JSON_PROJECT_ITEM_NAME);
            if (o.DATA_JSON_IMPORT_IF_MISSING !== undefined) DATA_JSON_IMPORT_IF_MISSING = !!o.DATA_JSON_IMPORT_IF_MISSING;
            if (o.DATA_JSON_RENAME_IMPORTED_TO_CANONICAL !== undefined) DATA_JSON_RENAME_IMPORTED_TO_CANONICAL = !!o.DATA_JSON_RENAME_IMPORTED_TO_CANONICAL;
            if (o.DATA_JSON_LOG_VERBOSE !== undefined) DATA_JSON_LOG_VERBOSE = !!o.DATA_JSON_LOG_VERBOSE;
        }
    }catch(eOpt){}

    var workFolder = proj.file.parent; // .../POST/WORK
    var postFolder = workFolder ? workFolder.parent : null; // .../POST
    if (!postFolder || !postFolder.exists) { log("Cannot resolve POST folder from project path."); return { linked:false }; }

    // ISO auto-detect from parent of POST
    var __isoOrigin = "manual";
    var parentOfPost = postFolder ? postFolder.parent : null;
    if (DATA_JSON_ISO_MODE !== "manual") {
        if (parentOfPost && parentOfPost.exists) {
            var parentNameRaw = parentOfPost.name || "";
            var decodedName = parentNameRaw;
            try { decodedName = decodeURIComponent(parentNameRaw); } catch (eDec) { decodedName = parentNameRaw.replace(/%20/g,' ');}            
            if (decodedName === parentNameRaw && /%[0-9A-Fa-f]{2}/.test(parentNameRaw)) {
                decodedName = parentNameRaw.replace(/%([0-9A-Fa-f]{2})/g, function(m,h){ try{ return String.fromCharCode(parseInt(h,16)); }catch(eC){ return m; } });
            }
            var normalizedName = decodedName.replace(/\s+/g,' ').replace(/\s*-\s*/, ' - ').replace(/^\s+|\s+$/g,'');
            if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) {
                log("[data.json] Parent of POST folder name (raw): '" + parentNameRaw + "'");
                if (parentNameRaw !== decodedName) log("[data.json] Decoded name: '" + decodedName + "'");
                if (decodedName !== normalizedName) log("[data.json] Normalized name: '" + normalizedName + "'");
            }
            var workName = normalizedName || decodedName || parentNameRaw;
            var mIso = null;
            var m1 = workName.match(/-\s*([A-Za-z]{3})$/);
            if (m1) mIso = m1;
            if (!mIso) {
                var parts = workName.split(/[\s_]+/); if (parts.length) { var last = parts[parts.length-1]; if (/^[A-Za-z]{3}$/.test(last)) mIso = [null,last]; }
            }
            if (!mIso) {
                var dashParts = workName.split('-'); if (dashParts.length>=2) { var cand = dashParts[dashParts.length-1].replace(/\s+/g,''); if (/^[A-Za-z]{3}$/.test(cand)) mIso = [null,cand]; }
            }
            if (mIso && mIso[1]) { DATA_JSON_ISO_CODE = mIso[1].toUpperCase(); __isoOrigin = "auto"; if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) log("[data.json] Auto-detected ISO from parent folder: " + DATA_JSON_ISO_CODE); }
            else { if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) log("[data.json] Could not auto-detect ISO; will use manual fallback."); }
        }
    }
    if (!DATA_JSON_ISO_CODE) { DATA_JSON_ISO_CODE = (DATA_JSON_ISO_CODE_MANUAL||"XXX").toUpperCase(); __isoOrigin = (DATA_JSON_ISO_MODE==="manual")?"manual(forced)":"manual(fallback)"; }
    if (ENABLE_RELINK_DATA_JSON && DATA_JSON_LOG_VERBOSE) { log("[data.json] ISO code used: " + DATA_JSON_ISO_CODE + " (" + __isoOrigin + ")"); }

    if (!ENABLE_RELINK_DATA_JSON) return { linked:false, iso: DATA_JSON_ISO_CODE };

    // Project folder helpers
    function findOrCreateProjectFolder(segments){ var cur = proj.rootFolder; for (var i=0;i<segments.length;i++){ var seg = segments[i]; if(!seg) continue; var found=null; for (var j=1;j<=cur.numItems;j++){ var it=cur.items[j]; if (it && it instanceof FolderItem && it.name===seg){ found=it; break; } } if(!found){ found=proj.items.addFolder(seg); found.parentFolder=cur; } cur=found; } return cur; }
    function findItemByNameInFolder(folderItem, name){ if(!folderItem) return null; for(var i=1;i<=folderItem.numItems;i++){ var it=folderItem.items[i]; if(it && it.name===name) return it; } return null; }

    var dataFolderFS = new Folder(joinPath(postFolder.fsName, joinPath(DATA_JSON_FS_SUBPATH[0], DATA_JSON_FS_SUBPATH[1])));
    var fsFile = new File(joinPath(dataFolderFS.fsName, DATA_JSON_FILE_PREFIX + DATA_JSON_ISO_CODE + DATA_JSON_FILE_SUFFIX));
    if (!fsFile.exists) {
        log("[data.json] Source file not found: " + fsFile.fsName);
        return { linked:false, iso: DATA_JSON_ISO_CODE };
    }
    var projDataFolder = findOrCreateProjectFolder(DATA_JSON_PROJECT_FOLDER);
    var existing = findItemByNameInFolder(projDataFolder, DATA_JSON_PROJECT_ITEM_NAME);
    if (existing && existing instanceof FootageItem) {
        try { existing.replace(fsFile); if (DATA_JSON_LOG_VERBOSE) log("[data.json] Relinked existing item to " + fsFile.fsName); }
        catch(eRep){ log("[data.json] Relink failed: " + eRep); }
    } else if (DATA_JSON_IMPORT_IF_MISSING) {
        try { var ioData = new ImportOptions(fsFile); var importedData = proj.importFile(ioData); if (importedData) { importedData.parentFolder = projDataFolder; if (DATA_JSON_RENAME_IMPORTED_TO_CANONICAL) { try { importedData.name = DATA_JSON_PROJECT_ITEM_NAME; } catch(eNm) {} } if (DATA_JSON_LOG_VERBOSE) log("[data.json] Imported new JSON: " + fsFile.fsName); } else { log("[data.json] Import returned null for: " + fsFile.fsName); } }
        catch(eImp){ log("[data.json] Import failed: " + eImp); }
    } else {
        log("[data.json] Project item missing and import disabled.");
    }

    return { linked:true, iso: DATA_JSON_ISO_CODE };
};

// Standalone run
if (!__AE_PIPE__) { (function(){ AE_LinkData.run({}); })(); }
