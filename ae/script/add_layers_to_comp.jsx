// Script for Adobe After Effects — Add layers to composition from a template comp
// ——————————————————————————————————————————————————————————————
// What it does
// 1) Finds the template composition under Project panel path: ./project/work/template/
//    Expected template name pattern: title_duration_template_YYMMDD_vNN
//    Example: WTA_30s_template_250923_v01
// 2) Copies ALL layers from the template EXCEPT the underlying video footage layer
//    defined as: the highest layer index whose source is a FootageItem with video
// 3) Pastes/copies those layers into the selected compositions, preserving order and timing
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

    // Locate template folder and comp ——————————————————————————
    var templateFolder = findFolderPath(proj.rootFolder, ["project", "work", "template"]);
    if (!templateFolder) {
        alertOnce("Template folder not found at ./project/work/template/");
        app.endUndoGroup();
        return;
    }

    var templateComps = [];
    collectCompsRecursive(templateFolder, templateComps);
    if (!templateComps.length) {
        alertOnce("No template composition found in ./project/work/template/");
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

    // Copy layers from template to each target, preserving order (copy bottom->top)
    var addedTotal = 0;
    for (var t = 0; t < targets.length; t++) {
        var comp = targets[t];
        var added = 0;
        for (var li = templateComp.numLayers; li >= 1; li--) {
            if (li === excludeIdx) continue; // skip underlying video footage layer
            var srcLayer = templateComp.layer(li);
            try {
                srcLayer.copyToComp(comp);
                added++;
            } catch (eCopy) {
                log("Skip layer #" + li + " ('" + srcLayer.name + "') — " + (eCopy && eCopy.message ? eCopy.message : eCopy));
            }
        }
        addedTotal += added;
        log("Inserted " + added + " layer(s) into '" + comp.name + "'.");
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