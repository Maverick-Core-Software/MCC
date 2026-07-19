# PM2 Single-Universe Consolidation - Build Plan

**Created:** 2026-07-19 by Claude (Fable 5, build-handoff orchestrator)
**Target repo:** C:\Workspace\Active\MCC
**Branch:** main

## Codebase Primer

(Orchestrator-only context - never sent to the executor.)

- Windows 11 Pro, PowerShell 7, node from carte's npm profile. pm2 7.0.3 lives at `C:\Users\carte\AppData\Roaming\npm\node_modules\pm2`.
- There is exactly ONE live pm2 universe: NSSM service `PM2` (display name "PM2 (Maverick stack)"), running as `.\carte` (NOT LocalSystem - account flipped ~Jul 17), `PM2_HOME=C:\ProgramData\pm2` (also set machine-wide). It launches `scripts/pm2-service-supervisor.cjs` in this repo, which resurrects the dump on start and re-resurrects every 20s if `pm2 jlist` fails or returns empty. The old user universe at `C:\Users\carte\.pm2` is dead (nothing since ~Jul 9).
- Remaining root problem: state files under `C:\ProgramData\pm2` (`pm2.pid`, `dump.pm2`, `dump.pm2.bak`, `module_conf.json`, `nssm.exe`) are owned by `BUILTIN\Administrators` with SYSTEM/Administrators Full + Users Read and NO explicit carte ACE. The service logon gets carte's UNFILTERED admin token (writes fine); interactive non-elevated shells get the UAC-FILTERED token (read-only) -> `EPERM` on every user-space pm2 call, each of which also strands an orphan `pm2\lib\Daemon.js` node process. Separately, `dump.pm2` freezes each app's full captured environment INCLUDING live secrets and is readable by all local Users.
- Executor constraints baked into every session: the executor terminal is NON-ELEVATED. It must NEVER run any `pm2` command, never stop/start/restart any service or process, never write a secret value into a committed file. MCC has 13 pre-existing dirty files - each session commits ONLY the files it names.
- All privileged operations (ACL changes, scheduled-task disable, `pm2 save`) are authored as scripts in Session 1 and executed only in Session 4 by Carter in an elevated shell (or by the orchestrator with Carter's explicit consent at that moment). Sessions 1-3 and 5 are pure file authoring/editing - safe for the local executor.
- Known live surface (from 2026-07-19 research): 16 apps in dump.pm2; ports 3000 (mav-console), 3012, 7331, 7332+7333 (one process, two listeners), 8080, 8765, 8790, 8792, 8795, 8901. qwen3-llama (8081) defined but not listening. Off-box consumer: Slack bot hits llama-guardian via Tailscale 100.124.216.11:8080. A logon scheduled task `\housecall-pro-mcp` is a competing launcher racing the pm2 app for port 7332. An orphan duplicate dashboard runs on 8793 outside pm2 (dies at reboot; leave it).
- Deliberate scope exclusions (design decisions, do not re-litigate in-session): NO service restart and NO app restarts in this plan - stale frozen envs in the dump persist until each app is individually restarted from its ecosystem file, which is a separately-consented follow-up documented in the registry doc. The HCP-MCP split is intentional, not drift: the LXC instance at 192.168.1.14:7332 is brand new and in a ~48-hour observation period (started ~2026-07-19, so through ~2026-07-21) ahead of a full migration; the local pm2 app remains authoritative until that cutover, and user `.env` pointing at the LXC is deliberate observation traffic. The eventual LXC migration is out of scope for this plan.

## Session 1 - ACL-fix and orphan-report scripts (authoring only)

**Goal:** Two PowerShell scripts exist in `scripts/` that (a) repair ownership/ACLs on `C:\ProgramData\pm2` and (b) report orphaned pm2 daemon processes. Nothing is executed against the system in this session beyond safe read-only verification.
**Independent:** yes
**Stack / decisions:** PowerShell 7, no modules beyond built-ins. Use `takeown`/`icacls` (not raw .NET ACL APIs) for the fix script so its actions are auditable line-by-line. Both scripts must be idempotent and safe to re-run. Do NOT run any `pm2` command anywhere in this session, and do not execute the fix script - your terminal is non-elevated and the script must refuse to run there anyway.

**Tasks:**
1. Create `scripts/pm2-acl-fix.ps1`. Behavior: (a) refuse to run without elevation - check the current WindowsPrincipal for the Administrators role and exit with a clear error and non-zero exit code if absent; (b) default mode is REPORT-ONLY: print current owner and access list for `C:\ProgramData\pm2`, `dump.pm2`, `dump.pm2.bak`, `pm2.pid`, and `module_conf.json`; (c) with an `-Apply` switch: take ownership of the whole `C:\ProgramData\pm2` tree for user `carte`, grant explicit inheritable Full-control ACEs to `carte`, `SYSTEM`, and `BUILTIN\Administrators`, disable ACL inheritance on the folder (preserving copied ACEs first), then remove every `BUILTIN\Users` ACE from the tree - this both fixes the non-elevated-EPERM cause and locks the secret-bearing `dump.pm2` away from other local users; (d) print a before/after summary and exit 0 on success. Must not touch anything outside `C:\ProgramData\pm2`.
2. Create `scripts/pm2-orphan-report.ps1`. Read-only diagnostic: enumerate node processes whose command line contains `pm2\lib\Daemon.js`, and print PID, start time, parent PID, and whether the process has children. It must NEVER kill anything and must always exit 0 (an empty table is a valid result). Purpose: a safe strand-check to run after any suspected user-space pm2 misuse.

**Interfaces (exact spellings):**
- `pm2-acl-fix.ps1` switch: `-Apply` (no other parameters).
- Both scripts live in `scripts/` next to `pm2-service-supervisor.cjs`.

**Verification:**
- Run: `pwsh -NoProfile -File scripts/pm2-acl-fix.ps1` from your (non-elevated) terminal - expected: it prints an error stating elevation is required and exits non-zero WITHOUT printing ACL output or changing anything.
- Run: `pwsh -NoProfile -File scripts/pm2-orphan-report.ps1` - expected: a (possibly empty) table of daemon processes, exit code 0.

**Commit:** `feat: add pm2 ACL fix and orphan report scripts`

## Session 2 - Ecosystem source-of-truth for dump-only apps + registry doc

**Goal:** Every pm2-managed app has an ecosystem config file on disk; the three apps that today exist only inside `dump.pm2` get one in their home project; a registry doc in MCC maps every app to its owning file and port.
**Independent:** yes
**Stack / decisions:** Ecosystem files are CommonJS (`ecosystem.config.cjs`) matching the existing ones in this stack. Ecosystem files must contain NO secret values - every app in scope already loads its own `.env` (force-override or script-dir anchored loaders); ecosystem env blocks may carry only non-secret keys such as port numbers. Do NOT run any `pm2` command in this session. `C:\ProgramData\pm2\dump.pm2` is a readable JSON file - read it with a one-off `node -e` JSON parse or PowerShell, never via pm2.

**Tasks:**
1. From `dump.pm2`, extract for each of `fb-comment-agent`, `maverick-dashboard`, `homelab-agent-sensors`: the `pm2_env.pm_exec_path`, `pm_cwd`, `exec_interpreter`, script args, and any port-related env keys. Then create an `ecosystem.config.cjs` beside each app's entry script (fb-comment-agent: the SEO-Agents-App folder containing `facebook-comment-agent.mjs`, port 8795; maverick-dashboard: `C:\Workspace\Shared\Maverick Integrations\workflows\dashboard\`, `server.mjs` with the `--port 8792` arg; homelab-agent-sensors: the folder containing `sensor_agent.py`, python interpreter, port 7331). Each file defines exactly one app with: name (matching the dump name exactly), absolute `script` path, absolute `cwd` (maverick-dashboard's dump entry has an EMPTY cwd - set it to its dashboard folder), interpreter where non-node, args, `autorestart: true`, and non-secret env only. If a folder already has an ecosystem file, add the app to it instead of creating a second file.
2. Create `docs/pm2-registry.md` in this repo (the `docs/` folder exists): a table of all 16 apps from `dump.pm2` with columns: app name, port(s), owning ecosystem file (absolute path), entry script, notes. Required notes: housecall-pro-mcp is ONE process listening on 7332 (full) and 7333 (lite); qwen3-llama (8081) is defined but not currently listening and the Slack bot depends on the guardian chain via Tailscale 100.124.216.11:8080; sync-estimates-weekly is cron `0 2 * * 0` with autorestart false; apps defined in ecosystem files but NOT in the dump (maverickforge, mcc-dashboard-agent in `C:\Workspace\Active\MCC\ecosystem.config.cjs`; mav-slack in `C:\Workspace\Active\grizzly-hcp\ecosystem.config.cjs`); the orphan duplicate dashboard on port 8793 (not pm2-managed, dies at reboot, do not migrate); the `\housecall-pro-mcp` logon scheduled task is a competing launcher slated for disable in the privileged cutover; a second HCP-MCP instance runs on an LXC at 192.168.1.14:7332 - it is new and under a ~48-hour observation period (through ~2026-07-21) before a planned full migration, and the LOCAL pm2 app stays authoritative until that cutover. End the doc with a "Restarting an app cleanly" section explaining in prose: restarts happen only from an ELEVATED shell, per app, using delete-then-start from the owning ecosystem file so the frozen dump env is replaced by fresh `.env` values, followed by a save - and that each such restart needs Carter's explicit go because these are live business processes.
3. Append the missing production keys to `C:\Workspace\Infrastructure\housecall-pro-mcp\.env` so a bare start matches the pm2 config: `HCP_MCP_HOST=0.0.0.0`, `HCP_MCP_LITE_PORT=7333`, and `HCP_MCP_LITE_TOOLS` copied verbatim from the env block of `C:\Workspace\Infrastructure\housecall-pro-mcp\ecosystem.config.cjs`. Do not modify any existing key in that `.env`, and do not copy any token/secret key. (That `.env` is gitignored - no commit for it.)

**Verification:**
- Run: `node -e "console.log(require('<each new ecosystem file's absolute path>').apps.map(a=>a.name).join())"` - expected: the app name(s), no throw.
- Search each new ecosystem file for the strings `TOKEN`, `PASSWORD`, `SECRET`, `KEY=` - expected: no secret values present (the `HCP_MCP_LITE_TOOLS` tool-name list is not a secret).
- `docs/pm2-registry.md` lists exactly 16 running/defined dump apps plus the ecosystem-only apps in the notes.

**Commit:** `docs: pm2 app registry and ecosystem coverage` (in MCC: `docs/pm2-registry.md` only). For each other folder that received an ecosystem file and is itself a git repo, commit just that file there with `feat: add pm2 ecosystem config`; if a folder is not a git repo, leave the file on disk and say so in your report.

## Session 3 - Documentation truth-up

**Goal:** Every doc that describes PM2 on this machine reflects reality: service runs as `.\carte`, EPERM cause is ACL/UAC-token asymmetry (not LocalSystem/SYSTEM ownership), and the no-user-space-pm2 rule stands.
**Independent:** no (references `docs/pm2-registry.md` from Session 2)
**Stack / decisions:** Markdown edits only. Do not run any `pm2` command. Preserve each doc's existing structure and tone; correct facts in place rather than rewriting whole files.

**Tasks:**
1. Update `C:\Users\carte\AppData\Local\hermes\skills\mlops\local-model-tuning\references\pm2-windows-service.md`: replace the claim that the service runs as LocalSystem - it runs as `.\carte` (NSSM `ObjectName` flipped ~2026-07-17). State the real EPERM mechanism: state files under `C:\ProgramData\pm2` were owned by `BUILTIN\Administrators` with no explicit carte ACE, so non-elevated (UAC-filtered) shells get `EPERM` while the service's unfiltered token writes fine; note this is fixed by `C:\Workspace\Active\MCC\scripts\pm2-acl-fix.ps1`. Keep the "read the files instead of calling pm2" guidance. Add pointers to `C:\Workspace\Active\MCC\docs\pm2-registry.md` and `scripts\pm2-orphan-report.ps1`, and note `PM2_HOME=C:\ProgramData\pm2` is set machine-wide.
2. Update the "PM2 - never call from user space" section of `C:\Users\carte\AppData\Local\hermes\SOUL.md`: change the phrase describing PM2 as "a SYSTEM service" to describe an NSSM service running as carte whose state files are admin-owned, so non-elevated pm2 fails with `connect EPERM`. Keep the rule itself, the read-files-instead remediation, and the pointer to the reference doc unchanged.
3. Update the PM2/llama lines in `C:\Workspace\Active\brain\knowledge\infrastructure.md` (around lines 9-10): record the service name, account `.\carte`, `PM2_HOME=C:\ProgramData\pm2`, the supervisor script path in MCC, the no-user-space-pm2 rule, and a pointer to `C:\Workspace\Active\MCC\docs\pm2-registry.md`. Do not touch unrelated sections.

**Verification:**
- Search each of the three updated files for `LocalSystem` - expected: no remaining claim that the service currently runs as LocalSystem (a historical "previously ran as" mention is fine).
- Each updated file contains the string `.\carte`.

**Commit:** No commit in MCC (no MCC files change). If `C:\Workspace\Active\brain` is a git repo, commit only `knowledge/infrastructure.md` there with `docs: pm2 service truth-up`; the hermes folder is not a repo - just report the edits.

## Session 4 - Privileged cutover (CARTER / elevated shell - NOT the local executor)

**Goal:** ACLs and ownership on `C:\ProgramData\pm2` are fixed, secrets are no longer world-readable, the competing housecall-pro-mcp launcher is disabled, a fresh dump is saved, and non-elevated pm2 access is re-tested.
**Independent:** no (requires Sessions 1 and 2 verified)

This session is NOT dispatched to the local executor. Carter runs it in an elevated PowerShell (or the orchestrator runs it with Carter's explicit consent at execution time). No service or app is stopped or restarted in this session.

**Tasks:**
1. Baseline: run `scripts/pm2-orphan-report.ps1` and note the count. Run `scripts/pm2-acl-fix.ps1` (report mode) and confirm the reported owner is `BUILTIN\Administrators` as expected.
2. Apply: run `scripts/pm2-acl-fix.ps1 -Apply`. Then confirm with `icacls C:\ProgramData\pm2\dump.pm2` that carte has Full control and no `BUILTIN\Users` entry remains.
3. Disable the competing logon launcher: `schtasks /Change /TN "\housecall-pro-mcp" /Disable`. Leave `\HCP Session Relogin` (daily 06:45) ENABLED - it maintains the per-account HCP browser session the pm2 app depends on.
4. From the same elevated shell, run `pm2 save` to write a fresh dump under the corrected ACLs, then re-check its ACL. Finally, from a separate NON-elevated terminal, run `pm2 jlist` once as the acceptance test - expected: JSON app list with no `EPERM`. If it still fails (the live daemon's pipes were created before the fix), record the exact error and STOP - re-creating pipes requires a service restart, which is a separate consent decision outside this plan. Run `scripts/pm2-orphan-report.ps1` again; if the non-elevated test stranded a daemon, report it (do not kill without Carter's go).

**Verification:**
- `icacls C:\ProgramData\pm2` and `...\dump.pm2` - expected: owner/explicit ACE for carte, no `BUILTIN\Users` line.
- `schtasks /Query /TN "\housecall-pro-mcp"` - expected: Status Disabled.
- Non-elevated `pm2 jlist` result recorded (pass or exact failure).
- Orphan-report delta recorded.

**Commit:** none (no repo files change). The orchestrator records the results in the Session 5 handoff content.

## Session 5 (final) - docs + brain-write

**Goal:** Project memory and the brain vault reflect this build. All three targets are REQUIRED - skipping any one fails the session.
**Independent:** no

Context you need (this repo had no `memory/` folder before this session - create it): This build consolidated PM2 on CartersPC into its single service universe. Facts to record: NSSM service "PM2 (Maverick stack)" runs as `.\carte` with `PM2_HOME=C:\ProgramData\pm2`, supervised by `scripts/pm2-service-supervisor.cjs` (resurrect-only, every 20s); ACLs on the ProgramData tree were repaired via `scripts/pm2-acl-fix.ps1` (carte Full control, `BUILTIN\Users` stripped, so the secret-bearing `dump.pm2` is no longer world-readable); `scripts/pm2-orphan-report.ps1` diagnoses stranded daemons; `docs/pm2-registry.md` maps all apps to ecosystem files and ports; the three dump-only apps (fb-comment-agent, maverick-dashboard, homelab-agent-sensors) now have ecosystem files in their home folders; the `\housecall-pro-mcp` logon task was disabled in favor of the pm2 app; hermes SOUL.md and the pm2-windows-service reference doc were corrected (service is carte, not LocalSystem). Session 4 cutover results (2026-07-19): two orphan daemons from 04:26 were killed with consent; `pm2-acl-fix.ps1 -Apply` succeeded (owner CARTERSPC\carte, 131 files, Users stripped); elevated `pm2 save` wrote a fresh dump.pm2 inheriting the locked ACL; BUT the non-elevated `pm2 jlist` acceptance test STILL fails with `connect EPERM \\.\pipe\interactor.sock` - the live daemon's named pipes predate the ACL fix and pipe security descriptors are fixed at creation, so non-elevated pm2 remains broken until a consented service restart (deliberately out of scope); that failed test stranded one new orphan daemon (PID 50572, 06:59), reported but not killed. Open items to list: qwen3-llama (8081) defined but not listening while the Slack bot depends on the guardian chain; HCP-MCP is mid-migration to an LXC at 192.168.1.14:7332, which is in a ~48-hour observation period through ~2026-07-21 - local pm2 app stays authoritative until the full migration, and user `.env` pointing at the LXC (vs grizzly `.env` at 127.0.0.1) is intentional observation traffic; user `.env` has `MCC_URL=localhost:3011` vs 3000 everywhere else; an unexplained elevated pm2 actor ran at 03:42-03:46 on 2026-07-19; per-app clean restarts (to purge stale frozen dump envs) are pending and individually consented; the service's `PM2_JS` points into carte's npm profile (fragile if pm2 is moved/reinstalled).

**Tasks:**
1. Create `memory/HANDOFF.md` - current-state summary from the context above (what is true NOW, not a narrative), including the open-items list.
2. Create `memory/JOURNAL.md` - a journal file whose first entry is dated 2026-07-19 describing this consolidation (what changed and why); future entries append below, never rewrite.
3. Update the brain vault project note at `C:\Workspace\Active\brain\projects\mcc.md` - append a dated "PM2 single-universe consolidation (2026-07-19)" section with the same facts and open items. This is not optional; skipping it fails the session.

**Verification:** all three files exist and contain the date 2026-07-19 and the string `pm2-acl-fix.ps1`.
**Commit:** `docs: update handoff + journal + brain note - pm2 single-universe consolidation` (MCC: `memory/HANDOFF.md`, `memory/JOURNAL.md`; commit `projects/mcc.md` in the brain repo separately if it is one).

## Revisions

- **2026-07-19 (post-Session-4, orchestrator):** Recorded Session 4 outcomes into the Session 5 context block: ACL fix applied, fresh elevated `pm2 save`, `\housecall-pro-mcp` task disabled, 04:26 orphans killed — but the non-elevated `pm2 jlist` acceptance test still fails with `connect EPERM \\.\pipe\interactor.sock` (daemon pipes predate the ACL fix; a consented service restart is the remaining step, outside this plan) and stranded one new orphan (PID 50572, reported not killed). The SOUL.md "never run pm2 from user space" rule therefore remains fully in force. Mechanical fact-recording only; no scope or task changes.
- **2026-07-19 (pre-approval, Carter clarification):** The user-`.env`-vs-grizzly-`.env` HCP_MCP_URL divergence is not drift. The LXC HCP-MCP (192.168.1.14:7332) is brand new and in a ~48-hour observation period (through ~2026-07-21) ahead of a full migration; the local pm2 housecall-pro-mcp app remains authoritative until that cutover. Removed it from the unresolved open items and recorded it as a known in-flight migration in the primer, the Session 2 registry-doc notes, and the Session 5 handoff content. No scope or task changes.
