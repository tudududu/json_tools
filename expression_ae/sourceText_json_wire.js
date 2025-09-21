// sourceText_json_wire
// v03 claim
// key off the comp name and match the video by title and duration
// -----------------------

// Pull claim line 1 by matching comp name "Title_15s_..." to videos[].metadata
var FOOTAGE_NAME = "data_in_SAU.json"; // must match the JSON item name in the Project panel
var desiredLine = 1;

// Parse thisComp.name → title + duration (e.g. "Alula_15s_v06_250910")
var compName = thisComp.name;
var parts = compName.split("_");

var titlePart = parts.length > 0 ? parts[0] : "";
var durationStr = "";
if (parts.length > 1) {
  var p = parts[1]; // e.g. "15s"
  // remove trailing 's' or 'S' if present
  if (p.length > 0 && (p.charAt(p.length - 1) == "s" || p.charAt(p.length - 1) == "S")) {
    durationStr = p.substring(0, p.length - 1);
  } else {
    durationStr = p; // fallback: take as-is
  }
}

function getClaimTextFor(title, duration) {
  try {
    var data = footage(FOOTAGE_NAME).sourceData;
    if (!data || !data.videos) return "";

    // Find video with matching metadata.title and metadata.duration
    var vids = data.videos;
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      var meta = v.metadata ? v.metadata : {};
      var mt = (meta.title + "");
      var md = (meta.duration + "");
      if (mt == (title + "") && md == (duration + "")) {
        // Found the video; pull claim line N
        if (v.claim && v.claim.length) {
          for (var j = 0; j < v.claim.length; j++) {
            if (v.claim[j].line == desiredLine) {
              return v.claim[j].text ? v.claim[j].text : "";
            }
          }
        }
        // Fallback to top-level claim array if line not present in video
        if (data.claim && data.claim.length >= desiredLine) {
          return data.claim[desiredLine - 1] + "";
        }
        return "";
      }
    }
    // If no video matched, optional fallback to top-level claim
    if (data.claim && data.claim.length >= desiredLine) {
      return data.claim[desiredLine - 1] + "";
    }
    return "";
  } catch (err) {
    return "";
  }
}

getClaimTextFor(titlePart, durationStr);