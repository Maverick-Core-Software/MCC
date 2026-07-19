# JOURNAL

Append-only. New entries go at the bottom. Never rewrite history.

## 2026-07-19 — PM2 service consolidation

Consolidated PM2 on CartersPC into a single service universe: one NSSM service,
one `PM2_HOME`, one registry doc, no user-space pm2.

**What changed:**

- Created `scripts/pm2-acl-fix.ps1` (elevation-gated ACL repair, report-only by
  default) and `scripts/pm2-orphan-report.ps1` (read-only orphan diagnostic).
- Created `docs/pm2-registry.md` mapping all 16 dump apps to owning ecosystem
  files and ports, with the consented delete+start+save restart procedure.
- Gave the three dump-only apps ecosystem files: fb-comment-agent
  (SEO-Agents-App), maverick-dashboard (Maverick Integrations dashboard folder);
  homelab-agent-sensors already had one in HomeLab-Agent.
- Appended `HCP_MCP_HOST`, `HCP_MCP_LITE_PORT`, `HCP_MCP_LITE_TOOLS` to the
  housecall-pro-mcp `.env` so a bare start matches the pm2 config.
- Corrected the docs that claimed the service runs as LocalSystem (hermes
  `SOUL.md`, `pm2-windows-service.md` reference): it runs as `.\carte`; the
  EPERM cause was admin-owned state files + UAC-filtered tokens.
- Cutover (privileged session): killed two orphan daemons (04:26) with consent;
  ran `pm2-acl-fix.ps1 -Apply` (owner CARTERSPC\carte, 131 files, Users stripped);
  disabled the `\housecall-pro-mcp` logon task; elevated `pm2 save` wrote a fresh
  dump inheriting the locked ACL.

**Why:** user-space pm2 was failing with EPERM and stranding orphan daemons;
state files under `C:\ProgramData\pm2` were admin-owned with no carte ACE, so
non-elevated (UAC-filtered) shells couldn't connect while the service wrote
fine. The secret-bearing `dump.pm2` was also world-readable via `BUILTIN\Users`.

**Unresolved:** non-elevated pm2 still fails — the live daemon's named pipes
predate the ACL fix and pipe security descriptors are fixed at creation. Needs a
consented service restart (deferred). See `HANDOFF.md` open items.
