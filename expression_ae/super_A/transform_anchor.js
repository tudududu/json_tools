// TEXT layer ► Anchor Point — left + vertical center for one-line and multiline POINT text
// Sets anchor so position expression can directly place left edge & vertical center to holder.
// For point text: r.top may be negative (ascender). Center = r.top + r.height/2.
var is3D = thisLayer.threeDLayer;
try {
  var r = sourceRectAtTime(time, false);
  var ax = r.left; // left edge
  var ay = r.top + r.height/2; // geometric vertical center independent of line count
  is3D ? [ax, ay, value[2]] : [ax, ay];
} catch(e) {
  value; // fallback
}
