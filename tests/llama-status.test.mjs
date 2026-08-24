import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLlamaMetrics,
  pickLocalCoreModelEntry,
  probeLlamaStatus,
  baseUrl,
  safeDisplayModel,
  isAiwaCatalogId,
} from '../lib/llama-status.mjs';

const ENDPOINT = 'http://localhost:8080';
const CONFIGURED = 'qwen3-14b';

const SAMPLE_METRICS = `# HELP llamacpp:prompt_tokens_total Number of prompt tokens processed.
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

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new Error('not json');
    },
    async text() {
      return text;
    },
  };
}

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const key = String(url);
    for (const [suffix, responder] of Object.entries(routes)) {
      if (key.endsWith(suffix) || key === suffix) {
        return typeof responder === 'function' ? responder() : responder;
      }
    }
    return jsonResponse(404, { error: `no mock for ${key}` });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('baseUrl strips trailing /v1', () => {
  assert.equal(baseUrl('http://localhost:8080/v1'), 'http://localhost:8080');
  assert.equal(baseUrl('http://localhost:8080/v1/'), 'http://localhost:8080');
});

test('parseLlamaMetrics reads llama.cpp prometheus gauges', () => {
  const m = parseLlamaMetrics(SAMPLE_METRICS);
  assert.equal(m.promptTokensTotal, 12345);
  assert.equal(m.outputTokensTotal, 6789);
  assert.equal(m.evalSpeed, 208.333);
  assert.equal(m.genSpeed, 34.4828);
  assert.equal(parseLlamaMetrics('# nothing\n').evalSpeed, null);
});

test('pickLocalCoreModelEntry prefers local-llm over nemotron data[0]', () => {
  const entry = pickLocalCoreModelEntry({
    data: [
      { id: 'nemotron-3.5-lightning-30b-a3b' },
      { id: 'local-llm', meta: { n_ctx: 32768, n_params: 9e9 } },
    ],
  }, CONFIGURED);
  assert.equal(entry.id, 'local-llm');
});

test('pickLocalCoreModelEntry refuses AIWA ids when no local entry exists', () => {
  const entry = pickLocalCoreModelEntry({
    data: [{ id: 'nemotron-3.5-lightning-30b-a3b' }, { id: 'qwen3.8-27b' }],
  }, CONFIGURED);
  assert.equal(entry, null);
});

test('llama_up false stays offline even when models lists nemotron', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: false }),
    '/v1/models': jsonResponse(200, {
      data: [{ id: 'nemotron-3.5-lightning-30b-a3b', meta: { n_ctx: 1 } }],
    }),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: CONFIGURED,
  });

  assert.equal(status.state, 'offline');
  assert.equal(status.model, CONFIGURED);
  assert.ok(!String(status.model).includes('nemotron'));
  assert.ok(fetchImpl.calls.some((u) => u.endsWith('/__guardian/health')));
  assert.ok(!fetchImpl.calls.some((u) => u.includes('/v1/models')), 'must not consult models when asleep');
  assert.ok(!fetchImpl.calls.some((u) => u.includes('192.168.1.240')));
});

test('llama_up true + local-llm + metrics → online with parsed metrics', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: true }),
    '/v1/models': jsonResponse(200, {
      data: [{ id: 'local-llm', meta: { n_ctx_train: 32768, n_params: 9000000000 } }],
    }),
    '/metrics': textResponse(200, SAMPLE_METRICS),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: CONFIGURED,
  });

  assert.equal(status.state, 'online');
  assert.equal(status.model, 'local-llm');
  assert.equal(status.contextTokens, 32768);
  assert.equal(status.parameterCount, 9000000000);
  assert.equal(status.evalSpeed, 208.333);
  assert.equal(status.genSpeed, 34.4828);
  assert.equal(status.promptTokensTotal, 12345);
  assert.equal(status.outputTokensTotal, 6789);
  assert.equal(status.promptMetricsSource, 'llama');
});

test('health 404 fails closed offline and does not treat models 200 as online', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(404, { error: 'not found' }),
    '/v1/models': jsonResponse(200, {
      data: [{ id: 'local-llm' }],
    }),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: CONFIGURED,
  });

  assert.equal(status.state, 'offline');
  assert.equal(status.model, CONFIGURED);
  assert.match(status.error, /404/);
  assert.ok(!fetchImpl.calls.some((u) => u.includes('/v1/models')), 'no models fallback for online');
});

test('health missing llama_up fails closed even with status=ok', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok' }),
    '/v1/models': jsonResponse(200, { data: [{ id: 'local-llm' }] }),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: CONFIGURED,
  });

  assert.equal(status.state, 'offline');
  assert.ok(!fetchImpl.calls.some((u) => u.includes('/v1/models')));
});

test('models failure while llama_up true stays online with configuredModel', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: true }),
    '/v1/models': () => {
      throw new Error('catalog glitch');
    },
    '/metrics': textResponse(200, SAMPLE_METRICS),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: CONFIGURED,
  });

  assert.equal(status.state, 'online');
  assert.equal(status.model, CONFIGURED);
  assert.equal(status.promptMetricsSource, 'llama');
  assert.equal(status.evalSpeed, 208.333);
});

test('llama_up true but only AIWA catalog ids → online with configuredModel not nemotron', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: true }),
    '/v1/models': jsonResponse(200, {
      data: [{ id: 'nemotron-3.5-lightning-30b-a3b' }, { id: 'qwen3.8-27b' }],
    }),
    '/metrics': textResponse(200, SAMPLE_METRICS),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: CONFIGURED,
  });

  assert.equal(status.state, 'online');
  assert.equal(status.model, CONFIGURED);
  assert.ok(!String(status.model).toLowerCase().includes('nemotron'));
  assert.ok(!String(status.model).toLowerCase().includes('qwen3.8'));
});

test('safeDisplayModel refuses AIWA LOCAL_MODEL misconfig', () => {
  assert.equal(isAiwaCatalogId('nemotron-3.5-lightning-30b-a3b'), true);
  assert.equal(safeDisplayModel('nemotron-3.5-lightning-30b-a3b'), 'local-llm');
  assert.equal(safeDisplayModel('qwen3.8-27b'), 'local-llm');
  assert.equal(safeDisplayModel('qwen3-14b'), 'qwen3-14b');
});

test('misconfigured LOCAL_MODEL AIWA id is not displayed while online', async () => {
  const fetchImpl = mockFetch({
    '/__guardian/health': jsonResponse(200, { status: 'ok', llama_up: true }),
    '/v1/models': jsonResponse(200, {
      data: [{ id: 'nemotron-3.5-lightning-30b-a3b' }],
    }),
    '/metrics': textResponse(200, SAMPLE_METRICS),
  });

  const status = await probeLlamaStatus({
    fetchImpl,
    endpoint: ENDPOINT,
    configuredModel: 'nemotron-3.5-lightning-30b-a3b',
  });

  assert.equal(status.state, 'online');
  assert.equal(status.model, 'local-llm');
  assert.equal(status.configuredModel, 'nemotron-3.5-lightning-30b-a3b');
});
