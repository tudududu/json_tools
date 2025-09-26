
// TARGET ► Position — Baseline-locked for TEXT; same alignment for others
var holder = thisComp.layer("Size_Holder_Claim");
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
  // Determine reference point in layer space we want to align to P.
  // For baseline mode: [centerX, 0]. For vertical-centering: middle of text block.
  var r  = sourceRectAtTime(time, false);
  var w  = Math.max(1, r.width);
  var bx = r.left + w/2;

  // Count lines (split on CR or LF). If text empty treat as 1.
  var txtStr = ""; try { txtStr = text.sourceText + ""; } catch(e) {}
  var lineCount = 1;
  if (txtStr.length) {
    // Normalize newlines then split
    var norm2 = txtStr.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    lineCount = norm2.split("\n").length;
  }

  var multiline = lineCount > 1;
  var deltaC;
  if (multiline) {
    // Estimate per-line height; AE's bounding box may include extra top padding.
    var lineH = r.height / lineCount;
    // Distance from first baseline (y=0) to visual vertical center approximated
    // as half of total baseline span: (lineCount-1)*lineH / 2.
    var baselineToCenter = ((lineCount - 1) * lineH) / 2;
    // Convert local baselineToCenter downwards (positive Y) into comp vector.
    var centerOffsetComp2 = toComp([0, baselineToCenter]) - toComp([0,0]);
    // Baseline must land at P - offset to place block center at P.
    var targetP2 = P - centerOffsetComp2;
    var pL = [bx, 0];
    var lP = fromComp(targetP2);
    var dL = pL - lP;
    deltaC = toComp(dL) - toComp([0,0]);
  } else {
    // Single line → keep baseline centered horizontally only.
    var pL3 = [bx, 0];
    var lP3 = fromComp(P);
    var dL3 = pL3 - lP3;
    deltaC = toComp(dL3) - toComp([0,0]);
  }

  thisLayer.threeDLayer ? value + [deltaC[0], deltaC[1], 0] : value + deltaC;
} else {
  // Non-text: keep prior behavior (position to alignment target)
  thisLayer.threeDLayer ? [P[0], P[1], value[2]] : P;
}
