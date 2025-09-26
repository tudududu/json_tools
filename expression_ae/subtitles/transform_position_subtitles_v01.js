// TARGET ► Position — Baseline-locked for TEXT; same alignment for others
var holder = thisComp.layer("Size_Holder_Subtit");
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
    // --- Mode A: lock baseline to LAST line (requested for 2-line subtitles) ---
    // We detect 2-line case specifically; for >2 lines we still geometric-center.
    if (lineCount === 2) {
      // Improved baseline estimate: r.top = -ascender. Height = asc + B + desc.
      // Let descent ≈ ascender * descentRatio (default 0.25). Then
      // baseline2Y = r.height + r.top*(1 + descentRatio) (derivation in notes).
      var descentRatio = ctrl("Descent Ratio", 0.25); // optional fine-tune
      var baseline2Y = r.height + r.top * (1 + descentRatio);
      // Fallback: if estimate goes negative or > height, revert to lineH method.
      if (baseline2Y < 0 || baseline2Y > r.height) {
        baseline2Y = r.height / lineCount; // fallback
      }
      var lastBaselineComp = toComp([bx, baseline2Y]);
      deltaC = P - lastBaselineComp; // place 2nd line baseline at P
    } else {
      // Fallback to geometric center for 3+ lines
      var centerY = r.top + r.height/2;
      var centerComp = toComp([bx, centerY]);
      deltaC = P - centerComp;
    }
  } else {
    // Single line: align first line baseline at P
    var baselineComp = toComp([bx, 0]);
    deltaC = P - baselineComp;
  }

  thisLayer.threeDLayer ? value + [deltaC[0], deltaC[1], 0] : value + deltaC;
} else {
  // Non-text: keep prior behavior (position to alignment target)
  thisLayer.threeDLayer ? [P[0], P[1], value[2]] : P;
}
