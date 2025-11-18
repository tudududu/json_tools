// TARGET ► Position — Baseline-locked for TEXT (simple)
// v01 — independent from holder; aligns to the current Position as target baseline

// This simple variant uses the layer's own Position as the target point P.
// - Single line: first-line baseline (y=0) aligns to P.
// - 2+ lines: last line baseline aligns to P using the text style leading for spacing.
// Optional: add a Slider effect named "Baseline Nudge Y" on this layer to nudge P in pixels (comp space).

function isText(li){ try{ li.text.sourceText; return true; } catch(e){ return false; } }

if (isText(thisLayer)){
  var P = value; // comp-space target (the layer's current Position)
  var nudge = 0; try { nudge = effect("Baseline Nudge Y")("Slider").value; } catch (e) {}
  var Pn = [P[0], P[1] + nudge, P.length>2? P[2] : undefined];

  var r  = sourceRectAtTime(time, false);
  var w  = Math.max(1, r.width);
  var bx = r.left + w/2;

  // Count lines
  var txtStr = ""; try { txtStr = text.sourceText + ""; } catch(e) {}
  var lineCount = 1;
  if (txtStr.length) {
    var norm = txtStr.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    lineCount = norm.split("\n").length;
  }

  // Determine leading (baseline-to-baseline distance)
  var lead = 0, autoL = false, fSize = 0;
  try {
    var st = text.sourceText.style;
    fSize = st.fontSize || 0;
    lead = st.leading || 0;
    autoL = st.autoLeading ? true : false;
  } catch (e) {}
  if (autoL || lead <= 0) {
    lead = fSize > 0 ? fSize * 1.2 : (r.height/Math.max(1,lineCount));
  }

  var delta;
  if (lineCount > 1) {
    var lastY = (lineCount - 1) * lead;
    var lastBaselineComp = toComp([bx, lastY]);
    delta = Pn - lastBaselineComp;
  } else {
    var baselineComp = toComp([bx, 0]);
    delta = Pn - baselineComp;
  }

  thisLayer.threeDLayer ? value + [delta[0], delta[1], 0] : value + delta;
} else {
  value; // Non-text: do nothing
}
