/*
 * effects.js — pixel-native glow, sparkles, shake and flash.
 * Everything operates on the 128x128 buffer so it stays chunky after upscale.
 * No CSS/SVG blur anywhere (that would smooth the pixels and break the look).
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette;
  var px = App.spark.px;

  // --- Ring bloom -----------------------------------------------------------
  // A halo built from discrete concentric rings of decreasing alpha, with a
  // touch of ordered dithering at the faint edge. Draw this BEFORE the spark.
  function ringPixels(ctx, cx, cy, radius) {
    var outer = radius + 0.5, inner = radius - 0.5;
    var o2 = outer * outer, i2 = inner * inner;
    for (var y = -radius - 1; y <= radius + 1; y++) {
      var yy = y * y;
      if (yy > o2) continue;
      var xo = Math.floor(Math.sqrt(o2 - yy));
      if (yy < i2) {
        var xi = Math.ceil(Math.sqrt(i2 - yy));
        for (var x = xi; x <= xo; x++) { px(ctx, cx + x, cy + y); px(ctx, cx - x, cy + y); }
      } else {
        for (var x2 = -xo; x2 <= xo; x2++) px(ctx, cx + x2, cy + y);
      }
    }
  }

  function drawBloom(ctx, cx, cy, radiusMax, pal, alphaScale) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var r = radiusMax; r >= 1; r--) {
      var t = r / radiusMax;                 // 1 outer -> ~0 inner
      var col = P.ramp3(pal, 1 - t);         // outer = tip, inner = core
      var a = (1 - t) * (1 - t) * alphaScale;
      a *= 0.6 + 0.4 * P.bayer(r, r);        // stipple the falloff
      if (a <= 0.003) continue;
      ctx.fillStyle = P.rgba(col, a);
      ringPixels(ctx, cx, cy, r);
    }
    ctx.restore();
  }

  // --- Sparkle particle system ---------------------------------------------
  function ParticleSystem(max) {
    this.max = max || 200;
    this.pool = [];
    this.acc = 0; // fractional spawn accumulator
  }

  ParticleSystem.prototype.emit = function (cx, cy, cfg, dt) {
    if (!cfg || !cfg.rate) return;
    this.acc += cfg.rate * dt;
    while (this.acc >= 1 && this.pool.length < this.max) {
      this.acc -= 1;
      this._spawn(cx, cy, cfg);
    }
    if (this.acc > 4) this.acc = 4; // don't bank a backlog after a stall
  };

  ParticleSystem.prototype._spawn = function (cx, cy, cfg) {
    var spread = cfg.spread || 'radial';
    var spd = cfg.speed * (0.6 + 0.8 * Math.random());
    var ang;
    if (spread === 'up') { ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.2; }
    else if (spread === 'drift') { ang = Math.random() * Math.PI * 2; spd *= 0.5; }
    else if (spread === 'twinkle') { ang = Math.random() * Math.PI * 2; spd *= 0.3; }
    else { ang = Math.random() * Math.PI * 2; } // radial
    var r0 = 6 + Math.random() * 4;
    this.pool.push({
      x: cx + Math.cos(ang) * r0,
      y: cy + Math.sin(ang) * r0,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: cfg.life * (0.7 + 0.6 * Math.random()),
      age: 0,
      twinkle: spread === 'twinkle',
    });
  };

  ParticleSystem.prototype.update = function (dt) {
    var pool = this.pool;
    for (var i = pool.length - 1; i >= 0; i--) {
      var p = pool[i];
      p.age += dt;
      if (p.age >= p.life) { pool.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var drag = 1 - 1.2 * dt; if (drag < 0) drag = 0;
      p.vx *= drag; p.vy *= drag;
    }
  };

  ParticleSystem.prototype.draw = function (ctx, pal) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var pool = this.pool;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      var fade = 1 - p.age / p.life;            // 1 fresh -> 0 dead
      var col = P.ramp3(pal, 0.4 + 0.6 * fade); // start white-hot, fade to tip
      ctx.fillStyle = P.rgba(col, fade * fade);
      var x = p.x | 0, y = p.y | 0;
      if (p.twinkle && ((p.age * 20) | 0) % 2 === 0) {
        px(ctx, x, y); px(ctx, x + 1, y); px(ctx, x - 1, y); px(ctx, x, y + 1); px(ctx, x, y - 1);
      } else {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  };

  // --- Error shake: integer-only translation (sub-pixel would blur) ---------
  function shakeOffset(cfg, elapsed, life) {
    if (!cfg) return { x: 0, y: 0 };
    var amp = cfg.amp;
    if (cfg.decay && life && isFinite(life)) amp *= Math.max(0, 1 - elapsed / life);
    var t = elapsed / 1000;
    var x = Math.round(Math.sin(t * cfg.hz * 6.283) * amp + (Math.random() - 0.5) * amp);
    var y = Math.round(Math.cos(t * cfg.hz * 5.1) * amp + (Math.random() - 0.5) * amp);
    return { x: x, y: y };
  }

  // --- Error flash: full-frame additive strobe ------------------------------
  function drawFlash(ctx, w, h, cfg, pal, elapsed) {
    if (!cfg) return;
    var t = elapsed / 1000;
    var sq = Math.sin(t * cfg.hz * 6.283) > 0 ? 1 : 0; // square wave
    var a = cfg.amp * (0.35 + 0.65 * sq);
    if (a <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = P.rgba(pal.tip, a);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  App.effects = {
    ParticleSystem: ParticleSystem,
    drawBloom: drawBloom,
    ringPixels: ringPixels,
    shakeOffset: shakeOffset,
    drawFlash: drawFlash,
  };
})(window.App);
