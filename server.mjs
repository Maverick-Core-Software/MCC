import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 3010);
const prometheusUrl = process.env.PROMETHEUS_URL || 'http://192.168.1.12:9090';
const llamaServerUrl = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8080';
const localModel = process.env.LOCAL_MODEL || 'qwen3.6-35b-a3b';
const hermesWorkerUrl = process.env.HERMES_WORKER_URL || '';
const repoBridgeUrl = process.env.MAV_REPO_BRIDGE_URL || '';
const hermesExe = process.env.HERMES_EXE || 'C:\\Users\\carte\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe';
const hermesWorkdir = process.env.HERMES_WORKDIR || 'C:\\Users\\carte';
const hermesTimeoutMs = Number(process.env.HERMES_TIMEOUT_MS || 180_000);
const dataDir = process.env.MAV_CONSOLE_DATA_DIR || path.join(__dirname, '.mav-console');
const ledgerFile = path.join(dataDir, 'task-runs.json');
const workspacePath = process.env.MAV_CONSOLE_WORKSPACE || __dirname;

const orchestratorState = {
  updatedAt: null,
  runs: []
};

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readLedger() {
  try {
    ensureDataDir();
    if (!fs.existsSync(ledgerFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to read task ledger: ${error.message}`);
    return [];
  }
}

function writeLedger(runs) {
  ensureDataDir();
  fs.writeFileSync(ledgerFile, JSON.stringify(runs.slice(0, 100), null, 2));
}

function addLedgerRun(run) {
  const runs = [run, ...readLedger().filter((item) => item.id !== run.id)].slice(0, 100);
  writeLedger(runs);
  orchestratorState.updatedAt = run.updatedAt || run.finishedAt || run.startedAt || new Date().toISOString();
  return run;
}

function updateLedgerRun(id, patch) {
  const runs = readLedger();
  const index = runs.findIndex((run) => run.id === id);
  if (index === -1) return null;
  const updated = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  runs[index] = updated;
  writeLedger(runs);
  orchestratorState.updatedAt = updated.updatedAt;
  return updated;
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) throw new Error('Request body too large');
  }
  return body ? JSON.parse(body) : {};
}

function textFromLlamaResponse(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const chunks = payload?.output?.flatMap((item) => item?.content || []) || [];
  return chunks.map((chunk) => chunk?.text || '').filter(Boolean).join('\n').trim();
}

async function callLocalModel(input, { maxOutputTokens = 1400 } = {}) {
  const response = await fetch(new URL('/v1/responses', llamaServerUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model: localModel,
      input,
      max_output_tokens: maxOutputTokens,
      temperature: 0.15
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Local model failed: ${response.status}`);
  }
  return textFromLlamaResponse(payload);
}

function fallbackPlan(idea, rawText = '') {
  return {
    summary: rawText || `Build a scoped MVP for: ${idea}`,
    tasks: [
      {
        id: 'task-1',
        title: 'Scout existing workspace',
        worker: 'local-qwen',
        reason: 'Cheap, fast read-only inspection before edits.',
        status: 'ready'
      },
      {
        id: 'task-2',
        title: 'Create agent execution brief',
        worker: 'hermes-qwen',
        reason: 'Hermes can use Qwen with tools for a controlled first implementation pass.',
        status: 'queued'
      },
      {
        id: 'task-3',
        title: 'Review architecture and risk',
        worker: 'codex-review',
        reason: 'Save hosted usage for final judgment and edge cases.',
        status: 'queued'
      }
    ],
    verification: ['Run focused tests', 'Run build', 'Review diff before deployment']
  };
}

function parsePlan(idea, rawText) {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallbackPlan(idea, rawText);
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary || fallbackPlan(idea, rawText).summary,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 8).map((task, index) => ({
        id: task.id || `task-${index + 1}`,
        title: task.title || `Task ${index + 1}`,
        worker: normalizeWorker(task.worker),
        reason: task.reason || 'Routed by local planner.',
        status: task.status || 'queued'
      })) : fallbackPlan(idea, rawText).tasks,
      verification: Array.isArray(parsed.verification) ? parsed.verification.slice(0, 6) : fallbackPlan(idea, rawText).verification
    };
  } catch {
    return fallbackPlan(idea, rawText);
  }
}

function hermesAvailable() {
  if (hermesWorkerUrl) return true;
  return fs.existsSync(hermesExe);
}

function workerIds() {
  return ['local-qwen', 'hermes-qwen', 'repo-bridge', 'codex-review', 'claude-cli', 'rag-server'];
}

function normalizeWorker(worker) {
  return workerIds().includes(worker) ? worker : 'local-qwen';
}

async function runHermesOneshot(prompt, { timeoutMs = hermesTimeoutMs } = {}) {
  if (hermesWorkerUrl) {
    return runHermesBridge(prompt, { timeoutMs });
  }
  if (!hermesAvailable()) {
    throw new Error(`Hermes executable not found: ${hermesExe}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(hermesExe, ['-z', prompt, '--toolsets', 'terminal,file,hermes-cli'], {
      cwd: hermesWorkdir,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Hermes timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ output: stdout.trim(), stderr: stderr.trim(), exitCode: code });
        return;
      }
      reject(new Error((stderr || stdout || `Hermes exited with ${code}`).trim()));
    });
  });
}

async function runHermesBridge(prompt, { timeoutMs = hermesTimeoutMs } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL('/run', hermesWorkerUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        prompt,
        toolsets: 'terminal,file,hermes-cli',
        timeoutMs
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || `Hermes bridge failed: ${response.status}`);
    }
    return {
      output: payload.output || payload.brief || '',
      stderr: payload.stderr || '',
      exitCode: payload.exitCode ?? 0,
      bridge: hermesWorkerUrl,
      durationMs: payload.durationMs ?? null
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Hermes bridge timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runRepoBridgeHermen(prompt, { timeoutMs = hermesTimeoutMs } = {}) {
  if (!repoBridgeUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL('/worker/hermen/run', repoBridgeUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        prompt,
        repo: workspacePath,
        timeoutMs,
        toolsets: 'terminal,file,hermes-cli'
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || `Repo bridge failed: ${response.status}`);
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Repo bridge timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRepoBridgeState() {
  if (!repoBridgeUrl) {
    return { endpoint: null, state: 'not-configured' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(new URL('/health', repoBridgeUrl), {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    const payload = await response.json();
    return {
      endpoint: repoBridgeUrl,
      state: response.ok && payload?.state === 'online' ? 'bridge-online' : 'bridge-error',
      detail: payload?.defaultRepo || null
    };
  } catch (error) {
    return {
      endpoint: repoBridgeUrl,
      state: 'bridge-offline',
      detail: error.name === 'AbortError' ? 'health timed out' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getHermesState() {
  if (!hermesWorkerUrl) {
    return {
      endpoint: hermesExe,
      state: fs.existsSync(hermesExe) ? 'available-local-dev' : 'not-on-host'
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(new URL('/health', hermesWorkerUrl), {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    const payload = await response.json();
    return {
      endpoint: hermesWorkerUrl,
      state: response.ok && payload?.state === 'online' ? 'bridge-online' : 'bridge-error',
      detail: payload?.model || payload?.hermesExe || null
    };
  } catch (error) {
    return {
      endpoint: hermesWorkerUrl,
      state: 'bridge-offline',
      detail: error.name === 'AbortError' ? 'health timed out' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyPrometheus(req, res, url) {
  const query = url.searchParams.get('query');
  if (!query) {
    send(res, 400, JSON.stringify({ error: 'Missing query parameter' }), 'application/json; charset=utf-8');
    return;
  }
  const upstream = new URL('/api/v1/query', prometheusUrl);
  upstream.searchParams.set('query', query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(upstream, { signal: controller.signal });
    const text = await response.text();
    send(res, response.status, text, response.headers.get('content-type') || 'application/json; charset=utf-8');
  } catch (error) {
    send(
      res,
      200,
      JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [] },
        warning: error.name === 'AbortError' ? 'Prometheus query timed out' : error.message
      }),
      'application/json; charset=utf-8'
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getLlamaStatus(res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(new URL('/v1/models', llamaServerUrl), {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    const payload = await response.json();
    const model = payload?.data?.[0] || payload?.models?.[0] || null;
    send(
      res,
      response.ok ? 200 : response.status,
      JSON.stringify({
        state: response.ok && model ? 'online' : 'error',
        model: model?.id || model?.name || model?.model || null,
        contextTokens: model?.meta?.n_ctx ?? null,
        parameterCount: model?.meta?.n_params ?? null,
        endpoint: llamaServerUrl
      }),
      'application/json; charset=utf-8'
    );
  } catch (error) {
    send(
      res,
      200,
      JSON.stringify({
        state: 'offline',
        model: null,
        contextTokens: null,
        parameterCount: null,
        endpoint: llamaServerUrl,
        error: error.name === 'AbortError' ? 'llama-server status timed out' : error.message
      }),
      'application/json; charset=utf-8'
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getOrchestratorStatus(res) {
  const hermesState = await getHermesState();
  const repoBridgeState = await getRepoBridgeState();
  const taskRuns = readLedger();
  sendJson(res, 200, {
    updatedAt: orchestratorState.updatedAt,
    workers: [
      {
        id: 'local-qwen',
        label: 'Cline/Qwen Local',
        role: 'fast planner and coding brief',
        cost: 'local',
        endpoint: llamaServerUrl,
        state: 'online-check-via-model-panel'
      },
      {
        id: 'hermes-qwen',
        label: 'Hermes/Qwen Agent',
        role: 'tool-enabled local worker',
        cost: 'local',
        endpoint: hermesState.endpoint,
        state: hermesState.state,
        detail: hermesState.detail
      },
      {
        id: 'repo-bridge',
        label: 'Windows Repo Bridge',
        role: 'git diff, status, and worker audit',
        cost: 'local',
        endpoint: repoBridgeState.endpoint,
        state: repoBridgeState.state,
        detail: repoBridgeState.detail
      },
      {
        id: 'codex-review',
        label: 'Codex Hosted',
        role: 'architecture and quality review',
        cost: 'metered',
        state: 'manual-gated'
      },
      {
        id: 'claude-cli',
        label: 'Claude CLI',
        role: 'specialist implementation pass',
        cost: 'subscription-gated',
        state: 'not-wired'
      },
      {
        id: 'rag-server',
        label: 'ProDesk Embeddings',
        role: 'project memory and retrieval',
        cost: 'local-network',
        state: 'planned'
      }
    ],
    runs: orchestratorState.runs,
    taskRuns
  });
}

async function createOrchestratorPlan(req, res) {
  try {
    const { idea } = await readJsonBody(req);
    if (!idea || typeof idea !== 'string' || idea.trim().length < 8) {
      sendJson(res, 400, { error: 'Idea must be at least 8 characters.' });
      return;
    }
    const prompt = `You are mav-console's local AI work router. Turn this product idea into a conservative implementation plan.

Idea:
${idea.trim()}

Return only JSON with this shape:
{
  "summary": "one sentence",
  "tasks": [
    { "id": "task-1", "title": "short action", "worker": "local-qwen|hermes-qwen|codex-review|claude-cli|rag-server", "reason": "why this worker", "status": "ready|queued" }
  ],
  "verification": ["short verification step"]
}

Rules:
- Route simple planning and low-risk coding briefs to local-qwen.
- Route tool-enabled local implementation prep to hermes-qwen.
- Route architecture, risk, and final QC to codex-review.
- Use claude-cli only for a hard specialist implementation pass.
- Use rag-server only when previous projects, docs, or client memory matter.
- Keep the plan to 4-7 tasks.`;
    const rawText = await callLocalModel(prompt);
    const plan = parsePlan(idea.trim(), rawText);
    const run = {
      id: `run-${Date.now()}`,
      idea: idea.trim(),
      plan,
      rawText,
      createdAt: new Date().toISOString(),
      status: 'planned'
    };
    orchestratorState.updatedAt = run.createdAt;
    orchestratorState.runs = [run, ...orchestratorState.runs].slice(0, 8);
    sendJson(res, 200, run);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function createLocalWorkerBrief(req, res) {
  try {
    const { idea, task } = await readJsonBody(req);
    if (!idea || !task?.title) {
      sendJson(res, 400, { error: 'Idea and task.title are required.' });
      return;
    }
    const prompt = `You are the local Qwen coding worker inside mav-console.

Product idea:
${idea}

Assigned task:
${task.title}

Return a compact execution brief with:
1. Files likely needed
2. Commands to inspect first
3. Minimal edit plan
4. Verification command

Do not claim you changed files.`;
    const brief = await callLocalModel(prompt, { maxOutputTokens: 900 });
    sendJson(res, 200, { brief, createdAt: new Date().toISOString() });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function createHermesWorkerRun(req, res) {
  try {
    const { idea, task } = await readJsonBody(req);
    if (!idea || !task?.title) {
      sendJson(res, 400, { error: 'Idea and task.title are required.' });
      return;
    }
    const prompt = `You are Hermes/Qwen inside mav-console. This is a controlled worker assignment, not an open-ended autonomous project.

Product idea:
${idea}

Assigned task:
${task.title}

Worker routing reason:
${task.reason || 'No reason supplied.'}

Use tools only for lightweight inspection if needed. Return:
1. What you inspected
2. Recommended implementation steps
3. Commands to run
4. Risks or blockers

Do not modify files unless the assigned task explicitly says to implement changes.`;
    const result = await runHermesOneshot(prompt);
    sendJson(res, 200, {
      brief: result.output,
      stderr: result.stderr,
      exitCode: result.exitCode,
      bridge: result.bridge || null,
      durationMs: result.durationMs || null,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function extractChangedFiles(output) {
  const files = new Set();
  const section = output.match(/(?:Files changed|Changed files|Files modified):?\s*([\s\S]{0,800})/i)?.[1];
  if (!section) return [];
  for (const match of section.matchAll(/`([^`]+\.(?:js|jsx|ts|tsx|css|mjs|json|md|yml|yaml|go))`/gi)) files.add(match[1]);
  for (const match of section.matchAll(/\b(src\/[^\s,;:)]+|server\.mjs|docker-compose\.yml|prometheus\.yml|Dockerfile)\b/g)) files.add(match[1]);
  return [...files].slice(0, 12);
}

async function createTaskRun(req, res) {
  const startedAt = new Date().toISOString();
  let ledgerRun = null;
  try {
    const { idea, task, mode = 'brief' } = await readJsonBody(req);
    if (!idea || !task?.title) {
      sendJson(res, 400, { error: 'Idea and task.title are required.' });
      return;
    }
    const worker = normalizeWorker(task.worker);
    ledgerRun = addLedgerRun({
      id: `taskrun-${Date.now()}`,
      planTaskId: task.id || null,
      idea,
      taskTitle: task.title,
      worker,
      mode,
      status: 'running',
      reviewStatus: 'needs-review',
      deployStatus: 'not-deployed',
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      output: '',
      stderr: '',
      changedFiles: [],
      diffStat: '',
      diff: '',
      repoPath: workspacePath,
      repoBefore: null,
      repoAfter: null,
      repoBaselineDirty: false,
      allChangedFiles: [],
      verification: [],
      error: null
    });

    let output = '';
    let stderr = '';
    let durationMs = null;
    if (worker === 'hermes-qwen') {
      const prompt = `You are Hermen, the local Hermes/Qwen worker inside mav-console.

This assignment is being logged in the mav-console task ledger.

Workspace:
${workspacePath}

Product idea:
${idea}

Assigned task:
${task.title}

Routing reason:
${task.reason || 'No reason supplied.'}

Mode:
${mode}

Rules:
- Keep the work tightly scoped to the assigned task.
- If mode is "brief", inspect/recommend only and do not edit files.
- If mode is "implement", you may make minimal edits only if the task explicitly asks for implementation.
- At the end, include a short "Files changed:" section.
- Include verification commands run or recommended.`;
      const result = await runRepoBridgeHermen(prompt) || await runHermesOneshot(prompt);
      output = result.output;
      stderr = result.stderr || '';
      durationMs = result.durationMs || null;
      ledgerRun.repoPath = result.repoPath || workspacePath;
      ledgerRun.repoBefore = result.before || null;
      ledgerRun.repoAfter = result.after || null;
      ledgerRun.repoBaselineDirty = Boolean(result.baselineDirty);
      ledgerRun.allChangedFiles = Array.isArray(result.allChangedFiles) ? result.allChangedFiles : [];
      ledgerRun.changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles : [];
      ledgerRun.diffStat = result.diffStat || '';
      ledgerRun.diff = result.diff || '';
    } else if (worker === 'local-qwen') {
      const prompt = `You are the local Qwen coding worker inside mav-console.

Product idea:
${idea}

Assigned task:
${task.title}

Return a compact execution brief with likely files, inspection commands, minimal edit plan, verification commands, and risks.

Do not claim you changed files.`;
      output = await callLocalModel(prompt, { maxOutputTokens: 900 });
    } else {
      output = `${workerLabelForServer(worker)} is not automated yet. Route this through manual review or a local worker.`;
    }

    const finishedAt = new Date().toISOString();
    const updated = updateLedgerRun(ledgerRun.id, {
      status: 'needs-review',
      output,
      stderr,
      durationMs,
      repoPath: ledgerRun.repoPath,
      repoBefore: ledgerRun.repoBefore,
      repoAfter: ledgerRun.repoAfter,
      repoBaselineDirty: ledgerRun.repoBaselineDirty,
      allChangedFiles: ledgerRun.allChangedFiles,
      changedFiles: ledgerRun.changedFiles.length ? ledgerRun.changedFiles : extractChangedFiles(output),
      diffStat: ledgerRun.diffStat,
      diff: ledgerRun.diff,
      finishedAt
    });
    sendJson(res, 200, updated);
  } catch (error) {
    if (ledgerRun) {
      const failed = updateLedgerRun(ledgerRun.id, {
        status: 'failed',
        error: error.message,
        finishedAt: new Date().toISOString()
      });
      sendJson(res, 200, failed);
      return;
    }
    sendJson(res, 500, { error: error.message });
  }
}

function workerLabelForServer(worker) {
  const labels = {
    'local-qwen': 'Local Qwen',
    'hermes-qwen': 'Hermen',
    'repo-bridge': 'Repo Bridge',
    'codex-review': 'Codex Review',
    'claude-cli': 'Claude CLI',
    'rag-server': 'RAG Server'
  };
  return labels[worker] || worker;
}

async function updateTaskRun(req, res) {
  try {
    const { id, reviewStatus, deployStatus, status } = await readJsonBody(req);
    if (!id) {
      sendJson(res, 400, { error: 'Task run id is required.' });
      return;
    }
    const patch = {};
    if (['needs-review', 'approved', 'rejected'].includes(reviewStatus)) patch.reviewStatus = reviewStatus;
    if (['not-deployed', 'ready', 'deployed', 'blocked'].includes(deployStatus)) patch.deployStatus = deployStatus;
    if (['running', 'needs-review', 'approved', 'failed', 'deployed'].includes(status)) patch.status = status;
    const updated = updateLedgerRun(id, patch);
    if (!updated) {
      sendJson(res, 404, { error: 'Task run not found.' });
      return;
    }
    sendJson(res, 200, updated);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/query') {
    await proxyPrometheus(req, res, url);
    return;
  }
  if (url.pathname === '/api/llm/status') {
    await getLlamaStatus(res);
    return;
  }
  if (url.pathname === '/api/orchestrator/status') {
    await getOrchestratorStatus(res);
    return;
  }
  if (url.pathname === '/api/orchestrator/plan' && req.method === 'POST') {
    await createOrchestratorPlan(req, res);
    return;
  }
  if (url.pathname === '/api/orchestrator/local-brief' && req.method === 'POST') {
    await createLocalWorkerBrief(req, res);
    return;
  }
  if (url.pathname === '/api/orchestrator/hermes-run' && req.method === 'POST') {
    await createHermesWorkerRun(req, res);
    return;
  }
  if (url.pathname === '/api/orchestrator/task-run' && req.method === 'POST') {
    await createTaskRun(req, res);
    return;
  }
  if (url.pathname === '/api/orchestrator/task-run' && req.method === 'PATCH') {
    await updateTaskRun(req, res);
    return;
  }
  if (url.pathname === '/health') {
    send(res, 200, 'ok\n');
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(distDir, requestedPath));
  if (!filePath.startsWith(distDir)) {
    send(res, 403, 'forbidden\n');
    return;
  }
  const finalPath = fs.existsSync(filePath) ? filePath : path.join(distDir, 'index.html');
  fs.readFile(finalPath, (error, data) => {
    if (error) {
      send(res, 404, 'not found\n');
      return;
    }
    send(res, 200, data, types[path.extname(finalPath).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`mav-console dashboard listening on http://0.0.0.0:${port}`);
  console.log(`Prometheus: ${prometheusUrl}`);
  console.log(`llama.cpp: ${llamaServerUrl}`);
});
