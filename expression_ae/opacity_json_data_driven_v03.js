/*
  Opacity – ISO code driven v03
  Layer name patterns (tail tokens): token1_token2_<ISO> or token1_token2_<ISO>_<ISO>
  Shows (100) if tail <ISO> (or <ISO>_<ISO>) matches JSON locale built from metadataGlobal.country[_language].
  Comparison is case-insensitive; hyphen vs underscore is normalized.

  Assumptions:
    - Footage item holding JSON is named exactly "data.json".
    - metadataGlobal.country is a 3-letter code (e.g. "BEL").
    - metadataGlobal.language is a 3-letter code (e.g. "FRA").
*/

var FOOTAGE_NAME = "data.json";
var ALLOW_COUNTRY_ONLY_MATCH = true; // If layer has just COUNTRY and JSON has COUNTRY_LANGUAGE, treat as match

// Normalize code strings: to string, uppercase, unify separators, trim spaces
function normCode(s) {
  var t = (s + "");
  // Fast bail-out for null-ish
  if (!t) return "";
  // Replace hyphen with underscore and strip spaces
  t = t.replace(/-/g, "_").replace(/\s+/g, "");
  return t.toUpperCase();
}

// --- Extract <ISO> (or <ISO>_<ISO>) from the END of the layer name ---
function extractISO(layerName) {
  var ln = layerName + "";
  var parts = ln.split(/[_-]/);
  var n = parts.length;
  function is3(x){ return /^[A-Za-z0-9]{3}$/.test(x || ""); }
  var last = parts[n-1] || "";
  var prev = parts[n-2] || "";
  if (is3(last) && is3(prev)) return prev + "_" + last; // ISO_ISO
  if (is3(last)) return last;                              // ISO
  return "";                                              // not found at tail
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
  // Build locale, then normalize both sides
  var locale = (language + "") ? (country + "_" + language) : (country + "");
  var L = normCode(locale);
  var S = normCode(isoLayer);

  var match = false;
  if (S && L) {
    if (S === L) {
      match = true;
    } else if (ALLOW_COUNTRY_ONLY_MATCH) {
      // If layer specifies just COUNTRY (3 chars) and JSON has COUNTRY_LANGUAGE
      // treat as match when prefixes match.
      if (S.length === 3 && L.length === 7 && L.indexOf(S + "_") === 0) {
        match = true;
      }
    }
  }

  match ? 100 : 0;
}