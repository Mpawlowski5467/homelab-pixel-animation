#!/usr/bin/env node
/*
 * terminal/dashboard.js — ANSI terminal port of the homelab pixel-strip dashboard
 * ("Mission Control"). Faithful port of index.html + src/dash/* : data simulator,
 * two auto-rotating scenes (Mission Control / Network Topology), dissolve
 * transitions, scrolling event ticker, and a full-screen critical-alert takeover.
 *
 * Run:   node terminal/dashboard.js          (TTY: alt screen, 1/2 jump scenes,
 *                                             0 fires a test alert, q quits)
 *        node terminal/dashboard.js --once   (render a single frame and exit)
 * Zero dependencies. Node >= 18. Design target ~160x40; min 80x24.
 */
'use strict';

/* ----------------------------------------------------------------------------
 * Palette — straight from src/config.js (Anthropic / Claude brand colors).
 * ------------------------------------------------------------------------- */
const PAL = {
  background: [20, 20, 19],     // #141413 warm near-black (brand Slate)
  white: [250, 249, 245],       // #faf9f5 ivory
  idle:    { mid: [217, 119, 87],  tip: [198, 97, 63] },   // brand clay #d97757
  success: { mid: [156, 170, 120], tip: [120, 140, 93] },  // brand green
  info:    { mid: [143, 180, 216], tip: [106, 155, 204] }, // brand blue
  warning: { mid: [232, 161, 60],  tip: [217, 119, 87] },  // amber #e8a13c
  error:   { mid: [232, 122, 92],  tip: [217, 74, 74] },   // hot red
};
const SLATE = [176, 174, 165];
const DIM = [120, 118, 110];
const LINE = [62, 62, 58];

function mid(state) { return (PAL[state] || PAL.idle).mid; }
function tip(state) { return (PAL[state] || PAL.idle).tip; }
function scaleCol(c, f) {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
}
function mix(a, b, f) {
  return [Math.round(a[0] + (b[0] - a[0]) * f),
          Math.round(a[1] + (b[1] - a[1]) * f),
          Math.round(a[2] + (b[2] - a[2]) * f)];
}

/* ----------------------------------------------------------------------------
 * Data store + simulator — port of src/dash/data.js.
 * ------------------------------------------------------------------------- */
function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

class Ring {
  constructor(n, fill) { this.n = n; this.buf = []; for (let i = 0; i < n; i++) this.buf.push(fill); }
  push(v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); }
  last() { return this.buf[this.buf.length - 1]; }
}

const D = (() => {
  const services = [
    { id: 'web', label: 'WEB', name: 'nginx',     state: 'success', cpu: 12, ram: 34, note: null },
    { id: 'pve', label: 'PVE', name: 'proxmox',   state: 'success', cpu: 28, ram: 61, note: null },
    { id: 'nas', label: 'NAS', name: 'truenas',   state: 'success', cpu: 8,  ram: 40, note: null },
    { id: 'dns', label: 'DNS', name: 'pi-hole',   state: 'success', cpu: 3,  ram: 12, note: null },
    { id: 'vpn', label: 'VPN', name: 'wireguard', state: 'info',    cpu: 5,  ram: 18, note: null },
    { id: 'bak', label: 'BAK', name: 'restic',    state: 'success', cpu: 6,  ram: 9,  note: null },
  ];
  const byId = {}; services.forEach((s) => { byId[s.id] = s; });

  // Logical node coordinates on the original 320x100 strip; scaled per-frame.
  const nodes = {
    net: { x: 24,  y: 50, label: 'NET', infra: true },
    sw:  { x: 78,  y: 50, label: 'SW',  infra: true },
    web: { x: 140, y: 24 }, pve: { x: 168, y: 66 }, nas: { x: 214, y: 26 },
    dns: { x: 252, y: 70 }, vpn: { x: 292, y: 44 }, bak: { x: 208, y: 82 },
  };
  const links = [
    ['net', 'sw'], ['sw', 'web'], ['sw', 'pve'], ['sw', 'nas'], ['sw', 'dns'], ['sw', 'vpn'],
    ['pve', 'bak'], ['nas', 'bak'],
  ];

  const metrics = {
    cpu: new Ring(48, 20), ram: new Ring(48, 45),
    net: new Ring(48, 12), temp: new Ring(48, 46),
  };

  const events = [
    { ago: 8,  state: 'success', msg: 'nginx cert renewed' },
    { ago: 34, state: 'info',    msg: 'proxmox pulled 3 images' },
    { ago: 71, state: 'success', msg: 'backup snapshot complete' },
  ];

  const store = {
    services, nodes, links, metrics, events,
    counts: { up: 24, down: 0, alerts: 0, jobs: 2 },
    bootMs: Date.now() - (12 * 86400 + 4 * 3600 + 33 * 60) * 1000,
    uptime: 0,
    pendingAlert: null,
  };

  // Timeline: calm -> warning -> critical(+takeover) -> recover -> calm, looping.
  const beats = [
    { state: 'info',    msg: 'docker compose up · media' },
    { state: 'success', msg: 'jellyfin transcode done' },
    { state: 'warning', msg: 'truenas disk 82% full',  set: { nas: { state: 'warning', note: 'DISK82%' } } },
    { state: 'info',    msg: 'pi-hole blocked 1204 queries' },
    { state: 'error',   msg: 'nas SMART error · sdb',   set: { nas: { state: 'error', note: 'SMART' } }, critical: true },
    { state: 'warning', msg: 'restic retrying backup',  set: { bak: { state: 'warning', note: 'RETRY' } } },
    { state: 'success', msg: 'nas array resilvered',    set: { nas: { state: 'success', note: null } } },
    { state: 'success', msg: 'restic backup complete',  set: { bak: { state: 'success', note: null } } },
    { state: 'info',    msg: 'all systems nominal' },
  ];
  let bIdx = 0, mAcc = 0, eAcc = 0;

  function walk(v, lo, hi, step) { return clamp(v + rnd(-step, step), lo, hi); }
  function recount() {
    let down = 0, al = 0;
    for (const s of services) {
      if (s.state === 'error') { down++; al++; } else if (s.state === 'warning') { al++; }
    }
    store.counts.down = down; store.counts.alerts = al; store.counts.up = 24 - down;
  }
  recount();

  store.tick = function (dt) {
    mAcc += dt; eAcc += dt;
    if (mAcc >= 0.45) {
      mAcc = 0;
      metrics.cpu.push(walk(metrics.cpu.last(), 4, 95, 14));
      metrics.ram.push(walk(metrics.ram.last(), 30, 88, 6));
      metrics.net.push(clamp(Math.abs(metrics.net.last() + rnd(-10, 12)), 0, 100));
      metrics.temp.push(walk(metrics.temp.last(), 38, 74, 2));
      for (const s of services) {
        if (s.state === 'error') { s.cpu = 0; continue; }
        s.cpu = Math.round(walk(s.cpu, 1, 96, 10));
        s.ram = Math.round(walk(s.ram, 5, 92, 5));
      }
    }
    if (eAcc >= 7) {
      eAcc = 0;
      const b = beats[bIdx % beats.length]; bIdx++;
      for (const e of events) e.ago += 7;
      events.unshift({ ago: 0, state: b.state, msg: b.msg });
      if (events.length > 12) events.pop();
      if (b.set) {
        for (const id in b.set) {
          const sv = byId[id];
          if (sv) { sv.state = b.set[id].state; if ('note' in b.set[id]) sv.note = b.set[id].note; }
        }
      }
      if (b.critical) store.pendingAlert = { state: 'error', msg: b.msg };
      recount();
    }
    store.uptime = Date.now() - store.bootMs;
  };

  store.fmtUptime = function () {
    let s = Math.floor((store.uptime || 0) / 1000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d + 'd ' + p(h) + ':' + p(m);
  };
  store.worstState = function () {
    const order = { error: 4, warning: 3, info: 1, success: 1, idle: 0 };
    let worst = 'success', wv = 1;
    for (const s of services) {
      const v = order[s.state] || 0;
      if (v > wv) { wv = v; worst = s.state; }
    }
    return worst;
  };
  store.heroState = function () {
    const w = store.worstState();
    return (w === 'success' || w === 'info') ? 'idle' : w;
  };
  store.statusWord = function () {
    const w = store.worstState();
    return w === 'error' ? 'CRITICAL' : w === 'warning' ? 'DEGRADED' : 'OPERATIONAL';
  };

  return store;
})();

// Warm the metric rings so the very first frame already shows live-looking
// sparklines (the HTML accumulates these on screen; here we pre-walk them).
(function warmRings() {
  for (let i = 0; i < 48; i++) {
    D.metrics.cpu.push(clamp(D.metrics.cpu.last() + rnd(-14, 14), 4, 95));
    D.metrics.ram.push(clamp(D.metrics.ram.last() + rnd(-6, 6), 30, 88));
    D.metrics.net.push(clamp(Math.abs(D.metrics.net.last() + rnd(-10, 12)), 0, 100));
    D.metrics.temp.push(clamp(D.metrics.temp.last() + rnd(-2, 2), 38, 74));
  }
  D.uptime = Date.now() - D.bootMs;
})();

/* ----------------------------------------------------------------------------
 * Frame buffer — every frame is composed cell-by-cell, then serialized to one
 * string of exactly rows lines, each exactly cols visible characters.
 * ------------------------------------------------------------------------- */
function pack(c) { return (c[0] << 16) | (c[1] << 8) | c[2]; }
const BG = pack(PAL.background);
const FG_DEFAULT = pack(SLATE);

class Frame {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.ch = new Array(n).fill(' ');
    this.fg = new Int32Array(n).fill(FG_DEFAULT);
    this.bg = new Int32Array(n).fill(BG);
  }
  set(x, y, ch, fg, bg) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.ch[i] = ch;
    if (fg != null) this.fg[i] = pack(fg);
    if (bg != null) this.bg[i] = pack(bg);
  }
  text(x, y, str, fg, bg) {
    for (let i = 0; i < str.length; i++) this.set(x + i, y, str[i], fg, bg);
  }
  textCenter(cx, y, str, fg, bg) { this.text(cx - (str.length >> 1), y, str, fg, bg); }
  textRight(x, y, str, fg, bg) { this.text(x - str.length + 1, y, str, fg, bg); }
  hline(x0, x1, y, ch, fg) { for (let x = x0; x <= x1; x++) this.set(x, y, ch, fg); }
  vline(x, y0, y1, ch, fg) { for (let y = y0; y <= y1; y++) this.set(x, y, ch, fg); }
  fillBg(x0, y0, x1, y1, bg) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const i = y * this.w + x;
      this.ch[i] = ' '; this.bg[i] = pack(bg); this.fg[i] = pack(bg);
    }
  }
  toAnsi() {
    const out = [];
    for (let y = 0; y < this.h; y++) {
      let line = '', curFg = -1, curBg = -1;
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const f = this.fg[i], b = this.bg[i];
        if (f !== curFg) {
          line += `\x1b[38;2;${(f >> 16) & 255};${(f >> 8) & 255};${f & 255}m`;
          curFg = f;
        }
        if (b !== curBg) {
          line += `\x1b[48;2;${(b >> 16) & 255};${(b >> 8) & 255};${b & 255}m`;
          curBg = b;
        }
        line += this.ch[i];
      }
      out.push(line + '\x1b[0m');
    }
    return out.join('\n');
  }
}

/* ----------------------------------------------------------------------------
 * Block-letter font — 3x5 hand-rolled, drawn with █ (the terminal stand-in for
 * the strip's big bitmap headings). bit2 = leftmost column.
 * ------------------------------------------------------------------------- */
const BIG = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 6, 4, 6, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 6, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  '0': [2, 5, 5, 5, 2], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7],
  '3': [6, 1, 2, 1, 6], '4': [5, 5, 7, 1, 1], '5': [7, 4, 6, 1, 6],
  '6': [3, 4, 6, 5, 2], '7': [7, 1, 2, 2, 2], '8': [2, 5, 2, 5, 2],
  '9': [2, 5, 3, 1, 6], '!': [2, 2, 2, 0, 2], ' ': null,
};

function bigWidth(word, scale) {
  let w = 0;
  for (const c of word) w += (c === ' ' ? 2 : 4) * scale;
  return w - scale; // drop trailing gap
}
function drawBig(f, x, y, word, color, scale) {
  scale = scale || 1;
  let cx = x;
  for (const c of word.toUpperCase()) {
    const g = BIG[c];
    if (c === ' ' || !g) { cx += 2 * scale; continue; }
    for (let r = 0; r < 5; r++) {
      for (let b = 0; b < 3; b++) {
        if (g[r] & (4 >> b)) {
          for (let s = 0; s < scale; s++) f.set(cx + b * scale + s, y + r, '█', color);
        }
      }
    }
    cx += 4 * scale;
  }
}

/* ----------------------------------------------------------------------------
 * Animated state spark glyph — terminal stand-in for widgets.miniSpark.
 * Pulse frequency / shape per src/config.js STATE_PRESETS.
 * ------------------------------------------------------------------------- */
const PRESETS = {
  idle:    { hz: 0.25, depth: 0.06, square: false, flash: false },
  success: { hz: 0.45, depth: 0.14, square: false, flash: false },
  info:    { hz: 0.40, depth: 0.10, square: false, flash: false },
  warning: { hz: 1.10, depth: 0.16, square: false, flash: false },
  error:   { hz: 3.50, depth: 0.22, square: true,  flash: true },
};
const SPARK_FRAMES = ['·', '✧', '✦', '✦'];

function sparkGlyph(state, t) {
  const pr = PRESETS[state] || PRESETS.idle;
  let wave = Math.sin(t * pr.hz * Math.PI * 2);
  if (pr.square) wave = wave > 0 ? 1 : -1;
  const amp = (wave + 1) / 2; // 0..1
  const ch = SPARK_FRAMES[Math.min(3, Math.floor(amp * 4))];
  let bright = 0.7 + 0.3 * amp;
  if (pr.flash) bright = wave > 0 ? 1 : 0.45;
  return { ch, col: scaleCol(mid(state), bright) };
}

/* ----------------------------------------------------------------------------
 * Sparkline — Ring -> ▁▂▃▄▅▆▇█, 1 or 2 rows tall.
 * ------------------------------------------------------------------------- */
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function drawSparkline(f, x, y, w, rows, ring, col, max) {
  const buf = ring.buf, n = buf.length;
  const dimCol = scaleCol(col, 0.55);
  for (let i = 0; i < w; i++) {
    const v = buf[Math.round((i / Math.max(1, w - 1)) * (n - 1))];
    const norm = clamp(v / max, 0, 1);
    if (rows >= 2) {
      const lvl = Math.round(norm * 16);
      const yTop = y, yBot = y + 1;
      if (lvl > 8) {
        f.set(x + i, yTop, BARS[clamp(lvl - 9, 0, 7)], col);
        f.set(x + i, yBot, '█', dimCol);
      } else {
        f.set(x + i, yTop, ' ', col);
        f.set(x + i, yBot, lvl <= 0 ? '▁' : BARS[clamp(lvl - 1, 0, 7)], col);
      }
    } else {
      const lvl = Math.round(norm * 8);
      f.set(x + i, y, lvl <= 0 ? '▁' : BARS[clamp(lvl - 1, 0, 7)], col);
    }
  }
}

/* ----------------------------------------------------------------------------
 * Scene 1 — MISSION CONTROL. Three columns like the strip: hero | tiles | metrics.
 * ------------------------------------------------------------------------- */
function sceneMissionControl(f, t, bodyTop, bodyH) {
  const w = f.w;
  // Column dividers mirror the 320px strip (x = 92 / 212).
  const lw = Math.floor(w * 0.2875);
  const rx = Math.floor(w * 0.6625);
  f.vline(lw, bodyTop, bodyTop + bodyH - 1, '│', LINE);
  f.vline(rx, bodyTop, bodyTop + bodyH - 1, '│', LINE);

  // --- Left: aggregate health hero -----------------------------------------
  const heroCx = lw >> 1;
  const hero = D.heroState();
  const heroCol = mid(hero);
  const word = D.statusWord();
  const wordW = bigWidth(word, 1);
  const useBig = (lw - 2) >= wordW && bodyH >= 13;
  let y = bodyTop + Math.max(0, Math.floor((bodyH - (useBig ? 13 : 8)) / 2));

  const sg = sparkGlyph(hero, t);
  f.set(heroCx, y, sg.ch, sg.col);
  f.set(heroCx - 2, y, '·', scaleCol(heroCol, 0.5));
  f.set(heroCx + 2, y, '·', scaleCol(heroCol, 0.5));
  y += 2;
  f.textCenter(heroCx, y, 'H O M E L A B', PAL.idle.mid);
  y += 2;
  if (useBig) {
    drawBig(f, heroCx - (wordW >> 1), y, word, heroCol, 1);
    y += 6;
  } else {
    f.textCenter(heroCx, y, word, heroCol);
    y += 2;
  }
  f.textCenter(heroCx, y, 'UP ' + D.fmtUptime(), SLATE);
  y += 1;
  const cu = D.counts;
  f.textCenter(heroCx, y + 1, `${cu.up} UP · ${cu.down} DN · ${cu.alerts} !`, SLATE);

  // --- Center: 3x2 service tiles --------------------------------------------
  const cx0 = lw + 2, cw = rx - lw - 3;
  const tileW = Math.floor((cw - 2) / 3);
  const tileH = Math.floor((bodyH - 1) / 2);
  const boxed = tileW >= 13 && tileH >= 5;
  for (let i = 0; i < D.services.length; i++) {
    const s = D.services[i];
    const tx = cx0 + (i % 3) * (tileW + 1);
    const ty = bodyTop + ((i / 3) | 0) * tileH + (boxed ? 0 : 1);
    const col = mid(s.state);
    const g = sparkGlyph(s.state, t + i * 0.37);
    if (boxed) {
      const bw = tileW - 1, bh = Math.min(tileH - 1, 5);
      const oy = ty + Math.max(0, Math.floor((tileH - bh - 1) / 2));
      f.set(tx, oy, '┌', LINE); f.set(tx + bw, oy, '┐', LINE);
      f.set(tx, oy + bh, '└', LINE); f.set(tx + bw, oy + bh, '┘', LINE);
      f.hline(tx + 1, tx + bw - 1, oy, '─', LINE);
      f.hline(tx + 1, tx + bw - 1, oy + bh, '─', LINE);
      f.vline(tx, oy + 1, oy + bh - 1, '│', LINE);
      f.vline(tx + bw, oy + 1, oy + bh - 1, '│', LINE);
      f.set(tx + 2, oy + 1, g.ch, g.col);
      f.text(tx + 4, oy + 1, s.label, col);
      f.text(tx + 2, oy + 2, s.name, SLATE);
      const stat = s.note ? s.note : `CPU ${s.cpu}% RAM ${s.ram}%`;
      f.text(tx + 2, oy + 3, stat.slice(0, bw - 3), s.note ? col : DIM);
    } else {
      f.set(tx, ty, g.ch, g.col);
      f.text(tx + 2, ty, s.label, col);
      const stat = s.note ? s.note : s.cpu + '%';
      f.text(tx + 2, ty + 1, stat.slice(0, tileW - 2), s.note ? col : DIM);
    }
  }

  // --- Right: live metric sparklines ----------------------------------------
  const mx = rx + 2, mw = w - mx - 1;
  const rowsEach = Math.max(2, Math.floor(bodyH / 4));
  const sparkRows = rowsEach >= 4 ? 2 : 1;
  const defs = [
    ['CPU', D.metrics.cpu, mid('info'), '%', 100],
    ['RAM', D.metrics.ram, mid('idle'), '%', 100],
    ['NET', D.metrics.net, mid('success'), 'M', 100],
    ['TMP', D.metrics.temp, mid('warning'), 'C', 90],
  ];
  for (let i = 0; i < 4; i++) {
    const [label, ring, col, unit, max] = defs[i];
    const my = bodyTop + i * rowsEach + Math.max(0, Math.floor((rowsEach - sparkRows - 1) / 2));
    f.text(mx, my, label, col);
    f.textRight(mx + mw - 1, my, Math.round(ring.last()) + unit, col);
    drawSparkline(f, mx, my + 1, mw, sparkRows, ring, col, max);
  }
}

/* ----------------------------------------------------------------------------
 * Scene 2 — NETWORK TOPOLOGY. Nodes + dotted links + animated traffic dots.
 * ------------------------------------------------------------------------- */
function sceneTopology(f, t, bodyTop, bodyH) {
  const w = f.w;
  const px = (lx) => 2 + Math.round((lx / 320) * (w - 8));
  const py = (ly) => bodyTop + Math.round(((ly - 14) / 78) * (bodyH - 3));

  // links (dotted)
  for (const [a, b] of D.links) {
    const na = D.nodes[a], nb = D.nodes[b];
    dottedLine(f, px(na.x), py(na.y), px(nb.x), py(nb.y), scaleCol(DIM, 0.7));
  }
  // traffic dots — clay ● moving along each link
  for (let i = 0; i < D.links.length; i++) {
    const na = D.nodes[D.links[i][0]], nb = D.nodes[D.links[i][1]];
    const p = ((t * 0.33) + i * 0.17) % 1;
    const dx = Math.round(px(na.x) + (px(nb.x) - px(na.x)) * p);
    const dy = Math.round(py(na.y) + (py(nb.y) - py(na.y)) * p);
    f.set(dx, dy, '●', PAL.idle.mid);
  }
  // nodes
  for (const k of Object.keys(D.nodes)) {
    const nd = D.nodes[k];
    const svc = D.services.find((s) => s.id === k);
    const state = svc ? svc.state : 'idle';
    const nx = px(nd.x), ny = py(nd.y);
    const g = sparkGlyph(state, t + nx * 0.013);
    const col = nd.infra ? PAL.idle.mid : mid(state);
    f.set(nx - 1, ny, '·', scaleCol(col, 0.5));
    f.set(nx + 1, ny, '·', scaleCol(col, 0.5));
    f.set(nx, ny, nd.infra ? '◆' : g.ch, nd.infra ? PAL.idle.mid : g.col);
    const label = nd.label || k.toUpperCase();
    f.textCenter(nx, ny + 1, label, col);
    if (svc) f.textCenter(nx, ny + 2, svc.note ? svc.note : svc.name, svc.note ? col : DIM);
  }
}

function dottedLine(f, x0, y0, x1, y1, col) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, n = 0;
  while (true) {
    if (n % 2 === 0) f.set(x0, y0, '·', col);
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

/* ----------------------------------------------------------------------------
 * Critical alert takeover — port of src/dash/alert.js (strobe + big message).
 * ------------------------------------------------------------------------- */
function sceneAlert(f, t, alert, elapsed) {
  const w = f.w, h = f.h;
  const flashOn = Math.sin(t * 2 * Math.PI * 2) > 0; // ~2 Hz
  const borderCol = flashOn ? tip('error') : scaleCol(tip('error'), 0.4);

  // flashing full-screen border
  f.hline(0, w - 1, 0, '█', borderCol);
  f.hline(0, w - 1, h - 1, '█', borderCol);
  for (let y = 1; y < h - 1; y++) { f.set(0, y, '█', borderCol); f.set(1, y, '█', borderCol);
    f.set(w - 1, y, '█', borderCol); f.set(w - 2, y, '█', borderCol); }

  // inverted red banner
  const bannerCol = flashOn ? tip('error') : mid('error');
  f.fillBg(2, 1, w - 3, 1, bannerCol);
  f.textCenter(w >> 1, 1, '⚠  C R I T I C A L   A L E R T  ⚠', PAL.background, bannerCol);

  // big spark, strobing, left of the message (HTML draws it at x=50)
  const wave = Math.sin(t * 3.5 * Math.PI * 2);
  const sCol = scaleCol(mid('error'), wave > 0 ? 1 : 0.55);
  const scx = Math.max(8, Math.floor(w * 0.14)), scy = h >> 1;
  const shake = Math.max(0.25, 1 - elapsed / 5.2);
  const jx = Math.round(Math.sin(t * 16 * Math.PI * 2) * 1.4 * shake);
  if (w >= 100 && h >= 16) {
    const SPARK = ['  ╲ │ ╱  ', '   ╲│╱   ', '──── ────', '   ╱│╲   ', '  ╱ │ ╲  '];
    for (let r = 0; r < SPARK.length; r++) f.textCenter(scx + jx, scy - 2 + r, SPARK[r], sCol);
    f.set(scx + jx, scy, '✦', scaleCol(PAL.white, wave > 0 ? 1 : 0.6));
  }

  // message block
  const mx = w >= 100 ? Math.floor(w * 0.27) : 5;
  const scale2 = (w - mx - 4) >= bigWidth('CRITICAL ALERT', 2) && h >= 20 ? 2 : 1;
  const bigH = 5;
  let my = scy - (bigH >> 1) - 2;
  if (my < 3) my = 3;
  drawBig(f, mx, my, 'CRITICAL ALERT', tip('error'), scale2);
  my += bigH + 1;
  const msg = (alert && alert.msg ? alert.msg : 'system fault').toUpperCase();
  f.text(mx, my, msg.slice(0, w - mx - 3), PAL.white);
  f.text(mx, my + 2, 'CHECK YOUR HOMELAB', scaleCol(tip('error'), 0.85));
}

/* ----------------------------------------------------------------------------
 * Overlays — header (dot + title + clock) and the scrolling event ticker.
 * ------------------------------------------------------------------------- */
const TITLES = ['MISSION CONTROL', 'NETWORK TOPOLOGY'];

function drawHeader(f, sceneIdx, alertMode) {
  const w = f.w;
  if (!alertMode) {
    const ws = D.worstState();
    const dotCol = ws === 'error' ? mid('error') : ws === 'warning' ? mid('warning') : mid('success');
    f.set(1, 0, '●', dotCol);
    f.text(3, 0, 'HOMELAB // ' + TITLES[sceneIdx], SLATE);
    f.hline(0, w - 1, 1, '─', LINE);
  }
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  const clock = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  if (alertMode) f.textRight(f.w - 4, 2, clock, mid('info'));
  else f.textRight(w - 2, 0, clock, mid('info'));
}

function drawTicker(f, now) {
  const w = f.w, y = f.h - 1;
  f.hline(0, w - 1, y - 1, '─', LINE);
  // build the colored cell strip: [+8S MSG]   ·   [...]
  const cells = [];
  for (const e of D.events) {
    const txt = '+' + e.ago + 'S ' + e.msg.toUpperCase();
    const col = mid(e.state);
    for (const ch of txt) cells.push([ch, col]);
    for (const ch of '   ·   ') cells.push([ch, scaleCol(DIM, 0.8)]);
  }
  if (cells.length === 0) return;
  const total = cells.length;
  const off = Math.floor((now / 1000) * 8) % total;
  for (let x = 0; x < w; x++) {
    const c = cells[(off + x) % total];
    f.set(x, y, c[0], c[1]);
  }
}

/* ----------------------------------------------------------------------------
 * Orchestrator — rotation / dissolve / alert state machine (port of main.js).
 * ------------------------------------------------------------------------- */
const HOLD = 11, TRANS = 0.6, ALERT = 5.2; // seconds
const scenes = [sceneMissionControl, sceneTopology];
let sceneIdx = 0, mode = 'hold';
let holdT = 0, transT = 0, alertT = 0, curAlert = null;
let lastNow = Date.now();
const t0 = Date.now();

function dissolveHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function getSize(isTty) {
  if (isTty) return [process.stdout.columns || 160, process.stdout.rows || 40];
  return [160, 40];
}

function composeFrame(now) {
  const isTty = !!process.stdout.isTTY;
  const [w, h] = getSize(isTty);
  const t = (now - t0) / 1000;

  if (w < 80 || h < 24) {
    const f = new Frame(Math.max(1, w), Math.max(1, h));
    f.textCenter(w >> 1, h >> 1, 'resize terminal to ≥ 80×24', mid('warning'));
    f.textCenter(w >> 1, (h >> 1) + 1, `(now ${w}×${h})`, DIM);
    return f;
  }

  const f = new Frame(w, h);
  const bodyTop = 2, bodyH = h - 4; // header(2) + body + divider/ticker(2)

  if (mode === 'alert') {
    sceneAlert(f, t, curAlert, alertT);
    drawHeader(f, sceneIdx, true);
    return f;
  }

  if (mode === 'transition') {
    const fA = new Frame(w, h), fB = new Frame(w, h);
    scenes[sceneIdx](fA, t, bodyTop, bodyH);
    scenes[(sceneIdx + 1) % scenes.length](fB, t, bodyTop, bodyH);
    const fr = clamp(transT / TRANS, 0, 1);
    const fe = fr * fr * (3 - 2 * fr); // smoothstep
    for (let y = bodyTop; y < bodyTop + bodyH; y++) {
      for (let x = 0; x < w; x++) {
        const src = dissolveHash(x, y) < fe ? fB : fA;
        const i = y * w + x;
        f.ch[i] = src.ch[i]; f.fg[i] = src.fg[i]; f.bg[i] = src.bg[i];
      }
    }
  } else {
    scenes[sceneIdx](f, t, bodyTop, bodyH);
  }

  drawHeader(f, mode === 'transition' && transT / TRANS > 0.5
    ? (sceneIdx + 1) % scenes.length : sceneIdx, false);
  drawTicker(f, now);
  return f;
}

function step(now) {
  let dt = (now - lastNow) / 1000;
  if (dt > 0.1) dt = 0.1;
  lastNow = now;

  D.tick(dt);
  if (D.pendingAlert && mode !== 'alert') {
    curAlert = D.pendingAlert; D.pendingAlert = null;
    mode = 'alert'; alertT = 0;
  }

  if (mode === 'alert') {
    alertT += dt;
    if (alertT >= ALERT) { mode = 'hold'; holdT = 0; }
  } else if (mode === 'transition') {
    transT += dt;
    if (transT >= TRANS) { sceneIdx = (sceneIdx + 1) % scenes.length; mode = 'hold'; holdT = 0; }
  } else {
    holdT += dt;
    if (holdT >= HOLD) { mode = 'transition'; transT = 0; }
  }
}

/* ----------------------------------------------------------------------------
 * Terminal lifecycle.
 * ------------------------------------------------------------------------- */
const once = process.argv.includes('--once');
const isTty = !!process.stdout.isTTY;
let restored = false;

function restore() {
  if (restored) return;
  restored = true;
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try { process.stdin.setRawMode(false); } catch (_) { /* ignore */ }
  }
  if (isTty && !once) process.stdout.write('\x1b[?1049l\x1b[?25h');
  process.stdout.write('\x1b[0m');
}

if (once) {
  // Single test frame: simulate a little time so everything looks alive.
  for (let i = 0; i < 4; i++) { D.tick(0.5); }
  const f = composeFrame(Date.now());
  process.stdout.write(f.toAnsi() + '\n\x1b[0m');
  process.exit(0);
}

if (isTty) process.stdout.write('\x1b[?1049h\x1b[?25l');

function quit() { restore(); process.exit(0); }
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('exit', restore);
process.on('uncaughtException', (err) => {
  restore();
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});

if (process.stdin.isTTY && process.stdin.setRawMode) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const k = buf.toString();
    if (k === 'q' || k === 'Q' || k === '\x03') quit();
    else if (k === '1') { sceneIdx = 0; mode = 'hold'; holdT = 0; }
    else if (k === '2') { sceneIdx = 1; mode = 'hold'; holdT = 0; }
    else if (k === '0') { D.pendingAlert = { state: 'error', msg: 'manual test alert' }; }
  });
}

function draw() {
  const now = Date.now();
  step(now);
  const f = composeFrame(now);
  process.stdout.write('\x1b[H' + f.toAnsi());
}

if (process.stdout.isTTY) process.stdout.on('resize', () => { try { draw(); } catch (_) {} });

setInterval(draw, 90); // ~11 fps
draw();
