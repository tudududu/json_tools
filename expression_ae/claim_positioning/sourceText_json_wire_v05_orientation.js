// sourceText_json_wire
// v05 (orientation update)
// Rewired for new JSON shape with orientation-specific top-level keys:
//   claim: { landscape:[...], portrait:[...] }
//   disclaimer: { landscape:[...], portrait:[...] }
//   logo: { landscape:[...], portrait:[...] }
// Video objects duplicated per orientation with videoId suffixed: e.g. WTAVL_120s_landscape
// ------------------------------------------------------------------------------
// Usage:
//   Set DATA_KEY to one of: "claim", "disclaimer", "logo", "subtitles" (if you adapt logic)
//   desiredLine is 1-based for line selection within video-level arrays or top-level arrays.
//   Orientation auto-detected from comp aspect ratio (>=1 => landscape, else portrait).

var FOOTAGE_NAME = "data.json";  // JSON footage name in Project panel
var DATA_KEY     = "claim";       // "claim" | "disclaimer" | "logo"
var desiredLine  = 1;             // 1-based

// Determine compOrientation from comp aspect ratio OR from comp name suffix if present
var compAR = (thisComp.width / Math.max(1, thisComp.height));
var compOrientation = compAR > 1 ? "landscape" : "portrait";

// Allow explicit override if comp name contains _landscape or _portrait
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
else if (nameLower.indexOf("_portrait") >= 0) compOrientation = "portrait";

// Derive base video id from comp name: "Title_15s_*" → "Title_15s"; oriented id adds suffix
var parts = thisComp.name.split("_");
var baseVideoId = (parts.length >= 2) ? (parts[0] + "_" + parts[1]) : ""; // Title_15s
var orientedVideoId = baseVideoId ? (baseVideoId + "_" + compOrientation) : ""; // Title_15s_landscape

// If comp name already equals a videoId exactly, use it directly
var directVideoId = thisComp.name; // fallback candidate

function pickFromArray(arr, lineNum) {
  if (!arr || arr.length === 0) return "";
  var first = arr[0];
  if (typeof first === "string") {
    var idx = Math.max(0, Math.min(arr.length - 1, lineNum - 1));
    return (arr[idx] || "") + "";
  } else {
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (it && it.line == lineNum) return (it.text || "") + "";
    }
    return "";
  }
}

function findVideo(data, candidates) {
  if (!data || !data.videos) return null;
  var vids = data.videos;
  for (var c = 0; c < candidates.length; c++) {
    var target = (candidates[c] + "").toLowerCase();
    if (!target) continue;
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if ((v.videoId + "").toLowerCase() === target) return v;
    }
  }
  return null;
}

function getGlobalArray(data, key, compOrientation) {
  if (!data) return null;
  var block = data[key];
  if (!block) return null;
  // New shape: object of orientations
  if (block instanceof Array) {
    // Legacy shape fallback
    return block;
  } else {
    return block[compOrientation] || null;
  }
}

function getText(data, orientedId, baseId, directId, key, lineNum, compOrientation) {
  if (!data) return "";
  // Try oriented video id first, then direct comp name, then base id (legacy)
  var vid = findVideo(data, [orientedId, directId, baseId]);
  if (vid) {
    var arr = vid[key];
    var txt = pickFromArray(arr, lineNum);
    if (txt) return txt;
  }
  // Fallback to top-level orientation-specific array
  var g = getGlobalArray(data, key, compOrientation);
  return pickFromArray(g, lineNum);
}

try {
  var data = footage(FOOTAGE_NAME).sourceData;
  getText(data, orientedVideoId, baseVideoId, directVideoId, DATA_KEY, desiredLine, compOrientation);
} catch (e) {
  "";
}