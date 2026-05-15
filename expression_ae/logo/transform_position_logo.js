// transform_position_logo.js
// TARGET ► Position
var holderName = "locker_" + thisLayer.name;
var holder = thisComp.layer(holderName);
var group = holder.content("PLACEHOLDER");
var rect  = group.content("Rectangle Path 1");

// Center of rect (comp space)
var gp = group.transform.position;
var C  = holder.toComp(gp);

// Holder's local axes in comp space
function norm(v){ var L = length(v,[0,0,0]); return (L>0)? v/L : v; }
var Xaxis = norm(holder.toCompVec([1,0,0]));
var Yaxis = norm(holder.toCompVec([0,1,0]));

// Comp-space half extents of the rectangle (handles holder transforms)
var cCenter = holder.toComp(gp);
var cRight  = holder.toComp([gp[0] + rect.size[0]/2, gp[1]]);
var cTop    = holder.toComp([gp[0], gp[1] - rect.size[1]/2]); // -Y is up in layer space
var halfW   = length(cRight - cCenter);
var halfH   = length(cTop   - cCenter);

// Optional controls with defaults
function ctrl(name, def){
  try{ return holder.effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value; } catch(e){ return def; }
}
var pad = Math.max(0, ctrl("Padding", 0));
var ax  = Math.max(-1, Math.min(1, ctrl("Align X", 0))); // -1..1
var ay  = Math.max(-1, Math.min(1, ctrl("Align Y", 0))); // -1..1

// Apply padding by shrinking usable half-extents
halfW = Math.max(0, halfW - pad);
halfH = Math.max(0, halfH - pad);

// Offset within holder along its local axes
C + Xaxis * (ax * halfW) + Yaxis * (ay * halfH);
