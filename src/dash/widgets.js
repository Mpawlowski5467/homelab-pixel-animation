/*
 * dash/widgets.js — reusable pixel widgets: mini-spark, sparkline, metric row.
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette, S = App.spark, T = App.text, C = App.config;

  function palOf(state) { return P.toRgbPalette(C.PALETTES[state]); }

  // A small spark in a given state, animated per that state's preset.
  function miniSpark(ctx, cx, cy, state, t, o) {
    o = o || {};
    var pr = C.STATE_PRESETS[state] || C.STATE_PRESETS.idle;
    var TAU = Math.PI * 2;
    var phase = (typeof o.phase === 'number' && isFinite(o.phase)) ? o.phase : 0;
    phase -= Math.floor(phase); // phase is expressed as a stable 0..1 cycle offset
    var phaseAngle = phase * TAU;
    var reduceMotion = !!App.reduceMotion;
    var wave = Math.sin(t * pr.pulseHz * TAU + phaseAngle);
    var pulse = reduceMotion ? 1
      : pr.pulseShape === 'square' ? 1 + pr.pulseDepth * (wave > 0 ? 1 : -1)
                                   : 1 + pr.pulseDepth * wave;
    var intensity = (pr.intensity == null ? 1 : pr.intensity);
    if (pr.flash && !reduceMotion) intensity *= (wave > 0 ? 1 : 0.62);
    var dx = 0, dy = 0;
    if (pr.shake && !reduceMotion) {
      var a = pr.shake.amp * (o.shake == null ? 0.5 : o.shake);
      dx = Math.round(Math.sin(t * pr.shake.hz * TAU + phaseAngle) * a);
      dy = Math.round(Math.cos(t * pr.shake.hz * 5.1 + phaseAngle * 1.37) * a);
    }
    ctx.save();
    if (dx || dy) ctx.translate(dx, dy);
    S.drawSpark(ctx, {
      cx: cx, cy: cy, spokes: 12,
      longLen: o.longLen || 11, shortLen: o.shortLen || 6.5, thickness: o.thickness || 1.2,
      // Offset within one spoke interval so neighbouring sparks do not rotate in lockstep.
      rotation: (reduceMotion ? 0 : t * (pr.spinDegPerSec || 0) * Math.PI / 180) + phaseAngle / 12,
      coreRadius: o.coreRadius || 2.3, palette: palOf(state), intensity: intensity, pulse: pulse,
    });
    ctx.restore();
  }

  // Area sparkline of a Ring into the box [x,y,w,h].
  function sparkline(ctx, x, y, w, h, ring, col, max) {
    var buf = ring.buf, n = buf.length;
    max = max || 100;
    ctx.globalCompositeOperation = 'source-over';
    var prevY = null;
    for (var i = 0; i < n; i++) {
      var px = x + Math.round(i / (n - 1) * (w - 1));
      var norm = buf[i] / max; if (norm > 1) norm = 1; if (norm < 0) norm = 0;
      var py = y + (h - 1) - Math.round(norm * (h - 1));
      ctx.fillStyle = P.rgba(col, 0.15);
      ctx.fillRect(px, py + 1, 1, (y + h) - (py + 1));
      if (prevY != null) {
        var a = Math.min(prevY, py), b = Math.max(prevY, py);
        ctx.fillStyle = P.rgba(col, 0.9);
        for (var yy = a; yy <= b; yy++) ctx.fillRect(px, yy, 1, 1);
      }
      ctx.fillStyle = P.rgba(col, 1);
      ctx.fillRect(px, py, 1, 1);
      prevY = py;
    }
  }

  // Label + value + sparkline as one row.  rowHeight ~16.
  function metricRow(ctx, label, x, y, w, ring, col, unit, max) {
    T.text(ctx, label, x, y, P.rgba(col, 0.92), 5);
    T.text(ctx, Math.round(ring.last()) + (unit || ''), x + w, y, P.rgbStr(col), 5, 'right');
    sparkline(ctx, x, y + 7, w, 9, ring, col, max);
  }

  App.widgets = { miniSpark: miniSpark, sparkline: sparkline, metricRow: metricRow, palOf: palOf };
})(window.App);
