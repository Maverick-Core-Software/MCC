'use strict';
/*
 * pm2-service-supervisor.cjs
 * ----------------------------------------------------------------------------
 * Run by NSSM as the Windows service "PM2" (see scripts/setup-pm2-service.ps1).
 *
 * WHY THIS EXISTS: on Windows the PM2 daemon is just a detached node process
 * with no supervisor. When it dies mid-session, every PM2-managed app (MCC /
 * mav-console included) goes down and stays down until someone runs
 * `pm2 resurrect` by hand — which is exactly the "dashboard is offline" failure.
 *
 * This supervisor is the long-lived process the service runs:
 *   - on start it resurrects the saved process list,
 *   - every INTERVAL_MS it checks the daemon is reachable and re-resurrects if
 *     it vanished (covers mid-session daemon death),
 *   - NSSM supervises THIS process, so if the supervisor itself dies NSSM
 *     restarts it, which re-resurrects (covers a wedged supervisor + reboot).
 *
 * Env supplied by the service (setup-pm2-service.ps1 sets these via NSSM):
 *   PM2_HOME  - the service-owned PM2 home (dump.pm2 lives here)
 *   PM2_JS    - absolute path to the pm2 CLI entry (…/pm2/bin/pm2)
 *
 * ponytail: the 20s poll is a naive heuristic. Ceiling: up to ~20s of downtime
 * before the daemon is brought back. Upgrade path: subscribe to the pm2 bus and
 * react to daemon-exit events instead of polling. Not worth it for a homelab.
 */
const { execFile } = require('node:child_process');

const NODE = process.execPath;
const PM2_JS = process.env.PM2_JS;
const INTERVAL_MS = 20000;

if (!PM2_JS) {
  // Fail loudly so NSSM's restart/throttle surfaces the misconfig in the log
  // instead of silently looping a no-op supervisor.
  console.error('PM2_JS env var is required (path to the pm2 CLI). Exiting.');
  process.exit(2);
}

function pm2(args) {
  return new Promise((resolve) => {
    execFile(NODE, [PM2_JS, ...args], { env: process.env, windowsHide: true },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

async function daemonHealthy() {
  // `pm2 jlist` prints a JSON array when the daemon is reachable. A populated
  // list contains "name"; an empty "[]" means the daemon is up but nothing is
  // loaded yet — treat that as needing a resurrect too.
  const { err, stdout } = await pm2(['jlist']);
  if (err) return false;
  const s = stdout.trim();
  return s.startsWith('[') && s.includes('"name"');
}

async function tick() {
  if (!(await daemonHealthy())) {
    console.log(new Date().toISOString() + ' daemon not healthy — resurrecting');
    await pm2(['resurrect']);
  }
}

(async () => {
  console.log(new Date().toISOString() + ' supervisor start: PM2_HOME=' + process.env.PM2_HOME);
  await pm2(['resurrect']);
  setInterval(() => { tick().catch((e) => console.error('tick error', e)); }, INTERVAL_MS);
})();
