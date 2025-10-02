/*
  Opacity – ISO code driven
  Layer name pattern:  logo_<ISO>
  Shows (100) only if <ISO> matches data.metadataGlobal.country (case-insensitive).
  Else hides (0).

  Assumptions:
    - Footage item holding JSON is named exactly "data.json".
    - metadataGlobal.country is a simple string (e.g. "DE", "usa", "gb").
*/

var FOOTAGE_NAME = "data.json";

// --- Extract <ISO> from layer name ---
function extractISO(layerName) {
  // Accept patterns like: logo_DE, logo-GB, logo_USA, logo_fra_v2
  // Priority: underscore after 'logo', else hyphen.
  var ln = layerName + "";
  var re = /logo[_-]([A-Za-z0-9]{2,4})/i;
  var m = ln.match(re);
  if (m && m[1]) {
    // Trim trailing decorations (e.g. logo_de_v2 → captures 'de', that’s fine)
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
  try {
    var data = footage(FOOTAGE_NAME).sourceData;
    country = safe(data, ["metadataGlobal", "country"], "");
  } catch (e) {
    country = "";
  }

  // Normalize both sides (uppercase)
  var match = (country + "").toUpperCase() === isoLayer.toUpperCase();

  match ? 100 : 0;
}