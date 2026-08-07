import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  hcpDir,
  thumbtackAgentTimeoutMs,
  thumbtackAutomationFile,
  thumbtackAutoReplyEnabled,
  thumbtackEventsFile,
  thumbtackNativeAutoReplyDisabled,
} from './config.mjs';
import { sendOpsSms } from './ops-notify.mjs';
import { createThumbtackApiClient } from './thumbtack-api.mjs';
import { extractCustomerLeadEvent, splitThumbtackAgentReply } from './thumbtack-lead-state.mjs';
import { getThumbtackAutomationStatus, sanitizeCustomerMessage } from './thumbtack-policy.mjs';

function historyForNegotiation(eventsFile, negotiationID) {
  if (!fs.existsSync(eventsFile)) return [];
  return fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/).flatMap(line => {
    try {
      const record = JSON.parse(line); const data = record.payload?.data || {};
      if (record.negotiationID !== negotiationID || record.eventType !== 'MessageCreatedV4' || !data.text) return [];
      return [{ role: /\bcustomer\b/i.test(String(data.from || '')) ? 'customer' : 'business', text: String(data.text) }];
    } catch { return []; }
  }).slice(-20);
}

export function generateThumbtackReply(input, { projectDir = hcpDir, timeoutMs = thumbtackAgentTimeoutMs } = {}) {
  return new Promise(resolve => {
    // Invoke tsx through node itself: spawning the npx.cmd shim without a shell
    // throws EINVAL on current Node (batch-file hardening, CVE-2024-27980).
    const tsxCli = projectDir ? path.join(projectDir, 'node_modules', 'tsx', 'dist', 'cli.mjs') : '';
    if (!projectDir || !fs.existsSync(projectDir) || !fs.existsSync(tsxCli)) { resolve({ success: false, error: 'Agent project unavailable.' }); return; }
    const proc = spawn(process.execPath, [tsxCli, 'src/automations/thumbtack/customer-reply.ts'], { cwd: projectDir, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const finish = value => resolve(value);
    const timer = setTimeout(() => { proc.kill(); finish({ success: false, error: 'Agent timed out.' }); }, timeoutMs);
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.on('error', () => { clearTimeout(timer); finish({ success: false, error: 'Agent could not start.' }); });
    proc.on('close', () => { clearTimeout(timer); try { finish(JSON.parse(output)); } catch { finish({ success: false, error: 'Invalid agent response.' }); } });
    proc.stdin.end(JSON.stringify(input));
  });
}

let defaultApiClient = null;
function defaultSendMessage(negotiationID, text) {
  defaultApiClient ??= createThumbtackApiClient({ environment: 'production', allowWrites: true });
  return defaultApiClient.sendMessage(negotiationID, text);
}

function hasAutoSentRecord(automationFile, negotiationID) {
  if (!fs.existsSync(automationFile)) return false;
  return fs.readFileSync(automationFile, 'utf8').split(/\r?\n/).some(line => {
    try {
      const record = JSON.parse(line);
      return record.action === 'auto-sent' && record.negotiationID === negotiationID;
    } catch { return false; }
  });
}

export function createThumbtackLeadProcessor({
  eventsFile = thumbtackEventsFile,
  automationFile = thumbtackAutomationFile,
  generateReply = generateThumbtackReply,
  sendMessage = defaultSendMessage,
  notify = sendOpsSms,
  outboundEnabled = getThumbtackAutomationStatus({
    autoReplyEnabled: thumbtackAutoReplyEnabled,
    nativeAutoReplyDisabled: thumbtackNativeAutoReplyDisabled,
  }).outboundEnabled,
} = {}) {
  const sendsInFlight = new Set();
  const append = entry => fs.appendFileSync(automationFile, `${JSON.stringify({ ...entry, createdAt: new Date().toISOString() })}\n`, 'utf8');
  // Operator nudges are best-effort: a notifier outage must never affect the
  // audit trail or the webhook pipeline.
  const nudge = async message => { try { await notify(message); } catch { /* best-effort only */ } };
  return {
    async process(record) {
      const lead = extractCustomerLeadEvent(record);
      if (!lead) return { action: 'ignored-noncustomer-event' };
      const result = await generateReply({ customerName: lead.customerName, history: historyForNegotiation(eventsFile, lead.negotiationID) });
      if (!result?.success) {
        append({ id: record.id, operationId: lead.operationId, negotiationID: lead.negotiationID, action: 'agent-failed', error: String(result?.error || 'unknown') });
        return { action: 'agent-failed' };
      }
      const split = splitThumbtackAgentReply(result.reply);
      // A valid ready block intentionally has no visible text. Do not replace
      // that with the generic fallback because the next estimate gate owns it.
      const visible = split.visibleReply ? sanitizeCustomerMessage(split.visibleReply) : { safe: true, text: '' };
      const action = split.malformed ? 'needs-review' : split.estimateReady ? 'ready-for-estimate-review' : 'drafted-reply';
      append({ id: record.id, operationId: lead.operationId, action, replySafe: visible.safe, reply: visible.text });

      // Auto-send is first-touch only: the draft goes out unattended solely when
      // no human or prior automation has ever answered this negotiation. The
      // history re-read happens at send time because drafting is slow — a manual
      // reply arriving mid-draft must win.
      const firstTouch = historyForNegotiation(eventsFile, lead.negotiationID).every(message => message.role === 'customer');
      const sendable = outboundEnabled && action === 'drafted-reply' && visible.safe && visible.text &&
        firstTouch && !hasAutoSentRecord(automationFile, lead.negotiationID) && !sendsInFlight.has(lead.negotiationID);
      if (!sendable) {
        await nudge(`Thumbtack ${action} for ${lead.customerName || 'customer'} (neg ${lead.negotiationID}): ${visible.text || 'no visible text'}`);
        return { action, reply: visible.text };
      }

      sendsInFlight.add(lead.negotiationID);
      try {
        await sendMessage(lead.negotiationID, visible.text);
        append({ id: record.id, operationId: lead.operationId, negotiationID: lead.negotiationID, action: 'auto-sent', reply: visible.text });
        return { action: 'auto-sent', reply: visible.text };
      } catch (error) {
        append({ id: record.id, operationId: lead.operationId, negotiationID: lead.negotiationID, action: 'send-failed', error: error?.message || 'unknown' });
        await nudge(`Thumbtack send-failed for ${lead.customerName || 'customer'} (neg ${lead.negotiationID}): ${error?.message || 'unknown'}`);
        return { action: 'send-failed', reply: visible.text };
      } finally {
        sendsInFlight.delete(lead.negotiationID);
      }
    },
  };
}
