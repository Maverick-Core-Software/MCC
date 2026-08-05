// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { extractCustomerLeadEvent, splitThumbtackAgentReply } from '../lib/thumbtack-lead-state.mjs';

describe('Thumbtack lead-state intake', () => {
  it('accepts only complete customer-originated message events', () => {
    const record = {
      id: 'a'.repeat(64),
      payload: {
        event: { eventType: 'MessageCreatedV4' },
        data: {
          from: 'Customer', messageID: 'msg-1', negotiationID: 'neg-1', text: 'I need an EV charger',
          customer: { displayName: 'Jamie Example' },
        },
      },
    };
    expect(extractCustomerLeadEvent(record)).toEqual({
      operationId: `thumbtack-${record.id}`,
      negotiationID: 'neg-1',
      messageID: 'msg-1',
      customerName: 'Jamie Example',
      text: 'I need an EV charger',
    });
    expect(extractCustomerLeadEvent({ ...record, payload: { ...record.payload, data: { ...record.payload.data, from: 'business' } } })).toBeNull();
  });

  it('never leaves an internal estimate handoff block in visible output', () => {
    expect(splitThumbtackAgentReply('Great — what amperage do you need? [THUMBTACK_ESTIMATE_READY]{"scope":"x"}[/THUMBTACK_ESTIMATE_READY]'))
      .toEqual({ visibleReply: 'Great — what amperage do you need?', estimateReady: { scope: 'x' }, malformed: false });
    expect(splitThumbtackAgentReply('[THUMBTACK_ESTIMATE_READY]not json[/THUMBTACK_ESTIMATE_READY]'))
      .toEqual({ visibleReply: '', estimateReady: null, malformed: true });
  });
});
