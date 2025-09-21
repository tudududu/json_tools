// sourceText_json_wire
// v04 claim
// matching by videoId
// -----------------------

// Read claim line 1 by matching videos[].videoId built from comp name: "Title_15s_*"
var FOOTAGE_NAME = "data_in_SAU.json"; // must match the JSON item name in Project panel
var desiredLine = 1;

// Build videoId guess from comp name (e.g., "Alula_15s_v06_250910" → "Alula_15s")
var parts = thisComp.name.split("_");
var videoIdGuess = (parts.length >= 2) ? (parts[0] + "_" + parts[1]) : ""; // "Title_15s"

// Optional: prepare a metadata fallback (strip trailing 's')
var titlePart = parts.length > 0 ? parts[0] : "";
var durationToken = parts.length > 1 ? parts[1] : "";       // e.g. "15s"
var durationStr = durationToken;                             // keep "15s" for videoId
var durationNum = durationToken;                             // "15" for metadata fallback
if (durationToken && (durationToken.slice(-1) == "s" || durationToken.slice(-1) == "S")) {
  durationNum = durationToken.slice(0, -1); // "15"
}

function getClaimByVideoIdOrMeta(idGuess, title, durationStrNum) {
  try {
    var data = footage(FOOTAGE_NAME).sourceData;
    if (!data || !data.videos) return "";

    var vids = data.videos;
    var idLower = (idGuess + "").toLowerCase();

    // 1) Try exact videoId match (case-insensitive)
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if ((v.videoId + "").toLowerCase() == idLower) {
        // Return claim line N
        if (v.claim && v.claim.length) {
          for (var j = 0; j < v.claim.length; j++) {
            if (v.claim[j].line == desiredLine) return (v.claim[j].text || "") + "";
          }
        }
        break; // matched videoId but line missing; fall back after the loop
      }
    }

    // 2) Fallback: match via metadata title + duration
    for (var k = 0; k < vids.length; k++) {
      var vv = vids[k];
      var meta = vv.metadata || {};
      if ((meta.title + "").toLowerCase() == (title + "").toLowerCase() &&
          (meta.duration + "") == (durationStrNum + "")) {
        if (vv.claim && vv.claim.length) {
          for (var m = 0; m < vv.claim.length; m++) {
            if (vv.claim[m].line == desiredLine) return (vv.claim[m].text || "") + "";
          }
        }
        break; // found video but line missing; fall back to global
      }
    }

    // 3) Global fallback to top-level claim array
    if (data.claim && data.claim.length >= desiredLine) {
      return (data.claim[desiredLine - 1] || "") + "";
    }
    return "";
  } catch (err) {
    return "";
  }
}

getClaimByVideoIdOrMeta(videoIdGuess, titlePart, durationNum);