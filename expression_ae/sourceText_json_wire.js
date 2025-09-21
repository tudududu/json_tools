// sourceText_json_wire
// v02 claim
// -----------------------

// Read "wta" → claim line 1 from data_in_SAU.json
var videoId = "wta";
var desiredLine = 1; // claim line number

function getClaimText(data, videoId, lineNum) {
  if (!data || !data.videos) return "";

  // Find the video object by videoId
  var vids = data.videos, v = null;
  for (var i = 0; i < vids.length; i++) {
    if (vids[i].videoId == videoId) { v = vids[i]; break; }
  }
  if (!v || !v.claim) return "";

  // Find the claim item by its "line" property
  for (var j = 0; j < v.claim.length; j++) {
    if (v.claim[j].line == lineNum) return v.claim[j].text;
  }
  return "";
}

var txt = "";
try {
  var data = footage("data_in_SAU.json").sourceData;
  txt = getClaimText(data, videoId, desiredLine);

  // Fallback to top-level claim array if not found
  if (!txt && data && data.claim && data.claim.length >= desiredLine) {
    txt = data.claim[desiredLine - 1];
  }
} catch (err) {
  txt = ""; // JSON not found or other error
}

// Preserve text style
var td = value;
td = txt;
td;