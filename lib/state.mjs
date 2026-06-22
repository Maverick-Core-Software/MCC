// Persisted dashboard state: the task-run ledger, generic JSON state files, and the
// in-memory orchestrator/SEO logs that are hydrated from disk so they survive restarts.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ledgerFile, seoTaskLogFile, orchestratorStateFile } from './config.mjs';

export function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function readLedger() {
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

export function writeLedger(runs) {
  ensureDataDir();
  fs.writeFileSync(ledgerFile, JSON.stringify(runs.slice(0, 100), null, 2));
}

export function addLedgerRun(run) {
  const runs = [run, ...readLedger().filter((item) => item.id !== run.id)].slice(0, 100);
  writeLedger(runs);
  orchestratorState.updatedAt = run.updatedAt || run.finishedAt || run.startedAt || new Date().toISOString();
  saveOrchestratorState();
  return run;
}

export function updateLedgerRun(id, patch) {
  const runs = readLedger();
  const index = runs.findIndex((run) => run.id === id);
  if (index === -1) return null;
  const updated = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  runs[index] = updated;
  writeLedger(runs);
  orchestratorState.updatedAt = updated.updatedAt;
  saveOrchestratorState();
  return updated;
}

// Generic JSON state persistence (mirrors the task-ledger pattern) so in-memory
// dashboard state survives a server restart instead of starting blank.
export function readJsonState(file, fallback) {
  try {
    ensureDataDir();
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Failed to read ${path.basename(file)}: ${error.message}`);
    return fallback;
  }
}

export function writeJsonState(file, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to write ${path.basename(file)}: ${error.message}`);
  }
}

function loadOrchestratorState() {
  const saved = readJsonState(orchestratorStateFile, null);
  if (saved && Array.isArray(saved.runs)) {
    return { updatedAt: saved.updatedAt || null, runs: saved.runs.slice(0, 8) };
  }
  return { updatedAt: null, runs: [] };
}

export function saveOrchestratorState() {
  writeJsonState(orchestratorStateFile, orchestratorState);
}

// Loaded from disk so the dashboard survives a server restart. Exported as a live
// reference — route handlers mutate orchestratorState.runs/updatedAt directly.
export const orchestratorState = loadOrchestratorState();

// SEO task event log — loaded from disk, capped at 100 entries.
export const seoTaskLog = (() => {
  const saved = readJsonState(seoTaskLogFile, []);
  return Array.isArray(saved) ? saved.slice(-100) : [];
})();

export function logSeoEvent(actionId, label, type, event, ok, msg) {
  seoTaskLog.push({ actionId, label: label || actionId, type: type || 'unknown', event, at: Date.now(), ok, msg });
  if (seoTaskLog.length > 100) seoTaskLog.shift();
  writeJsonState(seoTaskLogFile, seoTaskLog);
}
