// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createThumbtackApiClient } from '../lib/thumbtack-api.mjs';

// ── Test constants ───────────────────────────────────────────────────────────

const TEST_API_BASE = 'https://staging-api.thumbtack.com';
const TEST_TOKEN_URL = 'https://staging-auth.thumbtack.com/oauth2/token';
const TEST_CLIENT_ID = 'test-client-id';
const TEST_CLIENT_SECRET = 'test-client-secret';

// ── Helpers ──────────────────────────────────────────────────────────────────

const freshTokenSet = () => ({
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  tokenType: 'Bearer',
  scope: 'offline_access supply::negotiations.write',
  environment: 'staging',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 3600_000, // 1 hour from now
  lastRefreshOutcome: 'saved',
});

const expiredTokenSet = () => ({
  ...freshTokenSet(),
  expiresAt: Date.now() - 60_000, // expired 1 minute ago
});

function makeMockStore(overrides = {}) {
  const tokens = overrides.initialTokens ?? freshTokenSet();
  let currentTokens = tokens;

  return {
    loadTokens: vi.fn(() => currentTokens),
    saveTokens: vi.fn((ts) => { currentTokens = ts; }),
    withRefreshLock: vi.fn(async (fn) => fn()),
    // Allow tests to inject a custom token set mid-test
    _setTokens: (newTokens) => { currentTokens = newTokens; },
  };
}

function makeMockFetch(status = 200, body = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => name === 'x-request-id' ? 'test-req-123' : null,
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Thumbtack API client', () => {
  describe('factory', () => {
    it('throws when apiBaseUrl is not provided and config is empty', () => {
      expect(() => createThumbtackApiClient({ apiBaseUrl: '' })).toThrow(/apiBaseUrl/i);
    });

    it('rejects an unsupported environment', () => {
      expect(() => createThumbtackApiClient({ environment: 'development', apiBaseUrl: TEST_API_BASE })).toThrow(/environment/i);
    });

    it('uses an explicitly supplied production API base without enabling writes', async () => {
      const fetchSpy = makeMockFetch(200, { businesses: [] });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);
      const client = createThumbtackApiClient({
        environment: 'production',
        apiBaseUrl: 'https://api.thumbtack.com',
        tokenStore: makeMockStore(),
      });
      await client.getBusinesses();
      expect(fetchSpy.mock.calls[0][0]).toBe('https://api.thumbtack.com/api/v4/businesses');
      await expect(client.sendMessage('neg-1', 'test')).rejects.toThrow(/disabled/i);
    });
  });

  describe('read primitives', () => {
    it('getBusinesses calls correct staging URL and returns data', async () => {
      const mockData = { businesses: [{ id: 'biz-1', name: 'Test Biz' }] };
      const fetchSpy = makeMockFetch(200, mockData);
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      const result = await client.getBusinesses();
      expect(result).toEqual(mockData);

      const callUrl = fetchSpy.mock.calls[0][0];
      expect(callUrl).toBe('https://staging-api.thumbtack.com/api/v4/businesses');
      expect(callUrl).not.toMatch(/:\/\/api\.thumbtack\.com/); // no production hostname

      const callOpts = fetchSpy.mock.calls[0][1];
      expect(callOpts.method).toBe('GET');
      expect(callOpts.headers['Authorization']).toBe('Bearer test-access-token');
    });

    it('getBusiness sends correct path with ID', async () => {
      const fetchSpy = makeMockFetch(200, { id: 'biz-42', name: 'Acme' });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      await client.getBusiness('biz-42');
      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('/api/v4/businesses/biz-42');
    });

    it('getNegotiation sends correct path', async () => {
      const fetchSpy = makeMockFetch(200, { id: 'neg-1' });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      await client.getNegotiation('neg-1');
      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('/api/v4/negotiations/neg-1');
    });

    it('getMessageHistory sends correct path', async () => {
      const fetchSpy = makeMockFetch(200, []);
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      await client.getMessageHistory('neg-1');
      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('/api/v4/negotiations/neg-1/messages');
    });

    it('getBusinessAssociatePhoneNumbers sends correct path', async () => {
      const fetchSpy = makeMockFetch(200, { phoneNumbers: [] });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      await client.getBusinessAssociatePhoneNumbers('biz-1');
      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('/api/v4/businesses/biz-1/associate-phone-numbers');
    });
  });

  describe('write gates (disabled by default)', () => {
    it('sendMessage throws when allowWrites is false (default)', async () => {
      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        tokenStore: makeMockStore(),
      });

      await expect(client.sendMessage('neg-1', 'Hello')).rejects.toThrow(/Write operations are disabled/i);
    });

    it('sendMessage succeeds when allowWrites is true', async () => {
      const fetchSpy = makeMockFetch(200, { messageID: 'msg-1' });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
        allowWrites: true,
      });

      const result = await client.sendMessage('neg-1', 'What is your price?');
      expect(result).toEqual({ messageID: 'msg-1' });

      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('/api/v4/negotiations/neg-1/messages');

      const callOpts = fetchSpy.mock.calls[0][1];
      expect(callOpts.method).toBe('POST');
      expect(JSON.parse(callOpts.body)).toEqual({ text: 'What is your price?' });
    });

    it('postJobSignal throws when allowWrites is false (default)', async () => {
      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        tokenStore: makeMockStore(),
      });

      await expect(client.postJobSignal('neg-1', { status: 'appt_scheduled' })).rejects.toThrow(/Write operations are disabled/i);
    });

    it('postJobSignal succeeds when allowWrites is true', async () => {
      const fetchSpy = makeMockFetch(200, {});
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const payload = { status: 'appt_scheduled', scheduledDate: '2026-07-25' };
      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
        allowWrites: true,
      });

      const result = await client.postJobSignal('neg-1', payload);
      expect(result).toEqual({});

      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('/api/v4/negotiations/neg-1/job-status');

      const callOpts = fetchSpy.mock.calls[0][1];
      expect(callOpts.method).toBe('POST');
      expect(JSON.parse(callOpts.body)).toEqual(payload);
    });
  });

  describe('token refresh', () => {
    it('refreshes expired token, saves new tokens, retries request', async () => {
      const mockStore = makeMockStore({ initialTokens: expiredTokenSet() });
      const saveTokensSpy = mockStore.saveTokens;

      // First fetch call is the token refresh POST
      // Second fetch call is the actual API request
      const fetchSpy = vi.fn()
        // First call: token refresh response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        })
        // Second call: the actual API request
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => 'req-456' },
          text: async () => JSON.stringify({ businesses: [{ id: 'biz-1' }] }),
          json: async () => ({ businesses: [{ id: 'biz-1' }] }),
        });

      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: mockStore,
      });

      const result = await client.getBusinesses();
      expect(result).toEqual({ businesses: [{ id: 'biz-1' }] });

      // Verify token refresh call
      const refreshCallUrl = fetchSpy.mock.calls[0][0];
      expect(refreshCallUrl).toBe(TEST_TOKEN_URL);
      const refreshCallOpts = fetchSpy.mock.calls[0][1];
      expect(refreshCallOpts.method).toBe('POST');
      expect(refreshCallOpts.headers['Authorization']).toContain('Basic ');
      expect(refreshCallOpts.body.toString()).toContain('grant_type=refresh_token');
      expect(refreshCallOpts.body.toString()).toContain('refresh_token=test-refresh-token');

      // Verify new tokens were saved
      expect(saveTokensSpy).toHaveBeenCalledTimes(1);
      const savedArgs = saveTokensSpy.mock.calls[0][0];
      expect(savedArgs.accessToken).toBe('new-access-token');
      expect(savedArgs.refreshToken).toBe('new-refresh-token');

      // Verify the actual API request used the new token
      const apiCallOpts = fetchSpy.mock.calls[1][1];
      expect(apiCallOpts.headers['Authorization']).toBe('Bearer new-access-token');
    });

    it('retains the current refresh token when a refresh response omits it', async () => {
      const mockStore = makeMockStore({ initialTokens: expiredTokenSet() });
      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ businesses: [] }),
        });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: mockStore,
      });
      await client.getBusinesses();

      expect(mockStore.saveTokens.mock.calls[0][0].refreshToken).toBe('test-refresh-token');
    });

    it('uses withRefreshLock for serialized refresh', async () => {
      const mockStore = makeMockStore({ initialTokens: expiredTokenSet() });
      // Replace withRefreshLock with a spy that actually serializes
      mockStore.withRefreshLock = vi.fn(async (fn) => fn());

      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ access_token: 'refreshed-token', refresh_token: 'new-rt', token_type: 'Bearer', expires_in: 3600 }),
          json: async () => ({ access_token: 'refreshed-token', refresh_token: 'new-rt', token_type: 'Bearer', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ businesses: [] }),
          json: async () => ({ businesses: [] }),
        });

      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: mockStore,
      });

      await client.getBusinesses();

      // withRefreshLock was called
      expect(mockStore.withRefreshLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('API returns 500 → redacted error (no token in error message)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: (name) => name === 'x-request-id' ? 'err-req-001' : null },
        text: async () => 'Internal Server Error',
        json: async () => { throw new Error('not json'); },
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      let thrownError;
      try {
        await client.getBusinesses();
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.message).toContain('HTTP 500');
      // No token values in error message
      expect(thrownError.message).not.toContain('test-access-token');
      expect(thrownError.message).not.toContain('Bearer');
      // No Authorization header content leaked
      expect(thrownError.message).not.toContain('Authorization');
    });

    it('no token in store throws a clear error', async () => {
      const storeNoTokens = makeMockStore();
      storeNoTokens.loadTokens = vi.fn(() => null);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: storeNoTokens,
      });

      await expect(client.getBusinesses()).rejects.toThrow(/No access token available/i);
    });
  });

  describe('no production URLs', () => {
    function collectAllPaths(client) {
      return [
        ['getBusinesses', () => client.getBusinesses()],
        ['getBusiness', () => client.getBusiness('biz-1')],
        ['getNegotiation', () => client.getNegotiation('neg-1')],
        ['getMessageHistory', () => client.getMessageHistory('neg-1')],
        ['getBusinessAssociatePhoneNumbers', () => client.getBusinessAssociatePhoneNumbers('biz-1')],
      ];
    }

    it('all read primitives use staging base URL, not production', async () => {
      const fetchSpy = makeMockFetch(200, {});
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy);

      const client = createThumbtackApiClient({
        apiBaseUrl: TEST_API_BASE,
        stagingTokenUrl: TEST_TOKEN_URL,
        tokenStore: makeMockStore(),
      });

      const paths = collectAllPaths(client);
      for (const [, fn] of paths) {
        await fn();
      }

      // Every call URL must be to staging-api.thumbtack.com, never api.thumbtack.com
      const allUrls = fetchSpy.mock.calls.map((c) => c[0]);
      for (const url of allUrls) {
        expect(url).toContain('staging-api.thumbtack.com');
        expect(url).not.toContain('://api.thumbtack.com');
      }
    });
  });
});
