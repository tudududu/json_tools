// opacity_layerName_vs_compName_v01
// Transform ► Opacity — Compare layer name videoID vs comp name videoID
// Returns 100 (opaque) if videoIDs match; 0 (transparent) if not.
// VideoID format: TITLE_NNs (e.g., "Alula_30s" from "Saudi_Alula_30s_template_1x1_251212_v02")
// Modular: supports name patterns with variable token count before TITLE via nameShift.

// nameShift: number of tokens before TITLE_NNs
//   0 = Title_30s, 1 = Client_Title_30s, 2 = Client_Brand_Title_30s
var nameShift = 0;

// -------- Extract videoID from name string --------
// Split name by "_" and pull TITLE at [shift] and duration at [shift+1]
function extractVideoId(nameStr, shift) {
  if (!nameStr || typeof nameStr !== "string") return "";
  var parts = nameStr.split("_");
  
  var titleIdx = 0 + shift;
  var durationIdx = 1 + shift;
  
  // Validate bounds
  if (parts.length <= durationIdx) return "";
  
  var title = (parts[titleIdx] || "").toLowerCase();
  var duration = (parts[durationIdx] || "").toLowerCase();
  
  // Duration should match NNs pattern (digits + 's')
  if (!/^\d+s?$/.test(duration)) return "";
  
  return title + "_" + duration;
}

try {
  var layerVidId = extractVideoId(thisLayer.name, nameShift);
  var compVidId = extractVideoId(thisComp.name, nameShift);
  
  // Return 100 if both extracted successfully and match; 0 otherwise
  if (layerVidId && compVidId && layerVidId === compVidId) {
    100;
  } else {
    0;
  }
} catch (e) {
  0;
}