/*
 * main.js — the glue. The ONLY place canvas meets the notifier.
 * Builds the renderer + notifier, registers the scene function (which reads
 * the notifier's per-frame descriptor and draws bg -> bloom -> spark ->
 * particles -> shake/flash), then starts the demo cycler.
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var C = App.config, P = App.palette, S = App.spark, E = App.effects;
  var RES = C.INTERNAL_RES;
  var TAU = Math.PI * 2;

  function boot() {
    var canvas = document.getElementById('screen');
    var messageEl = document.getElementById('message');
    var fpsEl = document.getElementById('fps');

    var renderer = new App.Renderer(canvas);
    var notifier = new App.Notifier();
    var particles = new E.ParticleSystem(220);

    var bg = P.hexToRgb(C.PALETTES.background);
    var cx = RES / 2, cy = RES / 2;

    var messageText = null, lastColor = null;

    // Resolve the active palette, blending prev -> current during a cross-fade.
    function resolvePalette(frame) {
      var cur = P.toRgbPalette(C.PALETTES[frame.preset.palette]);
      if (frame.prevState && frame.fade < 1) {
        var prev = P.toRgbPalette(C.PALETTES[C.STATE_PRESETS[frame.prevState].palette]);
        return P.mixPalette(prev, cur, frame.fade);
      }
      return cur;
    }

    renderer.setScene(function (ctx, elapsed, dt, now, fps) {
      var frame = notifier.update(now);
      var preset = frame.preset;
      var pal = resolvePalette(frame);
      var tsec = elapsed / 1000;
      var wave = Math.sin(tsec * preset.pulseHz * TAU); // shared pulse phase

      // --- message overlay (only touch the DOM on change) ---
      if (frame.message !== messageText) {
        messageText = frame.message;
        if (messageEl) messageEl.textContent = messageText;
      }
      if (messageEl) {
        var colStr = P.rgbStr(pal.mid);
        if (colStr !== lastColor) { messageEl.style.color = colStr; lastColor = colStr; }
      }

      // --- clear to background (opaque, so no additive trails) ---
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = P.rgbStr(bg);
      ctx.fillRect(0, 0, RES, RES);

      // --- motion params from preset + time ---
      var rotation = (preset.spinDegPerSec || 0) * tsec * Math.PI / 180;
      if (preset.jitter) rotation += (Math.random() - 0.5) * preset.jitter * 0.1;
      var pulse = preset.pulseShape === 'square'
        ? 1 + preset.pulseDepth * (wave > 0 ? 1 : -1)
        : 1 + preset.pulseDepth * wave;

      var intensity = (preset.intensity == null ? 1 : preset.intensity);
      intensity *= 0.4 + 0.6 * frame.entry;             // fade the spark in
      if (preset.flash) intensity *= (wave > 0 ? 1 : 0.55); // error strobe

      // --- error shake translates the whole spark (integer only) ---
      var sh = E.shakeOffset(preset.shake, elapsed, frame.duration);
      ctx.save();
      if (sh.x || sh.y) ctx.translate(sh.x, sh.y);

      // --- bloom halo (behind the spark) ---
      var bloomR = Math.round((C.SPARK.longLen + 10) * (0.9 + 0.2 * pulse));
      var bloomA = (preset.bloom.base + preset.bloom.gain * (0.5 + 0.5 * wave)) * intensity;
      E.drawBloom(ctx, cx, cy, bloomR, pal, P.clamp01(bloomA) * 0.5);

      // --- the spark ---
      S.drawSpark(ctx, {
        cx: cx, cy: cy,
        spokes: C.SPARK.spokes,
        longLen: C.SPARK.longLen,
        shortLen: C.SPARK.shortLen,
        thickness: C.SPARK.thickness,
        rotation: rotation,
        coreRadius: C.SPARK.coreRadius,
        palette: pal,
        intensity: intensity,
        pulse: pulse,
      });

      // --- sparkle particles ---
      particles.emit(cx, cy, preset.particles, dt);
      particles.update(dt);
      particles.draw(ctx, pal);

      ctx.restore();

      // --- error flash overlays the full (un-shaken) frame ---
      if (preset.flash) E.drawFlash(ctx, RES, RES, preset.flash, pal, elapsed);

      if (fpsEl && fps) fpsEl.textContent = fps + ' fps';
    });

    // Expose the seam so ANY trigger (console, future webhook) can drive it.
    App.notifier = notifier;
    window.Notifier = notifier;

    App.demo.bindHotkeys(notifier);
    App.demo.startDemo(notifier);
    renderer.run();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.App);
