// LOCAL AI CORE panel status. Online iff guardian /__guardian/health has llama_up === true (not /v1/models).
import { send } from './http.mjs';
import { localModelUrl, localModel } from './config.mjs';

// Prefer these ids when reading /v1/models after llama_up; never treat AIWA catalog entries as local core.
const LOCAL_CORE_MODEL_IDS = ['local-llm', 'qwen3-14b', 'qwen3.6-35b', 'qwen3-llama'];

// llama.cpp serves OpenAI routes under …/v1; /metrics and /__guardian sit at the server root.
export function baseUrl(url = localModelUrl) {
  return String(url).replace(/\/v1\/?$/, '');
}

// Parse the four metrics the panel shows out of llama.cpp's Prometheus text.
// Exported for the self-check (scripts/check_llama_status.mjs).
export function parseLlamaMetrics(text) {
  const read = (name) => {
    // Match a metric line "name <value>", skipping "# HELP/# TYPE" comment lines.
    const m = text.match(new RegExp('^' + name.replace(/[:]/g, '\\$&') + '\\s+([0-9.eE+-]+)', 'm'));
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    evalSpeed: read('llamacpp:prompt_tokens_seconds'),       // prompt eval throughput
    genSpeed: read('llamacpp:predicted_tokens_seconds'),     // generation throughput
    promptTokensTotal: read('llamacpp:prompt_tokens_total'),
    outputTokensTotal: read('llamacpp:tokens_predicted_total'),
  };
}

export function isAiwaCatalogId(id) {
  if (!id) return false;
  const lower = String(id).toLowerCase();
  return lower.includes('nemotron') || lower.includes('qwen3.8');
}

/** Display fallback when catalog has no local entry; never surface an AIWA id from LOCAL_MODEL misconfig. */
export function safeDisplayModel(configuredModel = localModel) {
  return isAiwaCatalogId(configuredModel) ? LOCAL_CORE_MODEL_IDS[0] : configuredModel;
}

/** Pick a LOCAL AI CORE catalog entry; never return an AIWA Nemotron/Qwen3.8 id. */
export function pickLocalCoreModelEntry(models, configuredModel = localModel) {
  const entries = Array.isArray(models?.data) ? models.data : [];
  for (const id of LOCAL_CORE_MODEL_IDS) {
    const hit = entries.find((e) => e?.id === id);
    if (hit) return hit;
  }
  if (configuredModel && !isAiwaCatalogId(configuredModel)) {
    const hit = entries.find((e) => e?.id === configuredModel);
    if (hit) return hit;
  }
  const localish = entries.find((e) => e?.id && !isAiwaCatalogId(e.id));
  return localish || null;
}

async function fetchJson(fetchImpl, url, signal) {
  const r = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}

/**
 * Probe guardian health + optional local models/metrics.
 * fetchImpl is injectable so tests can mock without a live llama/AIWA.
 */
export async function probeLlamaStatus({
  fetchImpl = globalThis.fetch,
  endpoint = baseUrl(),
  configuredModel = localModel,
  signal,
} = {}) {
  const displayFallback = safeDisplayModel(configuredModel);
  let state = 'offline';
  let error = null;
  let model = displayFallback;
  let contextTokens = null;
  let parameterCount = null;
  let metrics = { evalSpeed: null, genSpeed: null, promptTokensTotal: null, outputTokensTotal: null };
  let promptMetricsSource = 'unavailable';
  let promptMetricsError = null;

  // 1) Source of truth: guardian health llama_up (not /v1/models 200).
  try {
    const health = await fetchJson(fetchImpl, `${endpoint}/__guardian/health`, signal);
    if (health?.llama_up === true) {
      state = 'online';
    } else {
      state = 'offline';
      error = health?.llama_up === false
        ? 'GLM asleep (llama_up=false)'
        : 'guardian health missing llama_up';
    }
  } catch (e) {
    state = 'offline';
    error = e.name === 'AbortError' ? 'local model timed out' : e.message;
  }

  if (state !== 'online') {
    return {
      state,
      model,
      contextTokens,
      parameterCount,
      endpoint,
      configuredModel,
      evalSpeed: metrics.evalSpeed,
      genSpeed: metrics.genSpeed,
      promptTokensTotal: metrics.promptTokensTotal,
      outputTokensTotal: metrics.outputTokensTotal,
      promptMetricsSource,
      promptMetricsError,
      error,
    };
  }

  // 2) Identity from /v1/models — catalog glitch must not flip offline.
  try {
    const models = await fetchJson(fetchImpl, `${endpoint}/v1/models`, signal);
    const entry = pickLocalCoreModelEntry(models, configuredModel);
    if (entry) {
      model = entry.id || displayFallback;
      contextTokens = entry.meta?.n_ctx_train ?? entry.meta?.n_ctx ?? null;
      parameterCount = entry.meta?.n_params ?? null;
    }
  } catch (e) {
    // Stay online with safe display fallback; llama_up already confirmed.
    if (!error) {
      error = e.name === 'AbortError' ? 'models timed out' : e.message;
    }
  }

  // Local /metrics only; best-effort enrichment after llama_up.
  try {
    const m = await fetchImpl(`${endpoint}/metrics`, { signal, headers: { accept: 'text/plain' } });
    if (m.ok) {
      metrics = parseLlamaMetrics(await m.text());
      promptMetricsSource = 'llama';
    } else {
      promptMetricsError = `metrics returned ${m.status}`;
    }
  } catch (e) {
    promptMetricsError = e.name === 'AbortError' ? 'metrics timed out' : e.message;
  }

  return {
    state,
    model,
    contextTokens,
    parameterCount,
    endpoint,
    configuredModel,
    evalSpeed: metrics.evalSpeed,
    genSpeed: metrics.genSpeed,
    promptTokensTotal: metrics.promptTokensTotal,
    outputTokensTotal: metrics.outputTokensTotal,
    promptMetricsSource,
    promptMetricsError,
    error,
  };
}

export async function getLlamaStatus(res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const payload = await probeLlamaStatus({ signal: controller.signal });
    send(res, 200, JSON.stringify(payload), 'application/json; charset=utf-8');
  } finally {
    clearTimeout(timeout);
  }
}
