// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProductionOAuthHandlers, createStagingOAuthHandlers } from '../routes/thumbtack-oauth.mjs';

// ── Helpers ─────────────────────────────────────────────────────────────────

const tempDirs = [];

function makeRequest(url = '/', method = 'GET') {
  const req = Readable.from([]);
  req.url = url;
  req.method = method;
  req.headers = { host: 'localhost' };
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

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-oauth-'));
  tempDirs.push(dir);
  return dir;
}

function makeTokenStorePath(tmpDir) {
  return path.join(tmpDir, 'tokens.json');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

// ── Config constants for test ───────────────────────────────────────────────

const TEST_CLIENT_ID = 'test-client-id';
const TEST_CLIENT_SECRET = 'test-client-secret';
const TEST_AUTH_URL = 'https://staging-auth.thumbtack.com/oauth2/auth';
const TEST_TOKEN_URL = 'https://staging-auth.thumbtack.com/oauth2/token';
const TEST_REDIRECT_URI = 'https://example.com/callback';
const TEST_SCOPE = 'offline_access supply::businesses.list supply::businesses/associate-phone-numbers.read';
const TEST_ENCRYPTION_KEY = 'test-encryption-key-32chars!!';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Thumbtack staging OAuth', () => {
  describe('handleStagingStart', () => {
    it('returns 503 when staging is not configured', () => {
      const { handleStagingStart } = createStagingOAuthHandlers({
        stagingClientId: '',
        stagingClientSecret: '',
        stagingAuthUrl: '',
        stagingTokenUrl: '',
        isConfigured: false,
      });
      const req = makeRequest('/api/integrations/thumbtack/oauth/staging/start');
      const res = makeResponse();
      handleStagingStart(req, res);
      expect(res.status).toBe(503);
    });

    it.each([
      ['scope is absent', { scope: '' }],
      ['scope is malformed', { scope: 'offline_access invalid scope!' }],
      ['encryption key is absent', { encryptionKey: '' }],
      ['token store path is absent', { tokenStorePath: '' }],
    ])('returns 503 when %s', (_reason, invalidConfig) => {
      const { handleStagingStart } = createStagingOAuthHandlers({
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingAuthUrl: TEST_AUTH_URL,
        stagingTokenUrl: TEST_TOKEN_URL,
        redirectUri: TEST_REDIRECT_URI,
        scope: TEST_SCOPE,
        encryptionKey: TEST_ENCRYPTION_KEY,
        tokenStorePath: makeTokenStorePath(makeTempDir()),
        isConfigured: true,
        ...invalidConfig,
      });
      const res = makeResponse();
      handleStagingStart(makeRequest('/api/integrations/thumbtack/oauth/staging/start'), res);
      expect(res.status).toBe(503);
    });

    it('redirects with correct params when configured', () => {
      const tmpDir = makeTempDir();
      const storePath = makeTokenStorePath(tmpDir);
      const { handleStagingStart } = createStagingOAuthHandlers({
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingAuthUrl: TEST_AUTH_URL,
        stagingTokenUrl: TEST_TOKEN_URL,
        redirectUri: TEST_REDIRECT_URI,
        scope: TEST_SCOPE,
        encryptionKey: TEST_ENCRYPTION_KEY,
        tokenStorePath: storePath,
        isConfigured: true,
      });

      const req = makeRequest('/api/integrations/thumbtack/oauth/staging/start');
      const res = makeResponse();
      handleStagingStart(req, res);

      expect(res.status).toBe(302);
      expect(res.headers).toBeDefined();
      const location = res.headers.Location;
      expect(location).toBeDefined();
      expect(location).toContain(TEST_AUTH_URL);

      const url = new URL(location);
      const params = url.searchParams;
      expect(params.get('client_id')).toBe(TEST_CLIENT_ID);
      expect(params.get('redirect_uri')).toBe(TEST_REDIRECT_URI);
      expect(params.get('response_type')).toBe('code');
      expect(params.get('scope')).toBe(TEST_SCOPE);
      expect(params.get('audience')).toBe('urn:partner-api');
      expect(params.get('state')).toBeDefined();
      expect(params.get('state').length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('handleStagingCallback', () => {
    let handlers;
    let tmpDir;
    let storePath;

    beforeEach(() => {
      tmpDir = makeTempDir();
      storePath = makeTokenStorePath(tmpDir);
      handlers = createStagingOAuthHandlers({
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingAuthUrl: TEST_AUTH_URL,
        stagingTokenUrl: TEST_TOKEN_URL,
        redirectUri: TEST_REDIRECT_URI,
        scope: TEST_SCOPE,
        encryptionKey: TEST_ENCRYPTION_KEY,
        tokenStorePath: storePath,
        isConfigured: true,
      });
    });

    function startOAuth() {
      // Generate a state by calling handleStagingStart
      const startReq = makeRequest('/api/integrations/thumbtack/oauth/staging/start');
      const startRes = makeResponse();
      handlers.handleStagingStart(startReq, startRes);
      const location = startRes.headers.Location;
      const state = new URL(location).searchParams.get('state');
      return state;
    }

    it('successfully exchanges code, saves tokens, returns success HTML', async () => {
      const state = startOAuth();

      // Mock fetch for the token exchange
      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'test-access-token-value',
          refresh_token: 'test-refresh-token-value',
          token_type: 'Bearer',
          scope: TEST_SCOPE,
          expires_in: 3600,
        }),
        text: async () => '',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const callbackUrl = `/api/integrations/thumbtack/oauth/staging/callback?code=test-auth-code&state=${state}`;
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      // Should return success
      expect(res.status).toBe(200);
      expect(res.body).toContain('Authorization Successful');
      expect(res.body).not.toContain('test-access-token-value');
      expect(res.body).not.toContain('test-refresh-token-value');
      expect(res.body).not.toContain('test-auth-code');
      expect(res.body).not.toContain(TEST_CLIENT_ID);
      expect(res.body).not.toContain(TEST_CLIENT_SECRET);

      // Verify fetch was called correctly
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const fetchCall = fetchSpy.mock.calls[0];
      expect(fetchCall[0]).toBe(TEST_TOKEN_URL);
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(fetchCall[1].headers['Authorization']).toContain('Basic ');
      const bodyStr = fetchCall[1].body.toString();
      expect(bodyStr).toContain('grant_type=authorization_code');
      expect(bodyStr).toContain('code=test-auth-code');
      expect(bodyStr).toContain(`redirect_uri=${encodeURIComponent(TEST_REDIRECT_URI)}`);

      // Verify tokens were persisted
      const store = await import('../lib/thumbtack-token-store.mjs');
      const tokenStore = store.createTokenStore({ encryptionKey: TEST_ENCRYPTION_KEY, storePath });
      const saved = tokenStore.loadTokens();
      expect(saved).not.toBeNull();
      expect(saved.accessToken).toBe('test-access-token-value');
      expect(saved.refreshToken).toBe('test-refresh-token-value');
      expect(saved.scope).toBe(TEST_SCOPE);
      expect(saved.environment).toBe('staging');
    });

    it('does not report success when durable token persistence fails', async () => {
      const handlersWithInvalidStorePath = createStagingOAuthHandlers({
        stagingClientId: TEST_CLIENT_ID,
        stagingClientSecret: TEST_CLIENT_SECRET,
        stagingAuthUrl: TEST_AUTH_URL,
        stagingTokenUrl: TEST_TOKEN_URL,
        redirectUri: TEST_REDIRECT_URI,
        scope: TEST_SCOPE,
        encryptionKey: TEST_ENCRYPTION_KEY,
        tokenStorePath: tmpDir,
        isConfigured: true,
      });
      const startRes = makeResponse();
      handlersWithInvalidStorePath.handleStagingStart(makeRequest(), startRes);
      const state = new URL(startRes.headers.Location).searchParams.get('state');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-access-token', refresh_token: 'new-refresh-token' }),
      });

      const res = makeResponse();
      await handlersWithInvalidStorePath.handleStagingCallback(
        makeRequest(`/api/integrations/thumbtack/oauth/staging/callback?code=test-code&state=${state}`),
        res,
      );

      expect(res.status).toBe(502);
      expect(res.body).not.toContain('Authorization Successful');
    });

    it('does not retain a prior refresh token on a fresh authorization-code exchange', async () => {
      const store = await import('../lib/thumbtack-token-store.mjs');
      store.createTokenStore({ encryptionKey: TEST_ENCRYPTION_KEY, storePath }).saveTokens({
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
      });
      const state = startOAuth();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-access-token' }),
      });

      const res = makeResponse();
      await handlers.handleStagingCallback(
        makeRequest(`/api/integrations/thumbtack/oauth/staging/callback?code=test-code&state=${state}`),
        res,
      );

      const saved = store.createTokenStore({ encryptionKey: TEST_ENCRYPTION_KEY, storePath }).loadTokens();
      expect(res.status).toBe(200);
      expect(saved.refreshToken).toBe('');
    });

    it('rejects expired state', async () => {
      const state = startOAuth();

      // Fast-forward time past STATE_TTL
      const STATE_TTL = 5 * 60 * 1000; // Must match the module constant
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + STATE_TTL + 1000);

      const callbackUrl = `/api/integrations/thumbtack/oauth/staging/callback?code=test-code&state=${state}`;
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      expect(res.status).toBe(400);
      expect(res.body).toContain('expired');
      expect(res.body).not.toContain('test-code');
    });

    it('rejects missing code param', async () => {
      const state = startOAuth();

      const callbackUrl = `/api/integrations/thumbtack/oauth/staging/callback?state=${state}`;
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      expect(res.status).toBe(400);
      expect(res.body).toContain('Missing authorization code');
    });

    it('rejects provider error (access_denied)', async () => {
      const state = startOAuth();

      const callbackUrl = `/api/integrations/thumbtack/oauth/staging/callback?error=access_denied&error_description=User+denied&state=${state}`;
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      expect(res.status).toBe(400);
      expect(res.body).toContain('Authorization Error');
      expect(res.body).not.toContain('test-code');
    });

    it('rejects token exchange failure (fetch returns 500)', async () => {
      const state = startOAuth();

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const callbackUrl = `/api/integrations/thumbtack/oauth/staging/callback?code=fail-code&state=${state}`;
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      expect(res.status).toBe(502);
      expect(res.body).toContain('Failed to exchange authorization code');
      expect(res.body).not.toContain('fail-code');
    });

    it('rejects invalid state (not in map)', async () => {
      const callbackUrl = '/api/integrations/thumbtack/oauth/staging/callback?code=test&state=invalid-state-that-does-not-exist';
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      expect(res.status).toBe(400);
      expect(res.body).toContain('Invalid state');
    });

    it('rejects missing state parameter', async () => {
      const callbackUrl = '/api/integrations/thumbtack/oauth/staging/callback?code=test';
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      expect(res.status).toBe(400);
      expect(res.body).toContain('Missing state');
    });

    it('enforces single-use: second callback with same state rejected', async () => {
      const state = startOAuth();

      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'test-access-token-abc',
          refresh_token: 'test-refresh-token-xyz',
          token_type: 'Bearer',
          scope: TEST_SCOPE,
          expires_in: 3600,
        }),
        text: async () => '',
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      // First call — success
      const firstUrl = `/api/integrations/thumbtack/oauth/staging/callback?code=first-code&state=${state}`;
      const firstRes = makeResponse();
      await handlers.handleStagingCallback(makeRequest(firstUrl), firstRes);
      expect(firstRes.status).toBe(200);

      // Second call with same state — should be rejected
      const secondUrl = `/api/integrations/thumbtack/oauth/staging/callback?code=second-code&state=${state}`;
      const secondRes = makeResponse();
      await handlers.handleStagingCallback(makeRequest(secondUrl), secondRes);
      expect(secondRes.status).toBe(400);
      expect(secondRes.body).toContain('Invalid state');
    });

    it('response bodies contain no tokens, secrets, or codes', async () => {
      const state = startOAuth();

      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'secret-access-token-42',
          refresh_token: 'secret-refresh-token-99',
          token_type: 'Bearer',
          scope: TEST_SCOPE,
          expires_in: 3600,
        }),
        text: async () => '',
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const callbackUrl = `/api/integrations/thumbtack/oauth/staging/callback?code=the-secret-code&state=${state}`;
      const req = makeRequest(callbackUrl);
      const res = makeResponse();
      await handlers.handleStagingCallback(req, res);

      const body = res.body;
      // Verify no secrets leaked in response
      expect(body).not.toContain('secret-access-token-42');
      expect(body).not.toContain('secret-refresh-token-99');
      expect(body).not.toContain('the-secret-code');
      expect(body).not.toContain(TEST_CLIENT_ID);
      expect(body).not.toContain(TEST_CLIENT_SECRET);
      expect(body).not.toContain('token');
      // test-code might appear in error messages like "Missing authorization code"
      // but the actual auth code "the-secret-code" should not appear anywhere
    });
  });
});

describe('Thumbtack production OAuth', () => {
  it('uses isolated production configuration and marks stored tokens as production', async () => {
    const tmpDir = makeTempDir();
    const storePath = makeTokenStorePath(tmpDir);
    const handlers = createProductionOAuthHandlers({
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      authUrl: 'https://auth.thumbtack.com/oauth2/auth',
      tokenUrl: 'https://auth.thumbtack.com/oauth2/token',
      redirectUri: TEST_REDIRECT_URI,
      scope: TEST_SCOPE,
      encryptionKey: TEST_ENCRYPTION_KEY,
      tokenStorePath: storePath,
      isConfigured: true,
    });
    const startRes = makeResponse();
    handlers.handleStagingStart(makeRequest('/api/integrations/thumbtack/oauth/start'), startRes);
    const location = new URL(startRes.headers.Location);
    const state = location.searchParams.get('state');
    expect(location.origin).toBe('https://auth.thumbtack.com');
    expect(location.searchParams.get('scope')).toBe(TEST_SCOPE);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'production-access-token',
        refresh_token: 'production-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      text: async () => '',
    });
    const callbackRes = makeResponse();
    await handlers.handleStagingCallback(
      makeRequest(`/api/integrations/thumbtack/oauth/callback?code=test-code&state=${state}`),
      callbackRes,
    );
    const store = await import('../lib/thumbtack-token-store.mjs');
    const saved = store.createTokenStore({ encryptionKey: TEST_ENCRYPTION_KEY, storePath }).loadTokens();
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body).toContain('Thumbtack production OAuth');
    expect(saved.environment).toBe('production');
  });
});
