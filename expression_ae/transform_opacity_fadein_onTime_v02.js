// transform_opacity_fadein_onTime_v02 (orientation-aware)
// Opacity = fade-in for orientation-specific video-level claim line N using JSON timings.
// - JSON now has duplicated video objects with videoId suffixed by orientation (e.g. WTAVL_120s_landscape)
// - Top-level claim also has orientation blocks (claim: { landscape: [...], portrait: [...] }) for fallback (no timing there)
// Behavior:
//   If video-level claim line found → fade from OPAC_IN to 100 over FADE_IN starting at line.in, stay 100 until exclusive out, then 0.
//   If not found → fall back to global oriented claim (no timing) → constant 100.
// -----------------------------------------------------------------------------

var FOOTAGE_NAME = "data.json"; // JSON footage name
var desiredLine  = 1;            // claim line number (1-based)
var FADE_IN      = 1.0;          // seconds
var OPAC_IN      = 0;            // starting opacity before fade
var compDur = thisComp.duration;
var fadeInDuration = (compDur < 30) ? FADE_IN / 2 : FADE_IN;

// Orientation detection (square -> portrait per requirement). Override via suffix in comp name.
var compAR = thisComp.width / Math.max(1, thisComp.height);
var compOrientation = compAR > 1 ? "landscape" : "portrait";
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
else if (nameLower.indexOf("_portrait") >= 0) compOrientation = "portrait";

// Base & oriented videoId derivation: Comp name pattern Title_15s_* → Title_15s
function baseVideoId() {
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[0] + "_" + p[1]) : "";
}
var baseId      = baseVideoId();
var orientedId  = baseId ? (baseId + "_" + compOrientation) : "";
var directId    = thisComp.name; // full comp name as fallback

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

function findClaimLine(videoObj, lineNum) {
  if (!videoObj) return null;
  var arr = videoObj.claim || [];
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (it && it.line == lineNum) return it;
  }
  return null;
}

function globalClaimFallback(data, lineNum) {
  if (!data || !data.claim) return null;
  var block = data.claim;
  var arr = null;
  if (block instanceof Array) {
    // legacy shape (array of strings)
    arr = block;
  } else {
    arr = block[compOrientation];
  }
  if (!arr || !arr.length) return null;
  var idx = Math.min(arr.length - 1, Math.max(0, lineNum - 1));
  // Provide a pseudo-item without timing so we can differentiate
  return { text: arr[idx], hasTiming: false };
}

var claimItem = null;
var dataRef = null;
try {
  dataRef = footage(FOOTAGE_NAME).sourceData;
  var vid = findVideo(dataRef, [orientedId, directId, baseId]);
  claimItem = findClaimLine(vid, desiredLine);
  if (claimItem) claimItem.hasTiming = true;
  if (!claimItem) claimItem = globalClaimFallback(dataRef, desiredLine);
} catch (e) {
  claimItem = null;
}

if (!claimItem) {
  0; // nothing found
} else if (!claimItem.hasTiming) {
  // Global fallback (no timing) → constant fully on
  100;
} else {
  var s = Number(claimItem["in"]);
  var e = Number(claimItem["out"]);
  if (isNaN(s) || isNaN(e) || e <= s) {
    100; // malformed timing → just show
  } else {
    var t = time;
    var fin = Math.min(Math.max(0.001, fadeInDuration), Math.max(0.001, e - s)); // clamp fade to window
    if (t < s) {
      OPAC_IN;
    } else if (t < s + fin) {
      linear(t, s, s + fin, OPAC_IN, 100);
    } else if (t < e) {
      100;
    } else {
      0;
    }
  }
}