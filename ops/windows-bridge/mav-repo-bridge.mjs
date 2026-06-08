import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const port = Number(process.env.MAV_REPO_BRIDGE_PORT || 8790);
const host = process.env.MAV_REPO_BRIDGE_HOST || '0.0.0.0';
const defaultRepo = process.env.MAV_REPO_DEFAULT || 'C:\\Workspace\\Active\\homelab-noc-dashboard\\homelab-noc-dashboard\\homelab-noc-dashboard';
const allowedRoots = (process.env.MAV_REPO_ALLOWED_ROOTS || 'C:\\Workspace\\Active;C:\\Users\\carte\\CodeProjects')
  .split(';')
  .map((item) => path.resolve(item.trim()))
  .filter(Boolean);
const hermesExe = process.env.HERMES_EXE || 'C:\\Users\\carte\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe';
const defaultTimeoutMs = Number(process.env.MAV_REPO_HERMES_TIMEOUT_MS || 300_000);
const maxBodyBytes = Number(process.env.MAV_REPO_MAX_BODY_BYTES || 160_000);
const maxDiffBytes = Number(process.env.MAV_REPO_MAX_DIFF_BYTES || 120_000);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBodyBytes) throw new Error('Request body too large');
  }
  return body ? JSON.parse(body) : {};
}

function resolveRepo(repoPath = defaultRepo) {
  const resolved = path.resolve(repoPath);
  const allowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!allowed) {
    throw new Error(`Repo path is outside allowed roots: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Repo path does not exist: ${resolved}`);
  }
  return resolved;
}

function runCommand(command, args, { cwd, timeoutMs = 20_000, maxBytes = 80_000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxBytes) stdout = `${stdout.slice(0, maxBytes)}\n[truncated]`;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxBytes) stderr = `${stderr.slice(0, maxBytes)}\n[truncated]`;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        command,
        args,
        cwd,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - started
      });
    });
  });
}

async function git(repoPath, args, options = {}) {
  const result = await runCommand('git', args, { cwd: repoPath, ...options });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function parseStatusPorcelain(output) {
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => ({
    code: line.slice(0, 2),
    path: line.slice(2).trimStart()
  }));
}

async function repoSnapshot(repoPath) {
  const [branch, commit, statusText, changedText, statText] = await Promise.all([
    git(repoPath, ['branch', '--show-current']).catch(() => ''),
    git(repoPath, ['rev-parse', '--short', 'HEAD']).catch(() => ''),
    git(repoPath, ['status', '--short']),
    git(repoPath, ['diff', '--name-only']).catch(() => ''),
    git(repoPath, ['diff', '--stat']).catch(() => '')
  ]);
  return {
    repoPath,
    branch,
    commit,
    dirty: Boolean(statusText.trim()),
    status: parseStatusPorcelain(statusText),
    changedFiles: changedText.split(/\r?\n/).filter(Boolean),
    diffStat: statText
  };
}

async function repoDiff(repoPath) {
  return git(repoPath, ['diff', '--', '.'], { maxBytes: maxDiffBytes });
}

async function runHermes(prompt, { repoPath, timeoutMs = defaultTimeoutMs, toolsets = 'terminal,file,hermes-cli' } = {}) {
  if (!fs.existsSync(hermesExe)) {
    throw new Error(`Hermes executable not found: ${hermesExe}`);
  }
  const started = Date.now();
  const childArgs = ['-z', prompt, '--toolsets', toolsets];
  const result = await runCommand(hermesExe, childArgs, {
    cwd: repoPath,
    timeoutMs,
    maxBytes: 120_000
  });
  return {
    output: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString()
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        state: 'online',
        defaultRepo,
        allowedRoots,
        hermes: fs.existsSync(hermesExe) ? 'available' : 'missing',
        port
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/repo/status') {
      const repoPath = resolveRepo(url.searchParams.get('repo') || defaultRepo);
      sendJson(res, 200, await repoSnapshot(repoPath));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/repo/diff') {
      const repoPath = resolveRepo(url.searchParams.get('repo') || defaultRepo);
      sendJson(res, 200, { repoPath, diff: await repoDiff(repoPath) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/worker/hermen/run') {
      const { prompt, repo, timeoutMs, toolsets } = await readJsonBody(req);
      if (!prompt || typeof prompt !== 'string') {
        sendJson(res, 400, { error: 'prompt is required.' });
        return;
      }
      const repoPath = resolveRepo(repo || defaultRepo);
      const before = await repoSnapshot(repoPath);
      const result = await runHermes(prompt, { repoPath, timeoutMs, toolsets });
      const after = await repoSnapshot(repoPath);
      const diff = await repoDiff(repoPath).catch((error) => `diff unavailable: ${error.message}`);
      const beforeFiles = new Set(before.changedFiles);
      const changedFilesDelta = after.changedFiles.filter((file) => !beforeFiles.has(file));
      sendJson(res, 200, {
        ...result,
        repoPath,
        before,
        after,
        baselineDirty: before.dirty,
        allChangedFiles: after.changedFiles,
        changedFiles: before.dirty ? changedFilesDelta : after.changedFiles,
        changedFilesDelta,
        diffStat: after.diffStat,
        diff
      });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`mav repo bridge listening on http://${host}:${port}`);
  console.log(`Default repo: ${defaultRepo}`);
  console.log(`Allowed roots: ${allowedRoots.join('; ')}`);
});
