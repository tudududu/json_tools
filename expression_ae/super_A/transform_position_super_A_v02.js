// transform_position_super_A_v02
// TARGET ► Position v02 260502
// — vertical centering for oneline and multiline TEXT
// - horizontal alignment switchable L/C/R (inline control)

var holder = thisComp.layer("locker_super_A");
var group  = holder.content("PLACEHOLDER");
var rect   = group.content("Rectangle Path 1");

// --- Holder center/axes/half-extents in comp space (rotation aware) ---
function norm(v){ var L = length(v,[0,0,0]); return (L>0)? v/L : v; }
var gp   = group.transform.position;
var C    = holder.toComp(gp);
var Xax  = norm(holder.toCompVec([1,0,0]));
var Yax  = norm(holder.toCompVec([0,1,0]));
var cCtr = C;
var cR   = holder.toComp([gp[0] + rect.size[0]/2, gp[1]]);
var cT   = holder.toComp([gp[0], gp[1] - rect.size[1]/2]);
var halfW = length(cR - cCtr);
var halfH = length(cT - cCtr);

// Optional controls
function ctrl(name, def){
  try{ return holder.effect(name)(name.match(/Menu/i) ? "Menu" : "Slider").value; } catch(e){ return def; }
}
var pad = Math.max(0, ctrl("Padding", 0));
// Horizontal alignment from holder control: -1..1 (left..right)
var ax  = Math.max(-1, Math.min(1, ctrl("Align X", 0))); // -1..1
// Optional vertical alignment slider still supported (0=center)
var ay  = Math.max(-1, Math.min(1, ctrl("Align Y", 0))); // -1..1
// Automatic vertical centering for multiline TEXT (2D point text only).
// Simplified: 1 line = baseline align; >=2 lines = compute baseline offset so block visually centers in holder.

halfW = Math.max(0, halfW - pad);
halfH = Math.max(0, halfH - pad);

// Target comp-space point inside the placeholder
// Map ax to left..right range
var xp = ax * halfW;
var P = C + Xax*(xp) + Yax*(ay*halfH);

// --- Baseline lock for TEXT layers ---
function isText(li){ try{ li.text.sourceText; return true; } catch(e) { return false; } }

if (isText(thisLayer)){
  // Align selected horizontal reference (from ax) & vertical geometric center
  var r = sourceRectAtTime(time, false);
  var centerY = r.top + r.height/2; // vertical center
  var refLocalX = r.left + ((ax + 1) * 0.5) * r.width;
  var refComp = toComp([refLocalX, centerY]);
  // Delta from current placed center-left to target P
  var dx = P[0] - refComp[0];
  var dy = P[1] - refComp[1];
  thisLayer.threeDLayer ? value + [dx, dy, 0] : value + [dx, dy];
} else {
  // Non-text: keep prior behavior (position to alignment target)
  thisLayer.threeDLayer ? [P[0], P[1], value[2]] : P;
}
