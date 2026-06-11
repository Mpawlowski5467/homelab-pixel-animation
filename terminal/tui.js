#!/usr/bin/env node
// tui.js — btop-style "hacker TUI" homelab monitor. Terminal (ANSI truecolor) port
// of views/tui.html: 2x2 panel grid (cpu / mem&disk / net / proc) with mock data
// that drifts forever. Run:  node terminal/tui.js     (q, Q or Ctrl-C to quit)
// Test hook:                 node terminal/tui.js --once   (one frame, exit 0)
// Requires Node >= 18, zero dependencies. Design target ~160x40, min 80x24.

'use strict';

const ONCE = process.argv.includes('--once');
const TTY = process.stdout.isTTY === true;

/* ====================================================================
 * helpers
 * ==================================================================== */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const mix = (a, b, t) => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];

/* ---- palette (hex values lifted from views/tui.html) ---- */
const C_CYAN  = [0, 211, 199];    // #00d3c7  cpu accent / tank
const C_GREEN = [81, 224, 122];   // #51e07a  ok / proc accent / net up
const C_YELL  = [240, 181, 69];   // #f0b545  warn / swap
const C_RED   = [255, 90, 110];   // #ff5a6e  crit
const C_MAG   = [196, 107, 255];  // #c46bff  mem accent / ram
const C_BLUE  = [77, 155, 255];   // #4d9bff  net accent / nvme / net down
const STAGE_BG = [9, 11, 17];     // stage radial #131825->#080a10, flattened
const PANEL_BG = [16, 21, 33];    // panel gradient rgba(15..20,20..26,32..40)
const TRACK_BG = [10, 14, 23];    // #0a0e17
const BORDER   = [36, 48, 71];    // #243047
const SEPC     = [43, 52, 71];    // #2b3447
const DIM      = [86, 101, 122];  // #56657a
const DIM2     = [93, 108, 129];  // #5d6c81
const FAINT    = [60, 71, 97];    // #3c4761
const KEYC     = [67, 80, 106];   // #43506a
const VALC     = [174, 188, 207]; // #aebccf
const TEXT     = [147, 162, 182]; // #93a2b6
const BRIGHT   = [205, 216, 230]; // #cdd8e6
const CMDC     = [182, 196, 214]; // #b6c4d6
const PIDC     = [84, 98, 122];   // #54627a
const MEMC     = [138, 153, 173]; // #8a99ad
const GRIDC    = [24, 32, 50];
const UNITC    = [95, 184, 178];  // #5fb8b2

// load-colour ramp: cyan(low) -> green -> yellow -> red(overload), same stops
function loadColor(p) {
  if (p < 0.40) return mix(C_CYAN, C_GREEN, p / 0.40);
  if (p < 0.70) return mix(C_GREEN, C_YELL, (p - 0.40) / 0.30);
  if (p < 0.88) return mix(C_YELL, C_RED, (p - 0.70) / 0.18);
  return C_RED;
}

// byte formatting (input GiB, binary, like btop)
function fmtBytes(gb) {
  if (gb >= 1024) return (gb / 1024).toFixed(2) + 'T';
  if (gb >= 100) return gb.toFixed(0) + 'G';
  if (gb >= 10) return gb.toFixed(1) + 'G';
  return gb.toFixed(2) + 'G';
}

/* ---- fixed-length ring buffer (no memory growth) ---- */
class Ring {
  constructor(n, init) {
    this.n = n;
    this.buf = new Float32Array(n);
    if (init !== undefined) this.buf.fill(init);
    this.head = 0; // index of oldest
  }
  push(v) { this.buf[this.head] = v; this.head = (this.head + 1) % this.n; }
  at(i) { return this.buf[(this.head + i) % this.n]; } // 0 = oldest
}

/* ====================================================================
 * STATE — all mocked, drifts continuously (constants match the HTML)
 * ==================================================================== */
const HISTORY = 120;

const cpu = {
  pct: 22, target: 22, shown: 22,
  freq: 4.1, temp: 52,
  cores: [], coreTarget: [],
  hist: new Ring(HISTORY, 0.18),
};
for (let i = 0; i < 16; i++) { cpu.cores[i] = rnd(0.08, 0.30); cpu.coreTarget[i] = cpu.cores[i]; }

const gauges = {
  ram:  { name: 'RAM',   sub: 'ddr4',        total: 32,    used: 14.8,  target: 14.8,  color: C_MAG },
  swap: { name: 'SWAP',  sub: 'zram',        total: 8,     used: 0.42,  target: 0.42,  color: C_YELL },
  nvme: { name: 'nvme0', sub: '/ root',      total: 931,   used: 372,   target: 372,   color: C_BLUE },
  tank: { name: 'tank',  sub: '/zfs raidz2', total: 21504, used: 13230, target: 13230, color: C_CYAN },
};

const net = {
  up: 1.2, upTarget: 1.2,
  down: 8.5, downTarget: 8.5,
  upHist: new Ring(HISTORY, 1.2),
  downHist: new Ring(HISTORY, 8.5),
  upTot: 184.3, downTot: 1043.7, // GiB cumulative
  scale: 30,                      // autoscale ceiling (MB/s)
};

const procDefs = [
  ['kvm',             'qemu-system-x86_64 -name win-vm', 0.55, 0.62],
  ['jellyfin',        'ffmpeg -hwaccel vaapi -i …',      0.42, 0.18],
  ['zfs',             'z_rd_int',                        0.16, 0.04],
  ['dockerd',         '--containerd /run/…',             0.10, 0.07],
  ['postgres',        'postgres: writer process',        0.08, 0.09],
  ['prometheus',      '--storage.tsdb.path=/tank',       0.12, 0.11],
  ['node_exporter',   '--collector.zfs',                 0.04, 0.02],
  ['nginx',           'worker process',                  0.05, 0.02],
  ['pihole-FTL',      '-f',                              0.06, 0.05],
  ['restic',          'backup /tank/media',              0.20, 0.08],
  ['systemd',         '--system --deserialize',          0.02, 0.01],
  ['sshd',            'mpawlowski [priv]',               0.01, 0.01],
  ['containerd',      '--config /etc/…',                 0.03, 0.03],
  ['smartd',          '--no-fork',                       0.01, 0.01],
  ['qbittorrent-nox', '--profile=/tank',                 0.09, 0.06],
  ['python3',         'home-assistant --config',         0.07, 0.10],
  ['cron',            '-f -P',                           0.01, 0.01],
  ['zed',             'arc_reclaim',                     0.03, 0.02],
];
const procs = procDefs.map((d, idx) => ({
  pid: 600 + idx * 137 + Math.floor(rnd(0, 90)),
  name: d[0], arg: d[1],
  cpuBase: d[2], memBase: d[3],
  cpu: d[2] * 100 + rnd(0, 6),
  mem: d[3] * 100 + rnd(0, 2),
}));
let procOrder = procs.slice().sort((a, b) => b.cpu - a.cpu);
let procRunning = 0;

let loadStr = '0.00 0.00 0.00';
const bootMs = Date.now() - (37 * 3600 + 14 * 60) * 1000; // fake ~1d13h uptime

/* ====================================================================
 * TICKS (cadenced exactly like the HTML rAF loop)
 * ==================================================================== */
function tickCores() {
  if (Math.random() < 0.12) cpu.target = clamp(cpu.target + rnd(-22, 30), 6, 96);
  else cpu.target = clamp(cpu.target + rnd(-6, 6), 6, 96);
  const base = cpu.target / 100;
  for (let i = 0; i < 16; i++) {
    const bias = (i % 5 === 0) ? 0.18 : 0;
    cpu.coreTarget[i] = clamp(base + bias + rnd(-0.28, 0.30), 0.02, 1);
  }
  cpu.temp = clamp(42 + base * 46 + rnd(-2, 2), 38, 92);
  cpu.freq = clamp(3.6 + base * 1.1 + rnd(-0.08, 0.08), 2.2, 4.85);
}

function tickGauges() {
  gauges.ram.target  = clamp(gauges.ram.target  + rnd(-0.9, 1.0), 8, 30.5);
  gauges.swap.target = clamp(gauges.swap.target + rnd(-0.15, 0.18), 0, 3.2);
  gauges.nvme.target = clamp(gauges.nvme.target + rnd(-1.5, 1.8), 300, 700);
  gauges.tank.target = clamp(gauges.tank.target + rnd(-12, 16), 11000, 18500);
}

function tickNetTarget() {
  if (Math.random() < 0.18) net.downTarget = clamp(net.downTarget + rnd(-14, 26), 0.2, 118);
  else net.downTarget = clamp(net.downTarget + rnd(-4, 4), 0.2, 118);
  if (Math.random() < 0.15) net.upTarget = clamp(net.upTarget + rnd(-6, 10), 0.05, 42);
  else net.upTarget = clamp(net.upTarget + rnd(-1.6, 1.6), 0.05, 42);
}

function tickProcs() {
  for (const p of procs) {
    const burst = Math.random() < 0.16 ? rnd(0, 38) : 0;
    const tgt = p.cpuBase * 100 + burst + rnd(-3, 7);
    p.cpu = clamp(lerp(p.cpu, tgt, 0.6), 0, 99.9);
    p.mem = clamp(p.mem + rnd(-0.5, 0.55), 0.1, 38);
  }
  procOrder = procs.slice().sort((a, b) => b.cpu - a.cpu);
  procRunning = procs.filter((p) => p.cpu > 1.5).length;
}

function tickTopbar() {
  const l1 = cpu.pct / 100 * 14 + rnd(-0.2, 0.2);
  loadStr = l1.toFixed(2) + ' ' + (l1 * 0.82).toFixed(2) + ' ' + (l1 * 0.7).toFixed(2);
}

/* ---- update loop with per-animation cadences (ms, same as HTML) ---- */
const acc = { cores: 0, gauges: 0, netTarget: 0, procs: 0, topbar: 0, scroll: 0 };
const EVERY = { cores: 900, gauges: 2200, netTarget: 900, procs: 1500, topbar: 250, scroll: 95 };
let simLast = null;

function update(now) {
  if (simLast === null) simLast = now;
  let dt = (now - simLast) / 1000;
  if (dt > 0.1) dt = 0.1;
  simLast = now;

  acc.cores += dt * 1000;     if (acc.cores >= EVERY.cores)         { acc.cores = 0; tickCores(); }
  acc.gauges += dt * 1000;    if (acc.gauges >= EVERY.gauges)       { acc.gauges = 0; tickGauges(); }
  acc.netTarget += dt * 1000; if (acc.netTarget >= EVERY.netTarget) { acc.netTarget = 0; tickNetTarget(); }
  acc.procs += dt * 1000;     if (acc.procs >= EVERY.procs)         { acc.procs = 0; tickProcs(); }
  acc.topbar += dt * 1000;    if (acc.topbar >= EVERY.topbar)       { acc.topbar = 0; tickTopbar(); }

  acc.scroll += dt * 1000;
  if (acc.scroll >= EVERY.scroll) {
    acc.scroll -= EVERY.scroll;
    cpu.hist.push(clamp(cpu.pct / 100 + rnd(-0.02, 0.02), 0, 1));
    net.upHist.push(net.up);
    net.downHist.push(net.down);
    let peak = 1;
    for (let k = 0; k < net.upHist.n; k++) {
      const a = net.upHist.at(k), b = net.downHist.at(k);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    net.scale = lerp(net.scale, peak * 1.18 + 2, 0.08);
    net.upTot += net.up * EVERY.scroll / 1000 / 1024;
    net.downTot += net.down * EVERY.scroll / 1000 / 1024;
  }

  // smooth eases (per frame)
  cpu.pct = lerp(cpu.pct, cpu.target, clamp(dt * 3.2, 0, 1));
  cpu.shown = lerp(cpu.shown, cpu.pct, clamp(dt * 6, 0, 1));
  for (let i = 0; i < 16; i++) cpu.cores[i] = lerp(cpu.cores[i], cpu.coreTarget[i], clamp(dt * 4, 0, 1));
  net.up = lerp(net.up, net.upTarget, clamp(dt * 3, 0, 1));
  net.down = lerp(net.down, net.downTarget, clamp(dt * 3, 0, 1));
  for (const k of Object.keys(gauges)) {
    const g = gauges[k];
    g.used = lerp(g.used, g.target, clamp(dt * 2.4, 0, 1));
  }
}

/* ====================================================================
 * SCREEN BUFFER — cell grid with fg/bg, serialized to one ANSI string.
 * Guarantees every line is exactly `w` visible chars.
 * ==================================================================== */
class Screen {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.ch = new Array(n);
    this.fg = new Array(n);
    this.bg = new Array(n);
  }
  clear(bg) {
    this.ch.fill(' ');
    this.fg.fill(TEXT);
    this.bg.fill(bg);
  }
  set(x, y, ch, fg, bg) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.ch[i] = ch;
    if (fg) this.fg[i] = fg;
    if (bg) this.bg[i] = bg;
  }
  setBg(x, y, bg) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.bg[y * this.w + x] = bg;
  }
  text(x, y, str, fg, bg) {
    const chars = Array.from(str);
    for (let i = 0; i < chars.length; i++) this.set(x + i, y, chars[i], fg, bg);
    return x + chars.length;
  }
  fillRect(x, y, w, h, ch, fg, bg) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ch, fg, bg);
  }
  toAnsi() {
    const parts = [];
    let cf = -1, cb = -1;
    for (let y = 0; y < this.h; y++) {
      if (y) parts.push('\n');
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const f = this.fg[i], b = this.bg[i];
        const fk = (f[0] << 16) | (f[1] << 8) | f[2];
        const bk = (b[0] << 16) | (b[1] << 8) | b[2];
        if (fk !== cf) { parts.push(`\x1b[38;2;${f[0]};${f[1]};${f[2]}m`); cf = fk; }
        if (bk !== cb) { parts.push(`\x1b[48;2;${b[0]};${b[1]};${b[2]}m`); cb = bk; }
        parts.push(this.ch[i]);
      }
    }
    return parts.join('');
  }
}

/* ====================================================================
 * DRAW PRIMITIVES
 * ==================================================================== */
const LBLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']; // left-aligned eighths
const VBLOCKS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']; // bottom-aligned eighths

// btop-style bordered panel with ┤key title├ tab and dim corner badge
function drawPanel(scr, x, y, w, h, key, title, accent, corner) {
  scr.fillRect(x, y, w, h, ' ', TEXT, PANEL_BG);
  for (let xx = x + 1; xx < x + w - 1; xx++) {
    scr.set(xx, y, '─', BORDER, PANEL_BG);
    scr.set(xx, y + h - 1, '─', BORDER, PANEL_BG);
  }
  for (let yy = y + 1; yy < y + h - 1; yy++) {
    scr.set(x, yy, '│', BORDER, PANEL_BG);
    scr.set(x + w - 1, yy, '│', BORDER, PANEL_BG);
  }
  scr.set(x, y, '┌', BORDER, PANEL_BG);
  scr.set(x + w - 1, y, '┐', BORDER, PANEL_BG);
  scr.set(x, y + h - 1, '└', BORDER, PANEL_BG);
  scr.set(x + w - 1, y + h - 1, '┘', BORDER, PANEL_BG);
  // title tab embedded in the top border: ┌─┤1 cpu├──…
  let tx = x + 2;
  tx = scr.text(tx, y, '┤', BORDER, PANEL_BG);
  tx = scr.text(tx, y, key, KEYC, PANEL_BG);
  tx = scr.text(tx, y, ' ' + title, accent, PANEL_BG);
  scr.text(tx, y, '├', BORDER, PANEL_BG);
  // right corner badge
  if (corner) {
    const cw = Array.from(corner).length;
    const cx = x + w - 3 - cw;
    if (cx > tx + 2) scr.text(cx, y, corner, FAINT, PANEL_BG);
  }
}

// horizontal gauge bar with accent->load gradient + segmented sheen
function drawHBar(scr, x, y, w, frac, accent, hot) {
  frac = clamp(frac, 0, 1);
  const cells = frac * w;
  const full = Math.floor(cells);
  const rem = Math.round((cells - full) * 8);
  for (let i = 0; i < w; i++) {
    if (i < full) {
      let c = mix(accent, hot, cells > 0 ? i / cells : 0);
      if (i % 4 === 3) c = mix(c, TRACK_BG, 0.3); // sheen segmentation
      scr.set(x + i, y, '█', c, TRACK_BG);
    } else if (i === full && rem > 0) {
      scr.set(x + i, y, LBLOCKS[rem], hot, TRACK_BG);
    } else {
      scr.set(x + i, y, ' ', DIM, TRACK_BG);
    }
  }
}

// faint dashed grid lines on empty graph cells (quarter heights)
function gridRows(h) {
  const s = new Set();
  for (let q = 1; q < 4; q++) s.add(Math.round(h * q / 4));
  s.delete(0); s.delete(h);
  return s;
}

// bottom-anchored area graph (grows upward); colorOf(v) per column
function drawGraphUp(scr, x, y, w, h, sample, colorOf) {
  const grid = gridRows(h);
  for (let col = 0; col < w; col++) {
    const v = clamp(sample(col), 0, 1);
    let e = Math.round(v * h * 8); // eighths
    if (e > h * 8) e = h * 8;
    const full = Math.floor(e / 8);
    const rem = e % 8;
    const c = colorOf(v);
    const dim = mix(c, PANEL_BG, 0.62);
    for (let r = 0; r < h; r++) {
      const yy = y + h - 1 - r; // r = 0 is bottom row
      if (r < full) {
        const bright = (rem === 0 && r === full - 1);
        scr.set(x + col, yy, '█', bright ? c : dim, PANEL_BG);
      } else if (r === full && rem > 0) {
        scr.set(x + col, yy, VBLOCKS[rem], c, PANEL_BG);
      } else if (grid.has(h - 1 - r)) {
        scr.set(x + col, yy, '╌', GRIDC, PANEL_BG);
      } else {
        scr.set(x + col, yy, ' ', DIM, PANEL_BG);
      }
    }
  }
}

// top-anchored area graph (grows downward) — bg-inversion trick for the edge
function drawGraphDown(scr, x, y, w, h, sample, colorOf) {
  const grid = gridRows(h);
  for (let col = 0; col < w; col++) {
    const v = clamp(sample(col), 0, 1);
    let e = Math.round(v * h * 8);
    if (e > h * 8) e = h * 8;
    const full = Math.floor(e / 8);
    const rem = e % 8;
    const c = colorOf(v);
    const dim = mix(c, PANEL_BG, 0.62);
    for (let r = 0; r < h; r++) {  // r = 0 is top row (baseline side)
      const yy = y + r;
      if (r < full) {
        const bright = (rem === 0 && r === full - 1);
        scr.set(x + col, yy, ' ', PANEL_BG, bright ? c : dim);
      } else if (r === full && rem > 0) {
        // cell filled from the top by rem/8: draw the EMPTY bottom part as a
        // bottom-aligned block in panel-bg colour over a bright bg
        scr.set(x + col, yy, VBLOCKS[8 - rem], PANEL_BG, c);
      } else if (grid.has(r)) {
        scr.set(x + col, yy, '╌', GRIDC, PANEL_BG);
      } else {
        scr.set(x + col, yy, ' ', DIM, PANEL_BG);
      }
    }
  }
}

// sample a ring of n values across w columns (newest at the right edge)
function ringSampler(ring, w, map) {
  return (col) => {
    const idx = w > 1 ? Math.round(col * (ring.n - 1) / (w - 1)) : ring.n - 1;
    return map(ring.at(idx));
  };
}

/* ---- 3-row block-digit font for the big CPU% readout ---- */
const BIGFONT = {
  0: ['█▀█', '█ █', '█▄█'],
  1: ['▀█ ', ' █ ', '▄█▄'],
  2: ['▀▀█', '█▀▀', '█▄▄'],
  3: ['▀▀█', ' ▀█', '▄▄█'],
  4: ['█ █', '▀▀█', '  █'],
  5: ['█▀▀', '▀▀█', '▄▄█'],
  6: ['█▀▀', '█▀█', '█▄█'],
  7: ['▀▀█', '  █', '  █'],
  8: ['█▀█', '█▀█', '█▄█'],
  9: ['█▀█', '▀▀█', '▄▄█'],
};
function drawBigNumber(scr, x, y, str, fg) {
  let cx = x;
  for (const ch of str) {
    const glyph = BIGFONT[ch];
    if (!glyph) { cx += 1; continue; }
    for (let r = 0; r < 3; r++) scr.text(cx, y + r, glyph[r], fg);
    cx += 4;
  }
  return cx;
}

/* ====================================================================
 * PANEL RENDERERS
 * ==================================================================== */
function renderCpuPanel(scr, x, y, w, h) {
  drawPanel(scr, x, y, w, h, '1', 'cpu', C_CYAN, 'amd ryzen · 16t');
  const ix = x + 2, iy = y + 1, iw = w - 4, ih = h - 2;
  const gpct = clamp(cpu.shown / 100, 0, 1);
  const gcol = loadColor(gpct);
  const bigCol = [clamp(gcol[0] + 40, 0, 255), clamp(gcol[1] + 30, 0, 255), clamp(gcol[2] + 30, 0, 255)];
  const full = ih >= 12 && iw >= 56;

  let graphY, graphH;
  if (full) {
    // left column: big % + meta · right: 16 core bars in 2 columns of 8
    const leftW = 26;
    const px = drawBigNumber(scr, ix, iy, String(Math.round(cpu.shown)), bigCol);
    scr.text(px, iy + 2, '%', UNITC);
    scr.text(ix, iy + 4, 'AMD Ryzen 7 5800X', VALC);
    let tx = scr.text(ix, iy + 5, 'freq ', DIM2);
    tx = scr.text(tx, iy + 5, cpu.freq.toFixed(2) + ' GHz', [52, 199, 191]);
    scr.text(tx, iy + 5, ' · 8c/16t', DIM2);
    tx = scr.text(ix, iy + 6, 'load ', DIM2);
    scr.text(tx, iy + 6, loadStr, [52, 199, 191]);
    tx = scr.text(ix, iy + 7, 'tctl ', DIM2);
    scr.text(tx, iy + 7, Math.round(cpu.temp) + '°C', [52, 199, 191]);

    const coreX = ix + leftW;
    const colW = Math.floor((iw - leftW - 2) / 2);
    for (let ci = 0; ci < 16; ci++) {
      const row = Math.floor(ci / 2), col = ci % 2;
      const cx = coreX + col * (colW + 2);
      const cy = iy + row;
      scr.text(cx, cy, String(ci + 1).padStart(2, '0'), PIDC);
      drawHBar(scr, cx + 3, cy, colW - 3, cpu.cores[ci], loadColor(cpu.cores[ci]), loadColor(cpu.cores[ci]));
    }
    graphY = iy + 9; graphH = ih - 9;
  } else {
    // compact: one status line + 16-core sparkline row, graph below
    let tx = scr.text(ix, iy, 'cpu ', C_CYAN);
    tx = scr.text(tx, iy, String(Math.round(cpu.shown)).padStart(2) + '%', bigCol);
    scr.text(tx, iy, ' · ' + cpu.freq.toFixed(2) + 'GHz · tctl ' + Math.round(cpu.temp) + '°C · 8c/16t', DIM2);
    tx = scr.text(ix, iy + 1, 'cores ', DIM2);
    for (let ci = 0; ci < 16 && tx + ci < ix + iw; ci++) {
      const v = cpu.cores[ci];
      scr.set(tx + ci, iy + 1, VBLOCKS[Math.max(1, Math.round(v * 8))], loadColor(v), TRACK_BG);
    }
    graphY = iy + 3; graphH = ih - 3;
  }
  if (graphH > 0) {
    drawGraphUp(scr, ix, graphY, iw, graphH,
      ringSampler(cpu.hist, iw, (v) => v),
      (v) => loadColor(v));
  }
}

function renderMemPanel(scr, x, y, w, h) {
  drawPanel(scr, x, y, w, h, '2', 'mem & disk', C_MAG, 'zfs · arc');
  const ix = x + 2, iy = y + 1, iw = w - 4, ih = h - 2;
  const list = [gauges.ram, gauges.swap, gauges.nvme, gauges.tank];
  for (let k = 0; k < 4; k++) {
    const g = list[k];
    const gy = iy + (list.length > 1 ? Math.round(k * (ih - 2) / (list.length - 1)) : 0);
    const pct = clamp(g.used / g.total, 0, 1);
    const hot = loadColor(pct);
    let tx = scr.text(ix, gy, g.name + ' ', g.color);
    scr.text(tx, gy, g.sub, DIM);
    const pctStr = Math.round(pct * 100) + '%';
    const bytesStr = fmtBytes(g.used) + '/' + fmtBytes(g.total);
    const pctCol = pct > 0.85 ? C_RED : pct > 0.7 ? C_YELL : BRIGHT;
    scr.text(ix + iw - Array.from(pctStr).length, gy, pctStr, pctCol);
    scr.text(ix + iw - 5 - Array.from(bytesStr).length, gy, bytesStr, MEMC);
    drawHBar(scr, ix, gy + 1, iw, pct, g.color, hot);
  }
}

function fmtRate(mbps) {
  if (mbps >= 1) return [mbps.toFixed(1), ' MB/s'];
  return [String(Math.round(mbps * 1000)), ' KB/s'];
}

function renderNetPanel(scr, x, y, w, h) {
  drawPanel(scr, x, y, w, h, '3', 'net eth0', C_BLUE, null);
  const ix = x + 2, iy = y + 1, iw = w - 4, ih = h - 2;
  // header stats
  scr.text(ix, iy, '▲ UP', C_GREEN);
  const [uv, uu] = fmtRate(net.up);
  let tx = scr.text(ix, iy + 1, uv, C_GREEN);
  scr.text(tx, iy + 1, uu, DIM2);
  scr.text(ix, iy + 2, 'Σ ' + net.upTot.toFixed(1) + 'G', DIM);
  const dx = ix + 16;
  scr.text(dx, iy, '▼ DOWN', C_BLUE);
  const [dv, du] = fmtRate(net.down);
  tx = scr.text(dx, iy + 1, dv, C_BLUE);
  scr.text(tx, iy + 1, du, DIM2);
  scr.text(dx, iy + 2, 'Σ ' + net.downTot.toFixed(1) + 'G', DIM);
  // legend (right aligned), like the HTML's #net-legend
  if (iw >= 52) {
    const l1 = '▲ tx upload', l2 = '▼ rx download';
    tx = scr.text(ix + iw - Array.from(l1).length, iy, '▲ tx', C_GREEN);
    scr.text(tx, iy, ' upload', PIDC);
    tx = scr.text(ix + iw - Array.from(l2).length, iy + 1, '▼ rx', C_BLUE);
    scr.text(tx, iy + 1, ' download', PIDC);
  }
  // split graph: up above the baseline, down below — both share net.scale
  const gy = iy + 3, gh = ih - 3;
  if (gh >= 2) {
    const upH = Math.floor(gh / 2), downH = gh - upH;
    drawGraphUp(scr, ix, gy, iw, upH,
      ringSampler(net.upHist, iw, (v) => v / net.scale),
      () => C_GREEN);
    drawGraphDown(scr, ix, gy + upH, iw, downH,
      ringSampler(net.downHist, iw, (v) => v / net.scale),
      () => C_BLUE);
  }
}

function renderProcPanel(scr, x, y, w, h) {
  const corner = (128 + procRunning) + ' tasks · ' + procRunning + ' running';
  drawPanel(scr, x, y, w, h, '4', 'proc', C_GREEN, corner);
  const ix = x + 2, iy = y + 1, iw = w - 4, ih = h - 2;
  // column layout: PID | COMMAND (flex) | CPU% | MEM% | bar
  const pidW = 6, cpuW = 6, memW = 6;
  const barW = iw >= 60 ? 10 : iw >= 44 ? 6 : 0;
  const cmdW = iw - pidW - cpuW - memW - barW - (barW ? 4 : 3);
  const cpuX = ix + pidW + 1 + cmdW + 1;
  const memX = cpuX + cpuW + 1;
  const barX = memX + memW + 1;

  scr.text(ix, iy, 'PID'.padStart(pidW), DIM);
  scr.text(ix + pidW + 1, iy, 'COMMAND', DIM);
  scr.text(cpuX, iy, 'CPU%'.padStart(cpuW), DIM);
  scr.text(memX, iy, 'MEM%'.padStart(memW), DIM);
  if (barW) scr.text(barX + barW - 1, iy, '▾', DIM);
  const sep = ih >= 12 ? 1 : 0;
  if (sep) for (let i = 0; i < iw; i++) scr.set(ix + i, iy + 1, '─', [32, 43, 64], PANEL_BG);

  const visible = Math.min(procOrder.length, ih - 1 - sep);
  for (let r = 0; r < visible; r++) {
    const p = procOrder[r];
    const ry = iy + 1 + sep + r;
    const hot = r === 0 && p.cpu > 8;
    const rowBg = hot ? mix(PANEL_BG, C_GREEN, 0.07) : PANEL_BG;
    for (let i = -1; i <= iw; i++) scr.setBg(ix + i, ry, rowBg);
    scr.text(ix, ry, String(p.pid).padStart(pidW), PIDC, rowBg);
    // command: bright name + dim arg, ellipsized to fit
    let cmd = Array.from(p.name);
    let argChars = Array.from(' ' + p.arg);
    if (cmd.length > cmdW) cmd = cmd.slice(0, cmdW);
    if (cmd.length + argChars.length > cmdW) {
      argChars = argChars.slice(0, Math.max(0, cmdW - cmd.length - 1));
      if (argChars.length) argChars.push('…');
    }
    let tx = scr.text(ix + pidW + 1, ry, cmd.join(''), CMDC, rowBg);
    scr.text(tx, ry, argChars.join(''), DIM, rowBg);
    const cpuCol = p.cpu >= 80 ? C_RED : p.cpu >= 50 ? C_YELL : hot ? [125, 240, 163] : BRIGHT;
    scr.text(cpuX, ry, p.cpu.toFixed(1).padStart(cpuW), cpuCol, rowBg);
    scr.text(memX, ry, p.mem.toFixed(1).padStart(memW), MEMC, rowBg);
    if (barW) drawHBar(scr, barX, ry, barW, p.cpu / 100, loadColor(clamp(p.cpu / 100, 0, 1)), loadColor(clamp(p.cpu / 100, 0, 1)));
  }
}

/* ---- top status bar ---- */
function renderTopbar(scr, W) {
  const tbBg = [11, 14, 21];
  scr.fillRect(0, 0, W, 1, ' ', DIM, tbBg);
  const now = new Date();
  const p2 = (v) => String(v).padStart(2, '0');
  const clock = p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds());
  const up = Math.floor((Date.now() - bootMs) / 1000);
  const d = Math.floor(up / 86400), hh = Math.floor((up % 86400) / 3600), mm = Math.floor((up % 3600) / 60);
  const uptime = (d > 0 ? d + 'd ' : '') + hh + 'h' + p2(mm) + 'm';
  const blinkOn = Math.floor(Date.now() / 525) % 2 === 0;

  // right side (drop segments on narrow terminals)
  const segs = [];
  const sep = () => segs.push([' │ ', SEPC]);
  segs.push(['up ', DIM], [uptime, VALC]);
  if (W >= 110) { sep(); segs.push(['load ', DIM], [loadStr, VALC]); }
  if (W >= 96) { sep(); segs.push(['temp ', DIM], [Math.round(cpu.temp) + '°C', VALC]); }
  sep();
  segs.push(['● online', C_GREEN], ['  ' + clock, DIM], [' ▮', blinkOn ? C_CYAN : mix(C_CYAN, tbBg, 0.85)]);
  const rightLen = segs.reduce((n, s) => n + Array.from(s[0]).length, 0);
  let rx = W - 1 - rightLen;
  for (const [t, c] of segs) rx = scr.text(rx, 0, t, c, tbBg);

  // left side, truncated against the right block
  let tx = scr.text(1, 0, 'btop++', C_CYAN, tbBg);
  tx = scr.text(tx, 0, ' │ ', SEPC, tbBg);
  tx = scr.text(tx, 0, 'rack-01', BRIGHT, tbBg);
  const sub = '  proxmox-ve 8.2 · truenas-scale';
  const room = W - 1 - rightLen - tx - 2;
  if (room > 4) scr.text(tx, 0, sub.slice(0, room), DIM, tbBg);
}

/* ====================================================================
 * FRAME COMPOSITION
 * ==================================================================== */
let scr = null;

function buildFrame(W, H) {
  if (!scr || scr.w !== W || scr.h !== H) scr = new Screen(W, H);
  scr.clear(STAGE_BG);

  if (W < 80 || H < 24) {
    const msg = `resize terminal to ≥ 80×24 (now ${W}×${H})`;
    const mx = Math.max(0, Math.floor((W - Array.from(msg).length) / 2));
    scr.text(mx, Math.floor(H / 2), msg, C_YELL);
    return scr.toAnsi();
  }

  renderTopbar(scr, W);

  // 2x2 grid with a 1-cell gap, below the top bar
  const gx = 0, gy = 1;
  const gw = W, gh = H - 1;
  const leftW = Math.floor((gw - 1) / 2);
  const rightW = gw - 1 - leftW;
  const topH = Math.floor((gh - 1) / 2);
  const botH = gh - 1 - topH;
  renderCpuPanel(scr, gx, gy, leftW, topH);
  renderMemPanel(scr, gx + leftW + 1, gy, rightW, topH);
  renderNetPanel(scr, gx, gy + topH + 1, leftW, botH);
  renderProcPanel(scr, gx + leftW + 1, gy + topH + 1, rightW, botH);
  return scr.toAnsi();
}

function termSize() {
  if (!TTY) return [160, 40];
  return [process.stdout.columns || 160, process.stdout.rows || 40];
}

/* ====================================================================
 * MAIN — setup, render loop, teardown
 * ==================================================================== */
// prime: simulate ~15s of history so graphs/tables don't start blank
{
  const t0 = Date.now() - 15000;
  for (let t = t0; t <= Date.now(); t += 85) update(t);
  tickTopbar();
}

if (ONCE) {
  update(Date.now());
  const [W, H] = termSize();
  process.stdout.write(buildFrame(W, H) + '\x1b[0m\n');
  process.exit(0);
}

let cleaned = false;
let timer = null;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (timer) clearInterval(timer);
  if (TTY) {
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  } else {
    process.stdout.write('\x1b[0m');
  }
}
function quit() { cleanup(); process.exit(0); }

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('exit', cleanup);

if (TTY) {
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      if (key === 'q' || key === 'Q' || key === '\x03') quit();
    });
  }
  process.stdout.on('resize', () => {
    process.stdout.write('\x1b[2J'); // once per resize, not per frame
  });
}

timer = setInterval(() => {
  update(Date.now());
  const [W, H] = termSize();
  process.stdout.write('\x1b[H' + buildFrame(W, H));
}, 85); // ~12 fps
