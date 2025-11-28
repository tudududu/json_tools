// transform_opacity_fadein_onTime_v05 (orientation-aware, SINGLE KEY)
// Simplified from multi-key version: drive opacity from one user-defined data key.
// JSON duplication per orientation (videoId suffixed, e.g. Title_30s_landscape).
// Supported keys: claim | disclaimer | logo | subtitles (timed arrays of objects with in/out; global arrays w/out timing)
// CONFIG:
//   DATA_KEY    → which array to read
//   desiredLine → line number (1-based). For subtitles: if 0 gather ALL subtitle lines' time windows (union)
// Behavior:
//   - Collect timed segments for the oriented video under DATA_KEY.
//   - Opacity per segment: fade from OPAC_IN to 100 over FADE_IN starting at 'in'. Exclusive out: [in, out).
//   - Multiple segments (e.g. subtitles lines) are treated as a union (any active segment → visible).
//   - If no timed segments but a global orientation fallback array exists for DATA_KEY → constant 100.
//   - Else → 0.
// Notes:
//   - Fade duration auto-clamped so it never exceeds the segment length.
//   - Orientation: square treated as portrait; can override by suffix _landscape / _portrait in comp name.

// transform_opacity_fadein_onTime_v04 (orientation-aware, SINGLE KEY)
// Start-frame non‑zero adaptation: avoids initial 0 opacity by biasing ramp with frameDuration.

// -------- CONFIG --------
var FOOTAGE_NAME = "data.json";
var DATA_KEY     = "logo";
var desiredLine  = 3;
var FADE_IN      = 0;
var OPAC_IN      = 0;
var START_MIN    = 1;          // minimum opacity on first active frame if OPAC_IN == 0

// -------- Orientation detection --------
var compAR = thisComp.width / Math.max(1, thisComp.height);
var compOrientation = compAR > 1 ? "landscape" : "portrait";
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
else if (nameLower.indexOf("_portrait")  >= 0) compOrientation = "portrait";

// -------- VideoId derivation --------
var nameShift = 1;  // 0 = Title_30s; 1 = Clien_Title_30s; 2 = Client_Brand_Title_30s
var token1 = 0 + nameShift;
var token2 = 1 + nameShift;

function baseVideoId(){
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : ""; // e.g. Title_30s
}
var baseId     = baseVideoId();
var orientedId = baseId ? (baseId + "_" + compOrientation) : "";
var directId   = thisComp.name;

function findVideo(data, candidates){
  if (!data || !data.videos) return null;
  var vids = data.videos;
  for (var c=0;c<candidates.length;c++){
    var target = (candidates[c] + "").toLowerCase();
    if (!target) continue;
    for (var i=0;i<vids.length;i++){
      var v = vids[i];
      if ((v.videoId + "").toLowerCase() === target) return v;
    }
  }
  return null;
}

function getGlobalArray(data, key){
  if (!data) return null;
  var blk = data[key];
  if (!blk) return null;
  if (blk instanceof Array) return blk;
  return blk[compOrientation] || null;
}

function collectSegments(videoObj, key){
  var segs = [];
  if (!videoObj) return segs;
  var arr = videoObj[key];
  if (!arr) return segs;
  if (key === "subtitles" && desiredLine === 0){
    for (var i=0;i<arr.length;i++){
      var it = arr[i]; if (!it) continue;
      var s = Number(it["in"]), e = Number(it["out"]);
      if (!isNaN(s) && !isNaN(e) && e > s) segs.push([s,e]);
    }
    return segs;
  }
  var lineNum = desiredLine < 1 ? 1 : desiredLine;
  for (var j=0;j<arr.length;j++){
    var it2 = arr[j];
    if (it2 && it2.line == lineNum){
      var ss = Number(it2["in"]), ee = Number(it2["out"]);
      if (!isNaN(ss) && !isNaN(ee) && ee > ss) segs.push([ss,ee]);
      break;
    }
  }
  return segs;
}

// Optional: merge overlapping/touching segments for cleaner evaluation
function mergeSegments(list){
  if (list.length <= 1) return list;
  list.sort(function(a,b){ return a[0]-b[0]; });
  var out = [list[0]];
  for (var i=1;i<list.length;i++){
    var cur = list[i];
    var prev = out[out.length-1];
    if (cur[0] <= prev[1]){
      if (cur[1] > prev[1]) prev[1] = cur[1];
    } else {
      out.push(cur);
    }
  }
  return out;
}

// Bias fade so first active frame > 0
function fadeOpacity(t, sT, eT, fin){
  if (fin <= 0.000001 || fin <= thisComp.frameDuration){
    // Treat as instant
    return 100;
  }
  var frameBias = thisComp.frameDuration; // pushes start above 0
  var progress = (t - sT + frameBias) / fin;
  progress = Math.min(Math.max(progress, 0), 1);
  var val = OPAC_IN + (100 - OPAC_IN) * progress;
  if (OPAC_IN === 0 && val < START_MIN) val = START_MIN;
  return val;
}

var dataRef = null, videoObj = null, segments = [], hasGlobalFallback = false;
try {
  dataRef = footage(FOOTAGE_NAME).sourceData;
  videoObj = findVideo(dataRef, [orientedId, directId, baseId]);
  segments = collectSegments(videoObj, DATA_KEY);
  if (!segments.length){
    var gArr = getGlobalArray(dataRef, DATA_KEY);
    if (gArr && gArr.length) hasGlobalFallback = true;
  }
} catch(err){}

if (segments.length === 0){
  hasGlobalFallback ? 100 : 0;
} else {
  segments = mergeSegments(segments);
  var t = time;
  var active = null;
  for (var iS=0;iS<segments.length;iS++){
    var sg = segments[iS];
    if (t >= sg[0] && t < sg[1]) { active = sg; break; }
  }
  if (!active){
    0;
  } else {
    var sT = active[0], eT = active[1];
    var fin = Math.min(Math.max(0.0005, FADE_IN), Math.max(0.0005, eT - sT));
    (t < sT) ? 0 :
    (t < sT + fin) ? fadeOpacity(t, sT, eT, fin) : 100;
  }
}