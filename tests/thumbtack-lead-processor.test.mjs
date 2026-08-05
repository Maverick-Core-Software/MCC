// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createThumbtackLeadProcessor } from '../lib/thumbtack-lead-processor.mjs';

const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

describe('Thumbtack lead processor', () => {
  it('creates a shadow draft and never sends through the channel', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-thumbtack-')); dirs.push(dir);
    const eventsFile = path.join(dir, 'events.jsonl'); const automationFile = path.join(dir, 'automation.jsonl');
    const record = { id: 'b'.repeat(64), eventType: 'MessageCreatedV4', negotiationID: 'neg-1', payload: { data: { from: 'customer', messageID: 'm-1', negotiationID: 'neg-1', text: 'Need an EV charger', customer: { displayName: 'Sam' } } } };
    fs.writeFileSync(eventsFile, `${JSON.stringify(record)}\n`);
    const processor = createThumbtackLeadProcessor({ eventsFile, automationFile, generateReply: async input => {
      expect(input.history).toEqual([{ role: 'customer', text: 'Need an EV charger' }]);
      return { success: true, reply: 'What amperage charger are you planning for?' };
    } });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'drafted-reply', reply: 'What amperage charger are you planning for?' });
    expect(JSON.parse(fs.readFileSync(automationFile, 'utf8'))).toMatchObject({ action: 'drafted-reply', replySafe: true });
  });

  it('holds estimate-ready output for review rather than creating an estimate', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-thumbtack-')); dirs.push(dir);
    const eventsFile = path.join(dir, 'events.jsonl'); const automationFile = path.join(dir, 'automation.jsonl');
    const record = { id: 'c'.repeat(64), eventType: 'MessageCreatedV4', negotiationID: 'neg-2', payload: { data: { from: 'customer', messageID: 'm-2', negotiationID: 'neg-2', text: 'Yes, make an estimate', customer: {} } } };
    fs.writeFileSync(eventsFile, `${JSON.stringify(record)}\n`);
    const processor = createThumbtackLeadProcessor({ eventsFile, automationFile, generateReply: async () => ({ success: true, reply: '[THUMBTACK_ESTIMATE_READY]{"scope":"EV charger"}[/THUMBTACK_ESTIMATE_READY]' }) });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'ready-for-estimate-review' });
    expect(JSON.parse(fs.readFileSync(automationFile, 'utf8'))).toMatchObject({ action: 'ready-for-estimate-review', reply: '' });
  });
});
