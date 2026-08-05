import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { hcpDir, thumbtackAutomationFile, thumbtackEventsFile } from './config.mjs';
import { extractCustomerLeadEvent, splitThumbtackAgentReply } from './thumbtack-lead-state.mjs';
import { sanitizeCustomerMessage } from './thumbtack-policy.mjs';

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

export function generateThumbtackReply(input, { projectDir = hcpDir } = {}) {
  return new Promise(resolve => {
    if (!projectDir || !fs.existsSync(projectDir)) { resolve({ success: false, error: 'Agent project unavailable.' }); return; }
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const proc = spawn(command, ['tsx', 'src/automations/thumbtack/customer-reply.ts'], { cwd: projectDir, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const finish = value => resolve(value);
    const timer = setTimeout(() => { proc.kill(); finish({ success: false, error: 'Agent timed out.' }); }, 90_000);
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.on('error', () => { clearTimeout(timer); finish({ success: false, error: 'Agent could not start.' }); });
    proc.on('close', () => { clearTimeout(timer); try { finish(JSON.parse(output)); } catch { finish({ success: false, error: 'Invalid agent response.' }); } });
    proc.stdin.end(JSON.stringify(input));
  });
}

export function createThumbtackLeadProcessor({ eventsFile = thumbtackEventsFile, automationFile = thumbtackAutomationFile, generateReply = generateThumbtackReply } = {}) {
  return {
    async process(record) {
      const lead = extractCustomerLeadEvent(record);
      if (!lead) return { action: 'ignored-noncustomer-event' };
      const result = await generateReply({ customerName: lead.customerName, history: historyForNegotiation(eventsFile, lead.negotiationID) });
      if (!result?.success) return { action: 'agent-failed' };
      const split = splitThumbtackAgentReply(result.reply);
      // A valid ready block intentionally has no visible text. Do not replace
      // that with the generic fallback because the next estimate gate owns it.
      const visible = split.visibleReply ? sanitizeCustomerMessage(split.visibleReply) : { safe: true, text: '' };
      const action = split.malformed ? 'needs-review' : split.estimateReady ? 'ready-for-estimate-review' : 'drafted-reply';
      fs.appendFileSync(automationFile, `${JSON.stringify({ id: record.id, operationId: lead.operationId, action, replySafe: visible.safe, reply: visible.text, createdAt: new Date().toISOString() })}\n`, 'utf8');
      return { action, reply: visible.text };
    },
  };
}
