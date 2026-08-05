// Thumbtack webhook intake. Capture-only by design: persist authenticated events
// before any agent, CRM, or outbound-message workflow is allowed to run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  thumbtackAutoReplyEnabled,
  thumbtackAutomationFile,
  thumbtackEventsFile,
  thumbtackHcpWritesEnabled,
  thumbtackNativeAutoReplyDisabled,
  thumbtackWebhookSecret,
} from '../lib/config.mjs';
import { readJsonBody, sendJson } from '../lib/http.mjs';
import { getThumbtackAutomationStatus } from '../lib/thumbtack-policy.mjs';

const loadedEventIds = new Map();

function secureEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getEventIds(eventsFile) {
  const resolved = path.resolve(eventsFile);
  if (loadedEventIds.has(resolved)) return loadedEventIds.get(resolved);

  const ids = new Set();
  try {
    if (fs.existsSync(resolved)) {
      for (const line of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record?.id) ids.add(record.id);
        } catch {
          // Preserve intake availability if one historical line is malformed.
        }
      }
    }
  } catch (error) {
    console.error(`[thumbtack] failed to load event IDs: ${error.message}`);
  }
  loadedEventIds.set(resolved, ids);
  return ids;
}

function eventSummary(payload) {
  const data = payload?.data || payload?.event?.data || {};
  return {
    eventType: payload?.eventType || payload?.type || payload?.event?.eventType || payload?.event?.type || 'unknown',
    messageID: payload?.messageID || data?.messageID || null,
    negotiationID: payload?.negotiationID || data?.negotiationID || null,
  };
}

export function createThumbtackWebhookHandler({
  secret = thumbtackWebhookSecret,
  eventsFile = thumbtackEventsFile,
  automationFile = thumbtackAutomationFile,
  automation = getThumbtackAutomationStatus({
    autoReplyEnabled: thumbtackAutoReplyEnabled,
    nativeAutoReplyDisabled: thumbtackNativeAutoReplyDisabled,
    hcpWritesEnabled: thumbtackHcpWritesEnabled,
  }),
} = {}) {
  return async function handleThumbtackWebhook(req, res) {
    if (!secret) {
      sendJson(res, 503, { error: 'Thumbtack webhook is not configured.' });
      return;
    }

    const suppliedSecret = req.headers['x-maverick-webhook-token'];
    if (Array.isArray(suppliedSecret) || !secureEqual(suppliedSecret, secret)) {
      sendJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(req, 1_000_000);
      if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
        throw new Error('Webhook payload must be a JSON object.');
      }
    } catch (error) {
      const tooLarge = /too large/i.test(error.message);
      sendJson(res, tooLarge ? 413 : 400, { error: tooLarge ? 'Request body too large.' : 'Invalid JSON payload.' });
      return;
    }

    const payloadJson = JSON.stringify(payload);
    const id = crypto.createHash('sha256').update(payloadJson).digest('hex');
    const ids = getEventIds(eventsFile);
    if (ids.has(id)) {
      sendJson(res, 200, { received: true, duplicate: true, mode: 'capture-only' });
      return;
    }

    const record = {
      id,
      receivedAt: new Date().toISOString(),
      ...eventSummary(payload),
      payload,
    };

    try {
      fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
      fs.appendFileSync(eventsFile, `${JSON.stringify(record)}\n`, 'utf8');
      // Shadow records form an auditable queue for the lead-state engine. They
      // never include a generated response, invoke HCP, or send Thumbtack API writes.
      fs.appendFileSync(automationFile, `${JSON.stringify({
        id,
        receivedAt: record.receivedAt,
        eventType: record.eventType,
        negotiationID: record.negotiationID,
        messageID: record.messageID,
        mode: automation.mode,
        action: 'awaiting-lead-state-processing',
      })}\n`, 'utf8');
      ids.add(id);
    } catch (error) {
      console.error(`[thumbtack] failed to persist webhook: ${error.message}`);
      sendJson(res, 500, { error: 'Failed to persist webhook.' });
      return;
    }

    console.log(`[thumbtack] captured ${record.eventType} negotiation=${record.negotiationID || '-'} message=${record.messageID || '-'}`);
    sendJson(res, 202, { received: true, duplicate: false, mode: automation.mode });
  };
}

export const handleThumbtackWebhook = createThumbtackWebhookHandler();

export function getThumbtackWebhookStatus(_req, res) {
  const automation = getThumbtackAutomationStatus({
    autoReplyEnabled: thumbtackAutoReplyEnabled,
    nativeAutoReplyDisabled: thumbtackNativeAutoReplyDisabled,
    hcpWritesEnabled: thumbtackHcpWritesEnabled,
  });
  sendJson(res, 200, {
    state: thumbtackWebhookSecret ? 'ready' : 'not-configured',
    mode: automation.mode,
    outboundEnabled: automation.outboundEnabled,
    hcpWritesEnabled: automation.hcpWritesEnabled,
    reasons: automation.reasons,
  });
}
