// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTokenStore } from '../lib/thumbtack-token-store.mjs';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-token-store-'));
  tempDirs.push(dir);
  return dir;
}

function makeStorePath(tmpDir) {
  return path.join(tmpDir, 'tokens.json');
}

function dummyTokenSet(overrides = {}) {
  return {
    accessToken: 'test-access-token-abc123',
    refreshToken: 'test-refresh-token-xyz789',
    tokenType: 'Bearer',
    scope: 'business:phone_numbers negotiations:read',
    environment: 'staging',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Thumbtack token store', () => {
  // ── Round trip ──────────────────────────────────────────────────────────

  it('round-trips tokens: saveTokens → loadTokens values match', () => {
    const tmpDir = makeTempDir();
    const storePath = makeStorePath(tmpDir);
    const store = createTokenStore({ encryptionKey: 'test-key-1234', storePath });
    const tokens = dummyTokenSet();

    store.saveTokens(tokens);
    const loaded = store.loadTokens();

    expect(loaded).not.toBeNull();
    expect(loaded.accessToken).toBe(tokens.accessToken);
    expect(loaded.refreshToken).toBe(tokens.refreshToken);
    expect(loaded.tokenType).toBe(tokens.tokenType);
    expect(loaded.scope).toBe(tokens.scope);
    expect(loaded.environment).toBe(tokens.environment);
  });

  // ── Plaintext never leaks to disk ────────────────────────────────────────

  it('never writes plaintext token values to the store file', () => {
    const tmpDir = makeTempDir();
    const storePath = makeStorePath(tmpDir);
    const store = createTokenStore({ encryptionKey: 'test-key-1234', storePath });
    const tokens = dummyTokenSet();

    store.saveTokens(tokens);

    const raw = fs.readFileSync(storePath, 'utf8');
    // The token values should NOT appear as plaintext in the file.
    expect(raw).not.toContain(tokens.accessToken);
    expect(raw).not.toContain(tokens.refreshToken);
  });

  // ── Missing encryption key ───────────────────────────────────────────────

  it('throws when encryptionKey is missing (fails closed)', () => {
    expect(() => {
      createTokenStore({ storePath: '/tmp/nonexistent.json' });
    }).toThrow(/encryptionKey/i);
  });

  // ── Mismatched encryption key ────────────────────────────────────────────

  it('throws on load when encryption key does not match', () => {
    const tmpDir = makeTempDir();
    const storePath = makeStorePath(tmpDir);
    const storeA = createTokenStore({ encryptionKey: 'correct-key', storePath });
    storeA.saveTokens(dummyTokenSet());

    const storeB = createTokenStore({ encryptionKey: 'wrong-key', storePath });
    expect(() => storeB.loadTokens()).toThrow();
  });

  // ── withRefreshLock serialization ─────────────────────────────────────────

  it('serializes concurrent withRefreshLock calls', async () => {
    const tmpDir = makeTempDir();
    const storePath = makeStorePath(tmpDir);
    const store = createTokenStore({ encryptionKey: 'test-key-lock', storePath });
    const executionOrder = [];

    const slowFn = async (id) => {
      executionOrder.push(`start-${id}`);
      // Simulate a slow async operation (e.g. token refresh HTTP call).
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push(`end-${id}`);
    };

    // Launch two concurrent refresh lock calls.
    await Promise.all([
      store.withRefreshLock(() => slowFn(1)),
      store.withRefreshLock(() => slowFn(2)),
    ]);

    // Verify serialization: one started and finished before the other started.
    expect(executionOrder).toEqual([
      'start-1',
      'end-1',
      'start-2',
      'end-2',
    ]);
  });

  // ── Non-existent file returns null ───────────────────────────────────────

  it('returns null when store file does not exist', () => {
    const tmpDir = makeTempDir();
    const storePath = path.join(tmpDir, 'nonexistent.json');
    const store = createTokenStore({ encryptionKey: 'test-key', storePath });
    expect(store.loadTokens()).toBeNull();
  });
});
