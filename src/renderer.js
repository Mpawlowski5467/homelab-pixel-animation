/*
 * renderer.js — the render pipeline.
 *
 * Two canvases:
 *   buffer  (offscreen, 128x128)  — all drawing happens here at chunky scale
 *   display (on-screen <canvas>)  — backing store is also 128x128; CSS scales
 *                                   it up with image-rendering: pixelated, so
 *                                   the GPU does the nearest-neighbour upscale.
 *
 * The loop is framerate-independent (delta time). Register a scene via
 * setScene(fn) where fn(ctx, elapsed, dt, now, fps) draws one buffer frame.
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var RES = App.config.INTERNAL_RES;

  function Renderer(canvas) {
    this.display = canvas;
    this.dctx = canvas.getContext('2d');

    this.buffer = document.createElement('canvas');
    this.buffer.width = RES;
    this.buffer.height = RES;
    this.ctx = this.buffer.getContext('2d');

    this.scene = null;
    this.t0 = 0;
    this.last = 0;
    this.fps = 0;
    this._frames = 0;
    this._fpsTimer = 0;

    canvas.width = RES;
    canvas.height = RES;
    this.dctx.imageSmoothingEnabled = false;

    this._resize = this._resize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  // Letterbox: pick the largest INTEGER multiple of RES that fits the shorter
  // viewport dimension, so every logical pixel stays a perfect square block.
  Renderer.prototype._resize = function () {
    var scale = Math.max(1, Math.floor(Math.min(window.innerWidth, window.innerHeight) / RES));
    var size = RES * scale;
    this.display.style.width = size + 'px';
    this.display.style.height = size + 'px';
  };

  Renderer.prototype.setScene = function (fn) { this.scene = fn; };

  Renderer.prototype.run = function () { requestAnimationFrame(this._loop); };

  Renderer.prototype._loop = function (now) {
    if (!this.t0) { this.t0 = now; this.last = now; }
    var dt = (now - this.last) / 1000;
    if (dt > 0.1) dt = 0.1;            // clamp big gaps (e.g. background tab)
    this.last = now;
    var elapsed = now - this.t0;

    this._frames++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._frames / this._fpsTimer);
      this._frames = 0;
      this._fpsTimer = 0;
    }

    if (this.scene) this.scene(this.ctx, elapsed, dt, now, this.fps);

    this.dctx.imageSmoothingEnabled = false;
    this.dctx.drawImage(this.buffer, 0, 0); // 1:1 blit; CSS does the upscale

    requestAnimationFrame(this._loop);
  };

  App.Renderer = Renderer;
})(window.App);
