#!/usr/bin/env node
/*
 * datacenter.js — "Datacenter Floor" terminal (ANSI) port of views/datacenter.html.
 * Top-down homelab floor: 7 color-coded sectors with blinking server cabinets,
 * a central aisle, and 5 hooded agents (ATLAS/ARGUS/VESTA/HERMES/NOVA) that
 * autonomously patrol and report status in two-line typewriter speech bubbles.
 * Pixel art uses the half-block trick (▀ fg=top px, bg=bottom px). Truecolor.
 * Run:  node terminal/datacenter.js          (q, Q or Ctrl-C to quit)
 *       node terminal/datacenter.js --once   (render a single frame and exit)
 * Zero dependencies. Node >= 18.
 */
"use strict";

/* ========================== color utilities ========================== */
function hx(s) { return parseInt(s.slice(1), 16); }
function mix(a, b, t) {
  const r = ((a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * t) | 0;
  const g = ((a >> 8 & 255) + ((b >> 8 & 255) - (a >> 8 & 255)) * t) | 0;
  const bl = ((a & 255) + ((b & 255) - (a & 255)) * t) | 0;
  return (r << 16) | (g << 8) | bl;
}
function scaleC(c, f) {
  const r = Math.min(255, ((c >> 16 & 255) * f) | 0);
  const g = Math.min(255, ((c >> 8 & 255) * f) | 0);
  const b = Math.min(255, ((c & 255) * f) | 0);
  return (r << 16) | (g << 8) | b;
}
const FG_CACHE = new Map(), BG_CACHE = new Map();
function fgCode(c) {
  let s = FG_CACHE.get(c);
  if (s === undefined) {
    if (FG_CACHE.size > 4096) FG_CACHE.clear();
    s = "\x1b[38;2;" + (c >> 16 & 255) + ";" + (c >> 8 & 255) + ";" + (c & 255) + "m";
    FG_CACHE.set(c, s);
  }
  return s;
}
function bgCode(c) {
  let s = BG_CACHE.get(c);
  if (s === undefined) {
    if (BG_CACHE.size > 4096) BG_CACHE.clear();
    s = "\x1b[48;2;" + (c >> 16 & 255) + ";" + (c >> 8 & 255) + ";" + (c & 255) + "m";
    BG_CACHE.set(c, s);
  }
  return s;
}

/* ===================== palette (from the HTML) ======================== */
const C = {
  bg:         hx("#020803"),
  floor:      hx("#03100a"),
  aisle:      hx("#04160d"),
  phos:       hx("#5dff8b"),
  phosBright: hx("#aaffc4"),
  phosDim:    hx("#3fae63"),
  phosLo:     hx("#1f7a3c"),
  phosFaint:  hx("#0e4422"),
  ivory:      hx("#eafff0"),
  amber:      hx("#e8a13c"),
  amberDim:   hx("#a8702a"),
  cabBody:    hx("#06140c"),
  cabBody2:   hx("#08190f"),
  cabShade:   hx("#020c06"),
  bubbleBg:   hx("#04140b"),
  shadow:     hx("#010503")
};
const LED_COLORS = ["#0e4422", "#176c34", "#2f9a55", "#5dff8b", "#aaffc4"].map(hx);

/* =================== mock data store (drifts forever) ================= */
function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function walkV(v, lo, hi, step) { return clamp(v + rnd(-step, step), lo, hi); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }

const store = {
  load: 2.1, cores: 16, cpu: 22,
  scrub: 61, used: 14.6,
  reqs: 1180, checks: 142,
  ups: 100, watts: 253,
  fans: 44, intake: 21,
  containers: 42,
  bootMs: Date.now() - (19 * 86400 + 7 * 3600 + 42 * 60) * 1000
};
function fmtUptime() {
  let s = Math.floor((Date.now() - store.bootMs) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  return d + "d " + pad2(h) + ":" + pad2(m);
}
function driftData() {
  store.load = +clamp(store.load + rnd(-0.25, 0.25), 0.4, 9.5).toFixed(1);
  store.cpu = Math.round(walkV(store.cpu, 6, 78, 9));
  store.scrub = clamp(store.scrub + rnd(0.4, 1.6), 0, 100);
  if (store.scrub >= 100) store.scrub = rnd(2, 8);
  store.used = +clamp(store.used + rnd(-0.05, 0.07), 12.0, 20.4).toFixed(1);
  store.reqs = Math.round(walkV(store.reqs, 420, 2400, 180));
  store.checks = clamp(store.checks + (Math.random() < 0.5 ? -1 : 1), 138, 146) | 0;
  store.ups = clamp(store.ups + (Math.random() < 0.15 ? -1 : (store.ups < 100 ? 1 : 0)), 92, 100) | 0;
  store.watts = Math.round(walkV(store.watts, 180, 320, 12));
  store.fans = Math.round(walkV(store.fans, 28, 72, 4));
  store.intake = +clamp(store.intake + rnd(-0.3, 0.3), 18, 27).toFixed(0);
  if (Math.random() < 0.07) store.containers = clamp(store.containers + (Math.random() < 0.5 ? -1 : 1), 40, 44) | 0;
}

/* ============ status-line pools (ported verbatim from HTML) =========== */
const L = {
  "COMPUTE": {
    ok: [
      () => "load " + store.load.toFixed(1) + " / " + store.cores + "t",
      () => "cpu " + store.cpu + "% nominal",
      () => "kvm win-vm up",
      () => "8 vms online"
    ],
    warn: [
      () => "warn cpu spike",
      () => "warn load " + (store.load + 4).toFixed(1)
    ]
  },
  "STORAGE": {
    ok: [
      () => "zpool scrub " + Math.round(store.scrub) + "%",
      () => store.used.toFixed(1) + "t / 21t",
      () => "smart check ok",
      () => "resilver idle"
    ],
    warn: [() => "warn disk 88%", () => "warn smart sdb"]
  },
  "NETWORK": {
    ok: [
      () => "routing " + (store.reqs / 1000).toFixed(1) + "k req/s",
      () => "eth0 link 1g",
      () => "wireguard up",
      () => "pi-hole ok"
    ],
    warn: [() => "warn pkt loss", () => "warn lat 180ms"]
  },
  "MONITORING": {
    ok: [
      () => "all probes green",
      () => store.checks + " checks ok",
      () => "no alerts 6h",
      () => "grafana live"
    ],
    warn: [() => "warn 1 alert", () => "warn probe lag"]
  },
  "POWER·UPS": {
    ok: [
      () => "ups at " + store.ups + "%",
      () => "draw " + store.watts + "w",
      () => "mains ok 230v",
      () => "runtime 38min"
    ],
    warn: [() => "warn on battery", () => "warn ups 71%"]
  },
  "COOLING": {
    ok: [
      () => "fans at " + store.fans + "%",
      () => "intake " + store.intake + "c",
      () => "delta-t 6c",
      () => "airflow ok"
    ],
    warn: [() => "warn intake 29c", () => "warn fan 2 low"]
  },
  "BACKUP VAULT": {
    ok: [
      () => "backup ✓ 02:00",
      () => "restic snap ok",
      () => "snapshot 14/14",
      () => "offsite synced"
    ],
    warn: [() => "warn backup late", () => "warn retry 1/3"]
  }
};

/* ================= sectors (names/accents from HTML) =================== */
const SECTORS = [
  { name: "COMPUTE",      accent: hx("#e8a13c"), row: "top" },
  { name: "STORAGE",      accent: hx("#46d6ff"), row: "top" },
  { name: "NETWORK",      accent: hx("#5dff8b"), row: "top" },
  { name: "MONITORING",   accent: hx("#8aa0ff"), row: "top" },
  { name: "POWER·UPS",    accent: hx("#e8d44c"), row: "bot" },
  { name: "COOLING",      accent: hx("#79d4ff"), row: "bot" },
  { name: "BACKUP VAULT", accent: hx("#ff5db1"), row: "bot" }
];
const TOP_FRAC = [190 / 1280, 490 / 1280, 790 / 1280, 1090 / 1280];
const BOT_FRAC = [360 / 1280, 690 / 1280, 1010 / 1280];
function prettyName(name) { return name.replace("·", " · "); }

/* ====================== terminal / layout state ======================= */
const ONCE = process.argv.includes("--once");
const IS_TTY = !!process.stdout.isTTY;
const MIN_COLS = 80, MIN_ROWS = 24;

let cols = 160, rows = 40;     // terminal cells
let sceneRows = 38;            // text rows for the pixel scene
let Hpx = 76;                  // pixel-buffer height (2 × sceneRows)
let tooSmall = false;
let fb = new Uint32Array(0);   // framebuffer cols × Hpx (0xRRGGBB)
let topLabelRow = 0, botLabelRow = 0;
let aisleY = 0, aisleH = 0, aisleTop = 0, aisleBot = 0;
let walkY = 0, topAccessY = 0, botAccessY = 0;
let SPEED = 14;                // pixel cells / second

function termSize() {
  if (IS_TTY) return [process.stdout.columns || 80, process.stdout.rows || 24];
  return [160, 40];
}

function buildCabinets(S) {
  S.cabs = [];
  const n = S.w >= 20 ? 3 : 2;
  const inset = 2, gap = 1;
  const cw = Math.floor((S.w - inset * 2 - gap * (n - 1)) / n);
  const cy = S.y + 2, ch = Math.max(4, S.h - 4);
  for (let i = 0; i < n; i++) {
    const cx = S.x + inset + i * (cw + gap);
    const cab = { x: cx, y: cy, w: cw, h: ch, slots: [], leds: [] };
    for (let sy = cy + 3; sy < cy + ch - 1; sy += 2) {
      cab.slots.push(sy);
      const ledN = (Math.random() < 0.45 && cw >= 6) ? 2 : 1;
      for (let d = 0; d < ledN; d++) {
        cab.leds.push({
          x: cx + 1 + d * 2, y: sy,
          base: (Math.random() * 5) | 0,
          phase: Math.random() * 6.28,
          rate: rnd(0.6, 2.6),
          amber: Math.random() < 0.05
        });
      }
    }
    S.cabs.push(cab);
  }
}

function layout() {
  const oldCols = cols, oldHpx = Hpx, had = fb.length > 0;
  [cols, rows] = termSize();
  tooSmall = cols < MIN_COLS || rows < MIN_ROWS;
  if (tooSmall) return;

  sceneRows = rows - 2;          // header + footer text rows
  Hpx = sceneRows * 2;
  fb = new Uint32Array(cols * Hpx);

  topLabelRow = Math.max(0, (Math.round(Hpx * 0.14) >> 1) - 1);
  aisleY = Math.round(Hpx * 0.53);
  aisleH = Math.max(4, Math.round(Hpx * 0.08));
  aisleTop = aisleY - (aisleH >> 1);
  aisleBot = aisleTop + aisleH;
  walkY = aisleY + (aisleH >> 1);
  topAccessY = aisleTop - 2;

  const padW = Math.max(11, Math.round(cols * 210 / 1280));
  const topPadY = Math.round(Hpx * 0.14);
  const padHT = Math.round(Hpx * 0.25);
  const botPadY = Math.round(Hpx * 0.67);
  const padHB = Math.round(Hpx * 0.24);
  botAccessY = botPadY - 2;
  botLabelRow = Math.min(sceneRows - 1, ((botPadY + padHB + 2) >> 1));

  let ti = 0, bi = 0;
  for (const S of SECTORS) {
    if (S.row === "top") {
      S.cx = Math.round(TOP_FRAC[ti++] * cols);
      S.y = topPadY; S.h = padHT; S.accessY = topAccessY;
    } else {
      S.cx = Math.round(BOT_FRAC[bi++] * cols);
      S.y = botPadY; S.h = padHB; S.accessY = botAccessY;
    }
    S.w = padW;
    S.x = clamp(Math.round(S.cx - padW / 2), 0, cols - padW);
    buildCabinets(S);
  }

  SPEED = Math.max(10, cols * 108 / 1280);

  // rescale agent positions into the new space
  for (const a of agents) {
    if (had) {
      a.x = a.x / oldCols * cols;
      a.y = a.y / oldHpx * Hpx;
    } else {
      a.x = a.startFrac * cols;
      a.y = walkY;
    }
    a.x = clamp(a.x, 2, cols - 3);
    a.y = clamp(a.y, 8, Hpx - 1);
  }
}

/* ============================== agents ================================ */
const SPR_W = 5, SPR_H = 8;
const SPRITE = [
  ".333.",   // hood crown
  "33333",
  "34443",   // visor
  "34443",   // visor
  "33333",   // hood meets shoulders
  "11111",   // robe
  "11211",   // robe fold
  ""         // legs (per-frame)
];
const LEG_IDLE = ".2.2.", LEG_A = "2...2", LEG_B = "..2..";

function makeAgent(name, accentHex, startFrac) {
  return {
    name,
    accent: hx(accentHex),
    pal: { hoodT: hx("#2a8f4e"), robe: hx("#1c7d40"), shade: hx("#0f4f28"), visor: hx(accentHex) },
    x: startFrac * 160, y: 0,
    startFrac,
    target: null, lastSector: null,
    phase: "pick", leg: 0,
    frame: 0, stepAcc: 0, moving: false, bob: 0,
    line: "", shown: 0, typeAcc: 0, warn: false,
    holdAcc: 0, holdFor: 4.0,
    think: rnd(0.1, 1.6)
  };
}
const agents = [
  makeAgent("ATLAS",  "#46e8ff", 190 / 1280),
  makeAgent("ARGUS",  "#7fb8ff", 420 / 1280),
  makeAgent("VESTA",  "#ff5ce0", 640 / 1280),
  makeAgent("HERMES", "#ffb347", 860 / 1280),
  makeAgent("NOVA",   "#a0ff5d", 1060 / 1280)
];
agents[0].think = 0.2; agents[1].think = 0.9; agents[2].think = 1.5;
agents[3].think = 2.1; agents[4].think = 2.7;

function isClaimed(S) {
  for (const a of agents) if (a.target === S) return true;
  return false;
}
function pickSector(a) {
  const cands = [];
  for (const S of SECTORS) {
    if (S === a.lastSector) continue;
    if (isClaimed(S)) continue;
    cands.push(S);
  }
  if (cands.length === 0) {
    for (const S of SECTORS) if (!isClaimed(S)) cands.push(S);
  }
  if (cands.length === 0) return null;
  return cands[(Math.random() * cands.length) | 0];
}
function buildLine(a) {
  const pool = L[a.target.name];
  if (Math.random() < 0.14 && pool.warn.length) {
    a.warn = true;
    return pool.warn[(Math.random() * pool.warn.length) | 0]();
  }
  a.warn = false;
  return pool.ok[(Math.random() * pool.ok.length) | 0]();
}
const TYPE_S = 0.05;

function moveToward(a, tx, ty, dt) {
  const dx = tx - a.x, dy = ty - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const stepLen = SPEED * dt;
  if (d <= stepLen || d < 0.5) { a.x = tx; a.y = ty; return true; }
  a.x += (dx / d) * stepLen;
  a.y += (dy / d) * stepLen * 0.62;   // vertical legs read slower in cell space
  return false;
}

function tickAgent(a, dt) {
  if (a.moving) {
    a.stepAcc += dt;
    if (a.stepAcc >= 0.14) { a.stepAcc = 0; a.frame ^= 1; }
    a.bob = (a.frame === 0) ? 0 : -1;
  } else a.bob = 0;

  if (a.phase === "pick") {
    a.think -= dt;
    a.moving = false;
    if (a.think <= 0) {
      const S = pickSector(a);
      if (S) { a.target = S; a.phase = "route"; a.leg = 0; a.moving = true; }
      else a.think = rnd(0.4, 1.0);
    }
    return;
  }
  if (a.phase === "route") {
    a.moving = true;
    const S = a.target;
    if (a.leg === 0) { if (moveToward(a, a.x, walkY, dt)) a.leg = 1; return; }
    if (a.leg === 1) { if (moveToward(a, S.cx, walkY, dt)) a.leg = 2; return; }
    if (a.leg === 2) { if (moveToward(a, S.cx, S.accessY, dt)) a.phase = "arrive"; return; }
  }
  if (a.phase === "arrive") {
    a.moving = false;
    a.line = buildLine(a);
    a.shown = 0; a.typeAcc = 0;
    a.holdAcc = 0; a.holdFor = rnd(3.4, 4.6);
    a.phase = "speak";
    return;
  }
  if (a.phase === "speak") {
    a.moving = false;
    if (a.shown < a.line.length) {
      a.typeAcc += dt;
      a.shown = Math.min(a.line.length, Math.floor(a.typeAcc / TYPE_S));
    } else {
      a.holdAcc += dt;
      if (a.holdAcc >= a.holdFor) {
        a.lastSector = a.target;
        a.target = null;
        a.line = ""; a.shown = 0;
        a.phase = "pick";
        a.think = rnd(0.2, 1.1);
      }
    }
  }
}

/* ============================ simulation ============================== */
let simClock = 0, tData = 0, tMeta = 0, tBlink = 0;
let metaIdx = 0, headCursor = true, bubbleBlink = true, dashPhase = 0;

function metaLine() {
  switch (metaIdx % 5) {
    case 0: return "7 sectors · " + store.containers + " containers";
    case 1: return "5 agents on floor";
    case 2: return "uptime " + fmtUptime();
    case 3: return "backup ✓ 02:00";
    default: return "power " + store.watts + "w · fans " + store.fans + "%";
  }
}
function simStep(dt) {
  simClock += dt;
  tData += dt; if (tData >= 1.4) { tData -= 1.4; driftData(); }
  tMeta += dt; if (tMeta >= 3.4) { tMeta -= 3.4; metaIdx = (metaIdx + 1) % 5; }
  tBlink += dt; if (tBlink >= 0.5) { tBlink -= 0.5; headCursor = !headCursor; bubbleBlink = !bubbleBlink; }
  dashPhase = (dashPhase + dt * 6) % 12;
  for (const a of agents) tickAgent(a, dt);
  for (const S of SECTORS) S._active = false;
  for (const a of agents) if (a.phase === "speak" && a.target) a.target._active = true;
}

/* ========================= pixel draw helpers ========================= */
function px(x, y, col) {
  if (x < 0 || y < 0 || x >= cols || y >= Hpx) return;
  fb[y * cols + x] = col;
}
function rectPx(x, y, w, h, col) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(cols, x + w), y1 = Math.min(Hpx, y + h);
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) fb[yy * cols + xx] = col;
}
function blendPx(x, y, col, t) {
  if (x < 0 || y < 0 || x >= cols || y >= Hpx) return;
  const i = y * cols + x;
  fb[i] = mix(fb[i], col, t);
}

/* ====================== scene rendering (pixels) ====================== */
function drawFloorAndAisle(now) {
  fb.fill(C.floor);
  // faint grid
  const gcol = mix(C.floor, C.phos, 0.05);
  for (let x = 0; x < cols; x += 10)
    for (let y = 0; y < Hpx; y++) fb[y * cols + x] = gcol;
  for (let y = 0; y < Hpx; y += 8)
    for (let x = 0; x < cols; x++) fb[y * cols + x] = gcol;
  // central walking highway
  rectPx(0, aisleTop, cols, aisleH, C.aisle);
  const edge = mix(C.aisle, C.phosFaint, 0.6);
  for (let x = 0; x < cols; x++) {
    px(x, aisleTop, edge);
    px(x, aisleBot, edge);
    // marching dashed centerline
    if (((x + Math.floor(dashPhase)) % 12) < 6) px(x, aisleY, scaleC(C.phosLo, 0.85));
  }
  // phosphor speckle twinkle
  for (let i = 0; i < 22; i++) {
    blendPx((Math.random() * cols) | 0, (Math.random() * Hpx) | 0, C.phos, Math.random() * 0.06);
  }
}

function drawSector(S, now) {
  const dim = scaleC(S.accent, S._active ? 0.6 : 0.32);
  // thin border
  for (let x = S.x; x < S.x + S.w; x++) { px(x, S.y, dim); px(x, S.y + S.h - 1, dim); }
  for (let y = S.y; y < S.y + S.h; y++) { px(S.x, y, dim); px(S.x + S.w - 1, y, dim); }
  // L-corner brackets (full accent)
  const lg = 4, a = S._active ? mix(S.accent, 0xffffff, 0.2) : S.accent;
  const xr = S.x + S.w - 1, yb = S.y + S.h - 1;
  for (let i = 0; i < lg; i++) {
    px(S.x + i, S.y, a); px(xr - i, S.y, a);
    px(S.x + i, yb, a); px(xr - i, yb, a);
  }
  for (let i = 0; i < 2; i++) {
    px(S.x, S.y + i, a); px(xr, S.y + i, a);
    px(S.x, yb - i, a); px(xr, yb - i, a);
  }
  // access tick toward the aisle
  const t = scaleC(S.accent, 0.5);
  if (S.row === "top") {
    px(S.cx, yb + 1, t);
    for (let i = -2; i <= 2; i++) px(S.cx + i, yb + 2, t);
  } else {
    px(S.cx, S.y - 2, t);
    for (let i = -2; i <= 2; i++) px(S.cx + i, S.y - 3, t);
  }
  // cabinets
  for (const cab of S.cabs) {
    rectPx(cab.x, cab.y, cab.w, cab.h, C.cabBody);
    rectPx(cab.x, cab.y, cab.w, Math.max(1, Math.round(cab.h * 0.4)), C.cabBody2);
    // accent-tinted outline
    const oc = mix(C.cabBody, S.accent, 0.45);
    for (let x = cab.x; x < cab.x + cab.w; x++) { px(x, cab.y, oc); px(x, cab.y + cab.h - 1, oc); }
    for (let y = cab.y; y < cab.y + cab.h; y++) { px(cab.x, y, oc); px(cab.x + cab.w - 1, y, oc); }
    // header strip + bright notch
    const hs = mix(C.cabBody, S.accent, 0.35);
    for (let x = cab.x + 1; x < cab.x + cab.w - 1; x++) px(x, cab.y + 1, hs);
    px(cab.x + cab.w - 2, cab.y + 1, S.accent);
    if (cab.w >= 6) px(cab.x + cab.w - 4, cab.y + 1, scaleC(S.accent, 0.8));
    // U-slot lines
    const sc = mix(C.cabBody, C.phosFaint, 0.5);
    for (const sy of cab.slots)
      for (let x = cab.x + 1; x < cab.x + cab.w - 1; x++) px(x, sy, sc);
    // blinking LEDs + activity ticks
    for (const Ld of cab.leds) {
      const tw = 0.5 + 0.5 * Math.sin(now * Ld.rate + Ld.phase);
      let col;
      if (Ld.amber) col = tw > 0.55 ? C.amber : C.amberDim;
      else col = LED_COLORS[clamp(Ld.base + Math.round(tw * 2) - 1, 0, 4)];
      px(Ld.x, Ld.y, col);
      if (tw > 0.7 && !Ld.amber && cab.w >= 6) px(cab.x + cab.w - 2, Ld.y, C.phosLo);
    }
  }
}

function drawAgent(a) {
  const fx = Math.round(a.x), fy = Math.round(a.y) + a.bob;
  const left = fx - (SPR_W >> 1), top = fy - SPR_H + 1;
  // drop shadow under the feet
  for (let i = -2; i <= 2; i++) blendPx(fx + i, fy + 1, C.shadow, 0.55);
  const legRow = !a.moving ? LEG_IDLE : (a.frame === 0 ? LEG_A : LEG_B);
  for (let r = 0; r < SPR_H; r++) {
    const rowStr = (r === SPR_H - 1) ? legRow : SPRITE[r];
    for (let c = 0; c < SPR_W; c++) {
      const code = rowStr.charCodeAt(c) - 48;
      if (code <= 0 || code > 4) continue;
      const col = code === 1 ? a.pal.robe : code === 2 ? a.pal.shade
        : code === 3 ? a.pal.hoodT : a.pal.visor;
      px(left + c, top + r, col);
    }
  }
  // glowing visor halo (additive-ish blend around rows 2..3)
  for (let y = top + 1; y <= top + 4; y++) {
    for (let x = left - 1; x <= left + SPR_W; x++) {
      const inVisor = (y >= top + 2 && y <= top + 3 && x >= left + 1 && x <= left + 3);
      if (!inVisor) blendPx(x, y, a.pal.visor, 0.14);
    }
  }
}

/* ===================== text overlay (labels/bubbles) =================== */
let overlay = [];  // sparse: overlay[row] = array of {ch,fg,bg} per col
function ovRow(r) {
  let o = overlay[r];
  if (!o) { o = overlay[r] = new Array(cols); }
  return o;
}
function putText(row, col, str, fgc, bgc) {
  if (row < 0 || row >= sceneRows) return;
  const o = ovRow(row);
  for (let i = 0; i < str.length; i++) {
    const x = col + i;
    if (x < 0 || x >= cols) continue;
    o[x] = { ch: str[i], fg: fgc, bg: bgc };
  }
}

function drawSectorLabel(S) {
  let label = "[ " + S.name + " ]";
  if (label.length > S.w + 6) label = S.name;
  const row = S.row === "top" ? topLabelRow : botLabelRow;
  const colr = S._active ? mix(S.accent, 0xffffff, 0.25) : S.accent;
  putText(row, Math.round(S.cx - label.length / 2), label, colr, C.floor);
}

function drawBubble(a) {
  const S = a.target;
  if (!S) return;
  const accent = a.warn ? C.amber : C.phos;
  const nameLine = (a.name + " @ " + prettyName(S.name)).toUpperCase();
  let status = a.line.substring(0, a.shown);
  if (bubbleBlink) status += "█";
  const innerW = Math.min(cols - 6, Math.max(nameLine.length, a.line.length + 1, 14));
  const w = innerW + 4;   // borders + padding
  const bx = clamp(Math.round(a.x - w / 2), 0, cols - w);
  let r0;
  if (S.row === "top") r0 = (Math.round(a.y) >> 1) + 1;            // below agent, in aisle
  else r0 = ((Math.round(a.y) - SPR_H) >> 1) - 1;                  // above agent's head
  r0 = clamp(r0, 0, sceneRows - 2);
  const padLine = (txt) => " " + txt + " ".repeat(Math.max(0, innerW - txt.length)) + " ";
  putText(r0, bx, "▌" + padLine(nameLine.slice(0, innerW)) + "▐", accent, C.bubbleBg);
  putText(r0 + 1, bx, "▌", accent, C.bubbleBg);
  putText(r0 + 1, bx + 1, padLine(status.slice(0, innerW)), a.warn ? C.amber : C.ivory, C.bubbleBg);
  putText(r0 + 1, bx + w - 1, "▐", accent, C.bubbleBg);
}

/* ========================= frame composition ========================== */
let chA = [], fgA = [], bgA = [];
function ensureScratch() {
  if (chA.length !== cols) { chA = new Array(cols); fgA = new Array(cols); bgA = new Array(cols); }
}
function serializeScratch() {
  let s = "", cf = -1, cb = -1;
  for (let x = 0; x < cols; x++) {
    if (fgA[x] !== cf) { s += fgCode(fgA[x]); cf = fgA[x]; }
    if (bgA[x] !== cb) { s += bgCode(bgA[x]); cb = bgA[x]; }
    s += chA[x];
  }
  return s;
}
function textLine(segments, bgc) {
  // segments: [{col, text, fg}] over a solid background
  ensureScratch();
  for (let x = 0; x < cols; x++) { chA[x] = " "; fgA[x] = bgc; bgA[x] = bgc; }
  for (const seg of segments) {
    for (let i = 0; i < seg.text.length; i++) {
      const x = seg.col + i;
      if (x < 0 || x >= cols) continue;
      chA[x] = seg.text[i]; fgA[x] = seg.fg;
    }
  }
  return serializeScratch();
}
function sceneLine(r) {
  ensureScratch();
  const o = overlay[r];
  const yT = r * 2 * cols, yB = (r * 2 + 1) * cols;
  for (let x = 0; x < cols; x++) {
    const ov = o && o[x];
    if (ov) { chA[x] = ov.ch; fgA[x] = ov.fg; bgA[x] = ov.bg; }
    else { chA[x] = "▀"; fgA[x] = fb[yT + x]; bgA[x] = fb[yB + x]; }
  }
  return serializeScratch();
}

function headerLine() {
  const title = "node-01 // datacenter floor";
  const segs = [{ col: 1, text: title, fg: C.phos }];
  if (headCursor) segs.push({ col: 1 + title.length + 1, text: "█", fg: C.phos });
  const d = new Date();
  const clock = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  const meta = metaLine() + " · " + clock;
  segs.push({ col: cols - meta.length - 1, text: meta, fg: C.phosDim });
  return textLine(segs, C.bg);
}
function footerLine() {
  const segs = [];
  let x = 1;
  for (const a of agents) {
    const glyph = a.phase === "speak" ? "*" : (a.phase === "route" ? ">" : ".");
    segs.push({ col: x, text: a.name, fg: a.accent });
    segs.push({ col: x + a.name.length, text: glyph, fg: C.phosDim });
    x += a.name.length + 2;
  }
  const right = "q quit";
  segs.push({ col: cols - right.length - 1, text: right, fg: C.phosDim });
  return textLine(segs, C.bg);
}

function composeFrame() {
  if (tooSmall) {
    const msg = "resize terminal to ≥ " + MIN_COLS + "x" + MIN_ROWS;
    const lines = [];
    const midRow = rows >> 1;
    for (let r = 0; r < rows; r++) {
      ensureScratch();
      for (let x = 0; x < cols; x++) { chA[x] = " "; fgA[x] = C.phos; bgA[x] = C.bg; }
      if (r === midRow) {
        const c0 = Math.max(0, (cols - msg.length) >> 1);
        for (let i = 0; i < msg.length && c0 + i < cols; i++) chA[c0 + i] = msg[i];
      }
      lines.push(serializeScratch());
    }
    return lines;
  }
  overlay = new Array(sceneRows);
  drawFloorAndAisle(simClock);
  for (const S of SECTORS) drawSector(S, simClock);
  for (const S of SECTORS) drawSectorLabel(S);
  const order = agents.slice().sort((p, q) => p.y - q.y);
  for (const a of order) drawAgent(a);
  for (const a of order) if (a.phase === "speak" && a.shown > 0) drawBubble(a);

  const lines = new Array(rows);
  lines[0] = headerLine();
  for (let r = 0; r < sceneRows; r++) lines[1 + r] = sceneLine(r);
  lines[rows - 1] = footerLine();
  return lines;
}

/* ============================= main loop ============================== */
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    if (IS_TTY && !ONCE) process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
    else process.stdout.write("\x1b[0m");
    if (process.stdin.isTTY && !ONCE) process.stdin.setRawMode(false);
  } catch (e) { /* ignore */ }
}
function quit() { cleanup(); process.exit(0); }

function main() {
  layout();

  if (ONCE) {
    // pre-warm the sim so the single frame shows agents mid-patrol/speaking
    for (let i = 0; i < 270; i++) simStep(1 / 30);
    process.stdout.write(composeFrame().join("\n") + "\n\x1b[0m", () => process.exit(0));
    return;
  }

  if (IS_TTY) {
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    process.stdout.on("resize", layout);
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (b) => {
      const k = b.toString();
      if (k === "q" || k === "Q" || k === "\x03") quit();
    });
  }
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.on("exit", cleanup);

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    if (tooSmall) layout();          // keep checking for a usable size
    simStep(dt);
    process.stdout.write("\x1b[H" + composeFrame().join("\n"));
  }, 1000 / 12);
}

main();
