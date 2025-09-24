// Script for Adobe After Effects — Add layers to composition from a template comp
// ——————————————————————————————————————————————————————————————
// What it does
// 1) Finds the template composition under a configurable Project panel path (default: ./project/work/template/)
//    Expected template name pattern: title_duration_template_YYMMDD_vNN
//    Example: WTA_30s_template_250923_v01
// 2) Copies ALL layers from the template EXCEPT the underlying video footage layer
//    defined as: the highest layer index whose source is a FootageItem with video
// 3) Pastes/copies those layers into the selected compositions, preserving order and timing
//
// Configuration notes
// - TEMPLATE_FOLDER_PATH: where the template comp lives in the Project panel tree
// - ENABLE_JSON_TIMING_FOR_DISCLAIMER: when false, disclaimer spans full comp; when true, JSON timings are applied
// - LAYER_NAME_CONFIG: lists of names or substrings to identify logo/claim/disclaimer/subtitles layers.
//   Matching is case-insensitive. For 'logo', contains-matches can be limited to image/bitmap layers.
//   Edit these arrays to match your template naming conventions.
// - JSON wiring: For each comp, videoId is derived from name (Title_XXs). Applies in/out for logo/claim; disclaimer optionally by toggle.
//   New: per-video key `disclaimer_flag` controls disclaimer layer visibility (case-insensitive):
//     - 'y'   => visible (ON)
//     - 'n'   => hidden (OFF)
//     - 'auto'=> visible only if JSON has at least one valid disclaimer interval (in/out with out>in), otherwise hidden
//     - other/absent => no change to current visibility
//
// Usage
// - Select one or more target comps (or make one active) and run this script.
// - Ensure a template comp exists under ./work/template/ as described above.

(function addLayersFromTemplate() {
    app.beginUndoGroup("Add Layers From Template");

    function log(msg) { try { $.writeln(msg); } catch (e) {} }
    function alertOnce(msg) { try { alert(msg); } catch (e) {} }

    var proj = app.project;
    if (!proj) { alertOnce("No project open."); app.endUndoGroup(); return; }

    // Helpers ————————————————————————————————————————————————
    // Config: set the template folder path here (segments under Project panel Root)
    var TEMPLATE_FOLDER_PATH = ["project", "work", "template"]; // e.g., ["project","work","template"]
    // Gate for applying JSON disclaimer in/out; when false, disclaimer spans full comp
    var ENABLE_JSON_TIMING_FOR_DISCLAIMER = false;

    // Config: Layer name configuration (case-insensitive)
    // - exact: list of layer names to match exactly
    // - contains: list of substrings; if present in layer name, it's a match
    // - imageOnlyForContains (logo only): when true, a 'contains' match is valid only for image/bitmap footage layers
    // Adjust these lists to match your template naming conventions.
    var LAYER_NAME_CONFIG = {
        logo: {
            exact: ["Size_Holder_Logo"],
            contains: ["logo"],
            imageOnlyForContains: true
        },
        claim: {
            exact: ["claim", "Size_Holder_Claim"],
            contains: []
        },
        disclaimer: {
            exact: ["disclaimer", "Size_Holder_Disclaimer"],
            contains: []
        },
        subtitles: {
            exact: [],
            contains: ["subtitles"]
        }
    };

    function findChildFolderByName(parent, name) {
        for (var i = 1; i <= parent.numItems; i++) {
            var it = parent.items[i];
            if (it && it instanceof FolderItem && it.name === name) return it;
        }
        return null;
    }

    function findFolderPath(root, segments) {
        var cur = root;
        for (var i = 0; i < segments.length; i++) {
            var f = findChildFolderByName(cur, segments[i]);
            if (!f) return null;
            cur = f;
        }
        return cur;
    }

    function pathToString(segments) {
        var s = "./";
        for (var i = 0; i < segments.length; i++) {
            s += segments[i];
            if (i < segments.length - 1) s += "/";
        }
        return s + "/";
    }

    function collectCompsRecursive(folder, outArr) {
        for (var i = 1; i <= folder.numItems; i++) {
            var it = folder.items[i];
            if (it instanceof CompItem) outArr.push(it);
            else if (it instanceof FolderItem) collectCompsRecursive(it, outArr);
        }
    }

    function pickBestTemplateComp(candidates) {
        if (!candidates || !candidates.length) return null;
        // Prefer those matching pattern: title_duration_template_YYMMDD_vNN
        var pat = /^(.+?)_(\d{1,4}s)_template_(\d{6})_v(\d{1,3})$/i;
        var best = null; var bestDate = -1; var bestVer = -1;
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var m = String(c.name || "").match(pat);
            if (m) {
                var dateNum = parseInt(m[3], 10);
                var verNum = parseInt(m[4], 10);
                if (dateNum > bestDate || (dateNum === bestDate && verNum > bestVer)) {
                    best = c; bestDate = dateNum; bestVer = verNum;
                }
            }
        }
        if (best) return best;
        // Fallback: first comp
        return candidates[0];
    }

    function findBottomVideoFootageLayerIndex(comp) {
        // Return highest layer index whose source is FootageItem with video
        for (var i = comp.numLayers; i >= 1; i--) {
            var ly = comp.layer(i);
            try {
                if (ly && ly.source && (ly.source instanceof FootageItem)) {
                    var src = ly.source;
                    var hasVid = false;
                    try { hasVid = (src.hasVideo === true); } catch (e1) {}
                    if (hasVid) return i;
                }
            } catch (e) {}
        }
        return -1;
    }

    function getSelectedComps() {
        var out = [];
        var sel = proj.selection;
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) if (sel[i] instanceof CompItem) out.push(sel[i]);
        }
        if (!out.length && proj.activeItem && proj.activeItem instanceof CompItem) out.push(proj.activeItem);
        return out;
    }

    // JSON wiring helpers ——————————————————————————————————————
    function findProjectItemByName(name) {
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.items[i];
            if (it && it.name === name) return it;
        }
        return null;
    }

    function readTextFile(file) {
        if (!file || !file.exists) return null;
        var txt = null;
        try {
            file.encoding = "UTF-8";
            if (file.open("r")) {
                txt = file.read();
                file.close();
            }
        } catch (e) { try { file.close(); } catch (e2) {} }
        return txt;
    }

    function parseJSONSafe(text) {
        if (!text) return null;
        try {
            if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
        } catch (e) {}
        // Fallback (last resort): naive eval in sandboxed parentheses
        try { return eval('(' + text + ')'); } catch (e2) { return null; }
    }

    function loadProjectJSONByName(name) {
        var it = findProjectItemByName(name);
        if (!it || !(it instanceof FootageItem) || !it.mainSource) return null;
        var f = null;
        try { f = it.mainSource.file; } catch (e) {}
        if (!f) return null;
        var txt = readTextFile(f);
        if (!txt) return null;
        return parseJSONSafe(txt);
    }

    function buildVideoIdFromCompName(name) {
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

    function findVideoById(data, videoId) {
        try {
            var arr = data && data.videos ? data.videos : null;
            if (!arr) return null;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && String(arr[i].videoId) === String(videoId)) return arr[i];
            }
        } catch (e) {}
        return null;
    }

    function minMaxInOut(list) {
        if (!list || !list.length) return null;
        var minIn = null, maxOut = null;
        for (var i = 0; i < list.length; i++) {
            var o = list[i];
            if (!o) continue;
            var tin = (o["in"] !== undefined) ? parseFloat(o["in"]) : null;
            var tout = (o["out"] !== undefined) ? parseFloat(o["out"]) : null;
            if (tin === null || isNaN(tin) || tout === null || isNaN(tout)) continue;
            if (minIn === null || tin < minIn) minIn = tin;
            if (maxOut === null || tout > maxOut) maxOut = tout;
        }
        if (minIn === null || maxOut === null || maxOut <= minIn) return null;
        return { tin: minIn, tout: maxOut };
    }

    function setLayerInOut(layer, tin, tout, compDuration) {
        if (!layer) return;
        var start = (tin < 0) ? 0 : tin;
        var end = tout;
        if (compDuration && end > compDuration) end = compDuration;
        try { layer.startTime = 0; } catch (e) {}
        try { layer.inPoint = start; } catch (e1) {}
        try { layer.outPoint = end; } catch (e2) {}
    }

    function applyJSONTimingToComp(comp, data) {
        if (!data) return;
        var videoId = buildVideoIdFromCompName(comp.name);
        if (!videoId) { log("No videoId derivable from comp: " + comp.name); return; }
        var v = findVideoById(data, videoId);
        if (!v) { log("VideoId not found in JSON: " + videoId); return; }
        var logoMM = minMaxInOut(v.logo);
        var claimMM = minMaxInOut(v.claim);
        var disclaimerMM = minMaxInOut(v.disclaimer);
        // Disclaimer visibility flag ('y' or 'n', case-insensitive)
        var disclaimerFlag = null;
        try {
            var df = v.disclaimer_flag;
            if (df !== undefined && df !== null) {
                disclaimerFlag = String(df).toLowerCase();
            }
        } catch (eDF) {}
        // Determine if JSON has any valid disclaimer intervals
        var hasValidDisclaimer = false;
        if (v && v.disclaimer && v.disclaimer.length) {
            for (var di = 0; di < v.disclaimer.length; di++) {
                var d = v.disclaimer[di];
                if (!d) continue;
                var tin = (d["in"] !== undefined) ? parseFloat(d["in"]) : NaN;
                var tout = (d["out"] !== undefined) ? parseFloat(d["out"]) : NaN;
                if (!isNaN(tin) && !isNaN(tout) && tout > tin) { hasValidDisclaimer = true; break; }
            }
        }
        // Matching helpers using LAYER_NAME_CONFIG
        function matchesExact(name, list) {
            if (!name || !list || !list.length) return false;
            var n = String(name).toLowerCase();
            for (var i = 0; i < list.length; i++) {
                if (n === String(list[i]).toLowerCase()) return true;
            }
            return false;
        }

        function matchesContains(name, list) {
            if (!name || !list || !list.length) return false;
            var n = String(name).toLowerCase();
            for (var i = 0; i < list.length; i++) {
                if (n.indexOf(String(list[i]).toLowerCase()) !== -1) return true;
            }
            return false;
        }
        // Helper to test if layer is an image/bitmap footage
        function isImageFootageLayer(ly) {
            try {
                if (!ly || !ly.source) return false;
                var src = ly.source;
                if (!(src instanceof FootageItem)) return false;
                var hasVid = false, hasAud = false;
                try { hasVid = (src.hasVideo === true); } catch (e1) {}
                try { hasAud = (src.hasAudio === true); } catch (e2) {}
                // Images: video stream present in AE but no audio; often isStill=true
                var isStill = false;
                try { if (src.mainSource && src.mainSource.isStill === true) isStill = true; } catch (e3) {}
                var byExt = false;
                try {
                    var nm = String((src.name || "")).toLowerCase();
                    if (/\.(psd|psb|png|jpg|jpeg|tif|tiff|bmp|gif|ai)$/i.test(nm)) byExt = true;
                    var f = (src.mainSource && src.mainSource.file) ? src.mainSource.file : null;
                    if (!byExt && f) {
                        var fn = String((f.name || f.fsName || "")).toLowerCase();
                        if (/\.(psd|psb|png|jpg|jpeg|tif|tiff|bmp|gif|ai)$/i.test(fn)) byExt = true;
                    }
                } catch (e4) {}
                // Treat as image if isStill or byExt true and no audio
                return (isStill || byExt) && !hasAud;
            } catch (e) { return false; }
        }

        // Always set full comp duration for subtitles and (by default) disclaimer
        for (var si = 1; si <= comp.numLayers; si++) {
            var sLay = comp.layer(si);
            var sName = String(sLay.name || "");
            // Subtitles full duration always
            if (matchesExact(sName, LAYER_NAME_CONFIG.subtitles.exact) || matchesContains(sName, LAYER_NAME_CONFIG.subtitles.contains)) {
                setLayerInOut(sLay, 0, comp.duration, comp.duration);
            }
            // Disclaimer full duration when gating is OFF
            if (!ENABLE_JSON_TIMING_FOR_DISCLAIMER && (
                matchesExact(sName, LAYER_NAME_CONFIG.disclaimer.exact) ||
                matchesContains(sName, LAYER_NAME_CONFIG.disclaimer.contains)
            )) {
                setLayerInOut(sLay, 0, comp.duration, comp.duration);
            }
        }

        // Apply JSON timings
        var appliedAny = false;
        for (var i = 1; i <= comp.numLayers; i++) {
            var ly = comp.layer(i);
            var nm = String(ly.name || "");
            // Logo timing (exact names or contains matches; contains optionally limited to image-only)
            var logoExact = matchesExact(nm, LAYER_NAME_CONFIG.logo.exact);
            var logoContains = matchesContains(nm, LAYER_NAME_CONFIG.logo.contains);
            var logoContainsOk = logoContains && (!LAYER_NAME_CONFIG.logo.imageOnlyForContains || isImageFootageLayer(ly));
            if (logoMM && (logoExact || logoContainsOk)) {
                setLayerInOut(ly, logoMM.tin, logoMM.tout, comp.duration);
                log("Set logo layer '" + nm + "' to [" + logoMM.tin + ", " + logoMM.tout + ")");
                appliedAny = true;
                continue;
            }
            // Claim timing
            if (claimMM && (matchesExact(nm, LAYER_NAME_CONFIG.claim.exact) || matchesContains(nm, LAYER_NAME_CONFIG.claim.contains))) {
                setLayerInOut(ly, claimMM.tin, claimMM.tout, comp.duration);
                log("Set claim layer '" + nm + "' to [" + claimMM.tin + ", " + claimMM.tout + ")");
                appliedAny = true;
                continue;
            }
            // Disclaimer timing (gated) + visibility flag
            if (matchesExact(nm, LAYER_NAME_CONFIG.disclaimer.exact) || matchesContains(nm, LAYER_NAME_CONFIG.disclaimer.contains)) {
                if (ENABLE_JSON_TIMING_FOR_DISCLAIMER && disclaimerMM) {
                    setLayerInOut(ly, disclaimerMM.tin, disclaimerMM.tout, comp.duration);
                    log("Set disclaimer layer '" + nm + "' to [" + disclaimerMM.tin + ", " + disclaimerMM.tout + ")");
                } else {
                    // already set to full duration above when gating is off
                }
                // Apply visibility if disclaimer_flag present
                if (disclaimerFlag === 'y' || disclaimerFlag === 'n' || disclaimerFlag === 'auto') {
                    try {
                        if (disclaimerFlag === 'auto') {
                            ly.enabled = hasValidDisclaimer;
                        } else {
                            ly.enabled = (disclaimerFlag === 'y');
                        }
                        log("Set disclaimer visibility '" + nm + "' -> " + (ly.enabled ? "ON" : "OFF"));
                    } catch (eVis) {}
                }
            }
        }
        if (!appliedAny) {
            log("No logo/claim timing applied for " + videoId + ".");
        }
    }

    // Locate template folder and comp ——————————————————————————
    var templateFolder = findFolderPath(proj.rootFolder, TEMPLATE_FOLDER_PATH);
    if (!templateFolder) {
        alertOnce("Template folder not found at " + pathToString(TEMPLATE_FOLDER_PATH));
        app.endUndoGroup();
        return;
    }

    var templateComps = [];
    collectCompsRecursive(templateFolder, templateComps);
    if (!templateComps.length) {
        alertOnce("No template composition found in " + pathToString(TEMPLATE_FOLDER_PATH));
        app.endUndoGroup();
        return;
    }

    var templateComp = pickBestTemplateComp(templateComps);
    if (!templateComp) {
        alertOnce("Unable to resolve template composition.");
        app.endUndoGroup();
        return;
    }

    var excludeIdx = findBottomVideoFootageLayerIndex(templateComp);

    var targets = getSelectedComps();
    if (!targets.length) {
        alertOnce("Select one or more target compositions.");
        app.endUndoGroup();
        return;
    }

    log("Using template: " + templateComp.name + (excludeIdx > 0 ? (" (excluding layer #" + excludeIdx + ")") : ""));

    // Load JSON once
    var jsonData = loadProjectJSONByName("data.json");
    if (!jsonData) { log("JSON 'data.json' not found or failed to parse. Timing wiring will be skipped."); }

    // Copy layers from template to each target, preserving exact order
    // Strategy: iterate template layers top->bottom (excluding the underlying video),
    // copy each to target (paste inserts at top), then move the newly pasted layer
    // after the previously inserted one. This yields the same stacking as the template.
    var addedTotal = 0;
    for (var t = 0; t < targets.length; t++) {
        var comp = targets[t];
        var added = 0;
        var lastInserted = null; // track stacking chain for moveAfter
        // Iterate top -> bottom to mirror order precisely
        for (var li = 1; li <= templateComp.numLayers; li++) {
            if (li === excludeIdx) continue; // skip underlying video footage layer
            var srcLayer = templateComp.layer(li);
            try {
                var newLayer = srcLayer.copyToComp(comp);
                // Fallback if API returns undefined: assume the newest is at top
                if (!newLayer) { try { newLayer = comp.layer(1); } catch (eNL) {} }
                // Reposition to preserve order: place after previously inserted
                if (newLayer && lastInserted && newLayer !== lastInserted) {
                    try { newLayer.moveAfter(lastInserted); } catch (eMove) {}
                }
                if (newLayer) lastInserted = newLayer;
                added++;
            } catch (eCopy) {
                log("Skip layer #" + li + " ('" + srcLayer.name + "') — " + (eCopy && eCopy.message ? eCopy.message : eCopy));
            }
        }
        addedTotal += added;
        log("Inserted " + added + " layer(s) into '" + comp.name + "'.");
        // Apply JSON timings (logo/claim) to corresponding layers
        if (jsonData) {
            applyJSONTimingToComp(comp, jsonData);
        }
    }

    alertOnce("Added layers from template '" + templateComp.name + "' to " + targets.length + " comp(s). Total layers added: " + addedTotal + ".");
    app.endUndoGroup();
})();
// Script_ae: Add layers to composition. 01

// After Effetcs script to add layers to selected composition from a template composition.

// 1. Locate the template composition: In the AE project panel, project internal path: ./work/template/
// The template composition name pattern will be: ‘title_duration_template_date_version’, e.g. ‘WTA_30s_template_250923_v01’
// 2. Copy all of the layers except the underlaying video file i.e. footage layer with the highest layer number whose source file is AVItem - video (e.g. *.mp4, *.mov, etc.)
// 3. Add the copied layers into the selected compositions.