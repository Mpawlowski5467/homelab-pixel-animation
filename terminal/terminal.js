#!/usr/bin/env node
/*
 * terminal.js — CRT green-phosphor terminal view of "homelab // node-01".
 * Faithful ANSI/truecolor port of views/terminal.html:
 * header, scrolling SYSTEM LOG, VITALS bars, STATUS (big clock / uptime /
 * services) and a seamless scrolling ticker. Zero dependencies, Node >= 18.
 *
 *   run:        node terminal/terminal.js        (q / Q / Ctrl-C quits)
 *   one frame:  node terminal/terminal.js --once
 */

'use strict';

const ESC = '\x1b';

/* ---------------- palette (from the HTML :root) ---------------- */
const PAL = {
  p:      [93, 255, 139],   // phosphor green
  pb:     [170, 255, 196],  // bright phosphor highlight
  pd:     [42, 143, 79],    // dim phosphor (empties)
  pdd:    [20, 80, 43],     // very dim (rules / ghost)
  amber:  [255, 178, 74],   // WARN amber
  amberd: [122, 79, 24],    // dim amber (warn pulse)
  bg:     [2, 8, 3],        // near-black green-tinted
};
const BG = `${ESC}[48;2;${PAL.bg[0]};${PAL.bg[1]};${PAL.bg[2]}m`;

/* ---------------- helpers ---------------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const S = (t, c) => ({ t, c });                       // colored segment
const vlen = (segs) => segs.reduce((a, s) => a + s.t.length, 0);

/* ================================================================
 * SYSTEM LOG — pools + expanders (verbatim from the HTML)
 * ================================================================ */
const INFO = [
  ['systemd',  'Started Session c$N of user root.'],
  ['systemd',  'Reached target Multi-User System.'],
  ['systemd',  'docker.service: Deactivated successfully.'],
  ['systemd',  'Starting Daily apt download activities...'],
  ['systemd',  'Finished Rotate log files.'],
  ['docker',   'container start a3f$Hnginx-proxy (image=nginx:1.27)'],
  ['docker',   'container health_status: healthy  jellyfin'],
  ['docker',   'pulled layer sha256:$H done (mediacenter)'],
  ['docker',   'network bridge homelab_default reattached'],
  ['kernel',   'EXT4-fs (sda2): mounted filesystem with ordered data mode.'],
  ['kernel',   'tcp: lan0 link up, 1000 Mbps full duplex'],
  ['kernel',   'usb 1-1.3: new high-speed USB device number $N'],
  ['kernel',   'thermal thermal_zone0: trip point 0 below 60C'],
  ['sshd',     'Accepted publickey for root from 10.0.0.5 port $P'],
  ['sshd',     'Connection closed by 10.0.0.5 port $P [preauth]'],
  ['sshd',     'pam_unix(sshd:session): session opened for root'],
  ['zfs',      'scrub repaired 0B in 00:41:1$N with 0 errors on tank'],
  ['zfs',      'pool tank: vdev mirror-0 ONLINE, 0 errors'],
  ['zfs',      'snapshot tank/data@auto-$N created'],
  ['smartd',   'Device: /dev/sda, SMART Usage Attribute 194 Temp: 38'],
  ['smartd',   'Device: /dev/sdb, self-test completed without error'],
  ['nginx',    '10.0.0.5 "GET /grafana HTTP/2" 200 1042 "-"'],
  ['nginx',    '10.0.0.7 "GET /jellyfin/web HTTP/2" 304 0 "-"'],
  ['nginx',    'reload: configuration reloaded successfully'],
  ['certbot',  'Certificate not yet due for renewal (home.lan)'],
  ['certbot',  'Renewing cert for cloud.home.lan -> OK (89d left)'],
  ['proxmox',  'VM 101 (truenas) status: running  cpu 4.1%'],
  ['proxmox',  'backup job vzdump 110 finished, size 8.4G'],
  ['pi-hole',  'gravity: 142,318 domains on blocklist'],
  ['pi-hole',  'query A jellyfin.home.lan -> 10.0.0.12 (cache)'],
  ['wireguard', 'peer phone-7 handshake ok, rx 1.2M tx 480K'],
  ['restic',   'snapshot $H saved, 312 files new, 1.1 GiB'],
  ['restic',   'repository check: no errors were found'],
];
const WARN = [
  ['smartd',   'Device: /dev/sdb, 1 Currently unreadable sectors'],
  ['kernel',   'thermal thermal_zone0: trip point 0 crossed 72C'],
  ['nginx',    '10.0.0.9 "GET /admin HTTP/1.1" 403 162 "-"'],
  ['sshd',     'Failed password for invalid user admin from 45.$N.$N.7'],
  ['docker',   'container jellyfin unhealthy (exit code 137)'],
  ['zfs',      'pool tank: read errors detected on sdb, retrying'],
  ['systemd',  'restic-backup.service: high memory pressure'],
  ['certbot',  'renewal for vpn.home.lan deferred, ACME rate-limited'],
  ['wireguard', 'peer laptop-2 handshake timeout, retrying'],
];

function expand(s) {
  return s
    .replace(/\$N/g, () => String((Math.random() * 9 | 0) + 1))
    .replace(/\$P/g, () => String(40000 + (Math.random() * 25000 | 0)))
    .replace(/\$H/g, () => Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, '0'));
}

const LOG_CAP = 120;                       // bounded memory forever
const logLines = [];
function addLog(d) {
  const warn = Math.random() < 0.16;       // ~1 in 6 lines is amber WARN
  const e = warn ? pick(WARN) : pick(INFO);
  logLines.push({
    ts: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()),
    warn, src: e[0], msg: expand(e[1]),
  });
  while (logLines.length > LOG_CAP) logLines.shift();
}

/* ================================================================
 * VITALS — bounded random walk (same params as the HTML)
 * ================================================================ */
const VITALS = [
  { key: 'CPU',  val: 34, unit: '%',  min: 6,  max: 96, step: 7,  hot: 88 },
  { key: 'MEM',  val: 58, unit: '%',  min: 22, max: 94, step: 4,  hot: 90 },
  { key: 'TEMP', val: 46, unit: '°C', min: 33, max: 78, step: 3,  hot: 70, disp: true },
  { key: 'DISK', val: 71, unit: '%',  min: 60, max: 93, step: 2,  hot: 90 },
  { key: 'NET',  val: 21, unit: '%',  min: 1,  max: 99, step: 14, hot: 200 }, // net never "hot"
];
let loadAvg = '0.42';
let netRx = 0, netTx = 0, procs = 118;

function deriveVitals() {
  const net = VITALS[4].val;
  netRx = net * 1.9 + rnd(-3, 3);
  netTx = net * 0.7 + rnd(-2, 2);
  procs = 118 + (Math.random() * 9 | 0);
  loadAvg = (VITALS[0].val / 100 * 3.2 + 0.15).toFixed(2);
}
function driftVitals() {
  for (const v of VITALS) v.val = clamp(v.val + rnd(-v.step, v.step), v.min, v.max);
  deriveVitals();
}

/* ================================================================
 * STATUS — services / uptime / date
 * ================================================================ */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// boot 19d 7h 42m 11s ago so the uptime reads believably; counts up live.
const bootMs = Date.now() - (19 * 86400000 + 7 * 3600000 + 42 * 60000 + 11000);

const services = [
  'nginx', 'proxmox', 'truenas', 'pi-hole', 'wireguard',
  'jellyfin', 'docker', 'restic', 'certbot', 'smartd', 'zfs', 'sshd',
].map((name) => ({ name, warn: false }));

function flipServices() {
  let warnCount = services.filter((r) => r.warn).length;
  for (const r of services) {
    if (r.warn) {
      if (Math.random() < 0.40) r.warn = false;        // 40% chance to recover
    } else if (warnCount < 2 && Math.random() < 0.05) {
      r.warn = true; warnCount++;
    }
  }
}

/* ---------------- block-digit fonts (hand-rolled) ---------------- */
const FONT5 = {
  '0': ['████', '█  █', '█  █', '█  █', '████'],
  '1': [' ██ ', '  █ ', '  █ ', '  █ ', ' ███'],
  '2': ['████', '   █', '████', '█   ', '████'],
  '3': ['████', '   █', ' ███', '   █', '████'],
  '4': ['█  █', '█  █', '████', '   █', '   █'],
  '5': ['████', '█   ', '████', '   █', '████'],
  '6': ['████', '█   ', '████', '█  █', '████'],
  '7': ['████', '   █', '  █ ', '  █ ', '  █ '],
  '8': ['████', '█  █', '████', '█  █', '████'],
  '9': ['████', '█  █', '████', '   █', '████'],
  ':': [' ', '█', ' ', '█', ' '],
};
const FONT3 = {
  '0': ['█▀█', '█ █', '█▄█'],
  '1': [' █ ', ' █ ', ' █ '],
  '2': ['▀▀█', '█▀▀', '█▄▄'],
  '3': ['▀▀█', ' ▀█', '▄▄█'],
  '4': ['█ █', '▀▀█', '  █'],
  '5': ['█▀▀', '▀▀█', '▄▄█'],
  '6': ['█▀▀', '█▀█', '█▄█'],
  '7': ['▀▀█', '  █', '  █'],
  '8': ['█▀█', '█▀█', '█▄█'],
  '9': ['█▀█', '▀▀█', '▄▄█'],
  ':': ['█', ' ', '█'],
};
function glyphRows(str, font, h) {
  const rows = new Array(h).fill('');
  for (let i = 0; i < str.length; i++) {
    const g = font[str[i]] || font[':'];
    for (let r = 0; r < h; r++) rows[r] += (i ? ' ' : '') + g[r];
  }
  return rows;
}

/* ================================================================
 * TICKER — same 8 messages, seamless wrap
 * ================================================================ */
const TICK_MSGS = [
  'ALL SYSTEMS NOMINAL',
  'NODE-01 // RPi5 8GB // aarch64 // kernel 6.8.0-rpi',
  'ZFS POOL "tank" 14.6T MIRROR — HEALTHY — LAST SCRUB 41m',
  'NEXT BACKUP 02:00 (restic -> backblaze b2)',
  'CERTS OK — cloud.home.lan 89d — vpn.home.lan 61d',
  'DOCKER 11 CONTAINERS UP // JELLYFIN 2 STREAMS',
  'UPTIME 19d // 0 UNPLANNED REBOOTS THIS QUARTER',
  'PI-HOLE BLOCKING 142,318 DOMAINS // 7.4% QUERIES BLOCKED',
];
const tickChars = [];                       // one copy: [char, colorKey]
for (const m of TICK_MSGS) {
  tickChars.push(['▸', 'p'], [' ', 'p']);
  for (const ch of m) tickChars.push([ch, 'pb']);
  for (const ch of ' :: ') tickChars.push([ch, 'pd']);
}
const TICK_CPS = 7.5;                       // chars/sec ≈ 58 px/s in the HTML
const t0 = Date.now();

function buildTickerRow(w, now) {
  const len = tickChars.length;
  const off = Math.floor((now - t0) / 1000 * TICK_CPS) % len;
  const segs = [];
  let cur = null;
  for (let i = 0; i < w; i++) {
    const [ch, c] = tickChars[(off + i) % len];
    if (cur && cur.c === c) cur.t += ch;
    else { cur = { t: ch, c }; segs.push(cur); }
  }
  return segs;
}

/* ================================================================
 * COLUMN BUILDERS — each returns exactly n seg-rows of width <= w
 * ================================================================ */
function fitRows(rows, n) {
  while (rows.length > n) rows.pop();
  while (rows.length < n) rows.push([]);
  return rows;
}
function withTitle(title, w, content, n) {
  const rows = [
    [S('# ', 'pd'), S(title, 'pb')],
    [S('┄'.repeat(w), 'pdd')],
    ...content,
  ];
  return fitRows(rows, n);
}

function buildLogCol(w, n) {
  const body = n - 2;
  const lines = logLines.slice(-body);
  const out = [];
  for (let i = 0; i < body - lines.length; i++) out.push([]);   // pinned to bottom
  for (const l of lines) {
    out.push(l.warn
      ? [S(l.ts, 'pd'), S(' WARN ', 'amber'), S(l.src + ': ', 'amber'), S(l.msg, 'amber')]
      : [S(l.ts, 'pd'), S(' info ', 'pd'), S(l.src + ': ', 'pb'), S(l.msg, 'p')]);
  }
  return withTitle('SYSTEM LOG', w, out, n);
}

function buildVitCol(w, n) {
  const body = n - 2;
  const gap = body >= 14 ? 1 : 0;
  const barW = Math.max(6, Math.min(12, w - 12));
  const out = [];
  for (let i = 0; i < VITALS.length; i++) {
    const v = VITALS[i];
    const pct = v.disp ? clamp((v.val - 30) / (85 - 30) * 100, 0, 100) : v.val;
    const filled = clamp(Math.round(pct / 100 * barW), 0, barW);
    const hot = v.val >= v.hot;
    out.push([
      S(v.key.padEnd(5), 'pb'),
      S('[', 'p'),
      S('█'.repeat(filled), hot ? 'amber' : 'p'),
      S('░'.repeat(barW - filled), 'pd'),
      S(']', 'p'),
      S(' ' + (v.disp ? v.val.toFixed(0) : String(Math.round(v.val))), hot ? 'amber' : 'pb'),
      S(v.unit, 'pd'),
    ]);
    if (gap && i < VITALS.length - 1) out.push([]);
  }
  // mini readout (net rx/tx, tank, procs) under a dotted rule
  if (out.length + 3 + gap <= body) {
    if (gap) out.push([]);
    out.push([S('┄'.repeat(w), 'pdd')]);
    const rx = netRx.toFixed(1), tx = Math.max(0, netTx).toFixed(1);
    if (w >= 38) {
      out.push([S('net0  rx ', 'pd'), S(rx, 'p'), S(' mbit/s  tx ', 'pd'), S(tx, 'p'), S(' mbit/s', 'pd')]);
    } else {
      out.push([S('net0 rx ', 'pd'), S(rx, 'p'), S(' tx ', 'pd'), S(tx, 'p'), S(' mb/s', 'pd')]);
    }
    out.push([S('tank ', 'pd'), S(VITALS[3].val.toFixed(0) + '%', 'p'),
              S(' of 14.6T · procs ', 'pd'), S(String(procs), 'p')]);
  }
  return withTitle('VITALS', w, out, n);
}

function buildClockRows(now, w, compact) {
  const hm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  const ss = ':' + pad2(now.getSeconds());
  if (compact) {                                   // 3-row font, seconds dimmer
    const a = glyphRows(hm, FONT3, 3), b = glyphRows(ss, FONT3, 3);
    if (a[0].length + 1 + b[0].length > w) {       // ultra-narrow: plain text
      return [[S(hm, 'pb'), S(ss, 'p')]];
    }
    return a.map((r, i) => [S(r, 'pb'), S(' ', 'p'), S(b[i], 'p')]);
  }
  // 5-row HH:MM, 3-row :SS bottom-aligned (mimics the big/small HTML clock)
  const a = glyphRows(hm, FONT5, 5), b = glyphRows(ss, FONT3, 3);
  return a.map((r, i) => [
    S(r, 'pb'), S(' ', 'p'),
    i >= 2 ? S(b[i - 2], 'p') : S(' '.repeat(b[0].length), 'p'),
  ]);
}

function buildStatCol(w, n, now, nowMs) {
  const body = n - 2;
  const compact = body < 21 || w < 32;
  const clock = buildClockRows(now, w, compact);
  const roomy = body >= clock.length + 17 + 2;
  const out = [...clock];
  if (roomy) out.push([]);
  // dateline:  Tue 10 Jun 2026   (day-of-month bright)
  out.push([S(DOW[now.getDay()] + ' ', 'pd'), S(pad2(now.getDate()), 'p'),
            S(' ' + MON[now.getMonth()] + ' ' + now.getFullYear(), 'pd')]);
  // uptime
  let up = Math.floor((nowMs - bootMs) / 1000);
  const d = Math.floor(up / 86400); up -= d * 86400;
  const h = Math.floor(up / 3600); up -= h * 3600;
  const m = Math.floor(up / 60); const s = up - m * 60;
  out.push([S('UPTIME ', 'pd'), S(d + 'd ' + pad2(h) + ':' + pad2(m) + ':' + pad2(s), 'pb')]);
  if (roomy) out.push([]);
  // services header + list with dot leaders
  out.push([S('SERVICES ', 'pd'), S('┄'.repeat(Math.max(0, w - 9)), 'pdd')]);
  const warnOn = (nowMs % 1100) < 550;             // warnpulse 1.1s steps(2)
  for (const r of services) {
    const dots = Math.max(1, w - r.name.length - 6 - 2);
    out.push([
      S(r.name, 'p'),
      S(' ' + '·'.repeat(dots) + ' ', 'pdd'),
      r.warn ? S('[WARN]', warnOn ? 'amber' : 'amberd') : S('[ OK ]', 'p'),
    ]);
  }
  return withTitle('STATUS', w, out, n);
}

/* ================================================================
 * FRAME COMPOSITION
 * ================================================================ */
function fitSegs(segs, w) {
  const out = [];
  let len = 0;
  for (const sg of segs) {
    if (len >= w) break;
    const take = Math.min(sg.t.length, w - len);
    out.push(take === sg.t.length ? sg : S(sg.t.slice(0, take), sg.c));
    len += take;
  }
  if (len < w) out.push(S(' '.repeat(w - len), 'p'));
  return out;
}
function rowLR(left, right, w) {
  const pad = w - vlen(left) - vlen(right);
  return pad >= 0
    ? [...left, S(' '.repeat(pad), 'pd'), ...right]
    : [...left, S(' ', 'pd'), ...right];             // fitSegs truncates
}

function buildFrame(nowMs, W, H) {
  const now = new Date(nowMs);
  const lines = [];

  // ---------- header ----------
  const cur = (nowMs % 1060) < 530 ? '_' : ' ';      // blink 1.06s steps(1)
  const left = [S('homelab // node-01 ', 'pb'), S(cur, 'pb')];
  const right = [
    S('eth0 ', 'pd'), S('10.0.0.12', 'p'), S(' · ', 'pdd'),
    S('kernel ', 'pd'), S('6.8.0-rpi', 'p'), S(' · ', 'pdd'),
    S('aarch64', 'pd'), S(' · ', 'pdd'),
    S('load ', 'pd'), S(loadAvg, 'p'),
  ];
  lines.push(rowLR(left, right, W));
  lines.push([S('─'.repeat(W), 'pdd')]);

  // ---------- columns ----------
  const B = H - 4;
  const SEP = [S(' ', 'p'), S('│', 'pdd'), S(' ', 'p')];
  let colDefs;
  if (W < 100) {                                     // narrow: drop VITALS
    const usable = W - 3;
    const logW = Math.round(usable * 1.55 / 2.73);
    const statW = usable - logW;
    colDefs = [[buildLogCol(logW, B), logW], [buildStatCol(statW, B, now, nowMs), statW]];
  } else {
    const usable = W - 6;
    const logW = Math.round(usable * 1.55 / 3.78);   // HTML grid 1.55fr/1.05fr/1.18fr
    const vitW = Math.round(usable * 1.05 / 3.78);
    const statW = usable - logW - vitW;
    colDefs = [
      [buildLogCol(logW, B), logW],
      [buildVitCol(vitW, B), vitW],
      [buildStatCol(statW, B, now, nowMs), statW],
    ];
  }
  for (let r = 0; r < B; r++) {
    let row = [];
    colDefs.forEach(([col, cw], i) => {
      if (i) row = row.concat(SEP);
      row = row.concat(fitSegs(col[r], cw));
    });
    lines.push(row);
  }

  // ---------- ticker ----------
  lines.push([S('─'.repeat(W), 'pdd')]);
  lines.push(buildTickerRow(W, nowMs));
  return lines;
}

function buildSmallMsg(W, H) {
  const msg = 'resize terminal to ≥ 80×24';
  const lines = [];
  for (let r = 0; r < H; r++) {
    if (r === (H >> 1)) {
      const pad = Math.max(0, (W - msg.length) >> 1);
      lines.push([S(' '.repeat(pad), 'p'), S(msg, 'pb')]);
    } else lines.push([]);
  }
  return lines;
}

/* ================================================================
 * ANSI RENDERING
 * ================================================================ */
function fgc(c, f) {
  let [r, g, b] = PAL[c];
  if (f !== 1) {
    r = clamp(Math.round(r * f), 0, 255);
    g = clamp(Math.round(g * f), 0, 255);
    b = clamp(Math.round(b * f), 0, 255);
  }
  return `${ESC}[38;2;${r};${g};${b}m`;
}
function renderLine(segs, w, f) {
  let s = BG;
  let last = null;
  for (const sg of fitSegs(segs, w)) {
    if (sg.c !== last) { s += fgc(sg.c, f); last = sg.c; }
    s += sg.t;
  }
  return s;
}

/* ================================================================
 * MAIN
 * ================================================================ */
const ONCE = process.argv.includes('--once');
const outTTY = process.stdout.isTTY === true;
let W = 160, H = 40;
function measure() {
  if (outTTY) {
    W = process.stdout.columns || 160;
    H = process.stdout.rows || 40;
  } else { W = 160; H = 40; }
}

// seed 14 log lines so the column doesn't start empty (same as HTML)
(function seed() {
  const base = Date.now();
  for (let i = 0; i < 14; i++) addLog(new Date(base - (14 - i) * 1700));
})();
deriveVitals();

// subtle CRT feel: a single random line occasionally shifts brightness a touch
let glitchRow = -1, glitchF = 1, glitchUntil = 0;

function composeFrame(nowMs, eol) {
  const lines = (W < 80 || H < 24) ? buildSmallMsg(W, H) : buildFrame(nowMs, W, H);
  if (nowMs > glitchUntil && Math.random() < 0.04) {
    glitchRow = (Math.random() * lines.length) | 0;
    glitchF = rnd(0.8, 1.12);
    glitchUntil = nowMs + rnd(150, 600);
  }
  const live = nowMs <= glitchUntil;
  return lines
    .map((l, i) => renderLine(l, W, (live && i === glitchRow) ? glitchF : 1))
    .join(eol);
}

if (ONCE) {
  measure();
  process.stdout.write(composeFrame(Date.now(), '\n') + ESC + '[0m\n');
  process.exit(0);
}

let rawMode = false;
let quitting = false;
function quit() {
  if (quitting) return;
  quitting = true;
  try { if (rawMode) process.stdin.setRawMode(false); } catch (e) { /* noop */ }
  let s = ESC + '[0m';
  if (outTTY) s += ESC + '[?7h' + ESC + '[?1049l' + ESC + '[?25h';
  process.stdout.write(s);
  process.exit(0);
}

if (outTTY) {
  // alt screen, hide cursor, disable autowrap; one-time clear paints nothing yet
  process.stdout.write(ESC + '[?1049h' + ESC + '[?25l' + ESC + '[?7l');
}
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  rawMode = true;
  process.stdin.resume();
  process.stdin.on('data', (d) => {
    const k = d.toString();
    if (k === 'q' || k === 'Q' || k === '\x03') quit();
  });
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.stdout.on('resize', measure);
measure();

// sub-animation timers (same cadences as the HTML rAF loop)
let tLog = Date.now(), tVit = Date.now(), tSvc = Date.now();
const I_LOG = 1700, I_VIT = 900, I_SVC = 4200;

const EOL = rawMode ? '\r\n' : '\n';        // raw mode may disable ONLCR
function tick() {
  const now = Date.now();
  if (now - tVit >= I_VIT) { tVit = now; driftVitals(); }
  if (now - tLog >= I_LOG) { tLog = now; addLog(new Date(now)); }
  if (now - tSvc >= I_SVC) { tSvc = now; flipServices(); }
  process.stdout.write(ESC + '[H' + composeFrame(now, EOL));
}
tick();
setInterval(tick, 100);                     // ~10 fps
