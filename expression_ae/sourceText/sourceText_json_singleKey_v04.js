// sourceText_json_singleKey_v04 (orientation-aware, single key)
// Mirrors transform_opacity_fadein_onTime_v04 logic so text + opacity stay aligned.

var FOOTAGE_NAME = "data.json";
var DATA_KEY     = "claim"; // claim | disclaimer | logo | subtitles
var desiredLine  = 1;       // for subtitles: 0 = all active lines stacked

// -------- Orientation detection --------
var ar = thisComp.width / Math.max(1, thisComp.height);
var compOrientation = ar > 1 ? "landscape" : "portrait"; // square → portrait
var nm = thisComp.name.toLowerCase();
if (nm.indexOf("_landscape") >= 0) compOrientation = "landscape";
else if (nm.indexOf("_portrait") >= 0) compOrientation = "portrait";

// -------- VideoId candidates --------
function baseVideoId() {
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[0] + "_" + p[1]) : "";
}
var baseId     = baseVideoId();
var orientedId = baseId ? (baseId + "_" + compOrientation) : "";
var directId   = thisComp.name;

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

function getGlobalArray(data, key) {
  if (!data) return null;
  var blk = data[key];
  if (!blk) return null;
  if (blk instanceof Array) return blk; // legacy
  return blk[compOrientation] || null;
}

function activeItems(arr, t) { // exclusive out
  var out = [];
  if (!arr) return out;
  for (var i=0;i<arr.length;i++) {
    var it = arr[i]; if (!it) continue;
    var s = Number(it["in"]), e = Number(it["out"]);
    if (!isNaN(s) && !isNaN(e) && t >= s && t < e) out.push(it);
  }
  return out;
}

function pickLine(arr, lineNum) {
  if (!arr) return null;
  for (var i=0;i<arr.length;i++){
    var it = arr[i];
    if (it && it.line == lineNum) return it;
  }
  return null;
}

function itemText(it) {
  return (it && it.text != null) ? (it.text + "") : "";
}

// Style preservation
function styledText(str) {
  try {
    var td = text.sourceText;
    if (typeof td !== "object" || td === null || td.constructor.name !== "TextDocument") return str;
    var clone = td.clone();
    clone.text = str;
    return clone;
  } catch (e) {
    return str;
  }
}

var outText = "";
try {
  var data = footage(FOOTAGE_NAME).sourceData;
  var vid  = findVideo(data, [orientedId, directId, baseId]);
  var arr  = vid ? vid[DATA_KEY] : null;
  var t    = time;

  if (!arr) {
    // Untimed global fallback (non-subtitles)
    if (DATA_KEY !== "subtitles") {
      var glob = getGlobalArray(data, DATA_KEY);
      if (glob && glob.length) {
        var ln = desiredLine < 1 ? 1 : desiredLine;
        var idx = Math.min(glob.length - 1, ln - 1);
        outText = (glob[idx] + "");
      }
    }
  } else {
    if (DATA_KEY === "subtitles" && desiredLine === 0) {
      var act = activeItems(arr, t);
      if (act.length) {
        var join = "";
        for (var i=0;i<act.length;i++) {
          if (join.length) join += "\\r";
            join += itemText(act[i]);
        }
        outText = join;
      }
    } else {
      var lineNum = desiredLine < 1 ? 1 : desiredLine;
      var item = pickLine(arr, lineNum);
      if (item) {
        var s = Number(item["in"]), e = Number(item["out"]);
        if (!isNaN(s) && !isNaN(e) && t >= s && t < e) {
          outText = itemText(item);
        }
      }
    }
  }
} catch (err) {
  outText = "";
}

styledText(outText);