#!/usr/bin/env node
/**
 * prometheus-sync.mjs
 * Scrapes all Prometheus metrics every 5s and upserts a single row
 * into the Supabase `metrics` table. Lets the Vercel frontend read
 * live homelab data via Supabase realtime instead of /api/query.
 *
 * PM2: added to ecosystem.config.cjs
 */

import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROM_QUERIES } from '../src/config/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env — prefer SEO app's .env (has Supabase keys), fall back to local
const envPath = fs.existsSync(path.join(__dirname, '..', '.env'))
  ? path.join(__dirname, '..', '.env')
  : 'C:\\Workspace\\Active\\SEO-Agents-App\\.env';
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://192.168.1.12:9090';
const LOCAL_SERVER_URL = process.env.MAV_LOCAL_SERVER_URL || 'http://127.0.0.1:3000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const INTERVAL_MS = Number(process.env.PROM_SYNC_INTERVAL_MS) || 5000;
const NODE_ID = process.env.PROM_SYNC_NODE_ID || 'homelab';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// PromQL queries imported from the single source of truth: src/config/metrics.js

async function queryPrometheus(query) {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const json = await res.json();
  const result = json?.data?.result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const raw = result[0]?.value?.[1];
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function scrapeAll() {
  const entries = Object.entries(PROM_QUERIES);
  const values = {};
  // Batch 6 at a time to stay well under Prometheus connection limits
  const concurrency = 6;
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(([key, query]) => queryPrometheus(query).then(v => [key, v]))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const [key, val] = r.value;
        values[key] = val;
      }
    }
  }
  return values;
}

async function fetchLocalJson(path) {
  try {
    const res = await fetch(`${LOCAL_SERVER_URL}${path}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function syncNodeStatus() {
  const [model_status, deploy_status, orchestrator_status] = await Promise.all([
    fetchLocalJson('/api/llm/status'),
    fetchLocalJson('/api/deploy/status'),
    fetchLocalJson('/api/orchestrator/status'),
  ]);

  // Only upsert if at least one endpoint responded
  if (!model_status && !deploy_status && !orchestrator_status) return;

  const { error } = await supabase
    .from('node_status')
    .upsert({
      node_id: NODE_ID,
      ...(model_status && { model_status }),
      ...(deploy_status && { deploy_status }),
      ...(orchestrator_status && { orchestrator_status }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'node_id' });

  if (error) console.error(`[prometheus-sync] node_status upsert error: ${error.message}`);
}

let consecutiveErrors = 0;
let statusTick = 0;

async function sync() {
  try {
    const values = await scrapeAll();
    const { error } = await supabase
      .from('metrics')
      .upsert({ node_id: NODE_ID, values, updated_at: new Date().toISOString() }, { onConflict: 'node_id' });
    if (error) throw error;
    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors === 1 || consecutiveErrors % 12 === 0) {
      console.error(`[prometheus-sync] metrics error (x${consecutiveErrors}): ${err.message}`);
    }
  }

  // Sync node status every 3 ticks (every ~15s) — no need for sub-5s updates
  statusTick++;
  if (statusTick % 3 === 0) syncNodeStatus().catch(() => {});
}

console.log(`[prometheus-sync] starting — ${PROMETHEUS_URL} + ${LOCAL_SERVER_URL} → Supabase every ${INTERVAL_MS}ms`);
sync();
setInterval(sync, INTERVAL_MS);
