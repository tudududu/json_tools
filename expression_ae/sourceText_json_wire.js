// sourceText_json_wire
// v05
// Reusable Source Text expression (switch key via DATA_KEY)
// -----------------------

// Reusable JSON → text expression by key ("claim" | "disclaimer")
// - video is matched by comp name "Title_15s_*" → videoId "Title_15s"
// - switch DATA_KEY to reuse for different fields
var FOOTAGE_NAME = "data_in_SAU.json"; // must match item name in Project panel
var DATA_KEY = "claim";                // <-- set to "disclaimer" to reuse
var desiredLine = 1;                   // 1-based line selector

// Build videoId from comp name: "Alula_15s_v06_250910" → "Alula_15s"
var parts = thisComp.name.split("_");
var videoId = (parts.length >= 2) ? (parts[0] + "_" + parts[1]) : "";

// Helpers
function pickFromArray(arr, lineNum) {
  if (!arr || arr.length === 0) return "";
  var first = arr[0];
  // Two shapes:
  // 1) array of strings (global claim/disclaimer)
  // 2) array of objects with { line, text, ... } (video-level claim/disclaimer)
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

function getText(data, videoId, key, lineNum) {
  if (!data) return "";
  var vids = data.videos || [];

  // 1) Try video-level match by videoId (case-insensitive)
  var idLower = (videoId + "").toLowerCase();
  for (var i = 0; i < vids.length; i++) {
    var v = vids[i];
    if ((v.videoId + "").toLowerCase() == idLower) {
      var arr = v[key]; // e.g., v.claim or v.disclaimer
      var txt = pickFromArray(arr, lineNum);
      if (txt) return txt;
      break; // matched video but no line; fall through to global
    }
  }

  // 2) Global fallback (top-level claim/disclaimer arrays of strings)
  return pickFromArray(data[key], lineNum);
}

try {
  var data = footage(FOOTAGE_NAME).sourceData;
  getText(data, videoId, DATA_KEY, desiredLine);
} catch (e) {
  ""
}