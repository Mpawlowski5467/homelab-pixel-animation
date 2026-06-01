/*
 * demo.js — phase-1 looping producer.
 *
 * It just calls notifier.notify(...) on a timer, exactly the way a future
 * webhook bridge will. Deleting this file and dropping in webhook.js is the
 * whole "add real triggers" change — the animation code never knows.
 */
window.App = window.App || {};
(function (App) {
  'use strict';

  // [state, message, duration ms]
  var SCRIPT = [
    ['idle',    'System nominal',          6000],
    ['info',    'Backup started',          4500],
    ['success', 'Backup complete',         4500],
    ['info',    'Pulling container images', 4500],
    ['warning', 'Disk 82% full',           4500],
    ['error',   'Service nginx DOWN',      5500],
    ['success', 'nginx recovered',         4500],
    ['idle',    'All systems go',          5000],
  ];

  function startDemo(notifier) {
    var i = 0;
    (function step() {
      var e = SCRIPT[i % SCRIPT.length];
      notifier.notify(e[0], e[1], { duration: e[2] });
      i++;
      setTimeout(step, e[2]);
    })();
  }

  // Keys 1-5 fire each state on demand (handy for visual QA on the kiosk).
  function bindHotkeys(notifier) {
    var map = { '1': 'idle', '2': 'info', '3': 'success', '4': 'warning', '5': 'error' };
    window.addEventListener('keydown', function (ev) {
      var s = map[ev.key];
      if (s) notifier.notify(s, s.toUpperCase() + ' · manual', { duration: 4000, interrupt: true });
    });
  }

  App.demo = { startDemo: startDemo, bindHotkeys: bindHotkeys, SCRIPT: SCRIPT };
})(window.App);
