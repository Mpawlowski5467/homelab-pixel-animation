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
    var motionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    var pulsePhase = 0;
    var rotation = 0;

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
      var reduceMotion = !!(motionQuery && motionQuery.matches);
      var motionScale = reduceMotion ? 0.15 : 1;

      // Integrate phase instead of deriving it from app uptime. Changing to a
      // preset with a different speed now accelerates smoothly without a jump.
      pulsePhase = (pulsePhase + dt * preset.pulseHz * TAU * motionScale) % TAU;
      rotation = (rotation + dt * (preset.spinDegPerSec || 0) * Math.PI / 180 * motionScale) % TAU;
      var wave = Math.sin(pulsePhase);

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
      var frameRotation = rotation;
      if (!reduceMotion && preset.jitter) {
        frameRotation += (Math.random() - 0.5) * preset.jitter * 0.1;
      }
      var pulseDepth = preset.pulseDepth * (reduceMotion ? 0.2 : 1);
      var pulse = preset.pulseShape === 'square' && !reduceMotion
        ? 1 + pulseDepth * (wave > 0 ? 1 : -1)
        : 1 + pulseDepth * wave;

      var intensity = (preset.intensity == null ? 1 : preset.intensity);
      intensity *= 0.4 + 0.6 * frame.entry;             // fade the spark in
      if (preset.flash && !reduceMotion) intensity *= (wave > 0 ? 1 : 0.55); // error strobe

      // --- error shake translates the whole spark (integer only) ---
      var sh = reduceMotion
        ? { x: 0, y: 0 }
        : E.shakeOffset(preset.shake, frame.elapsed, frame.duration);
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
        rotation: frameRotation,
        coreRadius: C.SPARK.coreRadius,
        palette: pal,
        intensity: intensity,
        pulse: pulse,
      });

      // --- sparkle particles ---
      if (!reduceMotion) particles.emit(cx, cy, preset.particles, dt);
      particles.update(dt);
      if (!reduceMotion) particles.draw(ctx, pal);

      ctx.restore();

      // --- error flash overlays the full (un-shaken) frame ---
      if (preset.flash && !reduceMotion) {
        E.drawFlash(ctx, RES, RES, preset.flash, pal, frame.elapsed);
      }

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
