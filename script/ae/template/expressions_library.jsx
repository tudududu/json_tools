// Expressions Library — expressions_library.jsx
// Registry of named AE expression strings used by layer_template.jsx.
// Keys are symbolic names referenced from layer_templates_library.jsx item definitions.
// Expression strings are raw AE expression source — do not include JSON escaping.
//
// Usage: always loaded by layer_template.jsx via $.evalFile before item execution.
// Direct execution produces no side effects.

#target aftereffects

(function initExpressionsLibrary(globalObj) {
    if (!globalObj) return;
    if (!globalObj.AE_EXPRESSIONS || typeof globalObj.AE_EXPRESSIONS !== "object") {
        globalObj.AE_EXPRESSIONS = {};
    }

    // ── info ─────────────────────────────────────────────────────────────────

    // info_source_text
    // Builds an informational multiline debug string from the linked data.json footage.
    // Combines global metadata and resolved video-level metadata for QA inspection.
    // Reads FOOTAGE_NAME from the project. Orientation-aware via comp AR.
    globalObj.AE_EXPRESSIONS["info_source_text"] = [
        '// sourceText_json_info — per-video metadata inspector',
        'var FOOTAGE_NAME = "data.json";',
        'var nameShift = 1;',
        'var ar = thisComp.width / Math.max(1, thisComp.height);',
        'function orientFromAR(r){ return r > 1 ? "landscape" : "portrait"; }',
        'var compOrientTest = orientFromAR(ar);',
        'var nameLower = thisComp.name.toLowerCase();',
        'if (nameLower.indexOf("_landscape") >= 0) compOrientTest = "landscape";',
        'else if (nameLower.indexOf("_portrait") >= 0) compOrientTest = "portrait";',
        'var token1 = 0 + nameShift;',
        'var token2 = 1 + nameShift;',
        'function baseVideoId() {',
        '  var p = thisComp.name.split("_");',
        '  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : "";',
        '}',
        'var baseId = baseVideoId();',
        'var orientedId = baseId ? (baseId + "_" + compOrientTest) : "";',
        'var directId = thisComp.name;',
        'function findVideo(data, candidates) {',
        '  if (!data || !data.videos) return null;',
        '  var vids = data.videos;',
        '  for (var c = 0; c < candidates.length; c++) {',
        '    var target = (candidates[c] + "").toLowerCase();',
        '    if (!target) continue;',
        '    for (var i = 0; i < vids.length; i++) {',
        '      if ((vids[i].videoId + "").toLowerCase() === target) return vids[i];',
        '    }',
        '  }',
        '  return null;',
        '}',
        'function safe(obj, path, defVal) {',
        '  try {',
        '    var ref = obj;',
        '    for (var i = 0; i < path.length; i++) { if (!ref) return defVal; ref = ref[path[i]]; }',
        '    return (ref == null) ? defVal : ref;',
        '  } catch(e) { return defVal; }',
        '}',
        'function toStr(v){ return (v == null) ? "-" : (v + ""); }',
        'var sizeX = thisComp.width; var sizeY = thisComp.height;',
        'function gcd(x,y){ return (y===0)?x:gcd(y,x%y); }',
        'var r = gcd(sizeX,sizeY); var resultAspect = (sizeX/r)+":"+(sizeY/r);',
        'var out = "";',
        'try {',
        '  var data = footage(FOOTAGE_NAME).sourceData;',
        '  var globalMeta = data ? data.metadataGlobal : null;',
        '  var video = findVideo(data, [orientedId, directId, baseId]);',
        '  out += "aspect: " + resultAspect + "\\n";',
        '  out += "orient: " + compOrientTest + "\\n";',
        '  out += "client: " + toStr(safe(globalMeta,["client"],"-")) + "\\n";',
        '  out += "campaign: " + toStr(safe(globalMeta,["campaign"],"-")) + "\\n";',
        '  if (video) {',
        '    out += "videoId: " + toStr(video.videoId) + "\\n";',
        '    out += "duration: " + toStr(safe(video,["meta","duration"],"-")) + "\\n";',
        '    out += "title: " + toStr(safe(video,["meta","title"],"-"));',
        '  } else {',
        '    out += "videoId: (not matched)";',
        '  }',
        '} catch(e) { out = "data.json not linked"; }',
        'out;'
    ].join("\n");

    // info_position
    // Positions this text layer baseline at the vertical and horizontal center of the comp.
    // Intended as a safe default position for the info debug layer.
    globalObj.AE_EXPRESSIONS["info_position"] = [
        '// info_position — centered in comp',
        '[0 + thisComp.width * 0.05, 0 + thisComp.height * 0.05];'
    ].join("\n");

    // ── claim ────────────────────────────────────────────────────────────────

    function readTextFile(absPath) {
        var f = new File(absPath);
        if (!f.exists) return "";
        try {
            f.encoding = "UTF-8";
            if (!f.open("r")) return "";
            var t = f.read();
            f.close();
            return String(t || "");
        } catch(_) {
            try { f.close(); } catch(__) {}
            return "";
        }
    }

    function registerExpressionFromProjectPath(key, relativePathFromRoot) {
        var base = null;
        try { base = File($.fileName).parent; } catch(_) { base = null; }
        if (!base) {
            globalObj.AE_EXPRESSIONS[key] = "";
            return;
        }
        var abs = base.fsName + "/../../../" + String(relativePathFromRoot || "");
        var body = readTextFile(abs);
        globalObj.AE_EXPRESSIONS[key] = body;
    }

    registerExpressionFromProjectPath("claim_source_text", "expression_ae/claim/sourceText_json_wire_simple.js");
    registerExpressionFromProjectPath("claim_anchor",      "expression_ae/claim/anchor_baseline_centered_text.js");
    registerExpressionFromProjectPath("claim_position",    "expression_ae/claim/position_baseline_locked_text_multiline.js");
    registerExpressionFromProjectPath("claim_scale",       "expression_ae/claim/scale_uniform_contain_v02.js");
    registerExpressionFromProjectPath("claim_opacity",     "expression_ae/opacity/opacity_fadein_onTime_v08.js");

}($.global));
