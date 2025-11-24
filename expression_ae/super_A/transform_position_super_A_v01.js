// TARGET ► Position — vertical centering for oneline and multiline TEXT
var holder = thisComp.layer("Size_Holder_super_A");
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
var ax  = Math.max(-1, Math.min(1, ctrl("Align X", 0))); // -1..1
var ay  = Math.max(-1, Math.min(1, ctrl("Align Y", 0))); // -1..1
// Automatic vertical centering for multiline TEXT (2D point text only).
// Simplified: 1 line = baseline align; >=2 lines = compute baseline offset so block visually centers in holder.
// (Prev sliders removed for clarity; remove any old "V Align" / "Center Mode" controls if not needed.)

halfW = Math.max(0, halfW - pad);
halfH = Math.max(0, halfH - pad);

// Target comp-space point inside the placeholder
var P = C + Xax*(ax*halfW) + Yax*(ay*halfH);

// --- Baseline lock for TEXT layers ---
function isText(li){ try{ li.text.sourceText; return true; } catch(e) { return false; } }

if (isText(thisLayer)){
  // Uniform: align left edge & vertical geometric center for all line counts.
  var r = sourceRectAtTime(time, false);
  var leftX = r.left; // left edge
  var centerY = r.top + r.height/2; // vertical center
  var refComp = toComp([leftX, centerY]);
  // Delta from current placed center-left to target P
  var dx = P[0] - refComp[0];
  var dy = P[1] - refComp[1];
  thisLayer.threeDLayer ? value + [dx, dy, 0] : value + [dx, dy];
} else {
  // Non-text: keep prior behavior (position to alignment target)
  thisLayer.threeDLayer ? [P[0], P[1], value[2]] : P;
}
