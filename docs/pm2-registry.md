# PM2 App Registry

Every pm2-managed app on CartersPC, its owning ecosystem file, and its ports.
Source of truth: the ecosystem files below. `C:\ProgramData\pm2\dump.pm2` is a
frozen snapshot — it is rewritten only by `pm2 save` and its env blocks go stale.

## Apps (16 in dump.pm2)

| App | Port(s) | Owning ecosystem file | Entry script | Notes |
|-----|---------|-----------------------|--------------|-------|
| llama-guardian | 8080 | `C:\Workspace\Infrastructure\llama-cpp-server\ecosystem.config.cjs` | `scripts\llama-guardian.py` (python) | Always-on gateway; owns 8080, proxies to qwen3-llama on 8081 |
| qwen3-llama | 8081 | `C:\Workspace\Infrastructure\llama-cpp-server\ecosystem.config.cjs` | `llama-server.exe` | Defined but not currently listening; starts on demand via guardian. The Slack bot depends on the guardian chain via Tailscale `100.124.216.11:8080` |
| mav-email-watcher | — | `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs` | `src/automations/estimates/email-watcher.ts` (tsx) | |
| customer-chat-server | 3012 | `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs` | `src/server/customer-chat-server.ts` (tsx) | |
| voice-server | 8765 | `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs` | `src/agent/voice-server.ts` (tsx) | |
| booking-approval-poller | — | `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs` | `src/automations/bookings/approval-poller.ts` (tsx) | |
| sync-estimates-weekly | — | `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs` | `src/hcp/sync-estimates.ts` (tsx) | Cron `0 2 * * 0` (Sun 2 AM), `autorestart: false` — one-shot weekly job |
| mav-console | 3000 | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `server.mjs` | MCC dashboard/API server |
| prometheus-sync | — | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `scripts\prometheus-sync.mjs` | |
| downloads-watcher | — | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `C:\Users\carte\DownloadsOrganizer\downloads_watcher.py` | |
| mav-bridge | — | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `C:\Workspace\Active\SEO-Agents-App\scripts\mav-bridge.mjs` | Owned by MCC's file though the script lives in SEO-Agents-App |
| homelab-agent-sensors | 7331 | `C:\Workspace\Shared\Agents\HomeLab-Agent\ecosystem.config.cjs` | `sensor_agent.py` (python) | Sensor mode: `NTFY_ENABLED=false` set explicitly in the ecosystem env |
| fb-comment-agent | 8795 | `C:\Workspace\Active\SEO-Agents-App\ecosystem.config.cjs` | `scripts\facebook-comment-agent.mjs` | Ecosystem file added 2026-07-19 (was dump-only) |
| maverick-dashboard | 8792 | `C:\Workspace\Shared\Maverick Integrations\workflows\dashboard\ecosystem.config.cjs` | `server.mjs --port 8792` | Ecosystem file added 2026-07-19 (was dump-only, empty/wrong cwd in dump). Folder is NOT a git repo |
| housecall-pro-mcp | 7332 (full), 7333 (lite) | `C:\Workspace\Infrastructure\housecall-pro-mcp\ecosystem.config.cjs` | `dist\index.js` | ONE process listening on both ports; 7333 exposes only the filtered lite tool list |
| pc-actions-daemon | 8901 | `C:\Workspace\Shared\Agents\Hermes-Supervisor\pc-actions-daemon\ecosystem.local.config.cjs` | `uvicorn main:app` (python) | Owning file is local-only/gitignored (contains PC_ACTIONS_TOKEN) |

## Defined in ecosystem files but NOT in the dump

- `maverickforge` — `C:\Workspace\Active\MCC\ecosystem.config.cjs` (AI Gateway, port 3012)
- `mcc-dashboard-agent` — `C:\Workspace\Active\MCC\ecosystem.config.cjs` (HomeLab-Agent `agent.py`)
- `mav-slack` — `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs`

These are registered on next `pm2 start <file>` + `pm2 save`; they are not running.

## Known hazards

- **Orphan duplicate dashboard on port 8793** — not pm2-managed, dies at reboot.
  Do NOT migrate it into pm2; let it die.
- **`\housecall-pro-mcp` logon scheduled task** — a competing launcher for the
  HCP MCP outside pm2. Slated for disable in the privileged cutover.
- **Second HCP-MCP instance on LXC `192.168.1.14:7332`** — new, under a ~48-hour
  observation period (through ~2026-07-21) before a planned full migration. The
  LOCAL pm2 app stays authoritative until that cutover.

## Restarting an app cleanly

Restarts happen only from an **elevated** shell, one app at a time, and each one
needs Carter's explicit go — these are live business processes.

For each restart: `pm2 delete <app>`, then `pm2 start <owning ecosystem file> --only <app>`,
then `pm2 save`. Delete-then-start (not `pm2 restart`) is deliberate: a plain
restart reuses the frozen env from the dump, while delete+start rebuilds the
process from the ecosystem file and the app's fresh `.env` values. The final
`pm2 save` rewrites the dump so the next boot resurrects the new config, not
the old one.
