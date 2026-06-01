/*
 * mockup.js — a throwaway VISUAL MOCKUP for the 1280x400 (3.2:1) rack strip.
 * Demonstrates a "status wall": a brand hero spark + a grid of per-service
 * mini-sparks, each glowing in its own state colour, several at once.
 * Reuses the v1 engine (spark/effects/palette/config). Not the final code.
 */
(function () {
  'use strict';
  var P = App.palette, S = App.spark, C = App.config;

  var BUF_W = 320, BUF_H = 100;            // 4x -> 1280x400
  var display = document.getElementById('m');
  display.width = BUF_W; display.height = BUF_H;
  var dctx = display.getContext('2d'); dctx.imageSmoothingEnabled = false;
  var buffer = document.createElement('canvas');
  buffer.width = BUF_W; buffer.height = BUF_H;
  var ctx = buffer.getContext('2d');

  var bg = P.hexToRgb(C.PALETTES.background);
  var hero = { cx: 50, cy: 50, longLen: 30, shortLen: 17, thickness: 2.4, coreRadius: 6 };

  // Several statuses shown at once — varied on purpose.
  var services = [
    { label: 'WEB', state: 'success' },
    { label: 'PVE', state: 'success' },
    { label: 'NAS', state: 'warning' },
    { label: 'DNS', state: 'success' },
    { label: 'VPN', state: 'info' },
    { label: 'BAK', state: 'error' },
  ];
  var COLS = 3;
  services.forEach(function (s, i) {
    s.cx = 134 + (i % COLS) * 64;          // 134, 198, 262
    s.cy = 34 + ((i / COLS) | 0) * 34;     // 34, 68
  });

  function palOf(state) { return P.toRgbPalette(C.PALETTES[state]); }

  function drawMini(s, t) {
    var pr = C.STATE_PRESETS[s.state];
    var wave = Math.sin(t * pr.pulseHz * 6.283);
    var pulse = pr.pulseShape === 'square' ? 1 + pr.pulseDepth * (wave > 0 ? 1 : -1)
                                           : 1 + pr.pulseDepth * wave;
    var intensity = (pr.intensity == null ? 1 : pr.intensity);
    if (pr.flash) intensity *= (wave > 0 ? 1 : 0.6);   // error strobe
    var dx = 0, dy = 0;
    if (pr.shake) {                                     // error shake (local)
      var a = pr.shake.amp * 0.6;
      dx = Math.round(Math.sin(t * pr.shake.hz * 6.283) * a + (Math.random() - 0.5) * a);
      dy = Math.round(Math.cos(t * pr.shake.hz * 5.1) * a);
    }
    ctx.save();
    if (dx || dy) ctx.translate(dx, dy);
    S.drawSpark(ctx, {
      cx: s.cx, cy: s.cy, spokes: 12, longLen: 12, shortLen: 7, thickness: 1.3,
      rotation: t * (pr.spinDegPerSec || 0) * Math.PI / 180,
      coreRadius: 2.5, palette: palOf(s.state), intensity: intensity, pulse: pulse,
    });
    ctx.restore();
  }

  function frame(now) {
    var t = now / 1000;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = P.rgbStr(bg);
    ctx.fillRect(0, 0, BUF_W, BUF_H);

    S.drawSpark(ctx, {                                 // brand hero spark
      cx: hero.cx, cy: hero.cy, spokes: 12, longLen: hero.longLen, shortLen: hero.shortLen,
      thickness: hero.thickness, rotation: t * 0.25, coreRadius: hero.coreRadius,
      palette: palOf('idle'), intensity: 0.92, pulse: 1 + 0.05 * Math.sin(t * 0.25 * 6.283),
    });
    services.forEach(function (s) { drawMini(s, t); });

    dctx.drawImage(buffer, 0, 0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- HTML labels positioned by % over the canvas (exact buffer mapping) ---
  var labels = document.getElementById('labels');
  function addLabel(text, x, y, color, cls) {
    var d = document.createElement('div');
    d.className = 'lbl' + (cls ? ' ' + cls : '');
    d.textContent = text;
    d.style.left = (x / BUF_W * 100) + '%';
    d.style.top = (y / BUF_H * 100) + '%';
    if (color) d.style.color = color;
    labels.appendChild(d);
  }
  addLabel('HOMELAB', hero.cx, 88, P.rgbStr(P.hexToRgb(C.PALETTES.idle.mid)), 'hero');
  services.forEach(function (s) {
    addLabel(s.label, s.cx, s.cy + 13, P.rgbStr(P.hexToRgb(C.PALETTES[s.state].mid)));
  });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var d = new Date();
    var el = document.getElementById('clock');
    if (el) el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  setInterval(tick, 1000); tick();
})();
