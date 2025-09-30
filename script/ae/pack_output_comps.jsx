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

    // Logging configuration (added for debug visibility outside AE's internal console)
    var ENABLE_FILE_LOG = true;                 // Write log lines to a file
    // Use fsName to convert Folder object to a native path string; fallback to temp if desktop fails
    var LOG_FILE_PATH = (function(){ try { return Folder.desktop.fsName + "/pack_output_comps_debug.log"; } catch(e){ try { return Folder.temp.fsName + "/pack_output_comps_debug.log"; } catch(e2){ return "pack_output_comps_debug.log"; } } })();
    var APPEND_LOG_FILE = false;                // When false, overwrite each run
    var __logFile = null;
    if (ENABLE_FILE_LOG) {
        try {
            __logFile = new File(LOG_FILE_PATH);
            if (!APPEND_LOG_FILE && __logFile.exists) { __logFile.remove(); }
            if (!__logFile.exists) { __logFile.open('w'); __logFile.close(); }
        } catch (eLFInit) {}
    }
    function log(msg) {
        try { $.writeln(msg); } catch (e1) {}
        if (ENABLE_FILE_LOG && __logFile) {
            try {
                if (__logFile.open('a')) { __logFile.write(msg + "\n"); __logFile.close(); }
            } catch (eLF) {}
        }
    }
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
    var SKIP_IF_OUTPUT_ALREADY_EXISTS = true;      // If an output comp with the expected base name already exists in dest folder, skip instead of creating _01
    var DRY_RUN_MODE = true;                      // When true: do NOT create folders or comps; only log what would happen
    var DEBUG_NAMING = true;                      // When true: verbose logging for each token
    var DATA_JSON_PRIMARY_NAME = 'data.json';      // Primary expected data JSON name

    // --------------------------------------------------------------
    // OUTPUT NAME CONFIG (modular token-based name builder)
    // Order of tokens here defines default ordering. You can enable/disable tokens individually.
    // Default structure requested:
    // CLIENT_BRAND_COUNTRY_JOBNUMBER_CAMPAIGN_TITLE_DURATION_MEDIA_ASPECTRATIO_RESOLUTION_FRAMERATE_SUBTITLES_SOUNDLEVEL_DATE_VERSION
    // MEDIA and SOUNDLEVEL are placeholders for future data sources (currently disabled by default).
    // DATE: auto-generated, format YYDDMM (Year last 2 digits + Day + Month)
    // VERSION: briefVersion => vXX (pad to 2 digits)
    // DURATION: per-video duration => NN s (pad to 2 digits if <10) plus trailing 's'
    // ASPECTRATIO: simplified ratio (e.g. 16x9)
    // RESOLUTION: WxH (e.g. 1920x1080)
    // FRAMERATE: XXfps
    // SUBTITLES: 'sub' if subtitle_flag == 'Y' (case-insensitive) or inferred from presence of subtitles array; else omitted
    // TITLE: per-video metadata.title (fallback from comp name)
    //
    // You can reorder OUTPUT_NAME_TOKENS, or set enabled:false to omit.
    // --------------------------------------------------------------

    var OUTPUT_NAME_TOKENS = [
        { key: 'CLIENT',       enabled: true },
        { key: 'BRAND',        enabled: true },
        { key: 'COUNTRY',      enabled: true },
        { key: 'JOBNUMBER',    enabled: true },
        { key: 'CAMPAIGN',     enabled: true },
        { key: 'TITLE',        enabled: true },
        { key: 'DURATION',     enabled: true },
        { key: 'MEDIA',        enabled: false }, // future
        { key: 'ASPECTRATIO',  enabled: true },
        { key: 'RESOLUTION',   enabled: true },
        { key: 'FRAMERATE',    enabled: true },
        { key: 'SUBTITLES',    enabled: true },
        { key: 'SOUNDLEVEL',   enabled: false }, // future
        { key: 'DATE',         enabled: true },
        { key: 'VERSION',      enabled: true }
    ];

    var OUTPUT_NAME_CONFIG = {
        delimiter: '_',
        skipEmpty: true,        // if a token resolves to empty/null, omit it
        appendSuffix: true      // append APPEND_SUFFIX to the built name (if not already there)
    };

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

    // ------------------ JSON + video metadata helpers ------------------
    function findProjectItemByName(name) {
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (it && String(it.name) === String(name)) return it;
        }
        return null;
    }
    function readTextFile(file) {
        if (!file || !file.exists) return null;
        var txt = null;
        try {
            file.encoding = 'UTF-8';
            if (file.open('r')) { txt = file.read(); file.close(); }
        } catch (e) { try { file.close(); } catch (e2) {} }
        return txt;
    }
    function parseJSONSafe(text) {
        if (!text) return null;
        try { if (typeof JSON !== 'undefined' && JSON.parse) return JSON.parse(text); } catch (e) {}
        try { return eval('(' + text + ')'); } catch (e2) { return null; }
    }
    function loadProjectJSONByName(name) {
        var it = findProjectItemByName(name);
        if (!it || !(it instanceof FootageItem) || !it.mainSource) return null;
        var f = null; try { f = it.mainSource.file; } catch (e) {}
        if (!f) return null;
        var txt = readTextFile(f);
        if (!txt) return null;
        return parseJSONSafe(txt);
    }

    function tryLoadAnyDataJSON() {
        // Scan project for any .json footage with metadataGlobal/meta_global keys
        var best = null;
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (!(it instanceof FootageItem)) continue;
            var nm = String(it.name || '');
            if (nm.toLowerCase().indexOf('.json') === -1) continue;
            var f = null; try { f = it.mainSource.file; } catch (eF) {}
            if (!f || !f.exists) continue;
            var txt = readTextFile(f);
            if (!txt) continue;
            var parsed = parseJSONSafe(txt);
            if (!parsed) continue;
            if (parsed.metadataGlobal || parsed.meta_global) {
                // prefer one with more videos entries
                if (!best) best = { data: parsed, name: nm, videos: (parsed.videos && parsed.videos.length) ? parsed.videos.length : 0 };
                else {
                    var count = (parsed.videos && parsed.videos.length) ? parsed.videos.length : 0;
                    if (count > best.videos) best = { data: parsed, name: nm, videos: count };
                }
            }
        }
        return best;
    }

    function pad2(n) { n = parseInt(n,10); if (isNaN(n)) return '00'; return (n < 10 ? '0' + n : '' + n); }

    function gcd(a,b){ a=Math.abs(a); b=Math.abs(b); while(b){ var t=a%b; a=b; b=t;} return a||1; }
    function aspectRatioString(w,h){ if(!w||!h) return ''; var g=gcd(w,h); var aw=w/g; var ah=h/g; return aw + 'x' + ah; }

    function buildBaseVideoIdFromCompName(name){
        if(!name) return null;
        var parts = String(name).split(/[_\s]+/);
        if(!parts.length) return null;
        var title = parts[0];
        var durToken = null;
        for(var i=1;i<parts.length;i++){
            var p = parts[i];
            if(/^\d{1,4}s$/i.test(p)){ durToken = p.toLowerCase(); break; }
        }
        if(!title || !durToken) return null;
        return title + '_' + durToken; // e.g. WTA_30s
    }
    function getCompOrientation(comp){ try { if(comp && comp.width>comp.height) return 'landscape'; } catch(e){} return 'portrait'; }

    function findVideoRecord(data, comp){
        if(!data || !data.videos || !data.videos.length) return null;
        var baseId = buildBaseVideoIdFromCompName(comp ? comp.name : null);
        if(!baseId) return null;
        var orient = getCompOrientation(comp);
        var orientedId = baseId + '_' + orient;
        var videos = data.videos;
        var candidate = null;
        for(var i=0;i<videos.length;i++){ if(String(videos[i].videoId) === orientedId){ candidate = videos[i]; break; } }
        if(candidate) return candidate; // oriented match first
        // Fallback exact baseId (for future JSON variant without orientation)
        for(var j=0;j<videos.length;j++){ if(String(videos[j].videoId) === baseId){ return videos[j]; } }
        // Fallback: first video whose id starts with baseId
        for(var k=0;k<videos.length;k++){ var vid = String(videos[k].videoId||''); if(vid.indexOf(baseId)===0){ return videos[k]; } }
        return null;
    }

    function buildTokenValue(tokenKey, ctx){
        var meta = ctx.meta;
        var video = ctx.video;
        var comp = ctx.comp;
        switch(tokenKey){
            case 'CLIENT': return meta && meta.client ? meta.client : '';
            case 'BRAND': return meta && meta.brand ? meta.brand : '';
            case 'COUNTRY': return meta && meta.country ? meta.country : '';
            case 'JOBNUMBER': return meta && meta.jobNumber ? meta.jobNumber : '';
            case 'CAMPAIGN': return meta && meta.campaign ? meta.campaign : '';
            case 'TITLE':
                if(video && video.metadata && video.metadata.title) return video.metadata.title;
                // fallback from comp name first token
                var n = comp ? comp.name : ''; var p = n.split(/[_\s]+/); return p.length? p[0]:'';
            case 'DURATION':
                var d = null;
                if(video && video.metadata && video.metadata.duration) d = video.metadata.duration;
                else if(comp) d = Math.round(comp.duration);
                if(d===null || d===undefined || d==='') return '';
                var dn = parseInt(d,10); if(isNaN(dn)) return '';
                return (dn < 10 ? '0'+dn : ''+dn) + 's';
            case 'MEDIA':
                return ''; // placeholder (future)
            case 'ASPECTRATIO':
                return comp ? aspectRatioString(comp.width, comp.height) : '';
            case 'RESOLUTION':
                return comp ? (comp.width + 'x' + comp.height) : '';
            case 'FRAMERATE':
                if(!comp) return '';
                var fr = comp.frameRate; if(!fr || fr<=0) fr = 25; // default
                // Show integer if close to int, else keep one decimal
                var frInt = Math.round(fr);
                if(Math.abs(fr - frInt) < 0.01) return frInt + 'fps';
                return fr.toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + 'fps';
            case 'SUBTITLES':
                var flag = null;
                try { if(video && video.metadata && video.metadata.subtitle_flag) flag = String(video.metadata.subtitle_flag); } catch(e){}
                if(flag){ if(/^y$/i.test(flag)) return 'sub'; else return ''; }
                // infer from subtitles array length
                try { if(video && video.subtitles && video.subtitles.length) return 'sub'; } catch(eInf){}
                return '';
            case 'SOUNDLEVEL':
                return ''; // placeholder
            case 'DATE':
                var now = new Date();
                var yy = now.getFullYear() % 100;
                var dd = now.getDate();
                var mm = now.getMonth()+1; // 1-based
                // Corrected to YYMMDD (Year, Month, Day)
                return pad2(yy) + pad2(mm) + pad2(dd);
            case 'VERSION':
                var bv = meta && meta.briefVersion ? String(meta.briefVersion) : null;
                if(!bv) return '';
                var bvi = parseInt(bv,10);
                if(isNaN(bvi)) return 'v' + bv;
                return 'v' + (bvi < 10 ? '0'+bvi : ''+bvi);
            default: return '';
        }
    }

    function ensureSuffix(name){
        if(!OUTPUT_NAME_CONFIG.appendSuffix) return name;
        if(!APPEND_SUFFIX) return name;
        var lower = String(name).toLowerCase();
        var suffLower = APPEND_SUFFIX.toLowerCase();
        if(lower.length >= suffLower.length && lower.indexOf(suffLower, lower.length - suffLower.length) !== -1) return name;
        return name + APPEND_SUFFIX;
    }

    function buildOutputCompName(comp, jsonData){
        if(!comp) return null;
        var meta = null;
        // metadataGlobal (support legacy key 'meta_global')
        if(jsonData){
            if(jsonData.metadataGlobal) meta = jsonData.metadataGlobal;
            else if(jsonData.meta_global) meta = jsonData.meta_global;
        }
        var video = jsonData ? findVideoRecord(jsonData, comp) : null;
        if(!video){ log("No video metadata match for comp '" + comp.name + "' (will fallback)" ); }
        var ctx = { comp: comp, meta: meta, video: video };
        var parts = [];
        for(var i=0;i<OUTPUT_NAME_TOKENS.length;i++){
            var tk = OUTPUT_NAME_TOKENS[i];
            if(!tk.enabled) continue;
            var val = buildTokenValue(tk.key, ctx);
            if(DEBUG_NAMING) log("Token " + tk.key + " => '" + val + "'");
            if(!val){ if(OUTPUT_NAME_CONFIG.skipEmpty) continue; else val=''; }
            parts.push(val);
        }
        if(!parts.length) return null;
        var rawName = parts.join(OUTPUT_NAME_CONFIG.delimiter || '_');
        return ensureSuffix(rawName);
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
    // Load JSON once for naming (primary + fallback scan)
    var jsonData = loadProjectJSONByName(DATA_JSON_PRIMARY_NAME);
    if(!jsonData){
        var alt = tryLoadAnyDataJSON();
        if(alt){ jsonData = alt.data; log("Naming: primary '"+DATA_JSON_PRIMARY_NAME+"' not found; using '"+alt.name+"' with "+alt.videos+" video entries."); }
        else { log("Naming: no suitable data JSON found (looked for '"+DATA_JSON_PRIMARY_NAME+"')."); }
    } else { if(jsonData && jsonData.metadataGlobal) { var mg = jsonData.metadataGlobal; log("Naming JSON loaded: client=" + (mg.client||'') + ", campaign=" + (mg.campaign||'') + ", briefVersion=" + (mg.briefVersion||'') ); } }

    for (var s = 0; s < sel.length; s++) {
        var item = sel[s];
        if (!(item instanceof CompItem)) { skipped.push(item.name + " (not comp)" ); log("Skip: '"+item.name+"' not a comp"); continue; }

        // Determine destination folder early (so we can test existence)
        var relSegs = relativeSegmentsAfterAnchor(item, ANCHOR_SOURCE_FOLDER.toLowerCase());
        // Destination folder (avoid mutating project in dry-run)
        var destFolder = null;
        if(DRY_RUN_MODE){
            // Attempt to locate existing folder chain without creating
            destFolder = outputRoot; // best-effort: we won't traverse creation to avoid complexity
        } else {
            destFolder = relSegs.length ? ensurePath(outputRoot, relSegs) : outputRoot;
        }
        var expectedBaseName = buildOutputCompName(item, jsonData);
        if(!expectedBaseName){
            expectedBaseName = baseOutputName(item.name); // fallback to original behavior
        }
        log("   -> Proposed output name: " + expectedBaseName);

        log("Considering: '" + item.name + "' -> dest path segments: " + (relSegs.length ? relSegs.join("/") : "(root)") + ", expected output name: " + expectedBaseName);

        if (SKIP_IF_ALREADY_IN_OUTPUT && (isDescendantOf(item, outputRoot) || isInOutputPath(item))) {
            skipped.push(item.name + " (already in output)");
            log("Skip: source comp already under output root -> '"+item.name+"'");
            continue;
        }

        // Check if an output comp already exists with the expected base name (without uniqueness increment)
        if (SKIP_IF_OUTPUT_ALREADY_EXISTS && !DRY_RUN_MODE) {
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

        if(DRY_RUN_MODE){
            log("DRY-RUN: would create export comp '" + expectedBaseName + "' (rel path: " + (relSegs.length?relSegs.join('/'):'(root)') + ")");
            continue; // do not actually create
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

