// sourceText_json_wire v09 (orientation-aware, time-gated, multi-line)
// JSON → text; orientation-specific global keys + oriented videoIds
// DATA_KEY: "subtitles" | "claim" | "disclaimer" | "logo"
// Behavior:
//   subtitles: show ALL active lines (time ∈ [in,out)) stacked
//   claim/disclaimer/logo: desiredLine>0 → that line only (gated); desiredLine=0 → all active
// Orientation resolution order: explicit suffix in comp name (_landscape/_portrait) else aspect ratio (>1 landscape, else portrait). Square (1:1) treated as portrait by using >1 test.

var FOOTAGE_NAME = "data.json"; // JSON footage name
var DATA_KEY = "subtitles";   // key to pull
var desiredLine = 0;            // 0=time-driven multi; >0 fixed line
var nameShift = 1;  // 0 = Title_30s; 1 = Clien_Title_30s; 2 = Client_Brand_Title_30s

// -------- Orientation detection --------
var compAR = thisComp.width / Math.max(1, thisComp.height);
var compOrientation = compAR > 1 ? "landscape" : "portrait"; // square -> portrait per requirements
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
else if (nameLower.indexOf("_portrait") >= 0) compOrientation = "portrait";

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
  return (it && it.text != null) ? (it.text + "") : "";
}

function pickLine(arr, lineNum) {
  if (!arr) return null;
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
    var s = Number(it["in"]);
    var e = Number(it["out"]);
    if (!isNaN(s) && !isNaN(e) && t >= s && t < e) res.push(it);
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
        // global arrays are plain strings → no timing; just index
        if (desiredLine < 1) desiredLine = 1;
        var idx = Math.min(glob.length - 1, desiredLine - 1);
        (glob[idx] || "") + "";
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
        (isNaN(s) || isNaN(e) || (t < s || t >= e)) ? "" : getText(item);
      }
    }
  }
} catch (e) { ""; }