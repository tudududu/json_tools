// sourceText_json_wire_simple 260502
// not-time-gated, orientation-aware/override
// ------------------------------------------------------------------------------
// based on v05
// Rewired for new JSON shape with orientation-specific top-level keys:
//   claim: { landscape:[...], portrait:[...] }
// Video objects duplicated per orientation with videoId suffixed: e.g. WTAVL_120s_landscape
// ------------------------------------------------------------------------------
// Usage:
//   Set DATA_KEY to one of: "claim", "disclaimer", "logo", "subtitles" (if you adapt logic)
//   desiredLine is 1-based for line selection within video-level arrays or top-level arrays.
//   Orientation auto-detected from comp aspect ratio (>=1 => landscape, else portrait).

var FOOTAGE_NAME = "data.json";  // JSON footage name in Project panel

// Read controls from this text layer (Effects > Expression Controls)
// Required effects:
//   Dropdown Menu Control  "Data Key Menu"     -> claim | disclaimer | logo | subtitles | super_A
//   Slider Control         "Desired Line"      -> 0 = time-driven multi; >0 fixed line
//   Dropdown Menu Control  "Orientation Menu"  -> Auto | Landscape | Portrait
//   Slider Control         "Name Shift"        -> 0,1,2...
function ctrl(name, def) {
  try {
    return effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value;
  } catch (e) { return def; }
}

// Keep menu arrays in the same order as Dropdown items in AE.
var DATA_KEY_OPTIONS = ["claim", "disclaimer", "logo", "subtitles", "super_A", "super_B"];
var ORIENT_OPTIONS = ["Auto", "Landscape", "Portrait"];

var _dkIdx = Math.round(ctrl("Data Key Menu", 1)) - 1;      // default "disclaimer"
var _omIdx = Math.round(ctrl("Orientation Menu", 1)) - 1;   // default "Auto"

var DATA_KEY = DATA_KEY_OPTIONS[Math.max(0, Math.min(DATA_KEY_OPTIONS.length - 1, _dkIdx))];
var desiredLine = Math.round(ctrl("Desired Line", 1));      // 0=time-driven multi; >0 fixed line
var ORIENT_MODE = ORIENT_OPTIONS[Math.max(0, Math.min(ORIENT_OPTIONS.length - 1, _omIdx))];
var nameShift = Math.round(ctrl("Name Shift", 1));  // 0 = Title_30s; 1 = Clien_Title_30s; 2 = Client_Brand_Title_30s

// -------- Orientation detection / override -------- 
// Determine compOrientation from comp aspect ratio OR from comp name suffix if present
var compOrientation;
var nameLower = thisComp.name.toLowerCase();
if (ORIENT_MODE === "Landscape") {
  compOrientation = "landscape";
} else if (ORIENT_MODE === "Portrait") {
  compOrientation = "portrait";
} else {
  // Auto: aspect-based with suffix override
  var compAR = (thisComp.width / Math.max(1, thisComp.height));
  compOrientation = compAR > 1 ? "landscape" : "portrait"; // square -> portrait
  // Explicit override if comp name contains _landscape or _portrait
  if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
  else if (nameLower.indexOf("_portrait") >= 0) compOrientation = "portrait";
}

// -------- VideoId derivation --------
// Derive base video id from comp name: "Title_15s_*" → "Title_15s"; oriented id adds suffix
var token1 = 0 + nameShift;
var token2 = 1 + nameShift;

function baseVideoId() {
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : ""; // Title_15s
}
var baseId = baseVideoId();
var orientedId = baseId ? (baseId + "_" + compOrientation) : ""; // Title_15s_landscape

// If comp name already equals a videoId exactly, use it directly
var directId = thisComp.name; // fallback candidate

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
  getText(data, orientedId, baseId, directId, DATA_KEY, desiredLine, compOrientation);
} catch (e) {
  "";
}