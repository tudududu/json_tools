// sourceText_json_wire v12 (orientation-aware/override, time-gated, multi-line)
// JSON → text; orientation-specific global keys + oriented videoIds
// DATA_KEY: "subtitles" | "claim" | "disclaimer" | "logo"
// Behavior:
//   subtitles: show ALL active lines (time ∈ [in,out)) stacked
//   claim/disclaimer/logo: desiredLine>0 → that line only (gated); desiredLine=0 → all active
// Orientation resolution order: explicit suffix in comp name (_landscape/_portrait) else aspect ratio (>1 landscape, else portrait). Square (1:1) treated as portrait by using >1 test.

var FOOTAGE_NAME = "data.json"; // JSON footage name
var DATA_KEY = "claim";   // key to pull
var desiredLine = 1;            // 0=time-driven multi; >0 fixed line
// Orientation override: "Auto" | "Landscape" | "Portrait"
var ORIENT_MODE = "Auto";
var nameShift = 1;  // 0 = Title_30s; 1 = Clien_Title_30s; 2 = Client_Brand_Title_30s

// -------- Orientation detection / override -------- 
var compOrientation;
var nameLower = thisComp.name.toLowerCase();
if (ORIENT_MODE === "Landscape") {
  compOrientation = "landscape";
} else if (ORIENT_MODE === "Portrait") {
  compOrientation = "portrait";
} else {
  // Auto: aspect-based with suffix override
  var compAR = thisComp.width / Math.max(1, thisComp.height);
  compOrientation = compAR > 1 ? "landscape" : "portrait"; // square -> portrait
  if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
  else if (nameLower.indexOf("_portrait") >= 0) compOrientation = "portrait";
}

// -------- VideoId derivation --------
var token1 = 0 + nameShift;
var token2 = 1 + nameShift;

function baseVideoId() {
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : ""; // Title_15s
}
var baseId = baseVideoId();
var orientedId = baseId ? (baseId + "_" + compOrientation) : "";
var directId = thisComp.name; // full comp name fallback

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

function getOrientationGlobalBlock(data, key) {
  if (!data) return null;
  var block = data[key];
  if (!block) return null;
  if (block instanceof Array) {
    // legacy shape fallback
    return block;
  }
  return block[compOrientation] || null;
}

function getVideoArray(vidObj, key) {
  if (!vidObj) return null;
  return vidObj[key] || null;
}

function getText(it) {
  if (it == null) return "";
  // Support arrays of plain strings or objects with .text
  if (typeof it === "string") return it + "";
  return (it.text != null) ? (it.text + "") : "";
}

function pickLine(arr, lineNum) {
  if (!arr) return null;
  // If it's an array of strings, use index selection
  if (arr.length > 0 && typeof arr[0] === "string") {
    var idx = Math.max(0, Math.min(arr.length - 1, lineNum - 1));
    return arr[idx];
  }
  // Otherwise, expect objects with .line
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (it && it.line == lineNum) return it;
  }
  return null;
}

// Exclusive-out check: visible when t ∈ [in, out)
function activeByTime(arr, t) {
  var res = [];
  if (!arr) return res;
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (!it) continue;
    // Plain strings have no timing → always active
    if (typeof it === "string") {
      res.push(it);
      continue;
    }
    var s = Number(it["in"]);
    var e = Number(it["out"]);
    // If timing missing, treat as always active (non-subtitles often untimed)
    if (isNaN(s) || isNaN(e)) {
      res.push(it);
    } else if (t >= s && t < e) {
      res.push(it);
    }
  }
  return res;
}

function joinTexts(items) {
  var out = "";
  for (var i = 0; i < items.length; i++) {
    if (!items[i]) continue;
    if (out.length > 0) out += "\r"; // stack on new lines
    out += getText(items[i]);
  }
  return out;
}

try {
  var data = footage(FOOTAGE_NAME).sourceData;
  var vid = findVideo(data, [orientedId, directId, baseId]);
  var arr = getVideoArray(vid, DATA_KEY);
  var t = time;

  if (!arr) {
    // Fallback: orientation-specific global block (only for non-subtitles keys)
    if (DATA_KEY === "subtitles") {
      "";
    } else {
      var glob = getOrientationGlobalBlock(data, DATA_KEY);
      if (!glob) {
        "";
      } else {
        // If desiredLine=0, join all (no timing at global level)
        if (desiredLine === 0) {
          joinTexts(glob);
        } else {
          // Strings: index-based; Objects: pick by .line
          var pick = pickLine(glob, desiredLine);
          getText(pick);
        }
      }
    }
  } else {
    if (DATA_KEY === "subtitles" || desiredLine === 0) {
      var items = activeByTime(arr, t);
      joinTexts(items);
    } else {
      var item = pickLine(arr, desiredLine);
      if (!item) {
        "";
      } else {
        var s = Number(item["in"]);
        var e = Number(item["out"]);
        // If untimed, always visible; else gate by [in, out)
        (isNaN(s) || isNaN(e)) ? getText(item) : ((t < s || t >= e) ? "" : getText(item));
      }
    }
  }
} catch (e) { ""; }