# Homelab Pixel Strip

A glowing **pixel-art status display** for a homelab, built for an **ultra-wide 2U rack strip**
(designed around the GeeekPi 7.84″ **1280×400**, 3.2:1). Inspired by the animated Claude Code icon
(the warm Anthropic "spark/asterisk"). Zero dependencies, no build step — runs in any browser /
kiosk.

Two entry points share one pixel engine:

| Page | What it is |
|------|------------|
| **`index.html`** | **The dashboard** — a wide, multi-status pixel dashboard (the main thing). |
| **`views/index.html`** | **Display gallery** — a picker linking the five alternate self-contained themes below. |
| `notify.html` | v1 — a single full-screen spark **notification** with 5 severity states + a decoupled `Notifier.notify()` API. |
| `mockup.html` | An early static "status wall" concept (kept for reference). |

## The dashboard (`index.html`)

Two scenes **auto-rotate** (~11s each) with a smooth dissolve:

- **Mission Control** — an aggregate health hero (`OPERATIONAL` / `DEGRADED` / `CRITICAL`) with
  uptime + counts, a 3×2 grid of **service tiles** (spark + label + metric), and four **live metric
  sparklines** (CPU / RAM / NET / TMP).
- **Network Topology** — services as **linked spark nodes** (NET → SW → services) with **traffic
  dots** flowing along the links, each node glowing in its state colour.

Always on top: a **status dot + title + clock** header, a **colour-coded scrolling event ticker**,
and an **ambient edge-glow** tinted by overall health. A **critical event takes over the whole
strip** (the v1 red strobe/shake/message) then returns to the rotation.

Everything reads one store (`src/dash/data.js`), driven by a simulator that loops
**healthy → degrade → critical → recover**.

### Controls
- Keys **`1`** / **`2`** — jump to Mission Control / Topology · **`0`** — fire a test alert.
- Console: `Dash.view(0|1)`, `Dash.alert('your message')`.

## Alternate views (`views/`)

Five extra **self-contained, single-file** displays — same 1280×400 strip, each its own
aesthetic, all data mocked and drifting forever (~7/10 motion). Open `views/index.html` for a
picker, or point the kiosk straight at one:

| View | File | Vibe |
|------|------|------|
| **Agents on Duty** | `views/agents.html` | Green-phosphor CRT server aisle; pixel agents (ATLAS / ARGUS / VESTA) on watch while HERMES runs packets, with typewriter status bubbles. |
| **Datacenter Floor** | `views/datacenter.html` | Top-down companion to *Agents* — five pixel agents patrol the central aisle between seven colour-coded equipment sectors, reporting on arrival. |
| **CRT Terminal** | `views/terminal.html` | Retro green terminal — scrolling syslog, ASCII vitals bars, a big VT323 clock + service states, and a marquee ticker. |
| **Pixel / Amber** | `views/pixel-amber.html` | 8-bit amber — chunky Silkscreen clock + sysadmin quips, block-bar resources, and a low-fps pixel server tower with a beating heart. |
| **Hacker TUI** | `views/tui.html` | btop-style monitor — per-core bars + CPU graph, gradient mem/disk gauges, a net up/down graph, and a live re-sorting process table. |

Unlike the main dashboard, these **don't** share the `src/` engine — each file is fully standalone
(inline CSS/JS). The only external link is Google Fonts, with monospace fallbacks so they still
read correctly offline. Each scales to fill any viewport, letterboxed on black, and runs forever.

## Run it

Static site — pick either:
- **Double-click `index.html`** (`file://` works — classic scripts, no server), or
- `python3 -m http.server 8080` then open `http://localhost:8080` (matches the kiosk).

## Customise

- **Colours & per-state motion** — [`src/config.js`](src/config.js) (`PALETTES`, `STATE_PRESETS`,
  spark geometry). Grounded in Anthropic brand colours (clay `#d97757`, ivory `#faf9f5`, slate
  `#141413`, green `#788c5d`, blue `#6a9bcc`).
- **Your homelab** — [`src/dash/data.js`](src/dash/data.js): the `services` list, the `nodes`/`links`
  topology, and the `beats` timeline. This is also the seam where **real data** plugs in (below).
- **Resolution / density** — the dashboard buffer is `320×100` (→ 1280×400 at 4×) in
  [`src/dash/main.js`](src/dash/main.js); the v1 notifier uses `INTERNAL_RES` in config.

## File structure

```
index.html / notify.html / mockup.html   entry points
styles.css                               v1 notifier styles
src/
  config.js palette.js spark.js effects.js   shared pixel engine (spark + glow/particles)
  notifier.js demo.js main.js                v1 notification app
  dash/
    data.js      state store + simulator (the data seam)
    text.js      small text helper
    widgets.js   mini-spark, sparkline, metric row
    scenes.js    Mission Control + Topology
    alert.js     critical-alert takeover
    main.js      loop, scene rotation, ambient, overlays
views/                                       standalone single-file displays (no src/ deps)
  index.html                                 gallery / picker
  agents.html      datacenter.html           green-phosphor CRT pixel-agent scenes
  terminal.html                              green-phosphor CRT terminal
  pixel-amber.html tui.html                  8-bit amber + btop-style TUI
```

> Text is currently small bold monospace rendered on the buffer (chunkified by the 4× upscale). A
> true **bitmap pixel font** is the obvious next visual upgrade.

## Raspberry Pi kiosk (the rack strip)

Drive the 1280×400 strip with a Pi running Chromium full-screen.

1. **Serve** the app (a systemd service running `python3 -m http.server 8080`, `Restart=always`).
2. **Stop screen blanking** (X session autostart): `xset s off`, `xset -dpms`, `xset s noblank`
   (or `consoleblank=0` on the kernel cmdline; Wayland uses the compositor's idle settings).
3. **Launch Chromium kiosk:**
   ```sh
   chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \
     --check-for-update-interval=31536000 http://localhost:8080
   ```
4. **Hide the cursor:** `unclutter -idle 0` (CSS also sets `cursor: none`).
5. If the panel mounts rotated, add `--force-device-scale-factor=1` and set display rotation via
   `wlr-randr` / `xrandr` or the panel's config.

## Future: real data instead of the simulator

The store is the only seam — wiring real sources never touches the scenes. Add a tiny server that
pushes events/metrics to the page (SSE/WebSocket); the page writes them into `App.data`
(services/metrics/events) and **every scene updates for free**. Map existing tools server-side:

- **Uptime Kuma** webhook → `down` ⇒ `error`, `up` ⇒ `success`.
- **ntfy / Gotify** → priority ⇒ severity.
- **Glances / Netdata / Prometheus** → feed `metrics.*` rings (CPU/RAM/net/temp) and service states.
- A critical mapping sets `App.data.pendingAlert = {state:'error', msg}` to trigger the takeover.

(The v1 notifier's `Notifier.notify(state, message)` works the same way — see `notify.html`.)
