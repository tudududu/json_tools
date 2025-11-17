/*
  Opacity – ISO code driven v02
  Layer name paterns: token1_token2_<ISO> or token1_token2_ISO_ISO
  Shows (100) if <ISO> matches <locale> (case-insensitive).
  Else hides (0).

  Assumptions:
    - Footage item holding JSON is named exactly "data.json".
    - metadataGlobal.country is a simple string (e.g. "bel").
    - metadataGlobal.language is a simple string (e.g. "fra").
*/

var FOOTAGE_NAME = "data.json";

// --- Extract <ISO> from layer name ---
function extractISO(layerName) {
  // Accept patterns: token1_token2_ISO or token1_token2_ISO_ISO
// Match ISO or ISO_ISO.
var ln = layerName + "";
// Matches patterns like: token1_token2_ISO or token1_token2_ISO_ISO
// Captures the ISO or ISO_ISO part (3 letter codes, optionally with underscore separator)
var re = /[_-]([A-Z]{3}(?:_[A-Z]{3})?)(?:[_-]|$)/i;
var m = ln.match(re);
if (m && m[1]) {
    // Trim trailing decorations (e.g. logo_de_v2 → captures 'de', that's fine)
    return m[1];
}
return "";
}

function safe(obj, path, defVal) {
try {
    var ref = obj;
    for (var i = 0; i < path.length; i++) {
        if (ref == null) return defVal;
        ref = ref[path[i]];
    }
    return (ref == null) ? defVal : ref;
} catch (e) { return defVal; }
}


var isoLayer = extractISO(thisLayer.name);
if (!isoLayer) {
  0; // No pattern → hide
} else {
  var country = "";
  var language = "";
  try {
    var data = footage(FOOTAGE_NAME).sourceData;
    country = safe(data, ["metadataGlobal", "country"], "");
    language = safe(data, ["metadataGlobal", "language"], "");
  } catch (e) {
    country = "";
    language = "";
  }
  var locale = (language + "") ? (country + "_" + language) : (country + "");

  // Normalize both sides (uppercase)
  var match = (locale + "").toUpperCase() === isoLayer.toUpperCase();

  match ? 100 : 0;
}