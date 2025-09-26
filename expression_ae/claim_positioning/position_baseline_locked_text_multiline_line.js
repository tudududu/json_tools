
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
// Vertical alignment mode for TEXT (add a Slider "V Align" on holder):
// 0 = Baseline (original behavior)
// 1 = Center block vertically (multiline or single line)
// 2 = Auto (baseline for 1 line, center if multiline) [default]
var vAlignMode = Math.round(ctrl("V Align", 2));
// Center Mode (add Slider "Center Mode" on holder):
// 0 = baseline shift method (current default)
// 1 = direct geometric center alignment (alternative if 0 looks offset)
var centerMode = Math.round(ctrl("Center Mode", 0));

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

  var useCenter = (vAlignMode === 1) || (vAlignMode === 2 && lineCount > 1);
  var centerY = r.top + r.height/2; // local geometric center Y

  var deltaC;
  if (useCenter) {
    if (centerMode === 1) {
      // Direct geometric center alignment: move so local center maps to P.
      var pCenterLocal = [bx, centerY];
      var targetLocal  = fromComp(P);
      var dLocal       = pCenterLocal - targetLocal;
      deltaC = toComp(dLocal) - toComp([0,0]);
    } else {
      // Baseline shift method (previous logic): adjust baseline so center ends at P.
      var centerOffsetComp = toComp([0, centerY]) - toComp([0,0]);
      var targetP = P - centerOffsetComp; // baseline target
      var pL = [bx, 0];
      var lP = fromComp(targetP);
      var dL = pL - lP;
      deltaC = toComp(dL) - toComp([0,0]);
    }
  } else {
    // Baseline mode: keep original baseline alignment semantics (no vertical adjustment beyond baseline centering)
    var pL2 = [bx, 0];
    var lP2 = fromComp(P);
    var dL2 = pL2 - lP2;
    deltaC = toComp(dL2) - toComp([0,0]);
  }

  thisLayer.threeDLayer ? value + [deltaC[0], deltaC[1], 0] : value + deltaC;
} else {
  // Non-text: keep prior behavior (position to alignment target)
  thisLayer.threeDLayer ? [P[0], P[1], value[2]] : P;
}
