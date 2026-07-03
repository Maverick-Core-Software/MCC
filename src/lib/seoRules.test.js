import { describe, it, expect } from 'vitest';
import { postHealth, healthReason } from './seoRules';

describe('postHealth', () => {
  it('returns neutral for non-posted statuses', () => {
    expect(postHealth({ status: 'scheduled' })).toEqual({ state: 'neutral', reason: null });
    expect(postHealth({ status: 'pending_approval' })).toEqual({ state: 'neutral', reason: null });
    expect(postHealth({ status: 'approved' })).toEqual({ state: 'neutral', reason: null });
  });

  it('returns neutral for null/undefined', () => {
    expect(postHealth(null)).toEqual({ state: 'neutral', reason: null });
    expect(postHealth(undefined)).toEqual({ state: 'neutral', reason: null });
  });

  it('returns green for a fully-verified posted video', () => {
    expect(postHealth({
      status: 'posted', type: 'video', media_status: 'video', platform_post_id: 'fb_123',
    })).toEqual({ state: 'green', reason: null });
  });

  it('returns green for a posted photo with platform_post_id', () => {
    expect(postHealth({
      status: 'posted', type: 'photo', media_status: 'photo', platform_post_id: 'fb_456',
    })).toEqual({ state: 'green', reason: null });
  });

  it('returns red when media downgraded (video → photo)', () => {
    const h = postHealth({
      status: 'posted', type: 'video', media_status: 'downgraded', platform_post_id: 'fb_1',
    });
    expect(h.state).toBe('red');
    expect(h.reason).toBe('VIDEO → PHOTO');
  });

  it('returns red when media is none', () => {
    const h = postHealth({
      status: 'posted', type: 'video', media_status: 'none', platform_post_id: 'fb_1',
    });
    expect(h.state).toBe('red');
    expect(h.reason).toBe('NO MEDIA');
  });

  it('returns red when platform_post_id is null on a posted row', () => {
    const h = postHealth({
      status: 'posted', type: 'video', media_status: 'video', platform_post_id: null,
    });
    expect(h.state).toBe('red');
    expect(h.reason).toBe('NO POST ID');
  });

  it('returns red when type=video but media_status is photo (mismatch)', () => {
    // platform_post_id present, so this exercises the type_mismatch branch specifically
    const h = postHealth({
      status: 'posted', type: 'video', media_status: 'photo', platform_post_id: 'fb_1',
    });
    expect(h.state).toBe('red');
    expect(h.reason).toBe('TYPE MISMATCH');
  });

  it('downgraded reason takes precedence over missing post id', () => {
    // First-match wins — fallback media is the most user-actionable signal.
    const h = postHealth({
      status: 'posted', type: 'video', media_status: 'downgraded', platform_post_id: null,
    });
    expect(h.state).toBe('red');
    expect(h.reason).toBe('VIDEO → PHOTO');
  });
});

describe('healthReason', () => {
  it('returns the reason for red rows', () => {
    expect(healthReason({
      status: 'posted', type: 'video', media_status: 'none', platform_post_id: 'fb_1',
    })).toBe('NO MEDIA');
  });

  it('returns null for green / neutral rows', () => {
    expect(healthReason({
      status: 'posted', type: 'video', media_status: 'video', platform_post_id: 'fb_1',
    })).toBeNull();
    expect(healthReason({ status: 'scheduled' })).toBeNull();
  });
});
