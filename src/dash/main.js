/*
 * dash/main.js — orchestrates the strip:
 *   - 320x100 buffer -> nearest-neighbour upscale (CSS) to 1280x400
 *   - rotates Mission Control <-> Constellation with a smooth dissolve
 *   - ambient edge-glow tinted by overall health
 *   - persistent overlays: status dot + title + clock, and a colour-coded
 *     scrolling event ticker
 *   - critical alerts preempt with the full-strip takeover, then return
 */
window.App = window.App || {};
(function (App) {
  'use strict';
  var P = App.palette, T = App.text, C = App.config, D = App.data, SC = App.scenes, AL = App.alert;
  var BW = 320, BH = 100;

  function makeBuf() { var c = document.createElement('canvas'); c.width = BW; c.height = BH; return c; }
  function mid(s) { return P.hexToRgb(C.PALETTES[s].mid); }

  function boot() {
    var display = document.getElementById('screen');
    display.width = BW; display.height = BH;
    var dctx = display.getContext('2d'); dctx.imageSmoothingEnabled = false;

    // Keep the display lively by default, but honor the OS motion preference.
    // Widgets/scenes read App.reduceMotion at draw time, so this also responds
    // immediately if the preference changes while the kiosk is running.
    var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    App.reduceMotion = !!(motionQuery && motionQuery.matches);
    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener('change', function (e) { App.reduceMotion = e.matches; });
    } else if (motionQuery && motionQuery.addListener) {
      motionQuery.addListener(function (e) { App.reduceMotion = e.matches; });
    }

    var main = makeBuf(), mctx = main.getContext('2d');
    var bufA = makeBuf(), actx = bufA.getContext('2d');
    var bufB = makeBuf(), bctx = bufB.getContext('2d');
    var mix = makeBuf(), mixctx = mix.getContext('2d');
    mctx.imageSmoothingEnabled = false;
    actx.imageSmoothingEnabled = false;
    bctx.imageSmoothingEnabled = false;
    mixctx.imageSmoothingEnabled = false;

    // Sixteen hard-edged Bayer levels make the scene change read as a pixel
    // dissolve instead of producing blended/soft intermediate colours.
    var dissolvePatterns = [];
    for (var level = 0; level <= 16; level++) {
      var mask = document.createElement('canvas'); mask.width = 4; mask.height = 4;
      var maskCtx = mask.getContext('2d'); maskCtx.fillStyle = '#fff';
      for (var my = 0; my < 4; my++) {
        for (var mx = 0; mx < 4; mx++) {
          if (P.bayer(mx, my) < level / 16) maskCtx.fillRect(mx, my, 1, 1);
        }
      }
      dissolvePatterns.push(mixctx.createPattern(mask, 'repeat'));
    }

    var scenes = [SC.missionControl, SC.constellation];
    var titles = ['MISSION CONTROL', 'NETWORK TOPOLOGY'];
    var idx = 0, mode = 'hold';
    var HOLD = 11, TRANS = 1.2, ALERT = 5.2;            // seconds
    var hold = 0, trans = 0, alertT = 0, curAlert = null;
    var tickerX = 0, t0 = 0, last = 0;

    // Cache the ticker glyphs until its event content changes. This removes the
    // largest source of repeated bitmap-font work from the steady-state loop.
    var tickerBuf = document.createElement('canvas');
    tickerBuf.width = 1; tickerBuf.height = 6;
    var tickerKey = '', tickerWidth = 0, tickerNextCheck = 0;

    function rebuildTicker(now) {
      if (now < tickerNextCheck) return tickerWidth;
      tickerNextCheck = now + 1000;

      var key = '';
      for (var i = 0; i < D.events.length; i++) {
        var e = D.events[i];
        key += e.ago + '|' + e.state + '|' + e.msg + '\n';
      }
      if (key === tickerKey) return tickerWidth;
      tickerKey = key;

      var segs = [];
      for (var s = 0; s < D.events.length; s++) {
        var event = D.events[s];
        segs.push({ t: '+' + event.ago + 'S ' + event.msg.toUpperCase(), c: P.rgbStr(mid(event.state)) });
        segs.push({ t: '   ·   ', c: 'rgba(120,118,110,0.7)' });
      }

      tickerWidth = 0;
      for (var k = 0; k < segs.length; k++) tickerWidth += App.font.width(segs[k].t, 1);
      tickerBuf.width = Math.max(1, tickerWidth); tickerBuf.height = 6;
      var tc = tickerBuf.getContext('2d');
      tc.imageSmoothingEnabled = false;
      var x = 0;
      for (var j = 0; j < segs.length; j++) {
        T.text(tc, segs[j].t, x, 0, segs[j].c, 6, 'left');
        x += App.font.width(segs[j].t, 1);
      }
      return tickerWidth;
    }

    function bgFill(ctx) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = P.rgbStr(P.hexToRgb(C.PALETTES.background));
      ctx.fillRect(0, 0, BW, BH);
    }

    // Edge glow tinted by overall health — subtle "the screen is lit by status".
    function ambient(stateCol, tsec) {
      mctx.globalCompositeOperation = 'lighter';
      var Wd = 34;
      var breathe = App.reduceMotion ? 1 : 0.82 + 0.18 * Math.sin(tsec * 0.7);
      for (var x = 0; x < Wd; x++) {
        var a = (1 - x / Wd); a = a * a * 0.12 * breathe;
        mctx.fillStyle = P.rgba(stateCol, a);
        mctx.fillRect(x, 12, 1, BH - 22);
        mctx.fillRect(BW - 1 - x, 12, 1, BH - 22);
      }
      mctx.globalCompositeOperation = 'source-over';
    }

    function overlays(dt, alertMode, now) {
      mctx.globalCompositeOperation = 'source-over';
      mctx.fillStyle = 'rgba(40,40,38,0.7)'; mctx.fillRect(0, 11, BW, 1);

      if (!alertMode) {
        var ws = D.worstState();
        var dotCol = ws === 'error' ? mid('error') : ws === 'warning' ? mid('warning') : mid('success');
        mctx.fillStyle = P.rgbStr(dotCol); mctx.fillRect(4, 4, 3, 3);
        T.text(mctx, titles[idx], 11, 3, 'rgba(176,174,165,0.72)', 5, 'left');
      }
      var d = new Date();
      function p(n) { return (n < 10 ? '0' : '') + n; }
      T.text(mctx, p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()),
        BW - 4, 3, P.rgbStr(mid('info')), 6, 'right');

      if (alertMode) return;

      // colour-coded scrolling event ticker
      var total = rebuildTicker(now);
      tickerX -= (App.reduceMotion ? 0 : 20) * dt;
      if (total > 0 && tickerX <= -total) tickerX += total;

      mctx.fillStyle = 'rgba(10,10,9,0.92)'; mctx.fillRect(0, BH - 9, BW, 9);
      mctx.fillStyle = 'rgba(40,40,38,0.8)'; mctx.fillRect(0, BH - 10, BW, 1);
      if (total > 0) {
        var tx = Math.round(tickerX);
        mctx.drawImage(tickerBuf, tx, BH - 8);
        mctx.drawImage(tickerBuf, tx + total, BH - 8);
      }
    }

    function loop(now) {
      if (!t0) { t0 = now; last = now; }
      var dt = (now - last) / 1000; if (dt > 0.1) dt = 0.1; last = now;
      var tsec = (now - t0) / 1000;

      D.tick(dt, now);
      if (D.pendingAlert && mode !== 'alert') { curAlert = D.pendingAlert; D.pendingAlert = null; mode = 'alert'; alertT = 0; }

      bgFill(mctx);

      var alertFrame = mode === 'alert';
      if (alertFrame) {
        alertT += dt;
        AL.alertScene(mctx, tsec, curAlert, alertT * 1000, BW, BH);
        if (alertT >= ALERT) { mode = 'hold'; hold = 0; }
      } else {
        if (mode === 'transition') {
          if (App.reduceMotion) {
            idx = (idx + 1) % scenes.length; mode = 'hold'; hold = 0;
            scenes[idx](mctx, tsec, BW, BH);
          } else {
            trans += dt;
            var f = trans / TRANS; if (f > 1) f = 1;
            var fe = f * f * (3 - 2 * f);               // smoothstep ease
            scenes[idx](actx, tsec, BW, BH);
            scenes[(idx + 1) % scenes.length](bctx, tsec, BW, BH);

            // Keep A fixed, then reveal B through a hard 4x4 pixel mask. The
            // incoming scene travels just two logical pixels for subtle depth.
            var inX = Math.round((1 - fe) * 2);
            mixctx.globalCompositeOperation = 'source-over';
            mixctx.clearRect(0, 0, BW, BH);
            mixctx.drawImage(bufB, inX, 0);
            mixctx.globalCompositeOperation = 'destination-in';
            mixctx.fillStyle = dissolvePatterns[Math.round(fe * 16)];
            mixctx.fillRect(0, 0, BW, BH);
            mixctx.globalCompositeOperation = 'source-over';
            mctx.drawImage(bufA, 0, 0);
            mctx.drawImage(mix, 0, 0);
            if (f >= 1) { idx = (idx + 1) % scenes.length; mode = 'hold'; hold = 0; }
          }
        } else {
          hold += dt;
          scenes[idx](mctx, tsec, BW, BH);
          if (hold >= HOLD) { mode = 'transition'; trans = 0; }
        }
        ambient(mid(D.heroState()), tsec);
      }

      // Use the mode that was rendered this frame. Otherwise the final alert
      // frame briefly received the normal title/ticker after changing to hold.
      overlays(dt, alertFrame, now);
      dctx.drawImage(main, 0, 0);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    window.Dash = {
      alert: function (msg) { D.pendingAlert = { state: 'error', msg: msg || 'manual test alert' }; },
      view: function (i) {
        idx = (((i | 0) % scenes.length) + scenes.length) % scenes.length;
        mode = 'hold'; hold = 0;
      },
    };
    window.addEventListener('keydown', function (e) {
      if (e.key === '1') window.Dash.view(0);
      else if (e.key === '2') window.Dash.view(1);
      else if (e.key === '0') window.Dash.alert('manual test alert');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.App);
