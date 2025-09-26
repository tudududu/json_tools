// TEXT layer ► Anchor Point — Baseline-centered (no Y drift)
var is3D = thisLayer.threeDLayer;

try {
  var r = sourceRectAtTime(time, false);
  var w = Math.max(1, r.width); // avoid zero-width when text is empty
  var ax = r.left + w/2;        // horizontal center of visible text
  var ay = 6;                   // baseline is Y = 0 for POINT text
  is3D ? [ax, ay, value[2]] : [ax, ay];
} catch (e) {
  // Fallback: keep existing anchor if SRAT isn't available
  value;
}
