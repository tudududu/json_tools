// transform_scale_uniform_contain_v01

// Uniform contain, only shrink (never upscale)
// Update your transform_scale_uniform_contain.js expression so it reacts correctly to time‑driven Source Text
// Shrinks on the time driven visibility, but incorrectly.

//     Keeps aspect ratio.
//     If the target is larger than the placeholder, it scales down to fit.
//     If it’s smaller, it stays at your chosen baseline (100% or your keyframed value).


// TARGET ► Scale  — Contain, only shrink; never upscale
// Uses: Shape layer "Size Holder" with group "PLACEHOLDER" → "Rectangle Path 1"

var holder = thisComp.layer("Size_Holder_Claim");
var group  = holder.content("PLACEHOLDER");
var rect   = group.content("Rectangle Path 1");

// Comp-space extents of the placeholder (rotation/scale aware)
var gp = group.transform.position;
var cC = holder.toComp(gp);
var cR = holder.toComp([gp[0] + rect.size[0]/2, gp[1]]);
var cL = holder.toComp([gp[0] - rect.size[0]/2, gp[1]]);
var cT = holder.toComp([gp[0], gp[1] - rect.size[1]/2]);
var cB = holder.toComp([gp[0], gp[1] + rect.size[1]/2]);

var holderW = Math.max(1, length(cL, cR));
var holderH = Math.max(1, length(cT, cB));

// Optional padding read from holder effects
function ctrl(name, def){
  try { return holder.effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value; } catch(e) { return def; }
}
var pad = Math.max(0, ctrl("Padding", 0));
holderW = Math.max(1, holderW - 2*pad);
holderH = Math.max(1, holderH - 2*pad);

// Intrinsic content size (text/shapes via SRAT; fallback to layer dims)
function contentSizeAt(li, t){
  try {
    var rr = li.sourceRectAtTime(t, false);
    if (rr.width > 0 && rr.height > 0) return [rr.width, rr.height];
  } catch (e) {}
  return [li.width, li.height];
}

// Ensure dependency on Source Text so SRAT updates with data-driven text
// and detect if there is visible text at this time
function currentTextString(){
  try {
    var v = thisLayer.text.sourceText.value;
    return (v && v.text !== undefined) ? (v.text + "") : (v + "");
  } catch (e) { return ""; }
}
var hasTextNow = currentTextString().length > 0;

// Measure size only when text is present; otherwise skip containment (keep baseline)
var sampleTime = time;
var s = hasTextNow ? contentSizeAt(thisLayer, sampleTime) : [1, 1];
s = [Math.max(1, s[0]), Math.max(1, s[1])];

// Percentage needed to fully contain
var fit = Math.min(holderW / s[0], holderH / s[1]) * 100;

// Choose your baseline:
//   - If you want “100% unless too big”, use:  var base = 100;
//   - If you want to respect your keyed scale, use current X: 
var base = value[0]; // <- typical: keep your keyframed scale unless it needs clamping

var k = Math.min(base, fit); // only shrink, never upscale

// If no text is visible right now, keep baseline (avoid premature shrinking)
if (!hasTextNow) {
  thisLayer.threeDLayer ? [base, base, value[2]] : [base, base];
} else {
  thisLayer.threeDLayer ? [k, k, value[2]] : [k, k];
}
