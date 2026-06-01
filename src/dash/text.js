/*
 * dash/text.js — thin wrapper over the bitmap font (dash/font.js).
 * Keeps the old signature text(ctx, str, x, y, color, px, align); the px size
 * maps to an integer pixel scale (>=10 => 2x for headings, else 1x).
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  function scaleFor(px) { return (px && px >= 10) ? 2 : 1; }

  function text(ctx, str, x, y, color, px, align /* , baseline */) {
    App.font.draw(ctx, str, x, y, color, scaleFor(px), align || 'left');
  }
  function measure(ctx, str, px) { return App.font.width(str, scaleFor(px)); }

  App.text = { text: text, measure: measure, scaleFor: scaleFor };
})(window.App);
