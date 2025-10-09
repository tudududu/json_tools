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
// - LAYER_NAME_CONFIG: lists of names or substrings to identify logo/claim/disclaimer/subtitles/dataJson layers.
//   Matching is case-insensitive. For 'logo', contains-matches can be limited to image/bitmap layers.
//   Edit these arrays to match your template naming conventions.
// - JSON wiring: For each comp, videoId is derived from name (Title_XXs). Applies in/out for logo/claim; disclaimer optionally by toggle.
//   New: per-video key `disclaimer_flag` controls disclaimer layer visibility (case-insensitive):
//     - 'y'   => visible (ON)
//     - 'n'   => hidden (OFF)
//     - other/absent => defaults to OFF
// - DATA_JSON/data.json layers are forced to full comp duration.
// - TEMPLATE_MATCH_CONFIG: controls picking the best template comp for each target comp (Solution B)
//   arTolerance: numeric tolerance used to treat two aspect ratios as equal (default: 0.001)
//   requireAspectRatioMatch: when true, only templates within arTolerance are eligible; if none found, target is skipped
//
// Usage
// - Select one or more target comps (or make one active) and run this script.
// - Ensure a template comp exists under ./work/template/ as described above.

(function addLayersFromTemplate() {
    app.beginUndoGroup("Add Layers From Template");

    // ---------------- Logging Configuration ----------------
    // Enable/disable file logging and customize location.
    // By default tries to place logs under ./project/work/log relative to the project panel root.
    var ENABLE_FILE_LOG = true;                  // Master toggle for file logging
    var LOG_PATH_SEGMENTS = ["project","log"]; // Relative folder chain under project rootFolder
    var LOG_FILENAME_PREFIX = "add_layers_to_comp";      // Base filename prefix
    var SUPPRESS_CONSOLE_LOG = false;            // If true, only file logging (no $.writeln)
    var __logFile = null;                        // File handle once resolved

    function __buildTimestamp(){ var d=new Date(); function p(n){return (n<10?'0':'')+n;} return d.getFullYear()+''+p(d.getMonth()+1)+''+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); }

    function __findOrCreateLogFolder(){
        if(!ENABLE_FILE_LOG) return null;
        try {
            if(!app.project || !app.project.rootFolder) return null;
            var cur = app.project.rootFolder;
            // Walk down segments, creating if necessary
            for(var i=0;i<LOG_PATH_SEGMENTS.length;i++){
                var seg = LOG_PATH_SEGMENTS[i]; if(!seg) continue;
                var found=null;
                for(var j=1;j<=cur.numItems;j++){ var it=cur.items[j]; if(it instanceof FolderItem && String(it.name)===seg){ found=it; break; } }
                if(!found){ try { found = app.project.items.addFolder(seg); found.parentFolder = cur; } catch(eC) { found=null; } }
                if(!found) return null; // fail early
                cur = found;
            }
            // cur now represents an AE FolderItem; convert to disk folder relative to project file if possible
            // We'll attempt to use the project file path; if project unsaved fallback to desktop
            var baseFolder = null;
            try { if(app.project.file && app.project.file.parent) baseFolder = app.project.file.parent; } catch(ePF) {}
            if(baseFolder){
                // Build physical path .../<projectDir>/work/log or nested chain after removing initial 'project'
                var phys = baseFolder.fsName; // project folder path
                // If first segment is 'project', skip it for disk path (since project.file.parent already is that folder)
                var startIdx = 0; if(LOG_PATH_SEGMENTS.length && LOG_PATH_SEGMENTS[0]==='project') startIdx = 1;
                for(var si=startIdx; si<LOG_PATH_SEGMENTS.length; si++){
                    phys += '/' + LOG_PATH_SEGMENTS[si];
                    var testF = new Folder(phys); if(!testF.exists) { try { testF.create(); } catch(eMk) {} }
                }
                var finalF = new Folder(phys);
                if(finalF.exists) return finalF;
            }
        } catch(eF) {}
        try { return Folder.desktop; } catch(eD) {}
        try { return Folder.temp; } catch(eT) {}
        return null;
    }

    (function __initLog(){
        if(!ENABLE_FILE_LOG) return;
        var folder = __findOrCreateLogFolder();
        if(!folder) return;
        var ts = __buildTimestamp();
        try { __logFile = new File(folder.fsName + '/' + LOG_FILENAME_PREFIX + '_' + ts + '.log'); } catch(eLF) { __logFile = null; }
    })();

    function __writeFileLine(line){ if(!__logFile) return; try { if(__logFile.open('a')) { __logFile.write(line + '\n'); __logFile.close(); } } catch(eWF) { try { __logFile.close(); } catch(eC) {} } }

    function log(msg) {
        if(!SUPPRESS_CONSOLE_LOG){ try { $.writeln(msg); } catch(eC) {} }
        if(ENABLE_FILE_LOG) __writeFileLine(msg);
    }
    function alertOnce(msg) { try { alert(msg); } catch (e) {} }
    // One-time alert guard for AR-skip warning
    var __AR_SKIP_ALERT_SHOWN = false;

    var proj = app.project;
    if (!proj) { alertOnce("No project open."); app.endUndoGroup(); return; }

    // Helpers ————————————————————————————————————————————————
    // Config: set the template folder path here (segments under Project panel Root)
    var TEMPLATE_FOLDER_PATH = ["project", "work", "template"]; // e.g., ["project","work","template"]
    // Gate for applying JSON disclaimer in/out; when false, disclaimer spans full comp
    var ENABLE_JSON_TIMING_FOR_DISCLAIMER = false;
    // Auto-center un-parented layers when aspect ratio differs from template
    var ENABLE_AUTOCENTER_ON_AR_MISMATCH = true;
    // Template picking config (Solution B)
    var TEMPLATE_MATCH_CONFIG = {
        arTolerance: 0.001,
        requireAspectRatioMatch: false
    };

    // Skip-copy configuration (compact)
    var SKIP_COPY_CONFIG = {
        // When true, these layers will not be copied when their flag resolves to OFF
        disclaimerOff: true,
        subtitlesOff: true,
        logoAnimOff:  true,
        // Base logo layers that must always be copied (case-insensitive exact names)
        alwaysCopyLogoBaseNames: ["Size_Holder_Logo"],
        // Generic group-based skip (by LAYER_NAME_CONFIG keys, no flags)
        groups: {
            enabled: false,
            keys: ["info"/* e.g., "claim" */]
        },
        // Ad-hoc skip list (name tokens); case-insensitive contains match
        adHoc: {
            enabled: false,
            tokens: ["info", "template_aspect"]
        }
    };

    // Logo timing behavior toggle:
    // When true, for logo layers we set BOTH layer.inPoint and layer.startTime to the logo JSON in value (tin),
    // and layer.outPoint to the logo JSON out value (tout). This causes the layer's internal time zero to align
    // with its visible inPoint (useful for expressions referencing time / sourceTime inside the logo layer).
    // When false, we keep the prior behavior (startTime forced to 0; inPoint/outPoint trimmed around tin/tout).
    var APPLY_LOGO_INPOINT_TO_LAYER_STARTTIME = true;

    // Time-stretch configuration for 'logo_anim' layers
    // Enables speeding up the first N seconds of the logo_anim source so that the animation ends around
    // a fraction of the target layer's in/out span, while keeping the layer outPoint at the target time.
    // - ENABLE_LOGO_ANIM_TIMESTRETCH: master ON/OFF
    // - LOGO_ANIM_STRETCH_PERCENT: base percent (e.g., 66 means 0.66x duration, i.e., faster)
    // - LOGO_ANIM_SOURCE_ANIM_DURATION: how many seconds at the start of the source contain the animated part (e.g., 2.0s)
    // - LOGO_ANIM_ANIM_END_FRACTION: desired fraction of the target span where the animated part should complete (e.g., 2/3)
    // - LOGO_ANIM_STRETCH_GATE_MAX_DURATION: do NOT apply stretch if target layer span exceeds this threshold (e.g., 2.2s)
    var ENABLE_LOGO_ANIM_TIMESTRETCH = true;
    var LOGO_ANIM_STRETCH_PERCENT = 66;               // base stretch percent
    var LOGO_ANIM_SOURCE_ANIM_DURATION = 2.0;         // seconds
    var LOGO_ANIM_ANIM_END_FRACTION = 2.0/3.0;        // target fraction of span to end animation
    var LOGO_ANIM_STRETCH_GATE_MAX_DURATION = 2.2;    // seconds; if span > this, no stretch is applied

    // Visibility flag configuration (JSON key names)
    // These keys are looked up first on each video object, then (if not found) under video.metadata.*
    // Change here if the JSON schema evolves.
    var DISCLAIMER_FLAG_KEY = "disclaimer_flag"; // values: 'y','n' (case-insensitive)
    var SUBTITLES_FLAG_KEY = "subtitle_flag";   // values: 'y','n' (case-insensitive)
    var LOGO_ANIM_FLAG_KEY = "logo_anim_flag";  // values: 'y','n' (case-insensitive); controls 'logo_anim' vs 'logo' visibility
    // Configurable acceptable values (all compared case-insensitively)
    // Extend these arrays if JSON may contain alternative tokens (e.g. Yes/No / 1/0)
    var DISCLAIMER_FLAG_VALUES = {
        ON:   ['y', 'yes', '1'],
        OFF:  ['n', 'no', '0']
    };
    var SUBTITLES_FLAG_VALUES = DISCLAIMER_FLAG_VALUES;
    var LOGO_ANIM_FLAG_VALUES = DISCLAIMER_FLAG_VALUES; // share the same ON/OFF tokens

    // Config: Layer name configuration (case-insensitive)
    // - exact: list of layer names to match exactly
    // - contains: list of substrings; if present in layer name, it's a match
    // - imageOnlyForContains (logo only): when true, a 'contains' match is valid only for image/bitmap footage layers
    // Adjust these lists to match your template naming conventions.
    var LAYER_NAME_CONFIG = {
        info: {
            exact: ["info"],
            contains: ["info"]
        },
        logo: {
            exact: ["Size_Holder_Logo"],
            contains: ["logo"],
            imageOnlyForContains: false
        },
        // Specific match for animated logo variant to distinguish from generic 'logo'
        logoAnim: {
            exact: ["logo_anim", "Size_Holder_Logo"],
            contains: ["logo_anim"]
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
        },
        dataJson: {
            exact: ["DATA_JSON", "data.json"],
            contains: []
            },
            // Auto-center exceptions and alignment rules (case-insensitive exact names)
            recenterRules: {
                // If all arrays are empty, all un-parented layers will be auto-centered (default behavior).
                // noRecenter entries will be skipped from auto-centering.
                // force entries will be auto-centered regardless (useful if default changes in future).
                // alignH/alignV will align X/Y to center after the re-centering step (or even if re-centering is skipped).
                force: [],        // e.g., ["Logo", "Brand_Safe"]
                noRecenter: [],   // e.g., ["BG", "DoNotCenter"]
                alignH: [],       // e.g., ["Claim", "CTA"]
                alignV: []        // e.g., ["Disclaimer"]
            }
    };

    // Simple name matching helpers (case-insensitive)
    function _matchesExact(name, list) {
        if (!name || !list || !list.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < list.length; i++) if (n === String(list[i]).toLowerCase()) return true;
        return false;
    }
    function _matchesContains(name, list) {
        if (!name || !list || !list.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < list.length; i++) if (n.indexOf(String(list[i]).toLowerCase()) !== -1) return true;
        return false;
    }
    function nameMatchesGroup(name, groupKey) {
        var cfg = LAYER_NAME_CONFIG[groupKey];
        if (!cfg) return false;
        return _matchesExact(name, cfg.exact) || _matchesContains(name, cfg.contains);
    }
    function nameMatchesAnyTokenContains(name, tokens) {
        if (!name || !tokens || !tokens.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < tokens.length; i++) {
            var t = String(tokens[i]).toLowerCase();
            if (!t) continue;
            if (n.indexOf(t) !== -1) return true;
        }
        return false;
    }

    // FULL_DURATION_LAYER_GROUPS semantics:
    // Each entry may be either:
    //  - A key in LAYER_NAME_CONFIG (uses that group's exact/contains lists)
    //  - A literal layer name (case-insensitive exact) matched directly
    // Disclaimer layers remain handled separately to preserve JSON gating behavior.
    var FULL_DURATION_LAYER_GROUPS = ["subtitles", "Size_Holder_Subtitles", "dataJson", "DATA_JSON", "data.json", "center", "template_aspect", "info"]; // Add more keys or raw names as needed

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

    function isDescendantOfFolder(item, folder) {
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

    // New: pick best template per target using AR and resolution (Solution B)
    function pickBestTemplateCompForTarget(candidates, targetComp) {
        if (!candidates || !candidates.length) return null;
        if (!targetComp) return pickBestTemplateComp(candidates);
        var tAR = ar(targetComp.width, targetComp.height);
        var tol = (TEMPLATE_MATCH_CONFIG && typeof TEMPLATE_MATCH_CONFIG.arTolerance === 'number') ? TEMPLATE_MATCH_CONFIG.arTolerance : 0.001; // AR tolerance
        var requireAR = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch === true);
        // Helper to parse date/version for tie-breaks
        function parseDateVer(name) {
            var pat = /^(.+?)_(\d{1,4}s)_template_(\d{6})_v(\d{1,3})$/i;
            var m = String(name || "").match(pat);
            if (m) return { dateNum: parseInt(m[3],10), verNum: parseInt(m[4],10) };
            return { dateNum: -1, verNum: -1 };
        }
        // If requireAspectRatioMatch is true, limit candidates to those within tolerance
        var working = candidates;
        if (requireAR) {
            var filtered = [];
            for (var fi = 0; fi < candidates.length; fi++) {
                var cc = candidates[fi];
                var cARf = ar(cc.width, cc.height);
                if (Math.abs(cARf - tAR) <= tol) filtered.push(cc);
            }
            if (!filtered.length) return null;
            working = filtered;
        }

        var best = null;
        var bestScore = null; // lower is better; structure: { arDiff, resDiff, dateNum, verNum }
        for (var i = 0; i < working.length; i++) {
            var c = working[i];
            var cAR = ar(c.width, c.height);
            var arDiff = Math.abs(cAR - tAR);
            // resDiff: within AR match, prefer closest resolution; otherwise still compute to break ties
            var resDiff = Math.abs(c.width - targetComp.width) + Math.abs(c.height - targetComp.height);
            var dv = parseDateVer(c.name);
            var score = {
                arDiff: arDiff,
                resDiff: resDiff,
                dateNum: dv.dateNum,
                verNum: dv.verNum
            };
            if (!best) { best = c; bestScore = score; continue; }
            var s = bestScore;
            // Primary: AR closeness (prefer within tolerance first)
            var bothWithinTol = (score.arDiff <= tol) && (s.arDiff <= tol);
            if (bothWithinTol) {
                // If both match AR, prefer closest resolution
                if (score.resDiff < s.resDiff) { best = c; bestScore = score; continue; }
                if (score.resDiff > s.resDiff) { continue; }
                // Tie: prefer newer date/version
                if (score.dateNum > s.dateNum || (score.dateNum === s.dateNum && score.verNum > s.verNum)) { best = c; bestScore = score; }
                continue;
            }
            // If only one is within tolerance, prefer that one
            if (score.arDiff <= tol && s.arDiff > tol) { best = c; bestScore = score; continue; }
            if (s.arDiff <= tol && score.arDiff > tol) { continue; }
            // Otherwise, both outside tol: pick smaller AR diff
            if (score.arDiff < s.arDiff) { best = c; bestScore = score; continue; }
            if (score.arDiff > s.arDiff) { continue; }
            // Tie: prefer closer resolution
            if (score.resDiff < s.resDiff) { best = c; bestScore = score; continue; }
            if (score.resDiff > s.resDiff) { continue; }
            // Tie: prefer newer date/version
            if (score.dateNum > s.dateNum || (score.dateNum === s.dateNum && score.verNum > s.verNum)) { best = c; bestScore = score; }
        }
        return best || candidates[0];
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

    // Aspect ratio helpers and auto-center logic ————————————————————————
    function ar(w, h) { return (h && h !== 0) ? (w / h) : 0; }
    function arMismatch(compA, compB) {
        var rA = ar(compA.width, compA.height);
        var rB = ar(compB.width, compB.height);
        return Math.abs(rA - rB) > 0.001; // tolerance
    }

    function nameInListCaseInsensitive(name, list) {
        if (!name || !list || !list.length) return false;
        var n = String(name).toLowerCase();
        for (var i = 0; i < list.length; i++) { if (n === String(list[i]).toLowerCase()) return true; }
        return false;
    }

    function recenterUnparentedLayers(comp) {
        var cx = comp.width / 2;
        var cy = comp.height / 2;

        function shiftCombined(posProp, cx, cy) {
            if (!posProp) return;
            try {
                if (posProp.expressionEnabled) { return; }
            } catch (eExp) {}
            var is3D = false; var cur = null; var z = 0;
            try { cur = posProp.value; is3D = (cur && cur.length === 3); if (is3D) z = cur[2]; } catch (eVal) {}
            if (posProp.numKeys && posProp.numKeys > 0) {
                // Compute delta from first key
                var base = posProp.keyValue(1);
                var dx = cx - base[0];
                var dy = cy - base[1];
                for (var k = 1; k <= posProp.numKeys; k++) {
                    try {
                        var v = posProp.keyValue(k);
                        if (v && v.length) {
                            var nv = (v.length === 3) ? [v[0] + dx, v[1] + dy, v[2]] : [v[0] + dx, v[1] + dy];
                            posProp.setValueAtKey(k, nv);
                        }
                    } catch (eSetK) {}
                }
            } else {
                try { posProp.setValue(is3D ? [cx, cy, z] : [cx, cy]); } catch (eSet) {}
            }
        }

        function shiftSeparated(posX, posY, cx, cy) {
            if (!posX || !posY) return;
            try { if (posX.expressionEnabled || posY.expressionEnabled) { return; } } catch (eExp) {}
            var baseX = (posX.numKeys > 0) ? posX.keyValue(1) : posX.value;
            var baseY = (posY.numKeys > 0) ? posY.keyValue(1) : posY.value;
            var dx = cx - baseX;
            var dy = cy - baseY;
            if (posX.numKeys > 0) {
                for (var kx = 1; kx <= posX.numKeys; kx++) {
                    try { posX.setValueAtKey(kx, posX.keyValue(kx) + dx); } catch (eKX) {}
                }
            } else { try { posX.setValue(cx); } catch (eSX) {} }
            if (posY.numKeys > 0) {
                for (var ky = 1; ky <= posY.numKeys; ky++) {
                    try { posY.setValueAtKey(ky, posY.keyValue(ky) + dy); } catch (eKY) {}
                }
            } else { try { posY.setValue(cy); } catch (eSY) {} }
        }

        function alignXCombined(posProp, cx) {
            if (!posProp) return; try { if (posProp.expressionEnabled) return; } catch (e) {}
            var cur = null; try { cur = posProp.value; } catch (eV) {}
            if (posProp.numKeys && posProp.numKeys > 0) {
                var base = posProp.keyValue(1);
                var dx = cx - base[0];
                for (var k = 1; k <= posProp.numKeys; k++) {
                    try {
                        var v = posProp.keyValue(k);
                        var nv = (v.length === 3) ? [v[0] + dx, v[1], v[2]] : [v[0] + dx, v[1]];
                        posProp.setValueAtKey(k, nv);
                    } catch (eSet) {}
                }
            } else {
                try {
                    var is3D = (cur && cur.length === 3);
                    var ny = cur ? cur[1] : 0; var nz = is3D ? cur[2] : undefined;
                    posProp.setValue(is3D ? [cx, ny, nz] : [cx, ny]);
                } catch (eSet2) {}
            }
        }

        function alignYCombined(posProp, cy) {
            if (!posProp) return; try { if (posProp.expressionEnabled) return; } catch (e) {}
            var cur = null; try { cur = posProp.value; } catch (eV) {}
            if (posProp.numKeys && posProp.numKeys > 0) {
                var base = posProp.keyValue(1);
                var dy = cy - base[1];
                for (var k = 1; k <= posProp.numKeys; k++) {
                    try {
                        var v = posProp.keyValue(k);
                        var nv = (v.length === 3) ? [v[0], v[1] + dy, v[2]] : [v[0], v[1] + dy];
                        posProp.setValueAtKey(k, nv);
                    } catch (eSet) {}
                }
            } else {
                try {
                    var is3D = (cur && cur.length === 3);
                    var nx = cur ? cur[0] : 0; var nz = is3D ? cur[2] : undefined;
                    posProp.setValue(is3D ? [nx, cy, nz] : [nx, cy]);
                } catch (eSet2) {}
            }
        }

        function alignXSeparated(posX, cx) {
            if (!posX) return; try { if (posX.expressionEnabled) return; } catch (e) {}
            if (posX.numKeys > 0) {
                var base = posX.keyValue(1); var dx = cx - base;
                for (var k = 1; k <= posX.numKeys; k++) { try { posX.setValueAtKey(k, posX.keyValue(k) + dx); } catch (eK) {} }
            } else { try { posX.setValue(cx); } catch (eS) {} }
        }

        function alignYSeparated(posY, cy) {
            if (!posY) return; try { if (posY.expressionEnabled) return; } catch (e) {}
            if (posY.numKeys > 0) {
                var base = posY.keyValue(1); var dy = cy - base;
                for (var k = 1; k <= posY.numKeys; k++) { try { posY.setValueAtKey(k, posY.keyValue(k) + dy); } catch (eK) {} }
            } else { try { posY.setValue(cy); } catch (eS) {} }
        }

        for (var i = 1; i <= comp.numLayers; i++) {
            var ly = comp.layer(i);
            // Skip parented layers
            try { if (ly.parent) continue; } catch (ePar) {}
            // Recenter/align rules lookups
            var nm = String(ly.name || "");
            var rr = LAYER_NAME_CONFIG && LAYER_NAME_CONFIG.recenterRules ? LAYER_NAME_CONFIG.recenterRules : null;
            var inForce = rr ? nameInListCaseInsensitive(nm, rr.force || []) : false;
            var inSkip = rr ? nameInListCaseInsensitive(nm, rr.noRecenter || []) : false;
            var doAlignH = rr ? nameInListCaseInsensitive(nm, rr.alignH || []) : false;
            var doAlignV = rr ? nameInListCaseInsensitive(nm, rr.alignV || []) : false;
            var doRecenter = true;
            if (inSkip) doRecenter = false;
            if (inForce) doRecenter = true;

            var tr = null;
            try { tr = ly.property("ADBE Transform Group"); } catch (eTG) {}
            if (!tr) continue;
            var pos = tr.property("ADBE Position");
            var posX = null, posY = null;
            if (!pos) {
                posX = tr.property("ADBE Position_0");
                posY = tr.property("ADBE Position_1");
            }
            var wasLocked = false;
            try { wasLocked = (ly.locked === true); } catch (eLk) {}
            try { if (wasLocked) ly.locked = false; } catch (eUl) {}
            try {
                if (doRecenter) {
                    if (pos) shiftCombined(pos, cx, cy);
                    else if (posX && posY) shiftSeparated(posX, posY, cx, cy);
                }
                // Alignment step after re-centering (or standalone if recenter skipped)
                if (doAlignH) {
                    if (pos) alignXCombined(pos, cx); else if (posX) alignXSeparated(posX, cx);
                }
                if (doAlignV) {
                    if (pos) alignYCombined(pos, cy); else if (posY) alignYSeparated(posY, cy);
                }
            } catch (eSh) {}
            try { if (wasLocked) ly.locked = true; } catch (eRl) {}
        }
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

    // Base (orientation-agnostic) videoId builder from comp name
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

    // Determine orientation of a comp: landscape if width > height; portrait otherwise (square counts as portrait)
    function getCompOrientation(comp) {
        try { if (comp && comp.width > comp.height) return "landscape"; } catch (e) {}
        return "portrait";
    }

    // Build oriented videoId (e.g., "Title_30s_landscape") from comp; returns { oriented: string|null, base: string|null, orientation: string }
    function buildOrientedVideoId(comp) {
        var baseId = buildVideoIdFromCompName(comp ? comp.name : null);
        var orientation = getCompOrientation(comp);
        if (!baseId) return { oriented: null, base: null, orientation: orientation };
        return { oriented: baseId + "_" + orientation, base: baseId, orientation: orientation };
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
        var ids = buildOrientedVideoId(comp);
        if (!ids.base) { log("No base videoId derivable from comp: " + comp.name); return; }
        var v = null;
        // Try orientation-specific first
        if (ids.oriented) v = findVideoById(data, ids.oriented);
        // Fallback to base (backward compatibility / missing orientation entry)
        if (!v) v = findVideoById(data, ids.base);
        if (!v) {
            log("VideoId not found (tried oriented: '" + ids.oriented + "', base: '" + ids.base + "'). Orientation=" + ids.orientation);
            return;
        }
        var videoId = v.videoId || ids.oriented || ids.base;
        var logoMM = minMaxInOut(v.logo);
        var claimMM = minMaxInOut(v.claim);
        var disclaimerMM = minMaxInOut(v.disclaimer);
        // Helper to extract flag value given a configured key (checks video then video.metadata)
        function extractFlag(videoObj, keyName) {
            if (!videoObj || !keyName) return null;
            try {
                if (videoObj.hasOwnProperty(keyName) && videoObj[keyName] !== undefined && videoObj[keyName] !== null && videoObj[keyName] !== '') {
                    return String(videoObj[keyName]).toLowerCase();
                }
                if (videoObj.metadata && videoObj.metadata.hasOwnProperty(keyName) && videoObj.metadata[keyName] !== undefined && videoObj.metadata[keyName] !== null && videoObj.metadata[keyName] !== '') {
                    return String(videoObj.metadata[keyName]).toLowerCase();
                }
            } catch (eFlag) {}
            return null;
        }
        // Visibility flags (raw lower-cased values or null)
        var disclaimerFlag = extractFlag(v, DISCLAIMER_FLAG_KEY);   // raw value; interpret below
        var subtitlesFlag  = extractFlag(v, SUBTITLES_FLAG_KEY);

        function interpretFlag(raw, cfg, allowAuto) {
            if (!raw) return null;
            var val = String(raw).toLowerCase();
            function inList(list){ if(!list||!list.length) return false; for(var i=0;i<list.length;i++){ if(val===String(list[i]).toLowerCase()) return true; } return false; }
            if (inList(cfg.ON)) return 'on';
            if (inList(cfg.OFF)) return 'off';
            if (allowAuto && inList(cfg.AUTO)) return 'auto';
            return null; // unrecognized
        }
    var disclaimerMode = interpretFlag(disclaimerFlag, DISCLAIMER_FLAG_VALUES, false);  // 'on','off', or null
    var subtitlesMode  = interpretFlag(subtitlesFlag, SUBTITLES_FLAG_VALUES, false);   // 'on','off', or null
    var logoAnimFlag   = extractFlag(v, LOGO_ANIM_FLAG_KEY);
    var logoAnimMode   = interpretFlag(logoAnimFlag, LOGO_ANIM_FLAG_VALUES, false);    // 'on','off', or null
    // Defaults when flags are missing: force OFF
    var effectiveDisclaimerMode = disclaimerMode || 'off';
    var effectiveSubtitlesMode  = subtitlesMode  || 'off';
    var effectiveLogoAnimMode   = logoAnimMode   || 'off';
        // AUTO regime removed: no need to compute valid disclaimer intervals
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

        // Always set full comp duration for configured groups, plus disclaimer when gating is OFF
        // This replaces the previous hard-coded block with a config-driven iteration.
        if (FULL_DURATION_LAYER_GROUPS && FULL_DURATION_LAYER_GROUPS.length) {
            // Precompute raw literal names (those not present as group keys)
            var rawNameSet = {};
            for (var fd = 0; fd < FULL_DURATION_LAYER_GROUPS.length; fd++) {
                var entry = FULL_DURATION_LAYER_GROUPS[fd];
                if (!LAYER_NAME_CONFIG[entry]) {
                    rawNameSet[String(entry).toLowerCase()] = true;
                }
            }
            for (var si = 1; si <= comp.numLayers; si++) {
                var sLay = comp.layer(si);
                var sName = String(sLay.name || "");
                var sLower = sName.toLowerCase();
                var matched = false;
                // Raw literal match first
                if (rawNameSet[sLower]) {
                    setLayerInOut(sLay, 0, comp.duration, comp.duration);
                    matched = true;
                } else {
                    // Group-based match
                    for (var g = 0; g < FULL_DURATION_LAYER_GROUPS.length && !matched; g++) {
                        var key = FULL_DURATION_LAYER_GROUPS[g];
                        var cfg = LAYER_NAME_CONFIG[key];
                        if (!cfg) continue; // not a group; already covered by rawNameSet check
                        if (matchesExact(sName, cfg.exact) || matchesContains(sName, cfg.contains)) {
                            setLayerInOut(sLay, 0, comp.duration, comp.duration);
                            matched = true;
                        }
                    }
                }
                // Disclaimer full duration when gating OFF (only if not already matched as some other group)
                if (!matched && !ENABLE_JSON_TIMING_FOR_DISCLAIMER) {
                    if (matchesExact(sName, LAYER_NAME_CONFIG.disclaimer.exact) || matchesContains(sName, LAYER_NAME_CONFIG.disclaimer.contains)) {
                        setLayerInOut(sLay, 0, comp.duration, comp.duration);
                    }
                }
            }
        }

        // Apply JSON timings
        var appliedAny = false;
        for (var i = 1; i <= comp.numLayers; i++) {
            var ly = comp.layer(i);
            var nm = String(ly.name || "");
            // Logo matching (handle logo_anim first to avoid generic 'logo' contains-match)
            var isLogoAnim = (matchesExact(nm, LAYER_NAME_CONFIG.logoAnim.exact) || matchesContains(nm, LAYER_NAME_CONFIG.logoAnim.contains));
            var logoExact = matchesExact(nm, LAYER_NAME_CONFIG.logo.exact);
            var logoContains = matchesContains(nm, LAYER_NAME_CONFIG.logo.contains);
            var logoContainsOk = logoContains && (!LAYER_NAME_CONFIG.logo.imageOnlyForContains || isImageFootageLayer(ly));
            var isGenericLogo = (logoExact || logoContainsOk) && !isLogoAnim;

            // Apply for logo_anim first
            if (logoMM && isLogoAnim) {
                // timing (treat like logo timing)
                if (APPLY_LOGO_INPOINT_TO_LAYER_STARTTIME) {
                    var tinA = logoMM.tin < 0 ? 0 : logoMM.tin;
                    var toutA = logoMM.tout; if (toutA > comp.duration) toutA = comp.duration;
                    try { ly.startTime = tinA; } catch (eAS) {}
                    try { ly.inPoint   = tinA; } catch (eAI) {}
                    try { ly.outPoint  = toutA; } catch (eAO) {}
                    log("Set logo_anim layer '" + nm + "' (startTime=inPoint mode) to [" + tinA + ", " + toutA + ")");
                } else {
                    setLayerInOut(ly, logoMM.tin, logoMM.tout, comp.duration);
                    log("Set logo_anim layer '" + nm + "' to [" + logoMM.tin + ", " + logoMM.tout + ")");
                }
                // Optional gated stretch: speed up content while keeping outPoint at target time
                try {
                    if (ENABLE_LOGO_ANIM_TIMESTRETCH === true) {
                        var span = ly.outPoint - ly.inPoint;
                        if (span > 0 && span <= LOGO_ANIM_STRETCH_GATE_MAX_DURATION) {
                            // Compute desired stretch so that the first LOGO_ANIM_SOURCE_ANIM_DURATION seconds
                            // fit into (LOGO_ANIM_ANIM_END_FRACTION * span) seconds.
                            var targetAnimTime = LOGO_ANIM_ANIM_END_FRACTION * span;
                            // desired stretch percent = (target duration / source anim duration) * 100
                            var desiredPercent = (targetAnimTime / LOGO_ANIM_SOURCE_ANIM_DURATION) * 100.0;
                            // Base cap: do not exceed the configured base speed-up (i.e., do not go above LOGO_ANIM_STRETCH_PERCENT)
                            var basePercent = LOGO_ANIM_STRETCH_PERCENT;
                            // We want to make content faster (percent < 100). Use the smaller percent to be faster or equal to base.
                            // If desiredPercent is greater (slower) than basePercent, cap at basePercent; else use desiredPercent.
                            var finalPercent = desiredPercent;
                            if (finalPercent > basePercent) finalPercent = basePercent;
                            if (finalPercent < 1) finalPercent = 1; // avoid pathological values
                            // Apply stretch: prefer ly.stretch if available (UI property), fallback to ly.timeStretch
                            // 100 = normal speed, 50 = 2x speed
                            var beforeIn = ly.inPoint;
                            var beforeOut = ly.outPoint;
                            var appliedProp = null;
                            // Warn if time remap is enabled; AE may ignore stretch behavior with timeRemap
                            try { if (ly.timeRemapEnabled === true) { log("Note: timeRemapEnabled on '" + nm + "' — stretch may have no visible effect."); } } catch (eTR) {}
                            try { ly.stretch = finalPercent; appliedProp = 'stretch'; } catch (eS) {
                                try { ly.timeStretch = finalPercent; appliedProp = 'timeStretch'; } catch (eTS) {
                                    log("Stretch application failed for '"+nm+"' (no stretch property): " + eTS);
                                }
                            }
                            // Re-apply endpoints to keep target timing intact
                            try { ly.inPoint = beforeIn; } catch (eRI) {}
                            try { ly.outPoint = beforeOut; } catch (eRO) {}
                            if (APPLY_LOGO_INPOINT_TO_LAYER_STARTTIME) { try { ly.startTime = beforeIn; } catch (eRS) {} }
                            // Readback and log
                            var rb = null; try { rb = (typeof ly.stretch !== 'undefined') ? ly.stretch : ((typeof ly.timeStretch !== 'undefined') ? ly.timeStretch : null); } catch (eRB) { rb = null; }
                            log("Applied gated stretch to '" + nm + "': span=" + span.toFixed(3) + "s, desired=" + desiredPercent.toFixed(2) + "%, final=" + finalPercent.toFixed(2) + "% (base=" + basePercent + "%)" + (rb!==null? (", readback=" + rb + "% via " + (appliedProp||"?")) : ""));
                        } else {
                            log("Stretch gated OFF for '" + nm + "' (span=" + (span>0?span.toFixed(3):span) + "s, gate max=" + LOGO_ANIM_STRETCH_GATE_MAX_DURATION + "s)");
                        }
                    }
                } catch (eStr) { log("Stretch application failed for '"+nm+"': " + eStr); }
                // visibility toggle: ON => logo_anim ON, logo OFF; OFF => logo_anim OFF, logo ON
                try { ly.enabled = (effectiveLogoAnimMode === 'on'); } catch (eAVis) {}
                log("logo_anim_flag => " + effectiveLogoAnimMode.toUpperCase() + " | '"+nm+"' -> " + (ly.enabled ? "ON" : "OFF"));
                appliedAny = true;
                continue;
            }

            // Apply for generic 'logo'
            if (logoMM && isGenericLogo) {
                if (APPLY_LOGO_INPOINT_TO_LAYER_STARTTIME) {
                    var tinL = logoMM.tin < 0 ? 0 : logoMM.tin;
                    var toutL = logoMM.tout;
                    if (toutL > comp.duration) toutL = comp.duration;
                    try { ly.startTime = tinL; } catch (eLS) {}
                    try { ly.inPoint = tinL; } catch (eLI) {}
                    try { ly.outPoint = toutL; } catch (eLO) {}
                    log("Set logo layer '" + nm + "' (startTime=inPoint mode) to [" + tinL + ", " + toutL + ")");
                } else {
                    setLayerInOut(ly, logoMM.tin, logoMM.tout, comp.duration);
                    log("Set logo layer '" + nm + "' to [" + logoMM.tin + ", " + logoMM.tout + ")");
                }
                // visibility per logo_anim_flag inverse
                try { ly.enabled = (effectiveLogoAnimMode !== 'on'); } catch (eLVis) {}
                log("logo_anim_flag => " + effectiveLogoAnimMode.toUpperCase() + " | '"+nm+"' -> " + (ly.enabled ? "ON" : "OFF"));
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
                } // else already set to full duration above when gating off
                // Apply default OFF when missing
                try {
                    if (effectiveDisclaimerMode === 'on') {
                        ly.enabled = true;
                    } else {
                        ly.enabled = false; // default off
                    }
                    log("Set disclaimer visibility '" + nm + "' -> " + (ly.enabled ? "ON" : "OFF"));
                } catch (eVis2) { log("Disclaimer visibility set failed for '"+nm+"': "+eVis2); }
                if (!disclaimerMode && disclaimerFlag) {
                    log("Disclaimer flag value '" + disclaimerFlag + "' not recognized (configured ON:"+DISCLAIMER_FLAG_VALUES.ON.join('/')+", OFF:"+DISCLAIMER_FLAG_VALUES.OFF.join('/')+") for '" + nm + "'.");
                }
                continue; // prevent also treating as subtitles if naming overlaps
            }
            // Subtitles visibility flag (no timing applied here)
            if (matchesExact(nm, LAYER_NAME_CONFIG.subtitles.exact) || matchesContains(nm, LAYER_NAME_CONFIG.subtitles.contains)) {
                // Apply default OFF when missing
                try {
                    ly.enabled = (effectiveSubtitlesMode === 'on');
                    log("Set subtitles visibility '" + nm + "' -> " + (ly.enabled ? "ON" : "OFF"));
                } catch (eSV) { log("Subtitles visibility set failed for '"+nm+"': "+eSV); }
                if (!subtitlesMode && subtitlesFlag) {
                    log("Subtitles flag value '" + subtitlesFlag + "' not recognized (configured ON:"+SUBTITLES_FLAG_VALUES.ON.join('/')+", OFF:"+SUBTITLES_FLAG_VALUES.OFF.join('/')+") for '" + nm + "'.");
                }
            }
        }
        if (!appliedAny) {
            log("No logo/claim timing applied for " + videoId + " (orientation=" + ids.orientation + ").");
        } else {
            log("Applied timing for videoId=" + videoId + " (orientation=" + ids.orientation + ").");
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

    var rawTargets = getSelectedComps();
    if (!rawTargets.length) {
        alertOnce("Select one or more target compositions.");
        app.endUndoGroup();
        return;
    }
    // Protect templates: skip any selected comps that live under the template folder
    var targets = [];
    var skippedProtectedCount = 0;
    for (var rt = 0; rt < rawTargets.length; rt++) {
        var rtComp = rawTargets[rt];
        if (isDescendantOfFolder(rtComp, templateFolder)) {
            skippedProtectedCount++;
            log("Skipping protected template comp '" + rtComp.name + "' (inside template folder)." );
        } else {
            targets.push(rtComp);
        }
    }
    if (!targets.length) {
        if (skippedProtectedCount > 0) {
            alertOnce("Selection contains only template comps (protected). Aborting.");
        } else {
            alertOnce("Select one or more target compositions.");
        }
        app.endUndoGroup();
        return;
    }

    // Per-target template selection (Solution B)
    // We'll log chosen template per target below.

    // Load JSON once
    var jsonData = loadProjectJSONByName("data.json");
    if (!jsonData) { log("JSON 'data.json' not found or failed to parse. Timing wiring will be skipped."); }

    // Copy layers from template to each target, preserving exact order
    // Strategy: iterate template layers top->bottom (excluding the underlying video),
    // copy each to target (paste inserts at top), then move the newly pasted layer
    // after the previously inserted one. This yields the same stacking as the template.
    var addedTotal = 0;
    var skippedARCount = 0;
    var skippedCopyTotal = 0; // total layers skipped due to skip-copy rules across all comps
    for (var t = 0; t < targets.length; t++) {
        var comp = targets[t];
        var templateComp = pickBestTemplateCompForTarget(templateComps, comp);
        if (!templateComp) {
            var requireAR = (TEMPLATE_MATCH_CONFIG && TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch === true);
            if (requireAR) {
                var tolMsg = (TEMPLATE_MATCH_CONFIG && typeof TEMPLATE_MATCH_CONFIG.arTolerance === 'number') ? TEMPLATE_MATCH_CONFIG.arTolerance : 0.001;
                log("No template matches AR within tolerance (±" + tolMsg + ") for '" + comp.name + "'. Skipping.");
                if (!__AR_SKIP_ALERT_SHOWN) {
                    try { alert("Some selected comps were skipped because no template matched their aspect ratio within tolerance (±" + tolMsg + "). You can adjust TEMPLATE_MATCH_CONFIG.arTolerance or disable TEMPLATE_MATCH_CONFIG.requireAspectRatioMatch."); } catch (eA) {}
                    __AR_SKIP_ALERT_SHOWN = true;
                }
                skippedARCount++;
                continue;
            }
            templateComp = pickBestTemplateComp(templateComps);
        }
        var excludeIdx = findBottomVideoFootageLayerIndex(templateComp);
        log("\n" + "Using template: " + templateComp.name + " -> target: " + comp.name + (excludeIdx > 0 ? (" (excluding layer #" + excludeIdx + ")") : ""));
    var added = 0;
    var skipCopyCount = 0; // per-comp count of layers skipped due to skip-copy rules
        var lastInserted = null; // track stacking chain for moveAfter
        // Track mapping from template layer index -> { newLayer, parentIdx }
        var mapNewLayers = [];

        // Resolve flags for this comp ahead of copying to allow skip-copy behavior
        var ids = buildOrientedVideoId(comp);
        var vRec = null; if (ids.oriented) vRec = findVideoById(jsonData, ids.oriented); if (!vRec) vRec = findVideoById(jsonData, ids.base);
        function _extractFlagLocal(vobj, key) {
            if (!vobj || !key) return null;
            try {
                if (vobj.hasOwnProperty(key) && vobj[key] !== undefined && vobj[key] !== null && vobj[key] !== '') return String(vobj[key]).toLowerCase();
                if (vobj.metadata && vobj.metadata.hasOwnProperty(key) && vobj.metadata[key] !== undefined && vobj.metadata[key] !== null && vobj.metadata[key] !== '') return String(vobj.metadata[key]).toLowerCase();
            } catch (eF) {}
            return null;
        }
        function _interpret(raw, cfg) {
            if (!raw) return null; var val = String(raw).toLowerCase();
            function inList(list){ if(!list||!list.length) return false; for(var i=0;i<list.length;i++) if(val===String(list[i]).toLowerCase()) return true; return false; }
            if (inList(cfg.ON)) return 'on'; if (inList(cfg.OFF)) return 'off'; return null;
        }
        var _discMode = 'off', _subtMode = 'off', _logoAnimMode = 'off';
        if (vRec) {
            var dfRaw = _extractFlagLocal(vRec, DISCLAIMER_FLAG_KEY);
            var sfRaw = _extractFlagLocal(vRec, SUBTITLES_FLAG_KEY);
            var lafRaw = _extractFlagLocal(vRec, LOGO_ANIM_FLAG_KEY);
            var dm = _interpret(dfRaw, DISCLAIMER_FLAG_VALUES);
            var sm = _interpret(sfRaw, SUBTITLES_FLAG_VALUES);
            var lm = _interpret(lafRaw, LOGO_ANIM_FLAG_VALUES);
            _discMode = dm || 'off';
            _subtMode = sm || 'off';
            _logoAnimMode = lm || 'off';
        }

        // Iterate top -> bottom to mirror order precisely
        for (var li = 1; li <= templateComp.numLayers; li++) {
            if (li === excludeIdx) continue; // skip underlying video footage layer
            var srcLayer = templateComp.layer(li);
            try {
                // Skip-copy behavior per-flag
                var lname = String(srcLayer.name || "");
                var isLogoAnim = nameMatchesGroup(lname, 'logoAnim');
                var isLogoGeneric = nameMatchesGroup(lname, 'logo') && !isLogoAnim; // avoid double-match
                var isDisclaimer = nameMatchesGroup(lname, 'disclaimer');
                var isSubtitles = nameMatchesGroup(lname, 'subtitles');
                var alwaysCopyBaseLogo = nameInListCaseInsensitive(lname, (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.alwaysCopyLogoBaseNames) ? SKIP_COPY_CONFIG.alwaysCopyLogoBaseNames : []);
                // If a base logo name also matches logoAnim due to config, force it to be treated as generic base logo
                if (isLogoAnim && alwaysCopyBaseLogo) { isLogoAnim = false; isLogoGeneric = true; }
                if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.logoAnimOff) {
                    if (isLogoAnim && _logoAnimMode !== 'on') { log("Skip copy: '"+lname+"' (logo_anim OFF)" ); skipCopyCount++; continue; }
                    if (isLogoGeneric && _logoAnimMode === 'on' && !alwaysCopyBaseLogo) { log("Skip copy: '"+lname+"' (logo generic OFF due to logo_anim ON)" ); skipCopyCount++; continue; }
                }
                if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.disclaimerOff && isDisclaimer && _discMode !== 'on') { log("Skip copy: '"+lname+"' (disclaimer OFF)"); skipCopyCount++; continue; }
                if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.subtitlesOff && isSubtitles && _subtMode !== 'on') { log("Skip copy: '"+lname+"' (subtitles OFF)"); skipCopyCount++; continue; }
                if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.groups && SKIP_COPY_CONFIG.groups.enabled && SKIP_COPY_CONFIG.groups.keys && SKIP_COPY_CONFIG.groups.keys.length) {
                    var groupSkipped = false;
                    for (var gk = 0; gk < SKIP_COPY_CONFIG.groups.keys.length; gk++) {
                        var key = SKIP_COPY_CONFIG.groups.keys[gk]; if (!key) continue;
                        // Do not skip base logo names through this mechanism
                        if (alwaysCopyBaseLogo && (key === 'logo' || key === 'logoAnim')) continue;
                        if (nameMatchesGroup(lname, key)) { log("Skip copy: '"+lname+"' (group skip: " + key + ")"); groupSkipped = true; break; }
                    }
                    if (groupSkipped) { skipCopyCount++; continue; }
                }
                if (SKIP_COPY_CONFIG && SKIP_COPY_CONFIG.adHoc && SKIP_COPY_CONFIG.adHoc.enabled && SKIP_COPY_CONFIG.adHoc.tokens && SKIP_COPY_CONFIG.adHoc.tokens.length) {
                    if (!alwaysCopyBaseLogo && nameMatchesAnyTokenContains(lname, SKIP_COPY_CONFIG.adHoc.tokens)) { log("Skip copy: '"+lname+"' (ad-hoc skip)"); skipCopyCount++; continue; }
                }

                // Capture and temporarily clear parent to avoid copy failures for linked layers
                var origParent = null; var hadParent = false; var parentIdx = null;
                try {
                    if (srcLayer.parent) {
                        origParent = srcLayer.parent; hadParent = true; parentIdx = origParent.index;
                        srcLayer.parent = null;
                    }
                } catch (ePar) {}

                var newLayer = srcLayer.copyToComp(comp);
                // Fallback if API returns undefined: assume the newest is at top
                if (!newLayer) { try { newLayer = comp.layer(1); } catch (eNL) {} }
                // Restore template layer parent
                try { if (hadParent) srcLayer.parent = origParent; } catch (eParR) {}
                // Reposition to preserve order: place after previously inserted
                if (newLayer && lastInserted && newLayer !== lastInserted) {
                    // Temporarily unlock involved layers to avoid ordering issues, then restore states
                    var newWasLocked = false, lastWasLocked = false;
                    try { newWasLocked = (newLayer.locked === true); } catch (eNLk) {}
                    try { lastWasLocked = (lastInserted.locked === true); } catch (eLLk) {}
                    try { if (newWasLocked) newLayer.locked = false; } catch (eNul) {}
                    try { if (lastWasLocked) lastInserted.locked = false; } catch (eLul) {}
                    try { newLayer.moveAfter(lastInserted); } catch (eMove) {}
                    // Restore locks
                    try { if (lastWasLocked) lastInserted.locked = true; } catch (eLrl) {}
                    try { if (newWasLocked) newLayer.locked = true; } catch (eNrl) {}
                }
                if (newLayer) lastInserted = newLayer;
                // Save mapping
                mapNewLayers[li] = { newLayer: newLayer, parentIdx: parentIdx };
                added++;
            } catch (eCopy) {
                log("Skip layer #" + li + " ('" + srcLayer.name + "') — " + (eCopy && eCopy.message ? eCopy.message : eCopy));
            }
        }
        // Restore parent relationships in target when possible
        try {
            for (var li2 = 1; li2 <= templateComp.numLayers; li2++) {
                if (li2 === excludeIdx) continue;
                var entry = mapNewLayers[li2];
                if (!entry || !entry.newLayer) continue;
                var pIdx = entry.parentIdx;
                if (pIdx === null || pIdx === undefined || pIdx === excludeIdx) continue;
                var pEntry = mapNewLayers[pIdx];
                if (!pEntry || !pEntry.newLayer) continue;
                try {
                    var child = entry.newLayer;
                    var parent = pEntry.newLayer;
                    var childWasLocked = false;
                    try { childWasLocked = (child.locked === true); } catch (eCl) {}
                    try { if (childWasLocked) child.locked = false; } catch (eCu) {}
                    child.parent = parent;
                    try { if (childWasLocked) child.locked = true; } catch (eCr) {}
                } catch (eSetP) {}
            }
        } catch (eMap) {}
        // Auto-center for aspect ratio mismatch (un-parented layers only)
        if (ENABLE_AUTOCENTER_ON_AR_MISMATCH && arMismatch(templateComp, comp)) {
            try { recenterUnparentedLayers(comp); } catch (eRC) { log("Auto-center failed for '" + comp.name + "': " + eRC); }
        }

        addedTotal += added;
        skippedCopyTotal += skipCopyCount;
    log("Skipped " + skipCopyCount + " layer(s) (copy) in '" + comp.name + "'.");
    log("Inserted " + added + " layer(s) into '" + comp.name + "'.");
        // Apply JSON timings (logo/claim) to corresponding layers
        if (jsonData) {
            applyJSONTimingToComp(comp, jsonData);
        }
    }

    var processedCount = targets.length - skippedARCount;
    var __summaryMsg = "Processed " + processedCount + ", skipped " + skippedARCount + " due to AR mismatch, skipped " + skippedProtectedCount + " protected template comps. Total layers added: " + addedTotal + ". Total layers skipped (copy): " + skippedCopyTotal + ".";
    log("\n" + __summaryMsg); // add the complete summarising alert at the end to the log as well
    alertOnce(__summaryMsg);
    app.endUndoGroup();
})();
