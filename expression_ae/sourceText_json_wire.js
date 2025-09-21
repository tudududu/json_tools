// sourceText_json_wire
// v08
// Updated Source Text expression (exclusive out)
// -----------------------

// JSON → text; match video by comp name and gate by time (exclusive out)
// Supports keys: "subtitles", "claim", "disclaimer"
// - "subtitles": shows ALL items whose [in, out) contains time (stacked)
// - "claim"/"disclaimer":
//     desiredLine > 0 → show only that line, gated by [in, out)
//     desiredLine = 0 → show ALL items whose [in, out) contains time (stacked)

var FOOTAGE_NAME = "data_in_SAU.json"; // must equal the JSON item name in Project panel
var DATA_KEY = "subtitles";            // "subtitles" | "claim" | "disclaimer"
var desiredLine = 0;                   // 0 = auto by time (all active); >0 = fixed line number

// Build videoId from comp name "Title_15s_*" → "Title_15s"
function compVideoId() {
  var parts = thisComp.name.split("_");
  return (parts.length >= 2) ? (parts[0] + "_" + parts[1]) : "";
}

function getVideo(data, videoId) {
  if (!data || !data.videos) return null;
  var idLower = (videoId + "").toLowerCase();
  for (var i = 0; i < data.videos.length; i++) {
    var v = data.videos[i];
    if ((v.videoId + "").toLowerCase() === idLower) return v;
  }
  return null;
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
  var vid = getVideo(data, compVideoId());
  if (!vid) { 
    "";
  } else {
    var arr = vid[DATA_KEY];
    if (!arr) { 
      "";
    } else {
      var t = time;

      // subtitles → always time-driven; claim/disclaimer → support fixed line or time
      if (DATA_KEY === "subtitles" || desiredLine === 0) {
        var items = activeByTime(arr, t);
        joinTexts(items);
      } else {
        // Fixed line (claim/disclaimer), gated by [in, out)
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
  }
} catch (e) {
  ""
}