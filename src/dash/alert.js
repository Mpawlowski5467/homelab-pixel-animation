/*
 * dash/alert.js — the critical-alert TAKEOVER. When something goes critical the
 * whole strip becomes this (the v1 drama: big spark + strobe + shake + message),
 * then main.js returns to the rotating dashboard.
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette, S = App.spark, T = App.text, E = App.effects, C = App.config;

  function alertScene(ctx, t, alert, elapsedMs, BW, BH) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = P.rgbStr(P.hexToRgb(C.PALETTES.background));
    ctx.fillRect(0, 0, BW, BH);

    var pr = C.STATE_PRESETS.error;
    var pal = P.toRgbPalette(C.PALETTES.error);
    var wave = Math.sin(t * pr.pulseHz * 6.283);
    var intensity = (wave > 0 ? 1 : 0.55);
    var pulse = 1 + pr.pulseDepth * (wave > 0 ? 1 : -1);

    var amp = pr.shake.amp * Math.max(0.25, 1 - elapsedMs / 5200);
    var dx = Math.round(Math.sin(t * pr.shake.hz * 6.283) * amp + (Math.random() - 0.5) * amp);
    var dy = Math.round(Math.cos(t * pr.shake.hz * 5.1) * amp);

    ctx.save();
    ctx.translate(dx, dy);
    S.drawSpark(ctx, {
      cx: 50, cy: BH / 2, spokes: 12, longLen: 30, shortLen: 17, thickness: 2.6,
      rotation: 0, coreRadius: 7, palette: pal, intensity: intensity, pulse: pulse,
    });
    ctx.restore();

    T.text(ctx, 'CRITICAL ALERT', 100, 28, P.rgbStr(pal.tip), 11, 'left');
    T.text(ctx, (alert && alert.msg ? alert.msg : 'system fault').toUpperCase(),
      100, 46, P.rgbStr(P.hexToRgb(C.PALETTES.white)), 8, 'left');
    T.text(ctx, 'CHECK YOUR HOMELAB', 100, 60, P.rgba(pal.tip, 0.8), 5, 'left');

    E.drawFlash(ctx, BW, BH, pr.flash, pal, elapsedMs);
  }

  App.alert = { alertScene: alertScene };
})(window.App);
