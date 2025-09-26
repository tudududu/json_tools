// transform_opacity_fadein_onTime_v03 (orientation-aware, multi-key)
// Combined opacity logic for multiple data keys.
// JSON duplication per orientation (videoId suffixed: e.g. WTAVL_120s_landscape)
// Supports keys: claim | disclaimer | logo | subtitles (timed arrays of objects w/ in/out)
// CONFIG:
//   DATA_KEYS   → which arrays to consider (union of their time windows)
//   desiredLine → line number to look for inside each key's array (1-based)
// Behavior:
//   - Collect all timed segments from the specified DATA_KEYS for the oriented video.
//   - For each segment: fade from OPAC_IN to 100 over FADE_IN (clamped to segment length) starting at 'in'.
//   - Opacity = max over overlapping segments (effectively 100 if any fully on). Outside all segments = 0.
//   - If no timed segments found, but a global orientation fallback array exists (claim/disclaimer/logo top-level) → constant 100.
//   - Exclusive out: segment active for t ∈ [in, out).
// NOTES:
//   - subtitles usually have many lines; if included and desiredLine=0 we could union all lines. For simplicity we only fetch the specified line (or all when desiredLine=0 for subtitles).
//   - Adjust logic easily by editing collectSegmentsForKey().

var FOOTAGE_NAME = "data.json";    // JSON footage item name
var DATA_KEYS    = ["claim", "disclaimer"]; // keys to combine
var desiredLine  = 1;               // 1-based line selector; if 0 and key === "subtitles" gather all lines
var FADE_IN      = 1.0;             // fade-in duration (s)
var OPAC_IN      = 0;               // starting opacity
var compDur      = thisComp.duration;
var fadeInAdapt  = (compDur < 30) ? FADE_IN / 2 : FADE_IN; // example adaptive tweak

// Orientation detection (square -> portrait per requirement). Override via suffix in comp name.
var compAR = thisComp.width / Math.max(1, thisComp.height);
var compOrientation = compAR > 1 ? "landscape" : "portrait"; // square -> portrait by spec
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

// ---------- Helpers for multi-key segment collection ----------
function getArray(videoObj, key) {
  if (!videoObj) return null;
  return videoObj[key] || null;
}

function collectSegmentsForKey(videoObj, key) {
  var segs = [];
  var arr = getArray(videoObj, key);
  if (!arr) return segs;
  if (key === "subtitles" && desiredLine === 0) {
    // take all timed subtitle lines
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it) continue;
      var s = Number(it["in"]), e = Number(it["out"]);
      if (!isNaN(s) && !isNaN(e) && e > s) segs.push([s, e]);
    }
    return segs;
  }
  // Otherwise locate specific lineNum
  var lineNum = desiredLine < 1 ? 1 : desiredLine;
  for (var j = 0; j < arr.length; j++) {
    var it2 = arr[j];
    if (it2 && it2.line == lineNum) {
      var ss = Number(it2["in"]), ee = Number(it2["out"]);
      if (!isNaN(ss) && !isNaN(ee) && ee > ss) segs.push([ss, ee]);
      break;
    }
  }
  return segs;
}

function getGlobalArray(data, key) {
  if (!data) return null;
  var blk = data[key];
  if (!blk) return null;
  if (blk instanceof Array) return blk; // legacy
  return blk[compOrientation] || null;
}

// Merge overlapping segments (optional optimization)
function mergeSegments(list) {
  if (list.length <= 1) return list;
  list.sort(function(a,b){ return a[0]-b[0]; });
  var out = [list[0]];
  for (var i=1;i<list.length;i++) {
    var cur = list[i];
    var prev = out[out.length-1];
    if (cur[0] <= prev[1]) { // overlap or touch
      if (cur[1] > prev[1]) prev[1] = cur[1];
    } else {
      out.push(cur);
    }
  }
  return out;
}

var dataRef = null, videoObj = null, segments = [], hasGlobalFallback = false;
try {
  dataRef = footage(FOOTAGE_NAME).sourceData;
  videoObj = findVideo(dataRef, [orientedId, directId, baseId]);
  // Collect segments from each key
  for (var k = 0; k < DATA_KEYS.length; k++) {
    var key = DATA_KEYS[k];
    var segs = collectSegmentsForKey(videoObj, key);
    if (segs.length) {
      for (var sIdx = 0; sIdx < segs.length; sIdx++) segments.push(segs[sIdx]);
    } else {
      // If no video-level timed lines, check global fallback (no timing → always on)
      var gArr = getGlobalArray(dataRef, key);
      if (gArr && gArr.length) hasGlobalFallback = true;
    }
  }
} catch (e) {}

if (hasGlobalFallback && segments.length === 0) {
  // At least one key has an orientation global entry without timing → constant on
  100;
} else if (segments.length === 0) {
  0; // nothing to show
} else {
  // Merge & evaluate
  segments = mergeSegments(segments);
  var t = time;
  // Find containing segment
  var iSeg = -1;
  for (var iS = 0; iS < segments.length; iS++) {
    var sg = segments[iS];
    if (t >= sg[0] && t < sg[1]) { iSeg = iS; break; }
  }
  if (iSeg < 0) {
    0;
  } else {
    var seg = segments[iSeg];
    var sT = seg[0], eT = seg[1];
    var fin = Math.min(Math.max(0.001, fadeInAdapt), Math.max(0.001, eT - sT));
    if (t < sT + fin) {
      linear(t, sT, sT + fin, OPAC_IN, 100);
    } else {
      100;
    }
  }
}