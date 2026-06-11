#!/usr/bin/env node
// pixel-amber — 8-bit AMBER retro homelab rig (terminal port of views/pixel-amber.html).
// Big blocky clock, typewriter sysadmin quips, block-bar gauges, and an animated
// half-block pixel server tower with blinking bay LEDs and a beating pixel heart.
// Run:  node terminal/pixel-amber.js        (q / Q / Ctrl-C to quit)
//       node terminal/pixel-amber.js --once (render a single frame and exit)
// Zero dependencies. Node >= 18. Design target ~160x40, minimum 80x24.

"use strict";

const ONCE = process.argv.includes("--once");

/* ================================================================
 * Color helpers — truecolor ANSI, colors packed as 0xRRGGBB ints.
 * ================================================================ */
function phex(h) {
  return (parseInt(h.slice(1, 3), 16) << 16) |
         (parseInt(h.slice(3, 5), 16) << 8) |
          parseInt(h.slice(5, 7), 16);
}
function lerpC(a, b, t) {
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8) |
          Math.round(ab + (bb - ab) * t);
}
function fgSeq(c) { return `\x1b[38;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`; }
function bgSeq(c) { return `\x1b[48;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`; }

/* ---- amber palette (lifted from the HTML) ---- */
const C = {
  bgTop:    phex("#1c1207"),  // radial gradient center
  bgEdge:   phex("#0f0a03"),  // radial gradient edge
  tag:      phex("#a8702f"),  // panel tags
  clock:    phex("#ffd28a"),  // big clock fill
  clockSh:  phex("#5a2f08"),  // chunky drop shadow
  colonDim: phex("#54300d"),  // blinked-off colon (opacity .18 feel)
  sec:      phex("#ff9a3c"),  // seconds
  date:     phex("#ffb454"),
  kvKey:    phex("#b9772f"),
  kvVal:    phex("#ffcf83"),
  quipLbl:  phex("#8f5f28"),
  quip:     phex("#ffb454"),
  cursor:   phex("#ffd28a"),
  divider:  phex("#57350f"),  // rgba(255,150,40,.28) over the dark bg
  resName:  phex("#d68a39"),
  resPct:   phex("#ffd28a"),
  barLit:   phex("#ff9a3c"),
  barGlow:  phex("#ffe0a6"),
  barEmpty: phex("#4a2f12"),
  footDim:  phex("#9a6428"),
  footHi:   phex("#ffb454"),
  footRule: phex("#3a250e"),
  pillFg:   phex("#0f0a03"),
  pillOk:   phex("#ffb454"),
  pillWarn: phex("#ff7a2c"),
  heartLbl: phex("#c0506a"),
  netVal:   phex("#ffd28a"),
  netUnit:  phex("#b9772f"),
};

/* ---- tower pixel palette (PAL from the HTML) ---- */
const PAL = {
  caseDark: phex("#2a1c0c"),
  caseMid:  phex("#3a2710"),
  caseLite: phex("#4d3414"),
  bayDark:  phex("#160d04"),
  bayFace:  phex("#241608"),
  ledOff:   phex("#5a3a16"),
  ledAmber: phex("#ffb454"),
  ledHot:   phex("#ffe0a6"),
  ledGreen: phex("#7CFFB0"),
  greenDim: phex("#3a6b46"),
  ventDark: phex("#1c1206"),
  ventLite: phex("#3a2710"),
  screen:   phex("#0c0803"),
  shadow:   phex("#0c0702"),
  screenTop:phex("#1c1206"),
  dotOff:   phex("#241608"),
  sled1:    phex("#352107"),
  sled2:    phex("#2c1b06"),
};

/* ---- heart palette ---- */
const HC = {
  base:  phex("#a8324a"),
  hot:   phex("#ff6a4a"),
  hiLo:  phex("#ff8a6a"),
  hiHi:  phex("#ffd0c0"),
  glint: phex("#ffe2d6"),
};

/* ================================================================
 * Mock state — all values drift forever; nothing is real.
 * (Faithful port of the HTML's drift logic.)
 * ================================================================ */
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }

const BOOT_OFFSET_MS = (37 * 86400 + 14 * 3600 + 9 * 60 + 41) * 1000; // 37d 14:09:41
const startWall = Date.now();

const metrics = {
  cpu:  { v: 34, target: 34 },
  ram:  { v: 58, target: 58 },
  temp: { v: 47, target: 47 }, // % of a 0..85C-ish scale
  disk: { v: 71, target: 71 },
};
const net = { down: 4.2, up: 0.8, dTarget: 4.2, uTarget: 0.8 };
let packets = 184203117; // climbs forever, display-capped
const load = [0.42, 0.51, 0.48];

const SERVICES = ["nginx", "proxmox", "truenas", "pi-hole", "wireguard", "restic", "jellyfin", "docker"];
const svcTotal = SERVICES.length;
let svcUpCount = svcTotal;

const FOOTNOTES = [
  "zfs scrub: idle",
  "zfs scrub: tank 38% · 412MB/s",
  "SMART: all drives PASSED",
  "restic backup @ 02:00 OK",
  "docker: 19 containers",
  "pi-hole: 31.4% blocked",
  "zfs scrub: tank 71% · 388MB/s",
  "SMART short test: PASSED",
  "wireguard: 3 peers up",
  "jellyfin: 1 stream · 1080p",
];
let footIdx = 0;

const QUIPS = [
  "there is no cloud, it's just my basement",
  "it's always DNS",
  "rm -rf /worries",
  "have you tried turning it off and on again?",
  "the backup you didn't test doesn't exist",
  "99 little bugs in the code...",
  "it works on my rack",
  "sudo make me a sandwich",
  "ssh-ing into the void",
  "uptime is a lifestyle",
  "blame the firmware",
  "git push --force friday? bold.",
];
let quipIdx = 0;
let quipPhase = "typing"; // typing -> holding -> deleting
let quipChars = 0;
let quipCur = QUIPS[0];
let quipHold = 0;

let bpm = 72;
let powerPulse = 0;
let ventScroll = 0;

const BAY_COUNT = 6;
const bays = [];
for (let b = 0; b < BAY_COUNT; b++) {
  bays.push({ on: Math.random() < 0.5, activity: rand(0.18, 0.62) });
}

function stepMetric(m, walk, lo, hi) {
  if (Math.random() < 0.5) m.target = clamp(m.target + rand(-walk, walk), lo, hi);
  m.v = clamp(m.v + (m.target - m.v) * 0.5, 0, 100);
}

function driftMetrics() {
  stepMetric(metrics.cpu, 6, 8, 95);
  stepMetric(metrics.ram, 3, 35, 90);
  stepMetric(metrics.temp, 2.2, 25, 82);
  stepMetric(metrics.disk, 0.8, 55, 86);
  // temp loosely correlates with cpu
  metrics.temp.target = clamp(metrics.temp.target * 0.7 + metrics.cpu.v * 0.32, 25, 82);
  // load average tracks cpu, slow EMAs
  const l = metrics.cpu.v / 100 * 1.6 + rand(-0.05, 0.05);
  load[0] = clamp(load[0] * 0.6 + l * 0.4, 0.05, 3.2);
  load[1] = clamp(load[1] * 0.8 + load[0] * 0.2, 0.05, 3.0);
  load[2] = clamp(load[2] * 0.9 + load[1] * 0.1, 0.05, 2.8);
  // net drift (download spikier than upload)
  if (Math.random() < 0.4) net.dTarget = rand(0.3, 18.5);
  if (Math.random() < 0.4) net.uTarget = rand(0.1, 6.0);
  net.down = clamp(net.down + (net.dTarget - net.down) * 0.4, 0, 30);
  net.up = clamp(net.up + (net.uTarget - net.up) * 0.4, 0, 12);
  // bpm gently wanders
  bpm = Math.round(clamp(bpm + rand(-3, 3), 58, 96));
}

function accumulatePackets(dtSec) {
  const pps = (net.down + net.up) * 1450 + 220;
  packets += Math.round(pps * dtSec);
  if (packets > 1e14) packets %= 1e11; // keep the number itself bounded
}

function stepQuip() {
  if (quipPhase === "typing") {
    quipChars++;
    if (quipChars >= quipCur.length) { quipChars = quipCur.length; quipPhase = "holding"; quipHold = 0; }
  } else if (quipPhase === "deleting") {
    quipChars--;
    if (quipChars <= 0) {
      quipChars = 0;
      quipIdx = (quipIdx + 1) % QUIPS.length;
      quipCur = QUIPS[quipIdx];
      quipPhase = "typing";
    }
  }
}

function tickServerLeds() {
  for (let i = 0; i < BAY_COUNT; i++) {
    if (Math.random() < bays[i].activity * 0.5) bays[i].on = !bays[i].on;
  }
  ventScroll += 2;
  if (ventScroll > 100000) ventScroll = 0;
}

// lub-dub cardiac envelope -> 0..1 (sharp systole + smaller second bump)
function cardiac(p) {
  const a = Math.exp(-Math.pow((p - 0.08) / 0.06, 2));
  const b = 0.55 * Math.exp(-Math.pow((p - 0.30) / 0.07, 2));
  return clamp(a + b, 0, 1);
}

/* ================================================================
 * Chunky 5-row block digit font (█ ▀ ▄), Silkscreen-ish.
 * Each digit is 6 cells wide; the colon is 2.
 * ================================================================ */
const FONT = {
  "0": ["▄████▄", "██  ██", "██  ██", "██  ██", "▀████▀"],
  "1": [" ▄██  ", "  ██  ", "  ██  ", "  ██  ", "██████"],
  "2": ["▄████▄", "▀▀  ██", "   ▄█▀", "  █▀  ", "██████"],
  "3": ["▄████▄", "▀▀  ██", "  ███▄", "▄▄  ██", "▀████▀"],
  "4": ["██  ██", "██  ██", "▀█████", "    ██", "    ██"],
  "5": ["██████", "██  ▀▀", "█████▄", "▄▄  ██", "▀████▀"],
  "6": ["▄████▄", "██  ▀▀", "█████▄", "██  ██", "▀████▀"],
  "7": ["██████", "▀▀  ██", "   ██ ", "  ██  ", "  ██  "],
  "8": ["▄████▄", "██  ██", " ████ ", "██  ██", "▀████▀"],
  "9": ["▄████▄", "██  ██", "▀█████", "▄▄  ██", "▀████▀"],
  ":": ["  ", "██", "  ", "██", "  "],
};
const FONT_H = 5;

/* ================================================================
 * Screen buffer — char + packed fg + packed bg per cell.
 * Every line serializes to EXACTLY `cols` visible characters.
 * ================================================================ */
let SW = 0, SH = 0;
let chBuf = null, fgBuf = null, bgBuf = null, rowBg = null;

function ensureScreen(w, h) {
  if (w === SW && h === SH) return;
  SW = w; SH = h;
  chBuf = new Array(w * h).fill(" ");
  fgBuf = new Int32Array(w * h);
  bgBuf = new Int32Array(w * h);
  rowBg = new Int32Array(h);
  for (let r = 0; r < h; r++) {
    // faint radial-ish warm gradient, brightest around 38% height
    const t = Math.min(1, Math.abs(r / Math.max(1, h - 1) - 0.38) / 0.62);
    rowBg[r] = lerpC(C.bgTop, C.bgEdge, t * t * 0.85 + t * 0.15);
  }
}

function clearScreen() {
  for (let r = 0; r < SH; r++) {
    const bg = rowBg[r], off = r * SW;
    for (let c = 0; c < SW; c++) {
      chBuf[off + c] = " ";
      fgBuf[off + c] = bg;
      bgBuf[off + c] = bg;
    }
  }
}

function put(x, y, str, fg, bg) {
  if (y < 0 || y >= SH) return;
  const off = y * SW;
  for (let i = 0; i < str.length; i++) {
    const cx = x + i;
    if (cx < 0 || cx >= SW) continue;
    chBuf[off + cx] = str[i];
    fgBuf[off + cx] = fg;
    if (bg !== undefined) bgBuf[off + cx] = bg;
  }
}

// Draw a font glyph, skipping spaces (transparent), at cell (x,y).
function putGlyph(x, y, glyph, fg) {
  for (let r = 0; r < FONT_H; r++) {
    const row = glyph[r];
    const off = (y + r) * SW;
    if (y + r < 0 || y + r >= SH) continue;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === " ") continue;
      const cx = x + i;
      if (cx < 0 || cx >= SW) continue;
      chBuf[off + cx] = ch;
      fgBuf[off + cx] = fg;
    }
  }
}

// Blit a 2x-vertical-resolution pixel buffer using ▀ (fg=top px, bg=bottom px).
// pix is an array of H rows (H even), each a Int32Array of width W; -1 = transparent.
function blitPixels(x0, y0, pix, W, H) {
  const cellRows = H >> 1;
  for (let cy = 0; cy < cellRows; cy++) {
    const sy = y0 + cy;
    if (sy < 0 || sy >= SH) continue;
    const top = pix[cy * 2], bot = pix[cy * 2 + 1];
    const off = sy * SW;
    for (let cx = 0; cx < W; cx++) {
      const sx = x0 + cx;
      if (sx < 0 || sx >= SW) continue;
      const t = top[cx], b = bot[cx];
      if (t < 0 && b < 0) continue;
      const back = rowBg[sy];
      chBuf[off + sx] = "▀";
      fgBuf[off + sx] = t < 0 ? back : t;
      bgBuf[off + sx] = b < 0 ? back : b;
    }
  }
}

function serialize() {
  let out = "";
  let lastFg = -1, lastBg = -1;
  for (let r = 0; r < SH; r++) {
    const off = r * SW;
    for (let c = 0; c < SW; c++) {
      const f = fgBuf[off + c], b = bgBuf[off + c];
      if (b !== lastBg) { out += bgSeq(b); lastBg = b; }
      if (f !== lastFg) { out += fgSeq(f); lastFg = f; }
      out += chBuf[off + c];
    }
    if (r < SH - 1) out += "\n";
  }
  return out;
}

/* ================================================================
 * Pixel painters — server tower + heart (port of the canvas code).
 * ================================================================ */
function makePix(W, H) {
  const rows = new Array(H);
  for (let y = 0; y < H; y++) rows[y] = new Int32Array(W).fill(-1);
  return rows;
}
function pxFill(pix, W, H, x, y, w, h, col) {
  const x1 = Math.max(0, x), y1 = Math.max(0, y);
  const x2 = Math.min(W, x + w), y2 = Math.min(H, y + h);
  for (let yy = y1; yy < y2; yy++) {
    const row = pix[yy];
    for (let xx = x1; xx < x2; xx++) row[xx] = col;
  }
}

// Tower: chassis + power LED + mini screen + vents + drive bays + foot vents.
function drawTower(W, H) {
  const pix = makePix(W, H);
  const P = (x, y, w, h, c) => pxFill(pix, W, H, x, y, w, h, c);

  const cx = 1, cy = 1, cw = W - 3, ch = H - 3;
  // outer shadow, then case fill with left/top highlight + right/bottom shade
  P(cx + 1, cy + 1, cw, ch, PAL.shadow);
  P(cx, cy, cw, ch, PAL.caseMid);
  P(cx, cy, 1, ch, PAL.caseLite);
  P(cx, cy, cw, 1, PAL.caseLite);
  P(cx + cw - 1, cy, 1, ch, PAL.caseDark);
  P(cx, cy + ch - 1, cw, 1, PAL.caseDark);

  // --- top section: pulsing power LED + tiny status screen ---
  const topY = cy + 2;
  const pcol = lerpC(PAL.greenDim, PAL.ledGreen, 0.35 + 0.65 * powerPulse);
  P(cx + 2, topY, 3, 3, PAL.shadow);
  P(cx + 2, topY, 2, 2, pcol);
  if (powerPulse > 0.55) P(cx + 2, topY, 1, 1, PAL.ledHot); // hot core

  const sx = cx + 6, sy = topY, sw = cw - 8, sh = 4;
  if (sw > 2) {
    P(sx, sy, sw, sh, PAL.screen);
    P(sx, sy, sw, 1, PAL.screenTop);
    const dots = Math.floor((ventScroll * 0.5) % sw);
    for (let dpx = 0; dpx < sw - 1; dpx += 2) {
      const lit = ((dpx + dots) % 6) < 2;
      P(sx + dpx, sy + 2, 1, 1, lit ? PAL.ledAmber : PAL.dotOff);
    }
  }

  // --- vent grille (shimmering slots scroll horizontally) ---
  const vY = topY + 5;
  for (let vr = 0; vr < 2; vr++) {
    const ry = vY + vr * 2;
    P(cx + 2, ry, cw - 4, 1, PAL.ventDark);
    for (let vc = 0; vc < cw - 5; vc += 2) {
      const phase = ((vc + Math.floor(ventScroll)) % 8) < 2;
      P(cx + 3 + vc, ry, 1, 1, phase ? PAL.ventLite : PAL.caseDark);
    }
  }

  // --- drive bays stack (blinking activity LEDs) ---
  const bayTop = vY + 4;
  const bayX = cx + 2, bayW = cw - 4;
  const footY = cy + ch - 3;
  const avail = footY - bayTop - 1;
  const per = Math.max(4, Math.floor(avail / BAY_COUNT));
  const bayH = per - 1;
  for (let i = 0; i < BAY_COUNT; i++) {
    const by = bayTop + i * per;
    if (by + bayH > footY - 1) break;
    P(bayX, by, bayW, bayH, PAL.bayDark);
    P(bayX + 1, by + 1, bayW - 2, bayH - 2, PAL.bayFace);
    // drive sled slits
    P(bayX + 2, by + 1, bayW - 8, 1, PAL.sled1);
    if (bayH >= 5) P(bayX + 2, by + 3, bayW - 10, 1, PAL.sled2);
    // activity LED on the right
    const lx = bayX + bayW - 4, ly = by + 1;
    P(lx - 1, ly - 1, 4, 4, PAL.shadow);
    if (bays[i].on) {
      P(lx, ly, 2, 2, PAL.ledAmber);
      P(lx, ly, 1, 1, PAL.ledHot);
    } else {
      P(lx, ly, 2, 2, PAL.ledOff);
    }
  }

  // --- foot vents at the very bottom ---
  for (let fx = cx + 2; fx < cx + cw - 2; fx += 2) {
    P(fx, footY + 1, 1, 2, PAL.ventDark);
  }
  return pix;
}

// 10x10 heart bitmap (1 = fill, 2 = highlight pixel) — straight from the HTML.
const HEART = [
  "0011011000",
  "0111111100",
  "1111111110",
  "1112111110",
  "1111111110",
  "0111111100",
  "0011111000",
  "0001110000",
  "0000100000",
  "0000000000",
];
const HEART_W = 10, HEART_PH = 12; // 12 px tall -> 6 cell rows (1px inset + squash room)

function drawHeart(pulse) {
  const pix = makePix(HEART_W, HEART_PH);
  const lit = lerpC(HC.base, HC.hot, pulse);
  const hi = lerpC(HC.hiLo, HC.hiHi, pulse);
  const squash = pulse > 0.72 ? 1 : 0; // 1px thump on the strong beat
  const oy = 1;
  for (let y = 0; y < HEART.length; y++) {
    const row = HEART[y];
    const py = oy + y - squash;
    if (py < 0 || py >= HEART_PH) continue;
    for (let x = 0; x < row.length; x++) {
      const c = row.charAt(x);
      if (c === "0") continue;
      pix[py][x] = (c === "2") ? hi : lit;
    }
  }
  if (pulse > 0.6) {
    const gy = oy + 1 - squash;
    if (gy >= 0) pix[gy][3] = HC.glint; // glint on the beat peak
  }
  return pix;
}

/* ================================================================
 * Frame composition
 * ================================================================ */
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function groupDigits(n) {
  const s = "" + (n % 100000000000); // 11 digits max, like the HTML
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += " ";
    out += s.charAt(i);
  }
  return out;
}

function composeFrame(w, h, now) {
  ensureScreen(w, h);
  clearScreen();

  if (w < 80 || h < 24) {
    const msg = "resize terminal to ≥ 80×24";
    put(Math.max(0, (w - msg.length) >> 1), h >> 1, msg.slice(0, w), C.date);
    return serialize();
  }

  /* ---- zone layout (proportions from the 1280px strip) ---- */
  const z1w = Math.max(36, Math.round(w * 0.37));      // clock
  const rem = w - z1w;
  const z2w = Math.round(rem * 0.44);                  // resources
  const z3w = rem - z2w;                               // server tower
  const x2 = z1w, x3 = z1w + z2w;

  // dividers (faded amber lines between zones)
  for (let r = 2; r < h - 2; r++) {
    put(x2, r, "│", C.divider);
    put(x3, r, "│", C.divider);
  }

  /* ============ ZONE 1: CLOCK ============ */
  const p1 = z1w >= 44 ? 3 : 1;
  put(p1, 1, "HOMELAB · BASEMENT-01", C.tag);

  const d = new Date(now);
  const hhmm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  const colonOn = (now % 1000) < 500;
  const clockY = 3;
  // glyph layout: positions for H H : M M
  let gx = p1;
  const glyphs = [];
  for (const chr of hhmm) {
    const g = FONT[chr];
    glyphs.push({ x: gx, g, isColon: chr === ":" });
    gx += g[0].length + 1;
  }
  // chunky drop shadow first, then the bright fill on top
  for (const it of glyphs) putGlyph(it.x + 1, clockY + 1, it.g, C.clockSh);
  for (const it of glyphs) {
    putGlyph(it.x, clockY, it.g, it.isColon ? (colonOn ? C.clock : C.colonDim) : C.clock);
  }
  // seconds, small, after the big clock
  put(Math.min(gx, z1w - 3), clockY + FONT_H - 1, pad2(d.getSeconds()), C.sec);

  // date
  put(p1, clockY + FONT_H + 2, DOW[d.getDay()] + " · " + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()), C.date);

  // uptime + load
  const up = BOOT_OFFSET_MS + (now - startWall);
  let secs = Math.floor(up / 1000);
  const days = Math.floor(secs / 86400); secs -= days * 86400;
  const uh = Math.floor(secs / 3600); secs -= uh * 3600;
  const um = Math.floor(secs / 60); secs -= um * 60;
  const kvY = clockY + FONT_H + 4;
  put(p1, kvY, "UPTIME", C.kvKey);
  put(p1 + 8, kvY, days + "d " + pad2(uh) + ":" + pad2(um) + ":" + pad2(secs), C.kvVal);
  put(p1, kvY + 1, "LOAD", C.kvKey);
  put(p1 + 8, kvY + 1, load[0].toFixed(2) + " " + load[1].toFixed(2) + " " + load[2].toFixed(2), C.kvVal);

  // quip (typewriter + blinking block cursor), bottom of zone 1
  put(p1, h - 5, "~/motd $", C.quipLbl);
  const quipMax = z1w - p1 - 2;
  const qtxt = quipCur.slice(0, quipChars).slice(0, quipMax - 1);
  put(p1, h - 4, qtxt, C.quip);
  if ((now % 800) < 400) put(p1 + qtxt.length, h - 4, "█", C.cursor);

  /* ============ ZONE 2: RESOURCE MONITOR ============ */
  const p2 = x2 + 3;
  const innerW = z3w >= 0 ? (x3 - p2 - 1) : 0;
  put(p2, 1, "RESOURCES · PROXMOX NODE".slice(0, innerW), C.tag);

  const barCells = Math.max(10, Math.min(28, innerW));
  const glowN = Math.max(1, Math.round(barCells / 7)); // last ~2/14 cells glow
  const gaugeGap = h >= 34 ? 4 : 3;
  const GAUGES = [
    ["CPU", metrics.cpu.v, Math.round(metrics.cpu.v) + "%"],
    ["RAM", metrics.ram.v, Math.round(metrics.ram.v) + "%"],
    ["TEMP", metrics.temp.v, Math.round(28 + (metrics.temp.v / 100) * 57) + "°C"],
    ["DISK", metrics.disk.v, Math.round(metrics.disk.v) + "%"],
  ];
  for (let i = 0; i < GAUGES.length; i++) {
    const [name, v, label] = GAUGES[i];
    const gy = 3 + i * gaugeGap;
    put(p2, gy, name, C.resName);
    put(p2 + barCells - label.length, gy, label, C.resPct);
    const lit = Math.round((v / 100) * barCells);
    for (let cidx = 0; cidx < barCells; cidx++) {
      if (cidx < lit) {
        const edge = cidx >= lit - glowN;
        put(p2 + cidx, gy + 1, "█", edge ? C.barGlow : C.barLit);
      } else {
        put(p2 + cidx, gy + 1, "░", C.barEmpty);
      }
    }
  }

  // footnote (rotating) + service count
  put(p2, h - 5, "─".repeat(Math.max(0, innerW)), C.footRule);
  const foot = FOOTNOTES[footIdx];
  put(p2, h - 4, foot.slice(0, innerW), C.footDim);
  const svcTxt = " · svc ", svcVal = svcUpCount + "/" + svcTotal, svcTail = " up";
  let fx = p2 + Math.min(foot.length, innerW);
  if (fx + svcTxt.length + svcVal.length + svcTail.length <= p2 + innerW) {
    put(fx, h - 4, svcTxt, C.footDim); fx += svcTxt.length;
    put(fx, h - 4, svcVal, C.footHi); fx += svcVal.length;
    put(fx, h - 4, svcTail, C.footDim);
  }

  /* ============ ZONE 3: SERVER TOWER + HEART + NET ============ */
  const p3 = x3 + 2;
  put(p3, 1, "RACK · NODE-01", C.tag);
  // status pill (inverse video)
  const pillTxt = svcUpCount < svcTotal ? " DEGRADED " : " ONLINE ";
  const pillBg = svcUpCount < svcTotal ? C.pillWarn : C.pillOk;
  put(w - 1 - pillTxt.length, 1, pillTxt, C.pillFg, pillBg);

  // tower — half-block pixel art, 2x vertical resolution
  const towerCols = Math.max(11, Math.min(24, z3w - 27));
  const towerRows = Math.max(14, Math.min(29, h - 11));
  const towerPix = drawTower(towerCols, towerRows * 2);
  blitPixels(p3, 3, towerPix, towerCols, towerRows * 2);

  // right column: heart + label + net stats
  const rx = p3 + towerCols + 2;
  const rightW = w - rx - 1;
  if (rightW >= HEART_W) {
    const beatPeriod = 60000 / bpm;
    const pulse = cardiac((now % beatPeriod) / beatPeriod);
    const heartPix = drawHeart(pulse);
    blitPixels(rx, 3, heartPix, HEART_W, HEART_PH);
    const lbl = "SYS · " + bpm + " BPM";
    put(rx, 3 + (HEART_PH >> 1) + 1, (rightW >= lbl.length ? lbl : "♥ " + bpm).slice(0, rightW), C.heartLbl);

    const netY = 3 + (HEART_PH >> 1) + 3;
    const compact = rightW < 18;
    const lines = compact
      ? [["▼", net.down.toFixed(1) + "M", ""],
         ["▲", net.up.toFixed(1) + "M", ""],
         ["#", groupDigits(packets).slice(-9), ""]]
      : [["NET▼", net.down.toFixed(1).padStart(5), " MB/s"],
         ["NET▲", net.up.toFixed(1).padStart(5), " MB/s"],
         ["PKTS", " " + groupDigits(packets), ""]];
    for (let i = 0; i < 3; i++) {
      const y = netY + i * 2;
      const [k, v, u] = lines[i];
      put(rx, y, k, C.kvKey);
      put(rx + k.length + 1, y, v.slice(0, Math.max(0, rightW - k.length - 1)), C.netVal);
      if (u) put(rx + k.length + 1 + v.length, y, u.slice(0, Math.max(0, rightW - k.length - 1 - v.length)), C.netUnit);
    }
  }

  return serialize();
}

/* ================================================================
 * Animation timers (HTML cadences) driven off Date.now() deltas.
 * ================================================================ */
let last = Date.now();
let accDrift = 0, accQuip = 0, accFoot = 0, accSvc = 0;

function advance(now) {
  let dt = now - last;
  if (dt > 250) dt = 250; // clamp after suspend, like the HTML
  if (dt < 0) dt = 0;
  last = now;
  const dtSec = dt / 1000;

  accDrift += dt;
  if (accDrift >= 1100) { accDrift = 0; driftMetrics(); }

  accumulatePackets(dtSec);

  // quip typewriter (type 62ms/char, hold 2600ms, delete 32ms/char)
  if (quipPhase === "holding") {
    quipHold += dt;
    if (quipHold > 2600) quipPhase = "deleting";
  } else {
    accQuip += dt;
    const step = quipPhase === "deleting" ? 32 : 62;
    while (accQuip >= step && quipPhase !== "holding") {
      accQuip -= step;
      stepQuip();
    }
    if (accQuip > 1000) accQuip = 0;
  }

  accFoot += dt;
  if (accFoot >= 3400) { accFoot = 0; footIdx = (footIdx + 1) % FOOTNOTES.length; }

  accSvc += dt;
  if (accSvc >= 5000) {
    accSvc = 0;
    svcUpCount = Math.random() < 0.18 ? svcTotal - 1 : svcTotal;
  }

  powerPulse = 0.5 + 0.5 * Math.sin(now * 0.0021);
  tickServerLeds(); // each frame ≈ the HTML's 142ms server interval
}

/* ================================================================
 * Main — TTY handling, render loop, clean exit.
 * ================================================================ */
const outTTY = !!process.stdout.isTTY;
function dims() {
  if (!outTTY) {
    return [parseInt(process.env.COLUMNS, 10) || 160, parseInt(process.env.LINES, 10) || 40];
  }
  return [process.stdout.columns || 160, process.stdout.rows || 40];
}

// prime state once so the first frame is alive (mirrors the HTML)
driftMetrics();
footIdx = 1;          // updateFootnote() was called once on boot
svcUpCount = Math.random() < 0.18 ? svcTotal - 1 : svcTotal;

if (ONCE) {
  const [w, h] = dims();
  const frame = composeFrame(w, h, Date.now());
  process.stdout.write(frame + "\x1b[0m\n");
  process.exit(0);
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  clearInterval(timer);
  let tail = "\x1b[0m";
  if (outTTY) tail += "\x1b[?25h\x1b[?1049l";
  process.stdout.write(tail);
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch (e) { /* ignore */ }
  }
}
function quit() { cleanup(); process.exit(0); }

if (outTTY) process.stdout.write("\x1b[?1049h\x1b[?25l");

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const k = buf.toString("utf8");
    if (k === "q" || k === "Q" || k === "\x03") quit();
  });
}
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
process.on("exit", cleanup);
process.stdout.on("resize", () => { /* dims() is re-read every frame */ });
process.stdout.on("error", (e) => { if (e && e.code === "EPIPE") quit(); });

const FRAME_MS = 142; // ~7 fps, retro feel
const timer = setInterval(() => {
  const now = Date.now();
  advance(now);
  const [w, h] = dims();
  process.stdout.write("\x1b[H" + composeFrame(w, h, now));
}, FRAME_MS);
