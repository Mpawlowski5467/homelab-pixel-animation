/*
 * webhook.js — OPTIONAL future trigger. NOT loaded by index.html yet.
 *
 * This is the drop-in that replaces the demo cycler with real events. It
 * connects to a server's Server-Sent-Events stream and forwards each event
 * to the SAME notify() seam the demo uses — so renderer/spark/effects never
 * change. To enable: run a server (see README "Future: webhook integration"),
 * then in index.html swap <script src="src/demo.js"> for this file (or load
 * both), and add this AFTER main.js.
 *
 * Expected event payload (JSON): { "state": "error", "message": "nginx DOWN" }
 */
(function () {
  'use strict';
  function connect() {
    if (!window.Notifier) { setTimeout(connect, 200); return; } // wait for boot
    var src = new EventSource('/events');
    src.onmessage = function (e) {
      try {
        var d = JSON.parse(e.data);
        window.Notifier.notify(d.state, d.message, d.opts || {});
      } catch (err) {
        console.error('[webhook] bad event payload', err, e.data);
      }
    };
    src.onerror = function () { /* EventSource auto-reconnects */ };
  }
  connect();
})();
