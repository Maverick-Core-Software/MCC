# HANDOFF — PM2 Service Consolidation (CartersPC)

Current state as of 2026-07-19. What is true NOW.

## Service

- Windows service `PM2` ("PM2 (Maverick stack)", NSSM) runs as `.\carte` — flipped from LocalSystem ~2026-07-17.
- `PM2_HOME=C:\ProgramData\pm2`, set machine-wide.
- Supervised by `scripts/pm2-service-supervisor.cjs` — resurrect-only, checks every 20s.
- The service's `PM2_JS` points into carte's npm profile — fragile if pm2 is moved/reinstalled.

## ACLs

- `C:\ProgramData\pm2` repaired by `scripts/pm2-acl-fix.ps1 -Apply` (2026-07-19): owner `CARTERSPC\carte`, carte Full control, `BUILTIN\Users` stripped (131 files). `dump.pm2` is no longer world-readable.
- Fresh `dump.pm2` written by elevated `pm2 save` after the fix — it inherits the locked ACL.

## Tooling (this repo)

- `scripts/pm2-acl-fix.ps1` — elevation-gated; report-only by default, `-Apply` repairs ownership/ACLs.
- `scripts/pm2-orphan-report.ps1` — read-only stranded-daemon diagnostic; never kills, always exits 0.
- `docs/pm2-registry.md` — all 16 dump apps mapped to owning ecosystem files and ports, plus restart procedure.

## Ecosystem coverage

- Every pm2 app now has an ecosystem file. The three former dump-only apps:
  - `fb-comment-agent` → `C:\Workspace\Active\SEO-Agents-App\ecosystem.config.cjs` (port 8795)
  - `maverick-dashboard` → `C:\Workspace\Shared\Maverick Integrations\workflows\dashboard\ecosystem.config.cjs` (port 8792; folder NOT a git repo)
  - `homelab-agent-sensors` → already in `C:\Workspace\Shared\Agents\HomeLab-Agent\ecosystem.config.cjs` (port 7331)
- `\housecall-pro-mcp` logon scheduled task: DISABLED — the pm2 app is the only launcher.
- Docs corrected: hermes `SOUL.md` and the `pm2-windows-service.md` reference now say the service runs as `.\carte`, EPERM cause is ACL/UAC-token asymmetry.

## Known broken / pending

- **Non-elevated `pm2` still fails** with `connect EPERM \\.\pipe\interactor.sock`. The live daemon's named pipes predate the ACL fix and pipe security descriptors are fixed at creation. Fix requires a consented service restart — deliberately deferred.
- Orphan daemon PID 50572 (stranded 2026-07-19 06:59 by the failed acceptance test) reported, not killed. Two earlier orphans (04:26) were killed with consent.

## Open items

1. **qwen3-llama (8081)** — defined but not listening; the Slack bot depends on the guardian chain via Tailscale `100.124.216.11:8080`.
2. **HCP-MCP migration** — second instance on LXC `192.168.1.14:7332`, in ~48h observation through ~2026-07-21. Local pm2 app stays authoritative until full migration. User `.env` pointing at the LXC (vs grizzly `.env` at 127.0.0.1) is intentional observation traffic.
3. **User `.env` has `MCC_URL=localhost:3011`** — 3000 everywhere else. Unresolved discrepancy.
4. **Unexplained elevated pm2 actor** ran 2026-07-19 03:42–03:46. Source unknown.
5. **Per-app clean restarts pending** — delete+start from owning ecosystem file to purge stale frozen dump envs. Each needs Carter's individual consent.
6. **`PM2_JS` fragility** — points into carte's npm profile; breaks if pm2 is moved/reinstalled.
