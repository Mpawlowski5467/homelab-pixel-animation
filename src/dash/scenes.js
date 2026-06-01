/*
 * dash/scenes.js — the two rotating views. Each draws a full 320x100 frame
 * (minus the persistent clock/ticker overlays, which main.js adds on top).
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette, T = App.text, W = App.widgets, C = App.config, D = App.data;

  function bg(ctx, BW, BH) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = P.rgbStr(P.hexToRgb(C.PALETTES.background));
    ctx.fillRect(0, 0, BW, BH);
  }
  function mid(state) { return P.hexToRgb(C.PALETTES[state].mid); }
  var SLATE = { r: 176, g: 174, b: 165 };

  // ---------------- MISSION CONTROL ----------------
  function missionControl(ctx, t, BW, BH) {
    bg(ctx, BW, BH);

    // column dividers (subtle)
    ctx.fillStyle = 'rgba(60,60,56,0.5)';
    ctx.fillRect(92, 14, 1, 74);
    ctx.fillRect(212, 14, 1, 74);

    // Left: aggregate health hero + stats
    W.miniSpark(ctx, 44, 31, D.heroState(), t, { longLen: 20, shortLen: 11, thickness: 1.8, coreRadius: 4.3 });
    T.text(ctx, 'HOMELAB', 44, 50, P.rgbStr(mid('idle')), 7, 'center');
    var worst = D.worstState();
    var swCol = worst === 'error' ? mid('error') : worst === 'warning' ? mid('warning') : mid('success');
    T.text(ctx, D.statusWord(), 44, 60, P.rgbStr(swCol), 6, 'center');
    T.text(ctx, 'UP ' + D.fmtUptime(), 44, 69, P.rgbStr(SLATE), 4, 'center');
    var cu = D.counts;
    T.text(ctx, cu.up + 'UP ' + cu.down + 'DN ' + cu.alerts + '!', 44, 76, P.rgbStr(SLATE), 4, 'center');

    // Center: 3x2 service tiles
    var cols = [110, 152, 194], rows = [30, 62];
    for (var i = 0; i < D.services.length; i++) {
      var s = D.services[i];
      var x = cols[i % 3], y = rows[(i / 3) | 0];
      W.miniSpark(ctx, x, y, s.state, t, { longLen: 9, shortLen: 5, thickness: 1.0, coreRadius: 2 });
      T.text(ctx, s.label, x, y + 9, P.rgbStr(mid(s.state)), 5, 'center');
      T.text(ctx, s.note ? s.note : (s.cpu + '%'), x, y + 15, P.rgba(mid(s.state), 0.72), 4, 'center');
    }

    // Right: live metric sparklines
    var rx = 220, rw = 92;
    W.metricRow(ctx, 'CPU', rx, 18, rw, D.metrics.cpu, mid('info'), '%', 100);
    W.metricRow(ctx, 'RAM', rx, 36, rw, D.metrics.ram, mid('idle'), '%', 100);
    W.metricRow(ctx, 'NET', rx, 54, rw, D.metrics.net, mid('success'), 'M', 100);
    W.metricRow(ctx, 'TMP', rx, 72, rw, D.metrics.temp, mid('warning'), 'C', 90);
  }

  // ---------------- CONSTELLATION / TOPOLOGY ----------------
  function line(ctx, x0, y0, x1, y1, color) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    ctx.fillStyle = color;
    while (true) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  function svcById(id) {
    for (var i = 0; i < D.services.length; i++) if (D.services[i].id === id) return D.services[i];
    return null;
  }

  function constellation(ctx, t, BW, BH) {
    bg(ctx, BW, BH);
    var nodes = D.nodes, links = D.links, i;

    // links
    for (i = 0; i < links.length; i++) {
      var a = nodes[links[i][0]], b = nodes[links[i][1]];
      line(ctx, a.x, a.y, b.x, b.y, 'rgba(120,118,110,0.30)');
    }
    // traffic dots (additive)
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < links.length; i++) {
      var la = nodes[links[i][0]], lb = nodes[links[i][1]];
      var p = ((t * 0.33) + i * 0.17) % 1;
      ctx.fillStyle = 'rgba(217,119,87,0.95)';
      ctx.fillRect(Math.round(la.x + (lb.x - la.x) * p), Math.round(la.y + (lb.y - la.y) * p), 1, 1);
    }
    ctx.globalCompositeOperation = 'source-over';

    // nodes
    var keys = Object.keys(nodes);
    for (i = 0; i < keys.length; i++) {
      var k = keys[i], nd = nodes[k], svc = svcById(k);
      var state = svc ? svc.state : 'idle';
      var size = nd.infra ? { longLen: 7, shortLen: 4, thickness: 0.9, coreRadius: 1.6 }
                          : { longLen: 9, shortLen: 5, thickness: 1.1, coreRadius: 2 };
      W.miniSpark(ctx, nd.x, nd.y, state, t, size);
      var col = nd.infra ? mid('idle') : mid(state);
      T.text(ctx, nd.label || k.toUpperCase(), nd.x, nd.y + (nd.infra ? 7 : 8), P.rgbStr(col), 4, 'center');
    }
  }

  App.scenes = { missionControl: missionControl, constellation: constellation };
})(window.App);
