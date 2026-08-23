# PM2 App Registry

**Updated 2026-08-22 (post-Night4 audit).** PM2 now runs on TWO hosts: Workbench
(this PC, daemon as user `Carter`, dump at `C:\Users\carte\.pm2\dump.pm2` —
`C:\ProgramData\pm2` is legacy/EPERM) and AIWA (Proxmox host, daemon as root,
dump `/root/.pm2/dump.pm2`, resurrected at boot by `pm2-root.service`).
Workbench boot resurrect: scheduled task `PM2 Resurrect At Boot` (S4U, +45s) +
Startup-folder `pm2-resurrect.cmd` logon fallback. Source of truth: the
ecosystem files below. Refresh the relevant dump with `pm2 save` after changes.

## Workbench apps (11 live, verified 2026-08-22)

| App | Port(s) | Owning ecosystem file | Entry script | Notes |
|-----|---------|-----------------------|--------------|-------|
| llama-guardian | 8080 | `C:\Workspace\Infrastructure\llama-cpp-server\ecosystem.config.cjs` | `scripts\llama-guardian.py` (python) | Always-on gateway; owns 8080, proxies to local-llm on 8081. Reachable from AIWA at `100.124.41.115:8080` |
| local-llm | 8081 | `C:\Workspace\Infrastructure\llama-cpp-server\ecosystem.config.cjs` | `llama-server.exe` (GLM-4.7-Flash) | Stopped when idle; guardian wakes it on demand |
| pc-actions-daemon | 8901 | `C:\Workspace\Shared\Agents\Hermes-Supervisor\pc-actions-daemon\ecosystem.local.config.cjs` | `uvicorn main:app` (python) | Hermes PC bridge — AIWA hermes (gateway/pc-sms/triage) depends on it via Tailscale. Owning file is local-only/gitignored (contains PC_ACTIONS_TOKEN) |
| hermes-sandbox-reaper | — | `C:\...\hermes-supervisor-deploy\sandbox-reaper\ecosystem.config.js` (deploy copy) | | Added post-registry; documented 2026-08-22 |
| hermes-deadman-sink | — | `C:\...\hermes-supervisor-deploy\deadman-sink\ecosystem.config.js` (deploy copy) | | Added post-registry; documented 2026-08-22 |
| prometheus-sync | — | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `scripts\prometheus-sync.mjs` | |
| downloads-watcher | — | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `C:\Users\carte\DownloadsOrganizer\downloads_watcher.py` | |
| mav-bridge | — | `C:\Workspace\Active\MCC\ecosystem.config.cjs` | `C:\Workspace\Active\SEO-Agents-App\scripts\mav-bridge.mjs` | Owned by MCC's file though the script lives in SEO-Agents-App |
| homelab-agent-sensors | 7331 | `C:\Workspace\Shared\Agents\HomeLab-Agent\ecosystem.config.cjs` | `sensor_agent.py` (python) | Sensor mode: `NTFY_ENABLED=false` set explicitly in the ecosystem env |
| fb-comment-agent | 8795 | `C:\Workspace\Active\SEO-Agents-App\ecosystem.config.cjs` | `scripts\facebook-comment-agent.mjs` | Restarted 2026-08-22 after falling off during the CartersPC retirement |
| maverick-dashboard | 8792 | `C:\Workspace\Shared\Maverick Integrations\workflows\dashboard\ecosystem.config.cjs` | `server.mjs --port 8792` | Folder is NOT a git repo |

## AIWA host apps (root pm2, `/opt/grizzly-hcp`, verified 2026-08-22)

| App | Port(s) | Notes |
|-----|---------|-------|
| customer-chat-server | 3012 | grizzly customer chat |
| mav-email-watcher | — | estimates email watcher |
| mav-slack | — | Slack + employee SMS channel |
| voice-server | 8765 | VOICE booking persona (ConversationRelay). Public: `https://aiwa.tailf72e3f.ts.net:10000` (Tailscale funnel → 8765); Twilio +14698963862 VoiceUrl repointed here 2026-08-22 (was dead carterspc:10000). Needs `VOICE_PUBLIC_URL` env |
| booking-approval-poller | — | HCP notes + Twilio ops-SMS SCHEDULE approvals. Redeployed 2026-08-22 (was lost in CartersPC retirement) |
| sync-estimates-weekly | — | stopped one-shot; schedule owned by AIWA systemd `hcp-estimates-sync.timer` |

`mav-console` runs in CT 103 (`192.168.1.15:3000`), not under host pm2.

## Defined in ecosystem files but NOT running

- `maverickforge` — `C:\Workspace\Active\MCC\ecosystem.config.cjs` (AI Gateway, port 3012)
- `mcc-dashboard-agent` — `C:\Workspace\Active\MCC\ecosystem.config.cjs` (HomeLab-Agent `agent.py`)

> **Warning:** `maverickforge` is configured with `PORT: 3012`, which collides
> with `customer-chat-server` (also 3012, now on AIWA). Resolve the port before
> ever starting it.

## Known hazards

- **Orphan duplicate dashboard on port 8793** — not pm2-managed, dies at reboot.
  Do NOT migrate it into pm2; let it die.
- **HCP MCP is no longer a Windows PM2 workload.** The Windows `HCP Session
  Relogin` task is disabled, the stopped PM2 entry is rollback-only, and CT102
  (`192.168.1.14`) is the production runtime. Do not restart the archived PM2
  entry except as an explicitly approved rollback.

## CT103 `mav-console` deployment boundary

CT103 `mav-console` is **not** a Windows PM2 app and is not counted in the
table above. CT103 owns its production release; the `mav-console` entry in this
registry remains the PC copy and an approval-only rollback option. Normal CT103
deployment or rollback must not stop, restart, or modify that PC process. A
normal rollback returns CT103 to its prior exact release; using the PC copy
requires a separate explicit approval. `aiwa-host` is limited to host/LXC
configuration, while `mav-console` operations belong to CT103 through its
paired Orca environment.

## Restarting an app cleanly

Restarts happen only from an **elevated** shell, one app at a time, and each one
needs Carter's explicit go — these are live business processes.

For each restart: `pm2 delete <app>`, then `pm2 start <owning ecosystem file> --only <app>`,
then `pm2 save`. Delete-then-start (not `pm2 restart`) is deliberate: a plain
restart reuses the frozen env from the dump, while delete+start rebuilds the
process from the ecosystem file and the app's fresh `.env` values. The final
`pm2 save` rewrites the dump so the next boot resurrects the new config, not
the old one.
