/*
 * palette.js — pure colour maths. No canvas, no DOM.
 * Colours flow as {r,g,b} objects internally; hex only at the edges (config).
 */
window.App = window.App || {};
(function (App) {
  'use strict';

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixRgb(a, b, t) {
    return {
      r: Math.round(lerp(a.r, b.r, t)),
      g: Math.round(lerp(a.g, b.g, t)),
      b: Math.round(lerp(a.b, b.b, t)),
    };
  }

  function mixHex(aHex, bHex, t) {
    return mixRgb(hexToRgb(aHex), hexToRgb(bHex), t);
  }

  function rgba(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }
  function rgbStr(c) { return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')'; }

  // Normalise a hex state palette {core,mid,tip} into {r,g,b} objects.
  function toRgbPalette(p) {
    return { core: hexToRgb(p.core), mid: hexToRgb(p.mid), tip: hexToRgb(p.tip) };
  }

  // 3-stop ramp on an rgb palette. t: 0 = tip (outer), 0.5 = mid, 1 = core.
  function ramp3(pal, t) {
    if (t <= 0) return pal.tip;
    if (t >= 1) return pal.core;
    if (t < 0.5) return mixRgb(pal.tip, pal.mid, t / 0.5);
    return mixRgb(pal.mid, pal.core, (t - 0.5) / 0.5);
  }

  // Cross-fade two rgb palettes (core/mid/tip) by t.
  function mixPalette(a, b, t) {
    return {
      core: mixRgb(a.core, b.core, t),
      mid: mixRgb(a.mid, b.mid, t),
      tip: mixRgb(a.tip, b.tip, t),
    };
  }

  // 4x4 Bayer matrix (normalised 0..~0.94) for ordered dithering of glow edges.
  var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayer(x, y) {
    return BAYER4[((y & 3) << 2) + (x & 3)] / 16;
  }

  App.palette = {
    hexToRgb: hexToRgb,
    clamp01: clamp01,
    lerp: lerp,
    mixRgb: mixRgb,
    mixHex: mixHex,
    rgba: rgba,
    rgbStr: rgbStr,
    toRgbPalette: toRgbPalette,
    ramp3: ramp3,
    mixPalette: mixPalette,
    bayer: bayer,
  };
})(window.App);
