// sourceText_json_info (per-video metadata inspector)
// Builds an informational multiline string combining global metadata and the resolved video object's metadata.
// Intended for a debug / QA text layer inside AE.
// Output example:
// client: <client>\ncampaign: <campaign>\nvideoId: <resolvedVideoId>\ncompOrient(meta): <video.meta.orientation>\ncompOrient(test): <computedFromAR>\nduration(meta): <video.meta.duration>\ntitle: <video.meta.title>\nsubtitles: <count>
// If a field is missing it shows '-'. If video not found, returns basic global info only.

var FOOTAGE_NAME = "data.json"; // name of JSON footage

// ---------- Orientation detection (computed test) ----------
var ar = thisComp.width / Math.max(1, thisComp.height);
function orientFromAR(r){ return r > 1 ? "landscape" : "portrait"; } // square => portrait
var compOrientTest = orientFromAR(ar);

// Allow explicit override via suffix (_landscape / _portrait)
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientTest = "landscape";
else if (nameLower.indexOf("_portrait") >= 0) compOrientTest = "portrait";

// ---------- Derive candidate videoIds ----------
function baseVideoId() {
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[0] + "_" + p[1]) : ""; // e.g. Title_30s
}
var baseId = baseVideoId();
var orientedId = baseId ? (baseId + "_" + compOrientTest) : ""; // oriented video id suffix pattern
var directId = thisComp.name; // full comp name fallback

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

// ---------- Safe access helpers ----------
function safe(obj, path, defVal) {
  try {
    var ref = obj;
    for (var i = 0; i < path.length; i++) {
      if (!ref) return defVal;
      ref = ref[path[i]];
    }
    return (ref == null) ? defVal : ref;
  } catch (e) { return defVal; }
}

function toStr(v){ return (v == null) ? "-" : (v + ""); }


//========================AspectAuto_v02_230451
let sizeX = thisComp.width;
let sizeY = thisComp.height;
function greatestCommonDivisor (x, y) {
	return (y == 0) ? x : greatestCommonDivisor (y, x%y);
        }
function aspect(x, y) {
	let r = greatestCommonDivisor(sizeX, sizeY);
	return (x/r) + ":" + y/r;
}
resultAspect = aspect(sizeX, sizeY);

var out = "";
try {
  var data = footage(FOOTAGE_NAME).sourceData;
  var globalMeta = data ? data.metadataGlobal : null;
  var video = findVideo(data, [orientedId, directId, baseId]);

  var client   = toStr(safe(globalMeta, ["client"], "-"));
  var campaign = toStr(safe(globalMeta, ["campaign"], "-"));

  var videoId  = video ? toStr(video.videoId) : "(video not found)";
  var vMeta    = video ? video.metadata : null;
  var vOrient  = toStr(safe(vMeta, ["orientation"], "-"));
  var vDur     = toStr(safe(vMeta, ["duration"], "-"));
  var vTitle   = toStr(safe(vMeta, ["title"], "-"));
  var subsLen  = video && video.subtitles instanceof Array ? (video.subtitles.length+"") : (video ? "0" : "-");

  out  = "client: " + client;
  out += "\rcampaign: " + campaign;
  out += "\rvideoId: " + videoId;
  out += "\rcompOrient(meta): " + vOrient;
  out += "\rcompOrient(test): " + compOrientTest;
  out += "\raspect ratio: " + resultAspect;
  out += "\rduration(meta): " + vDur;
  out += "\rtitle: " + vTitle;
  out += "\rsubtitles: " + subsLen;
} catch (err) {
  out = "(metadata unavailable)";
}

out;