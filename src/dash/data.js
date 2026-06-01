/*
 * dash/data.js — the homelab state store + a simulator that keeps it lively.
 * This is the ONE source of truth the scenes read. A scripted simulator drives
 * it through a healthy -> degrade -> critical -> recover loop; later, real
 * metrics / webhooks write to this same store and every scene updates for free.
 */
window.App = window.App || {};
(function (App) {
  'use strict';

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function Ring(n, fill) { this.n = n; this.buf = []; for (var i = 0; i < n; i++) this.buf.push(fill); }
  Ring.prototype.push = function (v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); };
  Ring.prototype.last = function () { return this.buf[this.buf.length - 1]; };

  // Everything boots HEALTHY; the timeline below introduces (and heals) faults.
  var services = [
    { id: 'web', label: 'WEB', name: 'nginx',     state: 'success', cpu: 12, ram: 34 },
    { id: 'pve', label: 'PVE', name: 'proxmox',   state: 'success', cpu: 28, ram: 61 },
    { id: 'nas', label: 'NAS', name: 'truenas',   state: 'success', cpu: 8,  ram: 40 },
    { id: 'dns', label: 'DNS', name: 'pi-hole',   state: 'success', cpu: 3,  ram: 12 },
    { id: 'vpn', label: 'VPN', name: 'wireguard', state: 'info',    cpu: 5,  ram: 18 },
    { id: 'bak', label: 'BAK', name: 'restic',    state: 'success', cpu: 6,  ram: 9 },
  ];
  var byId = {}; services.forEach(function (s) { byId[s.id] = s; });

  var nodes = {
    net: { x: 24,  y: 50, label: 'NET', infra: true },
    sw:  { x: 78,  y: 50, label: 'SW',  infra: true },
    web: { x: 140, y: 24 }, pve: { x: 168, y: 66 }, nas: { x: 214, y: 26 },
    dns: { x: 252, y: 70 }, vpn: { x: 292, y: 44 }, bak: { x: 208, y: 82 },
  };
  var links = [
    ['net', 'sw'], ['sw', 'web'], ['sw', 'pve'], ['sw', 'nas'], ['sw', 'dns'], ['sw', 'vpn'],
    ['pve', 'bak'], ['nas', 'bak'],
  ];

  var metrics = {
    cpu: new Ring(48, 20), ram: new Ring(48, 45),
    net: new Ring(48, 12), temp: new Ring(48, 46),
  };

  var events = [
    { ago: 8,  state: 'success', msg: 'nginx cert renewed' },
    { ago: 34, state: 'info',    msg: 'proxmox pulled 3 images' },
    { ago: 71, state: 'success', msg: 'backup snapshot complete' },
  ];

  var store = {
    services: services, nodes: nodes, links: links, metrics: metrics, events: events,
    counts: { up: 24, down: 0, alerts: 0, jobs: 2 },
    bootMs: Date.now() - (12 * 86400 + 4 * 3600 + 33 * 60) * 1000,
    uptime: 0,
    pendingAlert: null,
  };

  // Timeline: calm -> warning -> critical(+takeover) -> recover -> calm, looping.
  var beats = [
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
  var bIdx = 0, mAcc = 0, eAcc = 0;

  function walk(v, lo, hi, step) { return clamp(v + rnd(-step, step), lo, hi); }
  function recount() {
    var down = 0, al = 0;
    for (var i = 0; i < services.length; i++) {
      var st = services[i].state;
      if (st === 'error') { down++; al++; } else if (st === 'warning') { al++; }
    }
    store.counts.down = down; store.counts.alerts = al; store.counts.up = 24 - down;
  }
  recount();

  store.tick = function (dt, nowMs) {
    mAcc += dt; eAcc += dt;
    if (mAcc >= 0.45) {
      mAcc = 0;
      metrics.cpu.push(walk(metrics.cpu.last(), 4, 95, 14));
      metrics.ram.push(walk(metrics.ram.last(), 30, 88, 6));
      metrics.net.push(clamp(Math.abs(metrics.net.last() + rnd(-10, 12)), 0, 100));
      metrics.temp.push(walk(metrics.temp.last(), 38, 74, 2));
      for (var i = 0; i < services.length; i++) {
        var s = services[i];
        if (s.state === 'error') { s.cpu = 0; continue; }
        s.cpu = Math.round(walk(s.cpu, 1, 96, 10));
        s.ram = Math.round(walk(s.ram, 5, 92, 5));
      }
    }
    if (eAcc >= 7) {
      eAcc = 0;
      var b = beats[bIdx % beats.length]; bIdx++;
      for (var j = 0; j < events.length; j++) events[j].ago += 7;
      events.unshift({ ago: 0, state: b.state, msg: b.msg });
      if (events.length > 12) events.pop();
      if (b.set) {
        for (var id in b.set) {
          var sv = byId[id];
          if (sv) { sv.state = b.set[id].state; if ('note' in b.set[id]) sv.note = b.set[id].note; }
        }
      }
      if (b.critical) store.pendingAlert = { state: 'error', msg: b.msg };
      recount();
    }
    store.uptime = Date.now() - store.bootMs; // wall-clock; nowMs is RAF (page-relative)
  };

  store.fmtUptime = function () {
    var s = Math.floor((store.uptime || 0) / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d + 'd ' + p(h) + ':' + p(m);
  };
  store.worstState = function () {
    var order = { error: 4, warning: 3, info: 1, success: 1, idle: 0 };
    var worst = 'success', wv = 1;
    for (var i = 0; i < services.length; i++) {
      var v = order[services[i].state] || 0;
      if (v > wv) { wv = v; worst = services[i].state; }
    }
    return worst;
  };
  // Healthy hero shows the brand clay (idle); degraded shows the fault colour.
  store.heroState = function () {
    var w = store.worstState();
    return (w === 'success' || w === 'info') ? 'idle' : w;
  };
  store.statusWord = function () {
    var w = store.worstState();
    return w === 'error' ? 'CRITICAL' : w === 'warning' ? 'DEGRADED' : 'OPERATIONAL';
  };

  App.data = store;
})(window.App);
