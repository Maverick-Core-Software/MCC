import { PROM_QUERIES } from '../config/metrics.js';

function valueFromPrometheus(payload) {
  const result = payload?.data?.result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const raw = result[0]?.value?.[1];
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function queryPrometheus(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`/api/query?query=${encodeURIComponent(query)}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Prometheus query failed: ${response.status}`);
    return valueFromPrometheus(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryAllMetrics() {
  const entries = Object.entries(PROM_QUERIES);
  const results = [];
  const concurrency = 4;
  for (let index = 0; index < entries.length; index += concurrency) {
    const batch = entries.slice(index, index + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async ([key, query]) => [key, await queryPrometheus(query)])
    );
    settled.forEach((result, batchIndex) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push([batch[batchIndex][0], null]);
      }
    });
  }
  return results;
}

export async function queryModelStatus() {
  const response = await fetch('/api/llm/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Model status failed: ${response.status}`);
  return response.json();
}
