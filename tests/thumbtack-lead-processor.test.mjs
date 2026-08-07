// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createThumbtackLeadProcessor } from '../lib/thumbtack-lead-processor.mjs';

const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function makeFixture({ priorEvents = [], priorAutomation = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-thumbtack-')); dirs.push(dir);
  const eventsFile = path.join(dir, 'events.jsonl');
  const automationFile = path.join(dir, 'automation.jsonl');
  const record = { id: 'a'.repeat(64), eventType: 'MessageCreatedV4', negotiationID: 'neg-1', payload: { data: { from: 'customer', messageID: 'm-1', negotiationID: 'neg-1', text: 'Need an EV charger', customer: { displayName: 'Sam' } } } };
  fs.writeFileSync(eventsFile, [...priorEvents, record].map(r => JSON.stringify(r)).join('\n') + '\n');
  if (priorAutomation.length) fs.writeFileSync(automationFile, priorAutomation.map(r => JSON.stringify(r)).join('\n') + '\n');
  return { eventsFile, automationFile, record };
}

function businessEvent(negotiationID = 'neg-1', text = 'Hi, this is Jaime.') {
  return { id: 'f'.repeat(64), eventType: 'MessageCreatedV4', negotiationID, payload: { data: { from: 'Business', messageID: 'm-0', negotiationID, text } } };
}

function automationRecords(automationFile) {
  return fs.readFileSync(automationFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

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

  it('auto-sends a safe first-touch draft when outbound is enabled', async () => {
    const { eventsFile, automationFile, record } = makeFixture();
    const sent = [];
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => ({ success: true, reply: 'What amperage charger are you planning for?' }),
      sendMessage: async (negotiationID, text) => { sent.push({ negotiationID, text }); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'auto-sent' });
    expect(sent).toEqual([{ negotiationID: 'neg-1', text: 'What amperage charger are you planning for?' }]);
    expect(automationRecords(automationFile).at(-1)).toMatchObject({ action: 'auto-sent', negotiationID: 'neg-1' });
  });

  it('does not auto-send when the negotiation already has a business message', async () => {
    const { eventsFile, automationFile, record } = makeFixture({ priorEvents: [businessEvent()] });
    const sent = [];
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => ({ success: true, reply: 'Following up on your project.' }),
      sendMessage: async (...args) => { sent.push(args); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'drafted-reply' });
    expect(sent).toEqual([]);
  });

  it('does not auto-send when outbound is disabled', async () => {
    const { eventsFile, automationFile, record } = makeFixture();
    const sent = [];
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: false,
      generateReply: async () => ({ success: true, reply: 'What amperage charger are you planning for?' }),
      sendMessage: async (...args) => { sent.push(args); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'drafted-reply' });
    expect(sent).toEqual([]);
  });

  it('does not auto-send when a business reply arrives while drafting', async () => {
    const { eventsFile, automationFile, record } = makeFixture();
    const sent = [];
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => {
        fs.appendFileSync(eventsFile, `${JSON.stringify(businessEvent('neg-1', 'Manual reply from the office'))}\n`);
        return { success: true, reply: 'What amperage charger are you planning for?' };
      },
      sendMessage: async (...args) => { sent.push(args); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'drafted-reply' });
    expect(sent).toEqual([]);
  });

  it('does not auto-send a negotiation that already has an auto-sent record', async () => {
    const { eventsFile, automationFile, record } = makeFixture({
      priorAutomation: [{ id: 'e'.repeat(64), negotiationID: 'neg-1', action: 'auto-sent' }],
    });
    const sent = [];
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => ({ success: true, reply: 'Another draft.' }),
      sendMessage: async (...args) => { sent.push(args); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'drafted-reply' });
    expect(sent).toEqual([]);
  });

  it('does not auto-send a draft the sanitizer flagged as unsafe', async () => {
    const { eventsFile, automationFile, record } = makeFixture();
    const sent = [];
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => ({ success: true, reply: 'Our API endpoint shows customer id cus_123.' }),
      sendMessage: async (...args) => { sent.push(args); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'drafted-reply' });
    expect(sent).toEqual([]);
    expect(automationRecords(automationFile).at(-1)).toMatchObject({ action: 'drafted-reply', replySafe: false });
  });

  it('records send-failed and does not throw when the channel send fails', async () => {
    const { eventsFile, automationFile, record } = makeFixture();
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => ({ success: true, reply: 'What amperage charger are you planning for?' }),
      sendMessage: async () => { throw new Error('Thumbtack API error (HTTP 500)'); },
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'send-failed' });
    expect(automationRecords(automationFile).at(-1)).toMatchObject({ action: 'send-failed', negotiationID: 'neg-1' });
  });

  it('records agent-failed in the automation log when the agent cannot draft', async () => {
    const { eventsFile, automationFile, record } = makeFixture();
    const processor = createThumbtackLeadProcessor({
      eventsFile, automationFile, outboundEnabled: true,
      generateReply: async () => ({ success: false, error: 'Agent timed out.' }),
      sendMessage: async () => {},
    });
    await expect(processor.process(record)).resolves.toMatchObject({ action: 'agent-failed' });
    expect(automationRecords(automationFile).at(-1)).toMatchObject({ action: 'agent-failed', error: 'Agent timed out.' });
  });
});
