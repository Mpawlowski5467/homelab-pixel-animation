/*
 * dash/font.js — a hand-drawn 4x6 BITMAP pixel font.
 * Text is plotted as hard 1x1 (×scale) pixels, so it stays crisp through the
 * 4x nearest-neighbour upscale instead of blurring like anti-aliased fillText.
 * Uppercase + digits + the few symbols the dashboard needs. Anything lowercase
 * is upper-cased; unknown glyphs render as '?'.
 *
 * Each glyph = 6 rows; each row is a 4-bit mask, bit 3 (8) = leftmost column.
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var W = 4, H = 6, ADV = 5; // 4x6 cell, 1px gap => 5px advance

  var G = {
    ' ': [0, 0, 0, 0, 0, 0],
    '!': [0b0100, 0b0100, 0b0100, 0b0100, 0, 0b0100],
    '%': [0b1001, 0b0001, 0b0010, 0b0100, 0b1000, 0b1001],
    '+': [0, 0b0100, 0b1110, 0b0100, 0, 0],
    '-': [0, 0, 0, 0b1110, 0, 0],
    '.': [0, 0, 0, 0, 0, 0b0100],
    '/': [0b0001, 0b0001, 0b0010, 0b0100, 0b1000, 0b1000],
    ':': [0, 0b0100, 0, 0, 0b0100, 0],
    '·': [0, 0, 0b0110, 0b0110, 0, 0], // middle dot ·
    '?': [0b1110, 0b0001, 0b0010, 0b0100, 0, 0b0100],

    '0': [0b0110, 0b1001, 0b1011, 0b1101, 0b1001, 0b0110],
    '1': [0b0100, 0b1100, 0b0100, 0b0100, 0b0100, 0b1110],
    '2': [0b0110, 0b1001, 0b0010, 0b0100, 0b1000, 0b1111],
    '3': [0b1110, 0b0001, 0b0110, 0b0001, 0b1001, 0b0110],
    '4': [0b0010, 0b0110, 0b1010, 0b1111, 0b0010, 0b0010],
    '5': [0b1111, 0b1000, 0b1110, 0b0001, 0b1001, 0b0110],
    '6': [0b0110, 0b1000, 0b1110, 0b1001, 0b1001, 0b0110],
    '7': [0b1111, 0b0001, 0b0010, 0b0100, 0b0100, 0b0100],
    '8': [0b0110, 0b1001, 0b0110, 0b1001, 0b1001, 0b0110],
    '9': [0b0110, 0b1001, 0b1001, 0b0111, 0b0001, 0b0110],

    'A': [0b0110, 0b1001, 0b1001, 0b1111, 0b1001, 0b1001],
    'B': [0b1110, 0b1001, 0b1110, 0b1001, 0b1001, 0b1110],
    'C': [0b0110, 0b1001, 0b1000, 0b1000, 0b1001, 0b0110],
    'D': [0b1110, 0b1001, 0b1001, 0b1001, 0b1001, 0b1110],
    'E': [0b1111, 0b1000, 0b1110, 0b1000, 0b1000, 0b1111],
    'F': [0b1111, 0b1000, 0b1110, 0b1000, 0b1000, 0b1000],
    'G': [0b0110, 0b1001, 0b1000, 0b1011, 0b1001, 0b0111],
    'H': [0b1001, 0b1001, 0b1111, 0b1001, 0b1001, 0b1001],
    'I': [0b1110, 0b0100, 0b0100, 0b0100, 0b0100, 0b1110],
    'J': [0b0011, 0b0001, 0b0001, 0b0001, 0b1001, 0b0110],
    'K': [0b1001, 0b1010, 0b1100, 0b1100, 0b1010, 0b1001],
    'L': [0b1000, 0b1000, 0b1000, 0b1000, 0b1000, 0b1111],
    'M': [0b1001, 0b1111, 0b1111, 0b1001, 0b1001, 0b1001],
    'N': [0b1001, 0b1101, 0b1011, 0b1001, 0b1001, 0b1001],
    'O': [0b0110, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
    'P': [0b1110, 0b1001, 0b1001, 0b1110, 0b1000, 0b1000],
    'Q': [0b0110, 0b1001, 0b1001, 0b1001, 0b1010, 0b0111],
    'R': [0b1110, 0b1001, 0b1001, 0b1110, 0b1010, 0b1001],
    'S': [0b0111, 0b1000, 0b0110, 0b0001, 0b1001, 0b1110],
    'T': [0b1111, 0b0100, 0b0100, 0b0100, 0b0100, 0b0100],
    'U': [0b1001, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
    'V': [0b1001, 0b1001, 0b1001, 0b1001, 0b0110, 0b0110],
    'W': [0b1001, 0b1001, 0b1001, 0b1111, 0b1111, 0b1001],
    'X': [0b1001, 0b1001, 0b0110, 0b0110, 0b1001, 0b1001],
    'Y': [0b1001, 0b1001, 0b0110, 0b0100, 0b0100, 0b0100],
    'Z': [0b1111, 0b0001, 0b0010, 0b0100, 0b1000, 0b1111],
  };

  function glyph(ch) { return G[ch] || G['?']; }

  // draw(ctx, str, x, y(top-left), colorString, scale, align)
  function draw(ctx, str, x, y, color, scale, align) {
    scale = scale || 1;
    str = String(str).toUpperCase();
    var total = str.length * ADV * scale - scale; if (total < 0) total = 0;
    if (align === 'center') x -= Math.round(total / 2);
    else if (align === 'right') x -= total;
    x = Math.round(x); y = Math.round(y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    for (var i = 0; i < str.length; i++) {
      var g = glyph(str[i]); var gx = x + i * ADV * scale;
      for (var r = 0; r < H; r++) {
        var bits = g[r]; if (!bits) continue;
        for (var c = 0; c < W; c++) {
          if (bits & (1 << (W - 1 - c))) ctx.fillRect(gx + c * scale, y + r * scale, scale, scale);
        }
      }
    }
  }

  function width(str, scale) { scale = scale || 1; return String(str).length * ADV * scale - scale; }

  App.font = { draw: draw, width: width, H: H, W: W, ADV: ADV };
})(window.App);
