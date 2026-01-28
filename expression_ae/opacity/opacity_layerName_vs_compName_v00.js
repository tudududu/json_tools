// opacity_layerName_vs_compName 260127

// -------- CONFIG --------
var nameShift = 1;  // 0 = Title_30s; 1 = Clien_Title_30s; 2 = Client_Brand_Title_30s

// -------- VideoId derivation --------
var token1 = 0 + nameShift;
var token2 = 1 + nameShift;
var compName = thisComp.name;
var layerName = thisLayer.name;

function baseVideoId(name) {
  var p = name.split("_");
  return (p.length >= 2) ? (p[token1] + "_" + p[token2]) : ""; // e.g. Title_30s
}
var compVideoId = baseVideoId(compName);
var layerVideoId = baseVideoId(layerName);

// -------- OPACITY --------
try {
  if (compVideoId === layerVideoId) {
    100;
  } else {
    0;
  }
} catch(err){}