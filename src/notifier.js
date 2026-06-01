/*
 * notifier.js — the decoupled notification controller (THE key seam).
 *
 * Pure logic: no canvas, no DOM. It owns a priority queue and a tiny state
 * machine. ANY trigger source — the demo cycler now, a webhook/ntfy bridge
 * later — feeds it through the single public method notify(). The renderer
 * pulls the current frame descriptor via update(now).
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var C = App.config;

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

  function Notifier() {
    this.queue = [];
    this.current = null;   // { item, startMs }
    this.prev = null;      // previous state name, for cross-fade
    this._id = 0;
    this.idleState = 'idle';
  }

  Notifier.prototype.priority = function (s) { return C.PRIORITY[s] != null ? C.PRIORITY[s] : 0; };

  Notifier.prototype.defaultDuration = function (s) {
    var d = C.DEFAULT_DURATIONS[s];
    return d == null ? 4000 : d;
  };

  // PUBLIC API — source-agnostic. opts: { duration, interrupt }.
  Notifier.prototype.notify = function (state, message, opts) {
    opts = opts || {};
    if (!C.STATE_PRESETS[state]) state = 'info';
    var item = {
      id: ++this._id,
      state: state,
      message: message == null ? '' : String(message),
      duration: opts.duration != null ? opts.duration : this.defaultDuration(state),
    };
    var curState = this.current ? this.current.item.state : null;
    var preempt = opts.interrupt || (curState && this.priority(state) > this.priority(curState));
    if (preempt) {
      this.queue.unshift(item);
      if (this.current) this.current.item.duration = 0; // expire current next tick
    } else {
      this.queue.push(item);
    }
    return item.id;
  };

  // Called every frame with a performance.now()-style timestamp. Returns the
  // descriptor the scene needs to draw THIS frame.
  Notifier.prototype.update = function (now) {
    if (!this.current || now - this.current.startMs >= this.current.item.duration) {
      if (this.current) this.prev = this.current.item.state;
      var next = this.queue.shift();
      this.current = next
        ? { item: next, startMs: now }
        : { item: { id: -1, state: this.idleState, message: '', duration: Infinity }, startMs: now };
    }

    var cur = this.current;
    var elapsed = now - cur.startMs;
    var dur = cur.item.duration;

    var fade = 1;
    if (this.prev && this.prev !== cur.item.state) {
      fade = clamp01(elapsed / C.CROSSFADE_MS);
      if (fade >= 1) this.prev = null;
    }

    return {
      state: cur.item.state,
      prevState: this.prev,
      fade: fade,
      message: cur.item.message,
      preset: C.STATE_PRESETS[cur.item.state],
      elapsed: elapsed,
      duration: dur,
      progress: isFinite(dur) ? clamp01(elapsed / dur) : 0,
      entry: clamp01(elapsed / C.CROSSFADE_MS),
      exit: isFinite(dur) ? clamp01((dur - elapsed) / C.CROSSFADE_MS) : 1,
    };
  };

  App.Notifier = Notifier;
})(window.App);
