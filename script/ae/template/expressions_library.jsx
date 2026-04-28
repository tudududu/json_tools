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

    // ── claim (reserved for future item) ─────────────────────────────────────

    // claim_source_text
    // Reads the claim text field from data.json for the resolved video and orientation.
    // DATA_KEY is set to "claim"; reads line 1 by default.
    globalObj.AE_EXPRESSIONS["claim_source_text"] = [
        '// claim_source_text — orientation-aware claim from data.json',
        'var FOOTAGE_NAME = "data.json";',
        'var DATA_KEY = "claim";',
        'var desiredLine = 1;',
        'var ORIENT_MODE = "Auto";',
        'var nameShift = 1;',
        'var compOrientation;',
        'var nameLower = thisComp.name.toLowerCase();',
        'if (ORIENT_MODE === "Landscape") { compOrientation = "landscape"; }',
        'else if (ORIENT_MODE === "Portrait") { compOrientation = "portrait"; }',
        'else {',
        '  var compAR = thisComp.width / Math.max(1, thisComp.height);',
        '  compOrientation = compAR > 1 ? "landscape" : "portrait";',
        '  if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";',
        '  else if (nameLower.indexOf("_portrait") >= 0) compOrientation = "portrait";',
        '}',
        'var token1 = 0 + nameShift; var token2 = 1 + nameShift;',
        'function baseVideoId() {',
        '  var p = thisComp.name.split("_");',
        '  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : "";',
        '}',
        'var baseId = baseVideoId();',
        'var orientedId = baseId ? (baseId + "_" + compOrientation) : "";',
        'var directId = thisComp.name;',
        'function pickFromArray(arr, lineNum) {',
        '  if (!arr || arr.length === 0) return "";',
        '  var first = arr[0];',
        '  if (typeof first === "string") {',
        '    var idx = Math.max(0, Math.min(arr.length - 1, lineNum - 1));',
        '    return (arr[idx] || "") + "";',
        '  } else {',
        '    for (var i = 0; i < arr.length; i++) {',
        '      if (arr[i] && arr[i].line == lineNum) return (arr[i].text || "") + "";',
        '    }',
        '    return "";',
        '  }',
        '}',
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
        'var result = "";',
        'try {',
        '  var data = footage(FOOTAGE_NAME).sourceData;',
        '  var video = findVideo(data, [orientedId, directId, baseId]);',
        '  var orientKey = compOrientation;',
        '  var arr = video ? (video[DATA_KEY] ? video[DATA_KEY] : (data[DATA_KEY] ? data[DATA_KEY][orientKey] : null)) : (data[DATA_KEY] ? data[DATA_KEY][orientKey] : null);',
        '  result = arr ? pickFromArray(arr, desiredLine) : "";',
        '} catch(e) { result = ""; }',
        'result;'
    ].join("\n");

    // claim_position
    // Baseline-locked position tied to the Size_Holder_Claim shape layer in the comp.
    // Reads Padding, Align X, Align Y from expression controls on the holder.
    globalObj.AE_EXPRESSIONS["claim_position"] = [
        '// claim_position — baseline-locked to Size_Holder_Claim',
        'var holder = thisComp.layer("Size_Holder_Claim");',
        'var group  = holder.content("PLACEHOLDER");',
        'var rect   = group.content("Rectangle Path 1");',
        'function norm(v){ var L=length(v,[0,0,0]); return (L>0)?v/L:v; }',
        'var gp=group.transform.position;',
        'var C=holder.toComp(gp);',
        'var Xax=norm(holder.toCompVec([1,0,0]));',
        'var Yax=norm(holder.toCompVec([0,1,0]));',
        'var cCtr=C;',
        'var cR=holder.toComp([gp[0]+rect.size[0]/2,gp[1]]);',
        'var cT=holder.toComp([gp[0],gp[1]-rect.size[1]/2]);',
        'var halfW=length(cR-cCtr); var halfH=length(cT-cCtr);',
        'function ctrl(name,def){',
        '  try{return holder.effect(name)(name.match(/Menu/i)?"Menu":"Slider").value;}catch(e){return def;}',
        '}',
        'var pad=Math.max(0,ctrl("Padding",0));',
        'var ax=Math.max(-1,Math.min(1,ctrl("Align X",0)));',
        'var ay=Math.max(-1,Math.min(1,ctrl("Align Y",0)));',
        'halfW=Math.max(0,halfW-pad); halfH=Math.max(0,halfH-pad);',
        'var P=C+Xax*(ax*halfW)+Yax*(ay*halfH);',
        'function isText(li){try{li.text.sourceText;return true;}catch(e){return false;}}',
        'if(isText(thisLayer)){',
        '  var r=sourceRectAtTime(time,false);',
        '  var w=Math.max(1,r.width); var bx=r.left+w/2;',
        '  var pL=[bx,0];',
        '  var lP=fromComp(P); var deltaL=pL-lP;',
        '  var deltaC=toComp(deltaL)-toComp([0,0]);',
        '  thisLayer.threeDLayer?value+[deltaC[0],deltaC[1],0]:value+deltaC;',
        '} else {',
        '  thisLayer.threeDLayer?[P[0],P[1],value[2]]:P;',
        '}'
    ].join("\n");

}($.global));
