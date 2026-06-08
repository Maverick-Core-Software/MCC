import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 3010);
const prometheusUrl = process.env.PROMETHEUS_URL || 'http://192.168.1.12:9090';
const llamaServerUrl = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8080';
const localModel = process.env.LOCAL_MODEL || 'qwen3.6-35b-a3b';

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
        title: 'Create implementation slice',
        worker: 'local-qwen',
        reason: 'High-volume code generation can stay local.',
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
        worker: task.worker || 'local-qwen',
        reason: task.reason || 'Routed by local planner.',
        status: task.status || 'queued'
      })) : fallbackPlan(idea, rawText).tasks,
      verification: Array.isArray(parsed.verification) ? parsed.verification.slice(0, 6) : fallbackPlan(idea, rawText).verification
    };
  } catch {
    return fallbackPlan(idea, rawText);
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

function getOrchestratorStatus(res) {
  sendJson(res, 200, {
    updatedAt: orchestratorState.updatedAt,
    workers: [
      {
        id: 'local-qwen',
        label: 'Cline/Qwen Local',
        role: 'default coding worker',
        cost: 'local',
        endpoint: llamaServerUrl,
        state: 'online-check-via-model-panel'
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
    runs: orchestratorState.runs
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
    { "id": "task-1", "title": "short action", "worker": "local-qwen|codex-review|claude-cli|rag-server", "reason": "why this worker", "status": "ready|queued" }
  ],
  "verification": ["short verification step"]
}

Rules:
- Route high-volume code edits to local-qwen.
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
    getOrchestratorStatus(res);
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
