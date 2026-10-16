# Maverick Commander v2 — Rebuild Spec

**Branch:** `rebuild/maverick-commander-v2`
**Status:** Shell scaffold only. No routing, no live data wiring, no changes to any existing file.

## Goal
Rebuild the Maverick Commander dashboard to match Carter's original NOC concept:
dark NOC look — terminal activity log, round gauges, switch panel, charts,
storage bars. The old dashboard is largely stale because every device it
monitored has since been upgraded. This rebuild starts from the current
setup, not from fixing old wiring.

## Panels (7)

1. **Agent activity feed** — live terminal-style scrolling list of what
   agents are doing across the workbench. LIVE: `GET /api/agents/feed`
   (see `routes/agents.mjs`) polled every 3s by `src/commander/panels/AgentFeed.jsx`.
2. **Social monitor** — new comments, new posts, messages, GBP metrics.
   Now possible: Facebook is integrated and the GBP API transfer is live.
3. **Hardware** — aiwa (Proxmox) + workbench. GPU available / loaded /
   in-use, CPU utilization, SSD SMART health, disk used/avail, RAM
   used/avail, temperatures for everything.
4. **Network diagram with live numbers** — separate tab/page with live
   connection lines and color thresholds. PLUS the 3D ecosystem map
   (`src/pages/EcosystemMapPage.jsx`), which also needs updating — it is a
   separate, in-depth view and stays.
5. **Automations** — any automations, workflows, cron jobs, scheduled tasks.
6. **Services** — PM2 services on the workbench, container health on aiwa
   + services. Up/Down indication for any service.
7. **SEO pipeline monitor** — dedicated monitor for the Friday SEO pipeline.

## Later (not in this build)
- Mav-Room panel
- Maverick Core panel
- Both become important once live.

## Data-source notes
- Prometheus is believed running on aiwa but UNVERIFIED.
- Prometheus does NOT expose everything needed for the 9700 GPU in aiwa.
- Feed choice is the builder's call: easiest to maintain that has all the
  info. Document the choice here when it is made.
- GBP API: transfer live; token on CMB-Workbench + aiwa. Metrics:
  WEBSITE_CLICKS, CALL_CLICKS, BUSINESS_DIRECTION_REQUESTS, search
  keywords, reviews.
- SEO bridge (old): `GET /seo/status`, `GET /seo/actions`,
  `POST /seo/actions/approve`, `POST /seo/actions/run` via the Windows
  bridge. Confirm still valid before wiring Panel 7.

## Panel 1 feed (interim)
- Interim feed = **Claude agent updates** via `POST /api/agents/feed`
  (`{ agent, level, message }`, level in `info|warn|error`, `ts` defaults to
  now). `GET /api/agents/feed` returns the contract shape
  `{ entries: [{ ts, agent, level, message }], agents: [{ name, status }] }`.
- Entries are in-memory only (last 500); a server restart clears the feed.
  Persistence is a later step.
- Long-term = **Orca agent-agnostic feed** (Carter investigating). The
  server adapter translates Orca's shape into this same contract when ready,
  so the panel does not change.

## Build rules
- Additive only on this branch until Carter reviews. Do not modify
  existing files, `server.mjs`, `styles.css`, or routing in this scaffold.
- Real product names: Maverick Core, Maverick Assistant,
  Maverick Commander.
- Nothing here pushes, merges, or publishes anything.
