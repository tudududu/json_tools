// Opacity = fade-in for video-level claim line N using JSON timings
// - Starts at claim.in, lasts FADE_IN seconds (linear), stays 100 until out, then 0
// - Out is exclusive: visible for t ∈ [in, out)
var FOOTAGE_NAME = "data_in_SAU.json"; // must match JSON item name in Project panel
var desiredLine = 1;                   // claim line number
var FADE_IN = 1.0;                     // seconds (default 1s)

// Build videoId from comp name: "Title_15s_*" → "Title_15s"
function compVideoId() {
  var parts = thisComp.name.split("_");
  return (parts.length >= 2) ? (parts[0] + "_" + parts[1]) : "";
}

function findClaimItem(data, videoId, lineNum) {
  if (!data || !data.videos) return null;
  var idLower = (videoId + "").toLowerCase();
  for (var i = 0; i < data.videos.length; i++) {
    var v = data.videos[i];
    if ((v.videoId + "").toLowerCase() === idLower) {
      var arr = v.claim || [];
      for (var j = 0; j < arr.length; j++) {
        var it = arr[j];
        if (it && it.line == lineNum) return it;
      }
      break;
    }
  }
  return null;
}

var item = null;
try {
  var data = footage(FOOTAGE_NAME).sourceData;
  item = findClaimItem(data, compVideoId(), desiredLine);
} catch (e) {
  // leave item null
}

if (!item) {
  0
} else {
  var s = Number(item["in"]);
  var e = Number(item["out"]);
  if (isNaN(s) || isNaN(e)) {
    0
  } else {
    var t = time;
    var fin = Math.max(0.001, FADE_IN); // guard
    if (t < s) {
      0
    } else if (t < s + fin) {
      linear(t, s, s + fin, 0, 100)
    } else if (t < e) {
      100
    } else {
      0
    }
  }
}