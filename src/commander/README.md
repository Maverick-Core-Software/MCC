# Maverick Commander v2 — Shell

Additive scaffold on branch `rebuild/maverick-commander-v2`. No existing
files were modified, and no routing, server, or style changes were made.

## What the shell is

- `CommanderLayout.jsx` — dark NOC grid layout shell: header (title,
  live clock, agent active/error counts) + grid slots for the 7 panels.
- `panels/` — one placeholder component per panel, each rendering a
  "Coming soon — data source TBD" empty state. `HardwareMonitor.jsx`
  reuses the existing `Gauge` component (ECharts `type: 'gauge'`) with
  static values clearly labeled DEMO. No live data wiring yet.
- `commander.css` — shell-only styles. `styles.css` was left untouched.
- `../docs/rebuild-maverick-commander-v2.md` — the rebuild spec.

## What comes next (not in this scaffold)

1. Routing: mount `CommanderLayout` on a route/view (e.g. a new
   `commander` view) without disturbing existing views.
2. Live data wiring, one panel at a time, starting with the data-source
   decisions in the spec (Prometheus status on aiwa UNVERIFIED; Prometheus
   does not expose everything for the 9700 GPU).
3. Network diagram page (separate tab/page) + 3D ecosystem map update.
4. Mav-Room + Maverick Core panels (later, once live).

## Preview

Render `CommanderLayout` in a dev route or temporary view, then:

```powershell
npm install
npm run dev -- --port 3010
```

Expect placeholder panels and DEMO gauges only — no live data.
