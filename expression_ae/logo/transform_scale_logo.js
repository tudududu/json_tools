// transform_scale_logo.js
// TARGET ► Scale
var holderName = "locker_" + thisLayer.name;
var holder = thisComp.layer(holderName);
var group = holder.content("PLACEHOLDER");
var rect  = group.content("Rectangle Path 1");

// Fetch holder rectangle size & center in COMP space (supports holder layer transforms)
var gp = group.transform.position;    // center of the rectangle (layer space)
var sz = rect.size;                   // [w,h] in layer space (pre layer transform)

// Comp-space width/height of the rect (works even if holder is scaled/rotated)
var cC = holder.toComp(gp);
var cL = holder.toComp([gp[0] - sz[0]/2, gp[1]]);
var cR = holder.toComp([gp[0] + sz[0]/2, gp[1]]);
var cT = holder.toComp([gp[0], gp[1] - sz[1]/2]);
var cB = holder.toComp([gp[0], gp[1] + sz[1]/2]);

var holderW = length(cL, cR);
var holderH = length(cT, cB);

// Optional controls (with safe defaults)
function ctrl(name, def){
  try{ return holder.effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value; } catch(e){ return def; }
}
var mode = Math.round(ctrl("Fit Mode", 1)); // 1=Contain, 2=Fill, 3=Stretch
var pad  = Math.max(0, ctrl("Padding", 0)); // pixels

holderW = Math.max(1, holderW - 2*pad);
holderH = Math.max(1, holderH - 2*pad);

// Get the target's *intrinsic* content size
function contentSize(li){
  // Prefer sourceRectAtTime (true bounds for text/shapes)
  try {
    var rr = li.sourceRectAtTime(time, false);
    if (rr.width > 0 && rr.height > 0) return [rr.width, rr.height];
  } catch(e){}
  // Fallback for footage/precomps
  return [li.width, li.height];
}
var s = contentSize(thisLayer);

var sx = holderW / s[0] * 100;
var sy = holderH / s[1] * 100;

(mode == 3) ? [sx, sy] : (mode == 1 ? Math.min(sx, sy) : Math.max(sx, sy)) * [1,1];
