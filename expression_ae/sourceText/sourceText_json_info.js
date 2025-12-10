// sourceText_json_info v04 251209 (per-video metadata inspector)
// Builds an informational multiline string combining global metadata and the resolved video object's metadata.
// Intended for a debug / QA text layer inside AE.
// Output example:
// client: <client>\ncampaign: <campaign>\nvideoId: <resolvedVideoId>\ncompOrient(meta): <video.meta.orientation>\ncompOrient(test): <computedFromAR>\nduration(meta): <video.meta.duration>\ntitle: <video.meta.title>\nsubtitles: <count>
// If a field is missing it shows '-'. If video not found, returns basic global info only.

var FOOTAGE_NAME = "data.json"; // name of JSON footage
var nameShift = 1;  // 0 = Title_30s; 1 = Clien_Title_30s; 2 = Client_Brand_Title_30s

// ---------- Orientation detection (computed test) ----------
var ar = thisComp.width / Math.max(1, thisComp.height);
function orientFromAR(r){ return r > 1 ? "landscape" : "portrait"; } // square => portrait
var compOrientTest = orientFromAR(ar);

// Allow explicit override via suffix (_landscape / _portrait)
var nameLower = thisComp.name.toLowerCase();
if (nameLower.indexOf("_landscape") >= 0) compOrientTest = "landscape";
else if (nameLower.indexOf("_portrait") >= 0) compOrientTest = "portrait";

// ---------- Derive candidate videoIds ----------
var token1 = 0 + nameShift;
var token2 = 1 + nameShift;

function baseVideoId() {
  var p = thisComp.name.split("_");
  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : ""; // e.g. Title_30s
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
  var country = toStr(safe(globalMeta, ["country"], "-"));
  var language = toStr(safe(globalMeta, ["language"], "-"));
  var videoId  = video ? toStr(video.videoId) : "(video not found)";
  var vMeta    = video ? video.metadata : null;
  var vOrient  = toStr(safe(vMeta, ["orientation"], "-"));
  var vDur     = toStr(safe(vMeta, ["duration"], "-"));
  var vTitle   = toStr(safe(vMeta, ["title"], "-"));
  var subsFlag = toStr(safe(vMeta, ["subtitle_flag"], "-"));
  var disclaimerFlag = toStr(safe(vMeta, ["disclaimer_flag"], "-"));
  var disclaimerFlag_02 = toStr(safe(vMeta, ["disclaimer_02_flag"], "-"));
  var super_A_flag = toStr(safe(vMeta, ["super_A_flag"], "-"));
  var super_B_flag = toStr(safe(vMeta, ["super_B_flag"], "-"));
  var logo_animFlag = toStr(safe(vMeta, ["logo_anim_flag"], "-"));
  var logo_02_flag = toStr(safe(vMeta, ["logo_02_flag"], "-"));
  var logo_03_flag = toStr(safe(vMeta, ["logo_03_flag"], "-"));
  var logo_04_flag = toStr(safe(vMeta, ["logo_04_flag"], "-"));
  var logo_05_flag = toStr(safe(vMeta, ["logo_05_flag"], "-"));
  var claim_01_flag = toStr(safe(vMeta, ["claim_01_flag"], "-"));
  var claim_02_flag = toStr(safe(vMeta, ["claim_02_flag"], "-"));
  var subsLen  = video && video.subtitles instanceof Array ? (video.subtitles.length+"") : (video ? "0" : "-");
        
  out  = "client: " + client;
  out += "\rcampaign: " + campaign;
  out += "\rcountry: " + country;
  out += "\rlanguage: " + language;
  out += "\rvideoId: " + videoId;
  out += "\rdata(compOrientMeta): " + vOrient;
  out += "\rcompOrient(test): " + compOrientTest;
  out += "\raspect ratio: " + resultAspect;
  out += "\rduration(meta): " + vDur;
  out += "\rtitle: " + vTitle;
  out += "\rsubtitles: " + subsFlag;
  out += "\rdisclaimer: " + disclaimerFlag;
  out += "\rsuper_A: " + super_A_flag;
  out += "\rsuper_B: " + super_B_flag;
  out += "\rlogo_anim: " + logo_animFlag;
  out += "\rlogo_02: " + logo_02_flag;
  out += "\rlogo_03: " + logo_03_flag;
  out += "\rlogo_04: " + logo_04_flag;
  out += "\rlogo_05: " + logo_05_flag;
  out += "\rclaim_01: " + claim_01_flag;
  out += "\rclaim_02: " + claim_02_flag;
  out += "\rsubtitles: " + subsLen;
} catch (err) {
  out = "(metadata unavailable)";
}

out;