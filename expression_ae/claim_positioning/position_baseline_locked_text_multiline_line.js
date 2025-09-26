
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
  // r.top is the top edge relative to anchor (baseline y=0 for first line in point text)
  // Center Y of block in layer space:
  var centerY = r.top + r.height/2;
  var yRef = useCenter ? centerY : 0;
  var pL = [bx, yRef];

  // Compute how much to move to place pL exactly at P
  var lP     = fromComp(P);                     // where P lands in current layer space
  var deltaL = pL - lP;                         // layer-space shift needed
  var deltaC = toComp(deltaL) - toComp([0,0]);  // convert to comp-space delta

  thisLayer.threeDLayer ? value + [deltaC[0], deltaC[1], 0] : value + deltaC;
} else {
  // Non-text: keep prior behavior (position to alignment target)
  thisLayer.threeDLayer ? [P[0], P[1], value[2]] : P;
}
