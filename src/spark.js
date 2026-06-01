/*
 * spark.js — the procedural Anthropic-style spark/asterisk, drawn as pixel art.
 *
 * Key trick: we RASTERISE. Every mark is an integer 1x1 fillRect (never
 * lineTo/stroke, which would anti-alias). Spokes march outward 1px at a time,
 * tapering in width and colour. The whole thing is a pure function of params,
 * so a single renderer serves all states (only colour/intensity/pulse vary).
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette;

  // Plot one logical pixel (caller sets fillStyle + composite).
  function px(ctx, x, y) { ctx.fillRect(x | 0, y | 0, 1, 1); }

  // Filled disc of integer pixels (Euclidean).
  function fillDisc(ctx, cx, cy, radius) {
    if (radius <= 0) { px(ctx, cx, cy); return; }
    var r2 = radius * radius;
    for (var y = -radius; y <= radius; y++) {
      for (var x = -radius; x <= radius; x++) {
        if (x * x + y * y <= r2) px(ctx, cx + x, cy + y);
      }
    }
  }

  // p = { cx, cy, spokes, longLen, shortLen, thickness, rotation, coreRadius,
  //       palette:{core,mid,tip rgb}, intensity (0..1), pulse (~1 size mult) }
  function drawSpark(ctx, p) {
    var pal = p.palette;
    var intensity = p.intensity == null ? 1 : p.intensity;
    var pulse = p.pulse == null ? 1 : p.pulse;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // bright pixels sum toward white

    var i, r, k;
    for (i = 0; i < p.spokes; i++) {
      var angle = p.rotation + (i * Math.PI * 2) / p.spokes;
      var len = ((i % 2 === 0) ? p.longLen : p.shortLen) * pulse;
      var dx = Math.cos(angle), dy = Math.sin(angle);
      var nx = -dy, ny = dx; // unit normal for spoke width

      for (r = 0; r <= len; r++) {
        var t = r / len;                          // 0 = core, 1 = tip
        var w = p.thickness * (1 - t) * (1 - t);  // taper to a point
        var col = P.ramp3(pal, 1 - t);            // core colour -> tip colour
        var a = intensity * (0.35 + 0.65 * (1 - t));
        ctx.fillStyle = P.rgba(col, a);
        var bx = p.cx + dx * r, by = p.cy + dy * r;
        var ww = Math.max(0, Math.round(w));
        for (k = -ww; k <= ww; k++) px(ctx, bx + nx * k, by + ny * k);
      }
    }

    // Core bloom: concentric discs ramping to ivory-white-hot center.
    var cr = p.coreRadius * (0.85 + 0.15 * pulse);
    for (r = Math.ceil(cr); r >= 0; r--) {
      var ct = cr === 0 ? 1 : 1 - r / cr;         // 0 edge -> 1 center
      var ccol = P.ramp3(pal, 0.5 + 0.5 * ct);    // mid -> core
      if (ct > 0.7) ccol = P.mixRgb(ccol, pal.core, (ct - 0.7) / 0.3);
      ctx.fillStyle = P.rgba(ccol, intensity * (0.5 + 0.5 * ct));
      fillDisc(ctx, p.cx, p.cy, r);
    }

    ctx.restore();
  }

  App.spark = { drawSpark: drawSpark, fillDisc: fillDisc, px: px };
})(window.App);
