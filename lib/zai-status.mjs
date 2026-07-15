// Venice-first status probe (GLM 5.2), falling back to z.ai.
// Mirrors lib/llama-status.mjs but simpler: cloud API with no /metrics endpoint,
// so we just ping GET /models to confirm reachability and report model IDs.
import { send } from './http.mjs';
import {
  zaiApiKey, zaiBaseUrl, zaiModel, zaiVisionModel,
  veniceApiKey, veniceBaseUrl, veniceModel,
} from './config.mjs';

export async function getZaiStatus(res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  let state = 'offline';
  let error = null;

  try {
    // Try Venice first (it proxies z.ai models)
    if (veniceApiKey) {
      const r = await fetch(`${veniceBaseUrl}/models`, {
        signal: controller.signal,
        headers: { accept: 'application/json', Authorization: `Key ${veniceApiKey}` },
      });
      if (r.ok) { state = 'online'; }
    }
    // Fall back to Z.AI probe if Venice is offline
    if (state !== 'online') {
      try {
        if (!zaiApiKey) throw new Error('ZAI_API_KEY is not configured');
        const r = await fetch(`${zaiBaseUrl}/models`, {
          signal: controller.signal,
          headers: { accept: 'application/json', Authorization: `Bearer ${zaiApiKey}` },
        });
        if (r.ok) { state = 'online'; }
        else throw new Error(`z.ai /models returned ${r.status}`);
      } catch (e) {
        state = 'offline';
        error = e.name === 'AbortError' ? 'z.ai ping timed out' : e.message;
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const provider = state === 'online' && veniceApiKey ? 'venice' : 'z.ai';
  const endpoint = state === 'online' && veniceApiKey ? veniceBaseUrl : zaiBaseUrl;

  send(
    res,
    200,
    JSON.stringify({
      state,
      provider,
      textModel: veniceModel,
      visionModel: zaiVisionModel,
      endpoint,
      error,
    }),
    'application/json; charset=utf-8'
  );
}
