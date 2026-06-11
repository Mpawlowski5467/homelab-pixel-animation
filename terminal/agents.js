#!/usr/bin/env node
// terminal/agents.js — "HOMELAB // AGENTS ON DUTY"
// Green-phosphor CRT server aisle with hooded pixel agents: ATLAS (storage),
// ARGUS (monitoring) and VESTA (backups) stand watch at their racks while
// HERMES carries a glowing packet up and down the aisle. Each agent types out
// live status lines in a speech bubble (typewriter effect, occasional amber
// WARN lines). Terminal port of views/agents.html drawn with truecolor
// half-block (▀) pixel art. Node >= 18, zero dependencies.
// Run:  node terminal/agents.js          (q / Q / Ctrl-C quits)
//       node terminal/agents.js --once   (render one frame, exit 0)
"use strict";

// ---------------------------------------------------------------------------
// PALETTE — phosphor green on near-black (ported from views/agents.html).
// Colors are packed 0xRRGGBB ints.
// ---------------------------------------------------------------------------
const C = {
  bg:        0x020803,
  bgRack:    0x04130a,
  bgRack2:   0x061a0d,
  floor:     0x031007,
  grid:      0x0a3a1e,
  gridLo:    0x072515,
  phos:      0x5dff8b,   // primary phosphor green
  phosDim:   0x2f9a55,
  phosLo:    0x176c34,
  phosFaint: 0x0e4422,
  white:     0xcfffe0,
  amber:     0xffb347,
  amberDim:  0xa8702a,
  cyan:      0x46e8ff,   // ATLAS
  green:     0x7dff9a,   // ARGUS
  magenta:   0xff5ce0,   // VESTA
  netblue:   0x7fb8ff,   // HERMES packet
  headBg:    0x03100a,
  chassis:   0x020c06,
  unitSep:   0x03100a,
  wall:      0x030f08,
  bubbleBg:  0x03130a,
  robe:      0x1c7d40,
  robeShade: 0x0f4f28,
  hermRobe:  0x176c5a,
  hermShade: 0x0c4438,
  pktDim:    0x3a5878    // packet glow halo (pre-dimmed netblue)
};
const LED_COLORS = [0x0e4422, 0x176c34, 0x2f9a55, 0x5dff8b, 0x9bffba];

// SGR code caches (palette is small and fixed — bounded memory).
const FG_CACHE = new Map(), BG_CACHE = new Map();
function fgCode(c) {
  let s = FG_CACHE.get(c);
  if (s === undefined) {
    s = "\x1b[38;2;" + ((c >> 16) & 255) + ";" + ((c >> 8) & 255) + ";" + (c & 255) + "m";
    FG_CACHE.set(c, s);
  }
  return s;
}
function bgCode(c) {
  let s = BG_CACHE.get(c);
  if (s === undefined) {
    s = "\x1b[48;2;" + ((c >> 16) & 255) + ";" + ((c >> 8) & 255) + ";" + (c & 255) + "m";
    BG_CACHE.set(c, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 4x6 BITMAP PIXEL FONT (subset ported from the HTML) — used for the rack bay
// signs (STORAGE / MONITOR / BACKUP) drawn inside the pixel framebuffer.
// ---------------------------------------------------------------------------
const FW = 4, FH = 6, ADV = 5;
const GLY = {
  " ": [0, 0, 0, 0, 0, 0],
  "A": [0b0110, 0b1001, 0b1001, 0b1111, 0b1001, 0b1001],
  "B": [0b1110, 0b1001, 0b1110, 0b1001, 0b1001, 0b1110],
  "C": [0b0110, 0b1001, 0b1000, 0b1000, 0b1001, 0b0110],
  "D": [0b1110, 0b1001, 0b1001, 0b1001, 0b1001, 0b1110],
  "E": [0b1111, 0b1000, 0b1110, 0b1000, 0b1000, 0b1111],
  "G": [0b0110, 0b1001, 0b1000, 0b1011, 0b1001, 0b0111],
  "I": [0b1110, 0b0100, 0b0100, 0b0100, 0b0100, 0b1110],
  "K": [0b1001, 0b1010, 0b1100, 0b1100, 0b1010, 0b1001],
  "M": [0b1001, 0b1111, 0b1111, 0b1001, 0b1001, 0b1001],
  "N": [0b1001, 0b1101, 0b1011, 0b1001, 0b1001, 0b1001],
  "O": [0b0110, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  "P": [0b1110, 0b1001, 0b1001, 0b1110, 0b1000, 0b1000],
  "R": [0b1110, 0b1001, 0b1001, 0b1110, 0b1010, 0b1001],
  "S": [0b0111, 0b1000, 0b0110, 0b0001, 0b1001, 0b1110],
  "T": [0b1111, 0b0100, 0b0100, 0b0100, 0b0100, 0b0100],
  "U": [0b1001, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110]
};

// ---------------------------------------------------------------------------
// 12x16 HOODED AGENT SPRITE — ported verbatim from the HTML mask.
// Codes: 0 empty, 1 robe, 2 robe-shade, 3 hood, 4 visor.
// ---------------------------------------------------------------------------
const AGENT_BODY = [
  "....3333....",
  "...333333...",
  "..33444433..",
  "..34444443..",
  "..33444433..",
  "..333113....",
  ".1111111111.",
  ".1112112111.",
  ".1111111111.",
  ".1111111111.",
  ".1121112111.",
  ".1111111111.",
  ".1111111111.",
  ".11111111111"
];
const LEGS_IDLE   = ["..11....11..", "..22....22.."];
const LEGS_WALK_A = [".11......11.", "11........11"];
const LEGS_WALK_B = ["...11..11...", "..22....22.."];

// ---------------------------------------------------------------------------
// MOCK DATA STORE — drifts every ~1.4s, loops forever, no memory growth.
// ---------------------------------------------------------------------------
function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function walkv(v, lo, hi, step) { return clamp(v + rnd(-step, step), lo, hi); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }

const store = {
  reqs: 1180,
  scrub: 61,
  temp: 47,
  cpu: 22,
  containers: 24,
  power: 168,
  bootMs: Date.now() - (12 * 86400 + 4 * 3600 + 33 * 60) * 1000
};
function fmtUptime() {
  let s = Math.floor((Date.now() - store.bootMs) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return d + "D " + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
}
function driftData() {
  store.reqs = Math.round(walkv(store.reqs, 420, 2400, 180));
  store.scrub = clamp(store.scrub + rnd(0.4, 1.6), 0, 100);
  if (store.scrub >= 100) store.scrub = rnd(2, 8);
  store.temp = +walkv(store.temp, 41, 58, 1.1).toFixed(0);
  store.cpu = Math.round(walkv(store.cpu, 6, 78, 9));
  store.power = Math.round(walkv(store.power, 142, 205, 6));
  if (Math.random() < 0.07) store.containers = clamp(store.containers + (Math.random() < 0.5 ? -1 : 1), 21, 29);
}
let metaIdx = 0;
function metaLine() {
  switch (metaIdx % 4) {
    case 0: return "UPTIME " + fmtUptime();
    case 1: return "CONTAINERS " + store.containers + " RUNNING";
    case 2: return "POWER DRAW " + store.power + "W · 12 NODES";
    default: return "LOAD " + store.cpu + "% · NET " + store.reqs + " R/S";
  }
}

// ---------------------------------------------------------------------------
// AGENTS — status line pools ported from the HTML (live store reads).
// ---------------------------------------------------------------------------
const atlasLines = [
  () => "ZPOOL SCRUB " + Math.round(store.scrub) + "%",
  () => "POOL TEMP " + store.temp + "C",
  () => "SMART CHECK OK",
  () => "DISK ARRAY HEALTHY",
  () => "RESILVER IDLE"
];
const atlasWarns = [() => "WARN DISK 82%", () => "WARN SMART SDB"];
const argusLines = [
  () => "ALL PROBES GREEN",
  () => "CPU " + store.cpu + "% NOMINAL",
  () => "12 NODES UP",
  () => "PI-HOLE OK",
  () => "LATENCY 4MS"
];
const argusWarns = [() => "WARN TEMP 71C", () => "WARN CPU SPIKE"];
const vestaLines = [
  () => "BACKUP ✓ 02:00",
  () => "RESTIC SNAP OK",
  () => "SNAPSHOT 14/14",
  () => "OFFSITE SYNCED",
  () => "PRUNE COMPLETE"
];
const vestaWarns = [() => "WARN BACKUP LATE", () => "WARN RETRY 1/3"];

function agentPal(accent, robe, shade) {
  return { robe, shade, hood: shade, visor: accent };
}
function makeAgent(name, pal, lines, warns) {
  return {
    name, pal, lines, warns,
    txtFull: "", shown: 0,
    phase: "type", acc: 0, holdFor: 2.6,
    warn: false,
    bobPhase: Math.random() * Math.PI * 2,
    x: 0 // pixel-column center, assigned by layout()
  };
}
const agents = [
  makeAgent("ATLAS", agentPal(C.cyan, C.robe, C.robeShade), atlasLines, atlasWarns),
  makeAgent("ARGUS", agentPal(C.green, C.robe, C.robeShade), argusLines, argusWarns),
  makeAgent("VESTA", agentPal(C.magenta, C.robe, C.robeShade), vestaLines, vestaWarns)
];
// Stagger the typewriters so they don't move in unison.
agents[0].acc = 0.0;  agents[0].holdFor = 2.4;
agents[1].acc = -1.1; agents[1].holdFor = 2.9;
agents[2].acc = -2.2; agents[2].holdFor = 2.2;

function pickLine(a) {
  if (Math.random() < 0.14) {
    a.warn = true;
    return a.warns[(Math.random() * a.warns.length) | 0]();
  }
  a.warn = false;
  return a.lines[(Math.random() * a.lines.length) | 0]();
}
agents.forEach(a => { a.txtFull = pickLine(a); });

const TYPE_MS = 0.052; // seconds per character revealed
function tickAgent(a, dt) {
  a.acc += dt;
  if (a.phase === "type") {
    const want = Math.floor(a.acc / TYPE_MS);
    if (want >= a.txtFull.length) {
      a.shown = a.txtFull.length;
      a.phase = "hold"; a.acc = 0;
    } else {
      a.shown = Math.max(0, want);
    }
  } else if (a.phase === "hold") {
    if (a.acc >= a.holdFor) { a.phase = "erase"; a.acc = 0; }
  } else { // erase
    const rem = a.txtFull.length - Math.floor(a.acc / (TYPE_MS * 0.6));
    if (rem <= 0) {
      a.shown = 0; a.phase = "type"; a.acc = 0;
      a.txtFull = pickLine(a);
      a.holdFor = rnd(2.0, 3.1);
    } else {
      a.shown = rem;
    }
  }
}

// HERMES — walks the floor left<->right, 2-frame leg cycle, glowing packet.
const hermes = {
  pal: agentPal(C.netblue, C.hermRobe, C.hermShade),
  minX: 8, maxX: 100,   // set by layout()
  t: 0, dir: 1,
  speed: 0.085,
  step: 0, frame: 0
};
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function tickHermes(dt) {
  hermes.t += hermes.dir * hermes.speed * dt;
  if (hermes.t >= 1) { hermes.t = 1; hermes.dir = -1; }
  else if (hermes.t <= 0) { hermes.t = 0; hermes.dir = 1; }
  hermes.step += dt;
  if (hermes.step >= 0.16) { hermes.step = 0; hermes.frame ^= 1; }
}

// ---------------------------------------------------------------------------
// LAYOUT — adapts to the terminal size. Text bands top and bottom, half-block
// pixel scene in the middle (each terminal row = 2 vertical pixels).
//   row 0            header
//   row 1            divider
//   rows 2..4        speech-bubble band (3 text rows)
//   row 5            bubble tails (▼)
//   rows 6..R-3      pixel scene (racks, agents, floor)
//   row R-2          agent name tags
//   row R-1          footer legend
// ---------------------------------------------------------------------------
const MIN_COLS = 80, MIN_ROWS = 24;
let L = null;        // layout
let fb = null;       // pixel framebuffer, Int32Array(pxW * pxH) of 0xRRGGBB
let racks = [];      // rack geometry + LED fields

function buildRacks() {
  racks = [];
  const defs = [];
  // Decorative edge racks on wide terminals (dropped below 150 cols).
  if (L.cols >= 150) {
    defs.push({ cx: 2, w: 18, label: null });
    defs.push({ cx: L.cols - 3, w: 18, label: null });
  }
  const labels = L.cols >= 120 ? ["STORAGE", "MONITOR", "BACKUP"] : ["STOR", "MON", "BAK"];
  for (let i = 0; i < 3; i++) defs.push({ cx: L.rackCX[i], w: L.rackW, label: labels[i] });

  for (const d of defs) {
    const rx = d.cx - (d.w >> 1);
    const rack = { x: rx, y: L.rackTop, w: d.w, h: L.rackH, cx: d.cx, label: d.label, leds: [] };
    const unitH = 3, pad = 2;
    const rows = Math.max(1, Math.floor((rack.h - pad * 2) / unitH));
    for (let u = 0; u < rows; u++) {
      const uy = rack.y + pad + u * unitH;
      for (let k = 0; k < 3; k++) {
        rack.leds.push({
          x: rx + 3 + k * 3, y: uy,
          base: (Math.random() * 5) | 0,
          phase: Math.random() * 6.28,
          rate: rnd(0.6, 2.4),
          amber: Math.random() < 0.04,
          bar: false
        });
      }
      rack.leds.push({
        x: rx + d.w - 4, y: uy,
        base: 1, phase: Math.random() * 6.28, rate: rnd(1.0, 3.0),
        amber: false, bar: true
      });
    }
    racks.push(rack);
  }
}

function layout(cols, rows) {
  L = { cols, rows, tooSmall: cols < MIN_COLS || rows < MIN_ROWS };
  if (L.tooSmall) { fb = null; racks = []; return; }
  L.bubbleTop = 2;          // 3 bubble rows: 2,3,4 ; tails: 5
  L.tailRow = 5;
  L.sceneTop = 6;
  L.namesRow = rows - 2;
  L.footerRow = rows - 1;
  L.sceneRows = L.namesRow - L.sceneTop;
  L.pxW = cols;
  L.pxH = L.sceneRows * 2;
  L.floorY = L.pxH - 6;     // feet line; floor depth below
  L.rackTop = 8;            // pixel rows 0..6 hold the bay-sign pixel font
  L.rackH = Math.max(8, L.floorY - 5 - L.rackTop);
  L.rackW = Math.max(18, Math.min(40, Math.floor(cols * 0.22)));
  L.rackCX = [Math.round(cols * 0.20), Math.round(cols * 0.50), Math.round(cols * 0.80)];
  fb = new Int32Array(L.pxW * L.pxH);
  agents[0].x = L.rackCX[0];
  agents[1].x = L.rackCX[1];
  agents[2].x = L.rackCX[2];
  hermes.minX = 8;
  hermes.maxX = Math.max(hermes.minX + 4, L.pxW - 22);
  buildRacks();
}

// ---------------------------------------------------------------------------
// PIXEL FRAMEBUFFER HELPERS
// ---------------------------------------------------------------------------
function px(x, y, col) {
  if (x >= 0 && x < L.pxW && y >= 0 && y < L.pxH) fb[y * L.pxW + x] = col;
}
function rect(x, y, w, h, col) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(L.pxW, x + w), y1 = Math.min(L.pxH, y + h);
  for (let yy = y0; yy < y1; yy++) {
    const base = yy * L.pxW;
    for (let xx = x0; xx < x1; xx++) fb[base + xx] = col;
  }
}
function txtPx(str, x, y, col, align) {
  str = String(str).toUpperCase();
  let total = str.length * ADV - 1; if (total < 0) total = 0;
  if (align === "center") x -= (total >> 1);
  else if (align === "right") x -= total;
  x = x | 0; y = y | 0;
  for (let i = 0; i < str.length; i++) {
    const g = GLY[str.charAt(i)] || GLY[" "];
    const gx = x + i * ADV;
    for (let r = 0; r < FH; r++) {
      const bits = g[r]; if (!bits) continue;
      for (let c = 0; c < FW; c++) {
        if (bits & (1 << (FW - 1 - c))) px(gx + c, y + r, col);
      }
    }
  }
}
function drawAgentPx(ax, ay, pal, legs) {
  for (let r = 0; r < AGENT_BODY.length; r++) {
    const row = AGENT_BODY[r];
    for (let c = 0; c < 12; c++) {
      const code = row.charCodeAt(c) - 48;
      if (code <= 0) continue;
      const col = code === 1 ? pal.robe : code === 2 ? pal.shade : code === 3 ? pal.hood : pal.visor;
      px(ax + c, ay + r, col);
    }
  }
  for (let lr = 0; lr < 2; lr++) {
    const lrow = legs[lr];
    for (let lc = 0; lc < 12; lc++) {
      const lcode = lrow.charCodeAt(lc) - 48;
      if (lcode <= 0) continue;
      px(ax + lc, ay + 14 + lr, lcode === 2 ? pal.shade : pal.robe);
    }
  }
  // visor glow pixels
  px(ax + 5, ay + 3, pal.visor);
  px(ax + 6, ay + 3, pal.visor);
}

// ---------------------------------------------------------------------------
// SCENE DRAW (into the pixel framebuffer)
// ---------------------------------------------------------------------------
function drawRacks(now) {
  for (const R of racks) {
    rect(R.x - 1, R.y - 1, R.w + 2, R.h + 3, C.chassis);
    rect(R.x, R.y, R.w, R.h, C.bgRack);
    rect(R.x, R.y, R.w, 1, C.bgRack2);
    rect(R.x, R.y + R.h - 1, R.w, 1, C.bgRack2);
    for (let sy = R.y + 4; sy < R.y + R.h - 2; sy += 3) {
      rect(R.x + 1, sy, R.w - 2, 1, C.unitSep);
    }
    for (const Ld of R.leds) {
      const tw = 0.5 + 0.5 * Math.sin(now * Ld.rate + Ld.phase);
      if (Ld.bar) {
        const maxW = R.w >= 26 ? 4 : 2;
        const w = 1 + Math.round(tw * maxW);
        const col = tw > 0.7 ? C.phos : C.phosLo;
        rect(Ld.x - w + 1, Ld.y, w, 1, col);
      } else if (Ld.amber) {
        px(Ld.x, Ld.y, tw > 0.55 ? C.amber : C.amberDim);
      } else {
        const lvl = Math.min(4, Math.max(0, Ld.base + Math.round(tw * 2) - 1));
        px(Ld.x, Ld.y, LED_COLORS[lvl]);
      }
    }
    if (R.label) txtPx(R.label, R.cx, 1, C.phosLo, "center");
  }
}

function drawFloor() {
  rect(0, L.floorY - 2, L.pxW, L.pxH - (L.floorY - 2), C.floor);
  rect(0, L.floorY, L.pxW, 1, C.gridLo);
  if (L.floorY + 2 < L.pxH) rect(0, L.floorY + 2, L.pxW, 1, C.grid);
  rect(0, L.pxH - 1, L.pxW, 1, C.grid);
  // converging dotted verticals toward a vanishing point above the floor
  const vpx = L.pxW >> 1, vpy = L.floorY - 8;
  const offs = [-0.42, -0.26, -0.13, 0, 0.13, 0.26, 0.42];
  for (const o of offs) {
    const bx = vpx + o * L.pxW;
    for (let yy = L.pxH - 1; yy >= L.floorY; yy -= 2) {
      const f = (yy - vpy) / (L.pxH - vpy);
      const xx = Math.round(vpx + (bx - vpx) * f);
      px(xx, yy, C.gridLo);
    }
  }
}

function drawSpeckle() {
  for (let i = 0; i < 10; i++) {
    const x = (Math.random() * L.pxW) | 0;
    const y = (Math.random() * L.pxH) | 0;
    if (fb[y * L.pxW + x] === C.bg) px(x, y, C.phosFaint);
  }
}

// ---------------------------------------------------------------------------
// TEXT ROW HELPERS — each text row is {ch[], fg[], bg[]} of exactly cols cells.
// ---------------------------------------------------------------------------
function makeRow(fill, fgc, bgc) {
  const n = L.cols;
  return {
    ch: new Array(n).fill(fill),
    fg: new Int32Array(n).fill(fgc),
    bg: new Int32Array(n).fill(bgc)
  };
}
function put(row, x, str, fgc, bgc) {
  for (let i = 0; i < str.length; i++) {
    const c = x + i;
    if (c < 0 || c >= L.cols) continue;
    row.ch[c] = str[i];
    if (fgc !== undefined) row.fg[c] = fgc;
    if (bgc !== undefined) row.bg[c] = bgc;
  }
}
function rowToAnsi(row) {
  let out = "", lf = -1, lb = -1;
  const n = L.cols;
  for (let x = 0; x < n; x++) {
    if (row.fg[x] !== lf) { out += fgCode(row.fg[x]); lf = row.fg[x]; }
    if (row.bg[x] !== lb) { out += bgCode(row.bg[x]); lb = row.bg[x]; }
    out += row.ch[x];
  }
  return out + "\x1b[0m";
}
// Blit two framebuffer pixel rows into one half-block terminal row.
function sceneRowToAnsi(r) {
  let out = "", lf = -1, lb = -1;
  const n = L.pxW;
  const top = (r * 2) * n, bot = (r * 2 + 1) * n;
  for (let x = 0; x < n; x++) {
    const f = fb[top + x], b = fb[bot + x];
    if (f !== lf) { out += fgCode(f); lf = f; }
    if (b !== lb) { out += bgCode(b); lb = b; }
    out += "▀";
  }
  return out + "\x1b[0m";
}

// ---------------------------------------------------------------------------
// SPEECH BUBBLES — text rows above the scene; typewriter substring + cursor.
// ---------------------------------------------------------------------------
function drawBubble(bRows, tailRow, center, text, accent, warn, blink) {
  const border = warn ? C.amber : accent;
  const tcol = warn ? C.amber : C.white;
  const inner = text.length + 1;                  // +1 = cursor slot
  const contentW = Math.max(inner, 6);
  const total = contentW + 4;                     // "│ " + content + " │"
  let left = Math.round(center - total / 2);
  left = clamp(left, 0, Math.max(0, L.cols - total));

  put(bRows[0], left, "┌" + "─".repeat(contentW + 2) + "┐", border, C.bubbleBg);
  const padN = contentW - inner;
  const cur = blink ? "▌" : " ";
  put(bRows[1], left, "│ ", border, C.bubbleBg);
  put(bRows[1], left + 2, text, tcol, C.bubbleBg);
  put(bRows[1], left + 2 + text.length, cur, border, C.bubbleBg);
  put(bRows[1], left + 2 + inner, " ".repeat(padN) + " ", tcol, C.bubbleBg);
  put(bRows[1], left + total - 1, "│", border, C.bubbleBg);
  put(bRows[2], left, "└" + "─".repeat(contentW + 2) + "┘", border, C.bubbleBg);
  const tx = clamp(Math.round(center), left + 1, left + total - 2);
  put(tailRow, tx, "▼", border, C.bg);
}

// ---------------------------------------------------------------------------
// FRAME COMPOSITION — returns exactly L.rows lines, each exactly L.cols wide.
// ---------------------------------------------------------------------------
let nowSec = 0, headCursor = true, bubbleBlink = true;

function composeTooSmall() {
  const cols = Math.max(1, L.cols), rows = Math.max(1, L.rows);
  const msg = "resize terminal to ≥ 80×24";
  const lines = [];
  for (let r = 0; r < rows; r++) {
    if (r === (rows >> 1)) {
      const pad = Math.max(0, (cols - msg.length) >> 1);
      let line = " ".repeat(pad) + msg;
      line = line.length > cols ? line.slice(0, cols) : line + " ".repeat(cols - line.length);
      lines.push(bgCode(C.bg) + fgCode(C.phos) + line + "\x1b[0m");
    } else {
      lines.push(bgCode(C.bg) + " ".repeat(cols) + "\x1b[0m");
    }
  }
  return lines.join("\n");
}

function compose() {
  if (L.tooSmall) return composeTooSmall();
  const lines = [];

  // --- header ---
  const head = makeRow(" ", C.phosDim, C.headBg);
  const title = "HOMELAB // AGENTS ON DUTY";
  put(head, 1, title, C.phos);
  if (headCursor) put(head, 1 + title.length + 1, "▌", C.phos);
  const meta = metaLine();
  put(head, L.cols - 1 - meta.length, meta, C.phosDim);
  lines.push(rowToAnsi(head));

  // --- divider with phosphor ticks ---
  const div = makeRow("─", C.phosFaint, C.bg);
  for (let x = 6; x < L.cols; x += 24) { div.ch[x] = "┬"; div.fg[x] = C.phosLo; }
  lines.push(rowToAnsi(div));

  // --- speech bubble band (3 rows) + tail row ---
  const bRows = [
    makeRow(" ", C.phosDim, C.bg),
    makeRow(" ", C.phosDim, C.bg),
    makeRow(" ", C.phosDim, C.bg)
  ];
  const tails = makeRow(" ", C.phosDim, C.bg);
  for (const a of agents) {
    const shown = a.txtFull.substring(0, a.shown);
    const showCur = (a.phase !== "erase") && bubbleBlink;
    if (shown.length > 0 || a.phase === "type") {
      drawBubble(bRows, tails, a.x, shown, a.pal.visor, a.warn, showCur);
    }
  }
  // HERMES bubble drawn last so it passes in front
  const e = easeInOut(hermes.t);
  const hx = Math.round(hermes.minX + (hermes.maxX - hermes.minX) * e);
  drawBubble(bRows, tails, hx + 6, "ROUTING " + store.reqs + " R/S", C.netblue, false, bubbleBlink);
  lines.push(rowToAnsi(bRows[0]), rowToAnsi(bRows[1]), rowToAnsi(bRows[2]), rowToAnsi(tails));

  // --- pixel scene ---
  fb.fill(C.bg);
  rect(0, 0, L.pxW, L.rackTop + 4, C.wall);          // faint back-wall band
  drawRacks(nowSec);
  drawFloor();
  drawSpeckle();
  for (const a of agents) {
    const bob = Math.round(Math.sin(nowSec * 1.6 + a.bobPhase));
    drawAgentPx(a.x - 6, L.floorY - 16 + bob, a.pal, LEGS_IDLE);
  }
  const walkBob = hermes.frame === 0 ? 0 : -1;
  const hy = L.floorY - 16 + walkBob;
  drawAgentPx(hx, hy, hermes.pal, hermes.frame === 0 ? LEGS_WALK_A : LEGS_WALK_B);
  // glowing packet bobbing in HERMES' hand (side follows direction)
  const pkX = hx + (hermes.dir > 0 ? 12 : -2);
  const pkY = hy + 8 + Math.round(Math.sin(nowSec * 6));
  for (let g = 1; g <= 2; g++) {
    px(pkX - g, pkY, C.pktDim); px(pkX + g, pkY, C.pktDim);
    px(pkX, pkY - g, C.pktDim); px(pkX, pkY + g, C.pktDim);
  }
  px(pkX, pkY, C.white);
  for (let r = 0; r < L.sceneRows; r++) lines.push(sceneRowToAnsi(r));

  // --- name tags (text row riding on the floor) ---
  const names = makeRow(" ", C.phosDim, C.floor);
  for (const a of agents) {
    put(names, clamp(a.x - (a.name.length >> 1), 0, L.cols - a.name.length), a.name, a.pal.visor);
  }
  put(names, clamp(hx + 6 - 3, 0, L.cols - 6), "HERMES", C.netblue);
  lines.push(rowToAnsi(names));

  // --- footer legend ---
  const foot = makeRow(" ", C.phosDim, C.headBg);
  let fx = 1;
  const legend = [
    ["ATLAS", C.cyan], ["·STORAGE", C.phosDim],
    ["  ARGUS", C.green], ["·MONITORING", C.phosDim],
    ["  VESTA", C.magenta], ["·BACKUPS", C.phosDim],
    ["  HERMES", C.netblue], ["·TRANSIT", C.phosDim]
  ];
  for (const [s, col] of legend) { put(foot, fx, s, col); fx += s.length; }
  const quit = "[Q] QUIT";
  put(foot, L.cols - 1 - quit.length, quit, C.phosLo);
  lines.push(rowToAnsi(foot));

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// TICKING
// ---------------------------------------------------------------------------
let tData = 0, tMeta = 0, blinkT = 0;
function tick(dt) {
  nowSec += dt;
  tData += dt;
  if (tData >= 1.4) { tData = 0; driftData(); }
  tMeta += dt;
  if (tMeta >= 3.4) { tMeta = 0; metaIdx++; }
  blinkT += dt;
  if (blinkT >= 0.5) { blinkT = 0; headCursor = !headCursor; bubbleBlink = !bubbleBlink; }
  for (const a of agents) tickAgent(a, dt);
  tickHermes(dt);
}

// ---------------------------------------------------------------------------
// MAIN — TTY handling, render loop, --once test hook, cleanup on all exits.
// ---------------------------------------------------------------------------
const ONCE = process.argv.includes("--once");
const isTTY = !!process.stdout.isTTY;

function currentSize() {
  if (isTTY && process.stdout.columns && process.stdout.rows) {
    return [process.stdout.columns, process.stdout.rows];
  }
  return [160, 40];
}

if (ONCE) {
  const [cols, rows] = currentSize();
  layout(cols, rows);
  // advance the simulation a few seconds so bubbles have typed text
  for (let i = 0; i < 32; i++) tick(0.1);
  process.stdout.write(compose() + "\x1b[0m\n");
  process.exit(0);
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { clearInterval(timer); } catch (_) {}
  let out = "\x1b[0m";
  if (isTTY) out += "\x1b[?25h\x1b[?1049l";
  process.stdout.write(out);
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch (_) {}
    process.stdin.pause();
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

if (isTTY) process.stdout.write("\x1b[?1049h\x1b[?25l");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (d) => {
    const s = d.toString();
    if (s === "q" || s === "Q" || s === "\x03") { cleanup(); process.exit(0); }
  });
}
process.stdout.on("resize", () => {
  const [c, r] = currentSize();
  layout(c, r);
});

{
  const [c, r] = currentSize();
  layout(c, r);
}

let lastMs = Date.now();
const timer = setInterval(() => {
  const ms = Date.now();
  let dt = (ms - lastMs) / 1000;
  lastMs = ms;
  if (dt > 0.1) dt = 0.1;
  tick(dt);
  process.stdout.write("\x1b[H" + compose());
}, 83); // ~12 fps
