// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { createThumbtackWebhookHandler } from '../routes/thumbtack.mjs';

const tempDirs = [];

function makeRequest(payload, token = 'test-secret') {
  const req = Readable.from([typeof payload === 'string' ? payload : JSON.stringify(payload)]);
  req.headers = token === null ? {} : { 'x-maverick-webhook-token': token };
  return req;
}

function makeResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

function makeHandler(secret = 'test-secret', options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-thumbtack-'));
  tempDirs.push(dir);
  const eventsFile = path.join(dir, 'events.jsonl');
  const automationFile = path.join(dir, 'automation.jsonl');
  return {
    handler: createThumbtackWebhookHandler({
      secret,
      eventsFile,
      automationFile,
      automation: options.automation,
    }),
    eventsFile,
    automationFile,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Thumbtack webhook intake', () => {
  it('rejects a missing or incorrect custom-header token', async () => {
    const { handler } = makeHandler();
    for (const token of [null, 'wrong-secret']) {
      const res = makeResponse();
      await handler(makeRequest({ eventType: 'MessageCreatedV4' }, token), res);
      expect(res.status).toBe(401);
    }
  });

  it('returns unavailable when no webhook secret is configured', async () => {
    const { handler } = makeHandler('');
    const res = makeResponse();
    await handler(makeRequest({ eventType: 'MessageCreatedV4' }), res);
    expect(res.status).toBe(503);
  });

  it('persists an authenticated event once and recognizes a retry', async () => {
    const { handler, eventsFile, automationFile } = makeHandler();
    const payload = {
      eventType: 'MessageCreatedV4',
      data: { messageID: 'msg-1', negotiationID: 'neg-1', text: 'Can you give me a price?' },
    };

    const first = makeResponse();
    await handler(makeRequest(payload), first);
    expect(first.status).toBe(202);
    expect(JSON.parse(first.body)).toMatchObject({ received: true, duplicate: false, mode: 'shadow' });

    const retry = makeResponse();
    await handler(makeRequest(payload), retry);
    expect(retry.status).toBe(200);
    expect(JSON.parse(retry.body)).toMatchObject({ received: true, duplicate: true });

    const records = fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventType: 'MessageCreatedV4',
      messageID: 'msg-1',
      negotiationID: 'neg-1',
      payload,
    });
    const automationRecords = fs.readFileSync(automationFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    expect(automationRecords).toEqual([expect.objectContaining({
      id: records[0].id,
      mode: 'shadow',
      action: 'awaiting-lead-state-processing',
    })]);
  });

  it('normalizes the self-serve webhook event envelope', async () => {
    const { handler, eventsFile } = makeHandler();
    const payload = {
      event: { eventType: 'NegotiationCreatedV4', webhookID: 'webhook-1' },
      data: { negotiationID: 'neg-2' },
    };

    const res = makeResponse();
    await handler(makeRequest(payload), res);

    const record = JSON.parse(fs.readFileSync(eventsFile, 'utf8').trim());
    expect(res.status).toBe(202);
    expect(record).toMatchObject({ eventType: 'NegotiationCreatedV4', negotiationID: 'neg-2' });
  });

  it('rejects malformed JSON without writing an event', async () => {
    const { handler, eventsFile } = makeHandler();
    const res = makeResponse();
    await handler(makeRequest('{not-json'), res);
    expect(res.status).toBe(400);
    expect(fs.existsSync(eventsFile)).toBe(false);
  });
});
