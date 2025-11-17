/*
  Opacity – ISO code driven v04
  Layer name patterns (tail tokens):
    - token1_token2_<ISO>
    - token1_token2_<ISO>_<ISO>
    - Multi-code: any combination joined by '+', e.g. token1_token2_<ISO>+<ISO>, token1_token2_<ISO>_<ISO>+<ISO>
  Shows (100) if ANY tail code equals JSON locale built from metadataGlobal.country[_language].
  Comparison is case-insensitive; hyphen vs underscore is normalized.

  Assumptions:
    - Footage item holding JSON is named exactly "data.json".
    - metadataGlobal.country is a 3-letter code (e.g. "BEL").
    - metadataGlobal.language is a 3-letter code (e.g. "FRA").
*/

var FOOTAGE_NAME = "data.json";

// Normalize code strings: to string, uppercase, unify separators, trim spaces
function normCode(s) {
  var t = (s + "");
  // Fast bail-out for null-ish
  if (!t) return "";
  // Replace hyphen with underscore and strip spaces
  t = t.replace(/-/g, "_").replace(/\s+/g, "");
  return t.toUpperCase();
}

// --- Extract one or more codes from the tail of the layer name ---
// Accepts tail like: AAA, AAA_BBB, AAA+BBB, AAA_BBB+CCC_DDD
function extractCodes(layerName) {
  var ln = layerName + "";
  var m = ln.match(/[_-]([A-Za-z0-9_+\-]+)$/); // capture last token after '_' or '-'
  if (!m) return [];
  var tail = m[1].replace(/-/g, "_");
  var parts = tail.split("+");
  var out = [];
  for (var i=0;i<parts.length;i++) {
    var p = parts[i];
    if (/^[A-Za-z0-9]{3}$/.test(p)) {
      out.push(p);
    } else if (/^[A-Za-z0-9]{3}_[A-Za-z0-9]{3}$/.test(p)) {
      out.push(p);
    }
  }
  return out;
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


var isoList = extractCodes(thisLayer.name);
if (!isoList.length) {
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
  var match = false;
  if (L) {
    for (var k=0; k<isoList.length; k++) {
      var S = normCode(isoList[k]);
      if (S === L) { match = true; break; }
    }
  }

  match ? 100 : 0;
}