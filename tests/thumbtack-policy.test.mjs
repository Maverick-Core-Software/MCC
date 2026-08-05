// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_FALLBACK,
  canCreateHcpEstimate,
  getThumbtackAutomationStatus,
  sanitizeCustomerMessage,
} from '../lib/thumbtack-policy.mjs';

describe('Thumbtack customer automation policy', () => {
  it('stays in shadow mode until both independent auto-reply controls are set', () => {
    expect(getThumbtackAutomationStatus({ autoReplyEnabled: true, nativeAutoReplyDisabled: false, hcpWritesEnabled: true }))
      .toMatchObject({ mode: 'shadow', outboundEnabled: false, hcpWritesEnabled: false });
    expect(getThumbtackAutomationStatus({ autoReplyEnabled: true, nativeAutoReplyDisabled: true, hcpWritesEnabled: false }))
      .toMatchObject({ mode: 'outbound-enabled', outboundEnabled: true, hcpWritesEnabled: false });
  });

  it('never permits HCP estimate creation without explicit consent, name, real address, and separate HCP gate', () => {
    const automation = getThumbtackAutomationStatus({ autoReplyEnabled: true, nativeAutoReplyDisabled: true, hcpWritesEnabled: true });
    expect(canCreateHcpEstimate({ explicitEstimateConsent: false, customerName: 'Sam', serviceAddress: '123 Main St', automation })).toBe(false);
    expect(canCreateHcpEstimate({ explicitEstimateConsent: true, customerName: '', serviceAddress: '123 Main St', automation })).toBe(false);
    expect(canCreateHcpEstimate({ explicitEstimateConsent: true, customerName: 'Sam', serviceAddress: '123 Main St', automation })).toBe(true);
  });

  it('replaces internal or malformed text with a safe office handoff', () => {
    expect(sanitizeCustomerMessage('I created your HCP customer record.')).toEqual({ safe: false, text: CUSTOMER_FALLBACK });
    expect(sanitizeCustomerMessage('What kind of electrical work can we help with?')).toEqual({ safe: true, text: 'What kind of electrical work can we help with?' });
  });
});
