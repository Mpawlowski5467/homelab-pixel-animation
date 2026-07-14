/*
 * dash/alert.js — the critical-alert TAKEOVER. When something goes critical the
 * whole strip becomes this (the v1 drama: big spark + strobe + shake + message),
 * then main.js returns to the rotating dashboard.
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette, S = App.spark, T = App.text, C = App.config;

  function alertScene(ctx, t, alert, elapsedMs, BW, BH) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = P.rgbStr(P.hexToRgb(C.PALETTES.background));
    ctx.fillRect(0, 0, BW, BH);

    var pr = C.STATE_PRESETS.error;
    var pal = P.toRgbPalette(C.PALETTES.error);
    var reduceMotion = !!App.reduceMotion;
    var localSec = elapsedMs / 1000;
    var entry = reduceMotion ? 1 : Math.min(1, elapsedMs / 320);
    var enterEase = 1 - Math.pow(1 - entry, 3);
    var wave = reduceMotion ? 0 : Math.sin(localSec * 1.35 * 6.283);
    var intensity = reduceMotion ? 0.94 : 0.95 + 0.05 * wave;
    var pulse = reduceMotion ? 1 : 1 + pr.pulseDepth * 0.45 * wave;

    // A deterministic impact settles completely after 720ms; no random jitter
    // means the entrance reads cleanly at the dashboard's tiny resolution.
    var shakeT = Math.max(0, elapsedMs - 90);
    var shakeEnv = reduceMotion || elapsedMs < 90 || shakeT >= 720
      ? 0 : Math.pow(1 - shakeT / 720, 2);
    var dx = Math.round(Math.sin(shakeT / 1000 * pr.shake.hz * 6.283) * pr.shake.amp * shakeEnv);
    var dy = Math.round(Math.cos(shakeT / 1000 * pr.shake.hz * 0.73 * 6.283) * pr.shake.amp * 0.45 * shakeEnv);

    function flashPeak(center, halfWidth, strength) {
      var v = 1 - Math.abs(elapsedMs - center) / halfWidth;
      return v > 0 ? v * v * strength : 0;
    }

    // Slow background sweep + alert rails add motion while leaving text stable.
    if (!reduceMotion) {
      var sweepX = Math.round((elapsedMs * 0.055) % (BW + 48)) - 24;
      ctx.fillStyle = P.rgba(pal.tip, 0.045);
      ctx.fillRect(sweepX, 12, 18, BH - 23);
      var flashA = flashPeak(110, 90, pr.flash.amp * 0.65) +
        flashPeak(300, 70, pr.flash.amp * 0.30);
      if (flashA > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = P.rgba(pal.tip, flashA);
        ctx.fillRect(0, 0, BW, BH);
        ctx.restore();
      }
    }
    var railA = reduceMotion ? 0.28 : 0.18 + 0.10 * (0.5 + 0.5 * Math.sin(localSec * 1.1 * 6.283));
    ctx.fillStyle = P.rgba(pal.tip, railA);
    ctx.fillRect(0, 12, BW, 1);
    ctx.fillRect(0, BH - 11, BW, 1);

    ctx.save();
    ctx.translate(dx, dy);
    var sparkEntry = reduceMotion ? 1 : 0.76 + 0.24 * enterEase;
    S.drawSpark(ctx, {
      cx: 50 - (reduceMotion ? 0 : Math.round((1 - enterEase) * 9)), cy: BH / 2,
      spokes: 12, longLen: 30 * sparkEntry, shortLen: 17 * sparkEntry, thickness: 2.6,
      rotation: 0, coreRadius: 7 * sparkEntry, palette: pal, intensity: intensity, pulse: pulse,
    });

    var textX = 100 + (reduceMotion ? 0 : Math.round((1 - enterEase) * 7));
    ctx.globalAlpha = reduceMotion ? 1 : 0.35 + 0.65 * enterEase;
    T.text(ctx, 'CRITICAL ALERT', textX, 28, P.rgbStr(pal.tip), 11, 'left');
    T.text(ctx, (alert && alert.msg ? alert.msg : 'system fault').toUpperCase(),
      textX, 46, P.rgbStr(P.hexToRgb(C.PALETTES.white)), 8, 'left');
    T.text(ctx, 'CHECK YOUR HOMELAB', textX, 60, P.rgba(pal.tip, 0.8), 5, 'left');
    ctx.restore();
  }

  App.alert = { alertScene: alertScene };
})(window.App);
