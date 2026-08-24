// Self-check for lib/llama-status.mjs (metrics parser + guardian llama_up probe).
// Run: node scripts/check_llama_status.mjs   (exits non-zero on failure)
import assert from 'node:assert';
import {
  parseLlamaMetrics,
  pickLocalCoreModelEntry,
  probeLlamaStatus,
} from '../lib/llama-status.mjs';

// A representative slice of real llama.cpp /metrics output, comments included.
const sample = `# HELP llamacpp:prompt_tokens_total Number of prompt tokens processed.
# TYPE llamacpp:prompt_tokens_total counter
llamacpp:prompt_tokens_total 12345
# HELP llamacpp:tokens_predicted_total Number of generation tokens processed.
# TYPE llamacpp:tokens_predicted_total counter
llamacpp:tokens_predicted_total 6789
# HELP llamacpp:prompt_tokens_seconds Average prompt throughput in tokens/s.
# TYPE llamacpp:prompt_tokens_seconds gauge
llamacpp:prompt_tokens_seconds 208.333
# HELP llamacpp:predicted_tokens_seconds Average generation throughput in tokens/s.
# TYPE llamacpp:predicted_tokens_seconds gauge
llamacpp:predicted_tokens_seconds 34.4828
`;

const m = parseLlamaMetrics(sample);
assert.strictEqual(m.promptTokensTotal, 12345, 'promptTokensTotal');
assert.strictEqual(m.outputTokensTotal, 6789, 'outputTokensTotal');
assert.strictEqual(m.evalSpeed, 208.333, 'evalSpeed');
assert.strictEqual(m.genSpeed, 34.4828, 'genSpeed');

// Missing metrics must come back null, not throw or coerce to 0/NaN.
const empty = parseLlamaMetrics('# nothing here\n');
assert.strictEqual(empty.evalSpeed, null, 'missing metric -> null');

assert.strictEqual(
  pickLocalCoreModelEntry({ data: [{ id: 'nemotron-x' }, { id: 'local-llm' }] })?.id,
  'local-llm',
  'prefer local-llm over AIWA catalog head'
);
assert.strictEqual(
  pickLocalCoreModelEntry({ data: [{ id: 'nemotron-3.5-lightning-30b-a3b' }] }, 'qwen3-14b'),
  null,
  'refuse AIWA-only catalog'
);

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { throw new Error('not json'); },
    async text() { return text; },
  };
}

function mockFetch(routes) {
  return async (url) => {
    const key = String(url);
    for (const [suffix, responder] of Object.entries(routes)) {
      if (key.endsWith(suffix)) {
        return typeof responder === 'function' ? responder() : responder;
      }
    }
    return jsonResponse(404, { error: `no mock for ${key}` });
  };
}

const offline = await probeLlamaStatus({
  endpoint: 'http://localhost:8080',
  configuredModel: 'qwen3-14b',
  fetchImpl: mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: false }),
    '/v1/models': jsonResponse(200, { data: [{ id: 'nemotron-3.5-lightning-30b-a3b' }] }),
  }),
});
assert.strictEqual(offline.state, 'offline', 'llama_up false -> offline');
assert.strictEqual(offline.model, 'qwen3-14b', 'must not report nemotron as local core');

const online = await probeLlamaStatus({
  endpoint: 'http://localhost:8080',
  configuredModel: 'qwen3-14b',
  fetchImpl: mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: true }),
    '/v1/models': jsonResponse(200, {
      data: [{ id: 'local-llm', meta: { n_ctx: 8192, n_params: 1 } }],
    }),
    '/metrics': textResponse(200, sample),
  }),
});
assert.strictEqual(online.state, 'online', 'llama_up true -> online');
assert.strictEqual(online.model, 'local-llm');
assert.strictEqual(online.evalSpeed, 208.333);

const failClosed = await probeLlamaStatus({
  endpoint: 'http://localhost:8080',
  configuredModel: 'qwen3-14b',
  fetchImpl: mockFetch({
    '/__guardian/health': jsonResponse(404, { error: 'missing' }),
    '/v1/models': jsonResponse(200, { data: [{ id: 'local-llm' }] }),
  }),
});
assert.strictEqual(failClosed.state, 'offline', 'health 404 fails closed; models 200 is not online');

console.log('OK: parseLlamaMetrics + guardian llama_up probe (mock fetch, no live llama/AIWA)');
