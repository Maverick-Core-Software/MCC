// Agent activity feed — Maverick Commander Panel 1.
// INTERIM feed: Claude agent updates pushed in via POST /api/agents/feed.
// Long-term: an Orca agent-agnostic feed replaces the ingestion side; the
// GET contract below stays the same so the panel does not change.
// NOTE: entries live in memory only (capped at MAX_ENTRIES). No persistence
// yet — a server restart clears the feed. Persistence is a later step.
import { sendJson, readJsonBody } from '../lib/http.mjs';

const MAX_ENTRIES = 500;
const LEVELS = new Set(['info', 'warn', 'error']);

// Newest-last. Capped in postAgentFeed.
const entries = [];
// agentName -> { name, status }. Status is derived from the agent's latest
// post: an `error` entry marks it `error` until it posts again. `idle` and
// `offline` exist in the contract for the future Orca adapter; POST ingestion
// alone cannot produce them.
const agents = new Map();

function agentList() {
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgentFeed(req, res) {
  sendJson(res, 200, { entries: [...entries], agents: agentList() });
}

export async function postAgentFeed(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Request body must be valid JSON.' });
    return;
  }
  const agent = typeof body?.agent === 'string' ? body.agent.trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!agent || !message) {
    sendJson(res, 400, { error: 'Both `agent` and `message` are required.' });
    return;
  }
  const level = LEVELS.has(body?.level) ? body.level : 'info';
  const ts = typeof body?.ts === 'string' && !Number.isNaN(Date.parse(body.ts))
    ? new Date(body.ts).toISOString()
    : new Date().toISOString();
  const entry = { ts, agent, level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  agents.set(agent, {
    name: agent,
    status: level === 'error' ? 'error' : 'active',
  });
  sendJson(res, 201, entry);
}
