// HTTP response/request helpers: plain-text + JSON responses, body parsing, SSE writers.

export function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

export function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

export async function readJsonBody(req, maxSize = 512_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxSize) throw new Error('Request body too large');
  }
  return body ? JSON.parse(body) : {};
}

// OpenAI-style SSE chunk (used by chat/estimate streaming).
export function sseWrite(res, text) {
  if (!res.writable) return;
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
}

// Raw SSE event writer (used by the build/ops chat orchestration).
export function buildChatSseWrite(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
