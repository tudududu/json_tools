// opacity_fadein_onTime_v08 260502
// (orientation-aware, SINGLE KEY, fade in, fade out)

// union does not work (of multiple segments when desiredLine == 0 for subtitles.)

// Simplified from multi-key version: drive opacity from one user-defined data key.
// JSON duplication per orientation (videoId suffixed, e.g. Title_30s_landscape).
// Supported keys: (E.g. claim | disclaimer | logo | subtitles) timed arrays of objects with in/out; global arrays w/out timing;
// CONFIG:
//   DATA_KEY    → which array to read
//   desiredLine → line number (1-based). For subtitles: if 0 gather ALL subtitle lines' time windows (union)
// Behavior:
//   - Collect timed segments for the oriented video under DATA_KEY.
//   - Opacity per segment: fade from OPAC_IN to 100 over FADE_IN starting at 'in',
//     then fade from 100 to OPAC_IN over FADE_OUT ending at 'out'. Exclusive out: [in, out).
//   - Multiple segments (e.g. subtitles lines) are treated as a union (any active segment → visible).
//   - If no timed segments but a global orientation fallback array exists for DATA_KEY → constant 100.
//   - Else → 0.
// Notes:
//   - Fade durations auto-clamped so they never exceed segment length.
//   - Orientation: square treated as portrait; can override by suffix _landscape / _portrait in comp name.

// -------- CONFIG --------
// FOOTAGE_NAME stays inline; all other config comes from Expression Controls on this layer.
//
// Required effects (Effects > Expression Controls):
//   Dropdown Menu Control  "Data Key Menu"  — items: claim | disclaimer | logo | subtitles | super_A
//                                             Add further items in any order; keep this array in sync:
//   Slider Control         "Desired Line"   — 0 = all / subtitle union; ≥1 = specific line (integer)
//   Slider Control         "Fade In"        — seconds, decimals supported (e.g. 0.5)
//   Slider Control         "Fade Out"       — seconds, decimals supported (e.g. 0.5)
//   Slider Control         "Opacity In"     — 0–100
//   Slider Control         "Name Shift"     — 0 = Title_30s | 1 = Client_Title_30s | 2 = Client_Brand_Title_30s

var FOOTAGE_NAME = "data.json";

// Read a named effect from this layer; Menu effects need the "Menu" property, Sliders need "Slider".
function ctrl(name, def) {
  try {
    return effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value;
  } catch (e) { return def; }
}

// Map Dropdown index (1-based) to a JSON key string.
// Keep this array in the same order as the "Data Key Menu" dropdown items.
var DATA_KEY_OPTIONS = ["claim", "disclaimer", "logo", "subtitles", "super_A", "super_B"];
var _dkIdx = Math.round(ctrl("Data Key Menu", 1)) - 1; // 0-based
var DATA_KEY = DATA_KEY_OPTIONS[Math.max(0, Math.min(DATA_KEY_OPTIONS.length - 1, _dkIdx))];

var desiredLine = Math.round(ctrl("Desired Line", 0));
var FADE_IN     = ctrl("Fade In",     0);   // float seconds
var FADE_OUT    = ctrl("Fade Out",    0);   // float seconds
var OPAC_IN     = ctrl("Opacity In",  0);   // 0–100
var nameShift   = Math.round(ctrl("Name Shift", 1));

// -------- Orientation detection --------
var compAR = thisComp.width / Math.max(1, thisComp.height);
var compOrientation = compAR > 1 ? "landscape" : "portrait";
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientation = "landscape";
else if (nameLower.indexOf("_portrait")  >= 0) compOrientation = "portrait";

// -------- VideoId derivation --------
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

// Fade from OPAC_IN to 100 over segment start window
function fadeOpacity(t, sT, eT, fin){
  if (fin <= 0.000001 || fin <= thisComp.frameDuration){
    // Treat as instant
    return 100;
  }
  var progress = (t - sT) / fin;
  progress = Math.min(Math.max(progress, 0), 1);
  return OPAC_IN + (100 - OPAC_IN) * progress;
}

// Fade from 100 to OPAC_IN over segment end window
function fadeOutOpacity(t, outStart, outEnd, fout){
  if (fout <= 0.000001 || fout <= thisComp.frameDuration){
    // Treat as instant at out window start
    return OPAC_IN;
  }
  var progress = (t - outStart) / fout;
  progress = Math.min(Math.max(progress, 0), 1);
  return 100 + (OPAC_IN - 100) * progress;
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
    var segLen = Math.max(0.0005, eT - sT);
    var fin = Math.min(Math.max(0.0005, FADE_IN), segLen);
    var fout = Math.min(Math.max(0.0005, FADE_OUT), segLen);
    var outStart = eT - fout;
    (t < sT) ? 0 :
    (t < sT + fin) ? fadeOpacity(t, sT, eT, fin) :
    (t >= outStart && t < eT) ? fadeOutOpacity(t, outStart, eT, fout) : 100;
  }
}