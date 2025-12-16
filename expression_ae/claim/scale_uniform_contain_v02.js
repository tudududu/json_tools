// TARGET (Text) ► Scale — Contain, only shrink; JSON/text-safe

// --- Holder rect (rotation/scale aware) ---
var holder = thisComp.layer("Size_Holder_Claim");
var group  = holder.content("PLACEHOLDER");
var rect   = group.content("Rectangle Path 1");

var gp = group.transform.position;
var cC = holder.toComp(gp);
var cR = holder.toComp([gp[0] + rect.size[0]/2, gp[1]]);
var cL = holder.toComp([gp[0] - rect.size[0]/2, gp[1]]);
var cT = holder.toComp([gp[0], gp[1] - rect.size[1]/2]);
var cB = holder.toComp([gp[0], gp[1] + rect.size[1]/2]);

var holderW = Math.max(1, length(cL, cR));
var holderH = Math.max(1, length(cT, cB));

// Optional padding from holder effects
function ctrl(name, def){
  try { return holder.effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value; } catch(e) { return def; }
}
var pad = Math.max(0, ctrl("Padding", 0));
holderW = Math.max(1, holderW - 2*pad);
holderH = Math.max(1, holderH - 2*pad);

// --- Dependencies & robust text measurement ---
function isText(li){ try{ li.text.sourceText; return true; } catch(e){ return false; } }

// Force AE to evaluate after Source Text expression by referencing it (dependency only).
// We don't actually use the string here; it's just to ensure correct evaluation order.
var _txtDep = (function(){
  try { return thisLayer.text.sourceText.text; } catch(e) { return ""; }
})();

// Safe sourceRectAtTime for text: tries current frame; if 0×0, tries previous frame.
function safeTextSize(){
  function rectAt(t){ var r = sourceRectAtTime(t, false); return [r.width, r.height]; }
  var w = 0, h = 0;

  // Try now
  var r0 = rectAt(time);
  w = r0[0]; h = r0[1];

  // If empty (common right after JSON updates), try previous frame (if possible)
  if ((w < 1 || h < 1) && time > thisComp.displayStartTime){
    var tPrev = time - thisComp.frameDuration;
    var r1 = rectAt(tPrev);
    w = Math.max(w, r1[0]);
    h = Math.max(h, r1[1]);
  }

  // Final clamp to avoid div-by-zero and accidental upscales
  return [Math.max(1, w), Math.max(1, h)];
}

function contentSize(li){
  if (isText(li)){
    return safeTextSize(); // never fallback to comp size for text
  }
  // Non-text: SRAT if available, else layer dims
  try {
    var r = li.sourceRectAtTime(time, false);
    if (r.width > 0 && r.height > 0) return [r.width, r.height];
  } catch(e){}
  return [Math.max(1, li.width), Math.max(1, li.height)];
}

var s = contentSize(thisLayer);

// --- Only-shrink uniform contain ---
var fit = Math.min(holderW / s[0], holderH / s[1]) * 100;

// Baseline: respect your keyed X scale (never upscale beyond it)
var base = value[0];
var k = Math.min(base, fit);

thisLayer.threeDLayer ? [k, k, value[2]] : [k, k];
