// sourceText_json_wire
// v06
// Source Text expression (time-gated claim/disclaimer)
// -----------------------

// JSON → text, time-gated by the item's in/out range
// Match the video by comp name "Title_15s_*" → videoId "Title_15s"
var FOOTAGE_NAME = "data_in_SAU.json"; // must match the JSON item name in Project panel
var DATA_KEY = "claim";                // "claim" or "disclaimer"
var desiredLine = 1;                   // Set >0 to pick a specific line and gate by its in/out
                                       // Set to 0 to auto-pick the item whose time range contains 'time'

// Derive videoId from comp name
var parts = thisComp.name.split("_");
var videoId = (parts.length >= 2) ? (parts[0] + "_" + parts[1]) : "";

// Helpers
function getArrayForVideo(data, videoId, key) {
  if (!data || !data.videos) return null;
  var idLower = (videoId + "").toLowerCase();
  for (var i = 0; i < data.videos.length; i++) {
    var v = data.videos[i];
    if ((v.videoId + "").toLowerCase() == idLower) {
      return v[key] || null; // e.g. v.claim or v.disclaimer
    }
  }
  return null;
}

function pickByLine(arr, lineNum) {
  if (!arr) return null;
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (it && it.line == lineNum) return it;
  }
  return null;
}

function pickByTime(arr, t) {
  if (!arr) return null;
  // Linear scan is fine (arrays are small); use ["in"]/["out"] to avoid reserved word issues
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (!it) continue;
    var s = Number(it["in"]);
    var e = Number(it["out"]);
    if (isNaN(s) || isNaN(e)) continue;
    if (t >= s && t <= e) return it;
  }
  return null;
}

try {
  var data = footage(FOOTAGE_NAME).sourceData;
  var arr = getArrayForVideo(data, videoId, DATA_KEY);
  if (!arr) { 
    ""; // no video/key match
  } else {
    var t = time;
    var item = (desiredLine > 0) ? pickByLine(arr, desiredLine) : pickByTime(arr, t);
    if (!item) {
      ""; // nothing active
    } else {
      if (desiredLine > 0) {
        // Gate by this line's in/out
        var s = Number(item["in"]);
        var e = Number(item["out"]);
        (t >= s && t <= e) ? (item.text || "") : "";
      } else {
        // Already picked by time
        item.text || "";
      }
    }
  }
} catch (e) {
  ""
}