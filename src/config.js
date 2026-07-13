/*
 * config.js — single source of truth for theming + tuning.
 * Edit THIS file to retheme: resolution, palette, per-state color + motion.
 */
window.App = window.App || {};
(function (App) {
  'use strict';

  // Internal logical resolution. Everything is drawn on this square buffer,
  // then CSS upscales it nearest-neighbor. Lower = chunkier pixels / faster.
  // 128 reads as unmistakable pixel-art while keeping the spark smooth.
  var INTERNAL_RES = 128;

  // --- Palette, grounded in the Anthropic / Claude brand colors -------------
  // Clay #d97757, Ivory #faf9f5, Slate #141413, Green #788c5d, Blue #6a9bcc.
  // Red + amber added for error/warning severity. Core is ALWAYS ivory-hot.
  var PALETTES = {
    background: '#141413', // warm near-black (brand Slate) — fills the screen
    white: '#faf9f5',      // ivory hot-core (never pure #fff — keeps warmth)
    idle:    { core: '#faf9f5', mid: '#d97757', tip: '#c6613f' }, // brand clay
    success: { core: '#faf9f5', mid: '#9caa78', tip: '#788c5d' }, // brand green
    info:    { core: '#faf9f5', mid: '#8fb4d8', tip: '#6a9bcc' }, // brand blue
    warning: { core: '#fff3e2', mid: '#e8a13c', tip: '#d97757' }, // amber -> clay
    error:   { core: '#fff3ee', mid: '#e87a5c', tip: '#d94a4a' }, // hot red
  };

  // --- Spark geometry — CONSTANT across every state -------------------------
  // Only color + motion change per state; the iconic shape never does.
  var SPARK = {
    spokes: 12,      // alternating long/short => 6 + 6 sunburst
    longLen: 46,     // long spoke radius (logical px)
    shortLen: 26,    // short spoke radius
    thickness: 3.2,  // half-width at the core, tapers to ~0 at the tip
    coreRadius: 9,   // bright white-hot center disc
  };

  // --- Per-state presets — color reference + motion behaviour ---------------
  // pulseHz: breathe/pulse frequency   pulseDepth: size-pulse amplitude (0..1)
  // pulseShape: 'sine' | 'square'      spinDegPerSec: rotation speed
  // intensity: base brightness         jitter: tiny rotational noise (warning)
  // bloom {base,gain}: halo strength   particles: sparkle emitter config
  // shake {amp,hz,decay}: error shake  flash {amp,hz}: error full-frame strobe
  var STATE_PRESETS = {
    idle: {
      palette: 'idle',
      pulseHz: 0.25, pulseDepth: 0.06, pulseShape: 'sine',
      spinDegPerSec: 3, intensity: 0.85,
      bloom: { base: 0.55, gain: 0.20 },
      particles: { rate: 1.5, speed: 8, life: 2.6, spread: 'drift' },
      shake: null, flash: null,
    },
    success: {
      palette: 'success',
      pulseHz: 0.45, pulseDepth: 0.14, pulseShape: 'sine',
      spinDegPerSec: 6, intensity: 1.0,
      bloom: { base: 0.6, gain: 0.6 },
      particles: { rate: 14, speed: 26, life: 1.4, spread: 'up' },
      shake: null, flash: null,
    },
    info: {
      palette: 'info',
      pulseHz: 0.4, pulseDepth: 0.10, pulseShape: 'sine',
      spinDegPerSec: 5, intensity: 0.92,
      bloom: { base: 0.55, gain: 0.35 },
      particles: { rate: 5, speed: 14, life: 2.0, spread: 'twinkle' },
      shake: null, flash: null,
    },
    warning: {
      palette: 'warning',
      pulseHz: 1.1, pulseDepth: 0.16, pulseShape: 'sine',
      spinDegPerSec: 4, intensity: 1.0, jitter: 0.6,
      bloom: { base: 0.6, gain: 0.5 },
      particles: { rate: 18, speed: 34, life: 1.0, spread: 'radial' },
      shake: null, flash: null,
    },
    error: {
      palette: 'error',
      pulseHz: 3.5, pulseDepth: 0.22, pulseShape: 'square',
      spinDegPerSec: 0, intensity: 1.0,
      bloom: { base: 0.6, gain: 0.85 },
      particles: { rate: 44, speed: 60, life: 0.7, spread: 'radial' },
      shake: { amp: 2.4, hz: 16, decay: true },
      // Keep the takeover urgent without a harsh full-frame rapid strobe.
      flash: { amp: 0.26, hz: 1.8 },
    },
  };

  // How long each state stays on screen by default (ms). idle = forever.
  var DEFAULT_DURATIONS = {
    idle: Infinity, success: 4000, info: 4000, warning: 4000, error: 5000,
  };

  // Priority — a higher value preempts (jumps the queue). error beats info.
  var PRIORITY = { idle: 0, success: 1, info: 1, warning: 2, error: 3 };

  // Cross-fade duration when switching states (ms).
  var CROSSFADE_MS = 320;

  App.config = {
    INTERNAL_RES: INTERNAL_RES,
    PALETTES: PALETTES,
    SPARK: SPARK,
    STATE_PRESETS: STATE_PRESETS,
    DEFAULT_DURATIONS: DEFAULT_DURATIONS,
    PRIORITY: PRIORITY,
    CROSSFADE_MS: CROSSFADE_MS,
  };
})(window.App);
