// transform_anchor_logo.js
// TARGET ► Anchor Point (2D/3D‑safe center to true bounds)
var is3D = thisLayer.threeDLayer;

function centeredXY(includeExtents){
  try {
    var r = sourceRectAtTime(time, includeExtents); // works for Text/Shapes
    return [r.left + r.width/2, r.top + r.height/2];
  } catch (e) {
    // Fallback for footage/precomp or if SRAT isn't available
    return [width/2, height/2];
  }
}

var xy = centeredXY(false); // set to true if you want to include stroke/shadow extents
is3D ? [xy[0], xy[1], value[2]] : xy;
