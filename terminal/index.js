#!/usr/bin/env node
/*
 * terminal/index.js — the picker. Terminal counterpart of views/index.html.
 * Lists the six terminal views; ↑/↓ or 1-6 select, Enter launches, q quits.
 * When a view exits (q inside it), you land back on this menu.
 *
 *   node terminal/index.js
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ESC = '\x1b';
const fg = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
};
const RESET = `${ESC}[0m`;
const DIM = fg('#8b897f');
const INK = fg('#e7e5dd');
const CLAY = fg('#d97757');

const VIEWS = [
  { file: 'agents.js',      accent: '#5dff8b', name: 'Agents on Duty',
    tag: 'Green-phosphor CRT aisle — ATLAS / ARGUS / VESTA stand watch, HERMES runs packets.' },
  { file: 'datacenter.js',  accent: '#5dff8b', name: 'Datacenter Floor',
    tag: 'Top-down floor patrol — five agents route between seven colored sectors.' },
  { file: 'terminal.js',    accent: '#5dff8b', name: 'CRT Terminal',
    tag: 'Scrolling syslog, ASCII vitals bars, big block clock + service states, marquee ticker.' },
  { file: 'pixel-amber.js', accent: '#ffb454', name: 'Pixel / Amber',
    tag: '8-bit amber — chunky clock, sysadmin quips, and a pixel server tower with a beating heart.' },
  { file: 'tui.js',         accent: '#46d6ff', name: 'Hacker TUI',
    tag: 'btop-style monitor — per-core bars, CPU graph, mem/disk gauges, net graph, process table.' },
  { file: 'dashboard.js',   accent: '#d97757', name: 'Mission Control',
    tag: 'The spark dashboard — health hero, service tiles, sparklines, topology scene on rotation.' },
];

let sel = 0;
let blinkOn = true;
let blinkTimer = null;

function rows() { return process.stdout.rows || 40; }
function cols() { return process.stdout.columns || 100; }

function draw() {
  const w = cols();
  const center = (s, vis) => ' '.repeat(Math.max(0, Math.floor((w - vis) / 2))) + s;
  const out = [`${ESC}[H${ESC}[2J`];

  const title = 'homelab // displays';
  out.push('', center(`${INK}${title}${blinkOn ? CLAY + '_' : ' '}${RESET}`, title.length + 1));
  const sub = 'six looks for the rack strip — pick one for this terminal';
  out.push(center(`${DIM}${sub}${RESET}`, sub.length), '');

  VIEWS.forEach((v, i) => {
    const cur = i === sel;
    const acc = fg(v.accent);
    const marker = cur ? `${acc}▸ ` : '  ';
    const num = `${DIM}${i + 1}.${RESET} `;
    const name = cur ? `${acc}${v.name}${RESET}` : `${INK}${v.name}${RESET}`;
    out.push(`   ${marker}${num}${name}`);
    out.push(`        ${DIM}${v.tag}${RESET}`);
    out.push('');
  });

  const help = '↑/↓ move · 1-6 jump · Enter open · q quit';
  out.push(center(`${DIM}${help}${RESET}`, help.length));
  process.stdout.write(out.join('\n'));
}

function enterMenu() {
  process.stdout.write(`${ESC}[?1049h${ESC}[?25l`);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  draw();
  blinkTimer = setInterval(() => { blinkOn = !blinkOn; draw(); }, 550);
}

function leaveMenu() {
  clearInterval(blinkTimer);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write(`${ESC}[?1049l${ESC}[?25h${RESET}`);
}

function quit() {
  leaveMenu();
  process.exit(0);
}

function launch(view) {
  leaveMenu();
  const child = spawn(process.execPath, [path.join(__dirname, view.file)], { stdio: 'inherit' });
  child.on('exit', () => enterMenu());
}

process.stdin.on('data', (buf) => {
  const k = buf.toString();
  if (k === 'q' || k === 'Q' || k === '\x03') return quit();
  if (k === '\x1b[A') sel = (sel + VIEWS.length - 1) % VIEWS.length;       // up
  else if (k === '\x1b[B') sel = (sel + 1) % VIEWS.length;                 // down
  else if (k >= '1' && k <= String(VIEWS.length)) sel = k.charCodeAt(0) - 49;
  else if (k === '\r' || k === '\n') return launch(VIEWS[sel]);
  draw();
});

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.stdout.on('resize', draw);

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.log('homelab terminal views — run in an interactive terminal, or run a view directly:');
  VIEWS.forEach((v) => console.log(`  node terminal/${v.file.padEnd(16)} ${v.name}`));
  process.exit(0);
}
enterMenu();
