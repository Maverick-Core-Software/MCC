# PLAN.md — Thumbtack Staging OAuth & Partner API Integration

**Created:** 2026-07-22
**Planner model:** glm-5.2 (orchestrator-as-planner)
**Research run:** none (pre-scoped PLANSCOPE — existing prose plan restructured into wave format)
**Target repo:** `C:\Workspace\Active\MCC`
**Base branch:** `main`

## Outcome

Turn the already-approved Thumbtack staging credentials into a secure, testable MCC integration: staging authorization-code OAuth with encrypted token persistence, narrow read-only partner API adapters (business phone numbers, negotiations, messages, job signals), and safe validation — all without enabling automatic customer messaging, HCP writes, or production access.

## Non-goals

- Production authorization or production credential use
- Automatic replies, job-status updates, or Housecall Pro writes
- Changing the existing capture-only webhook contract, PM2 process state, Tailscale Funnel, or any deployed service without separate approval
- No Thumbtack message send or Job Signal post without explicit per-action approval

## Credential rules (all sessions)

- Never put Client IDs, Client Secrets, access tokens, refresh tokens, or one-time-note URLs in Git, tests, logs, screenshots, PLAN.md, or chat.
- Carter enters credentials directly into the established local secret source (`.env`).
- The executor verifies presence only (`Boolean(process.env.X)`), never values.
- Do not open a self-destructing credential note until the local secret fields and staging callback implementation are ready to receive it.
- **Tool-output redaction:** Hermes sanitizes phone-number-like digit strings as `****` in tool output. Verify with `grep` before reporting masked-looking values as defects.

## Risks

- **Staging endpoints may differ from production defaults** → Session 1 researches exact staging URLs from official Thumbtack docs; never infer a staging hostname from production.
- **Token race conditions on concurrent refresh** → Session 2 implements serialized refresh (mutex/queue pattern).
- **State replay / callback spoofing** → Session 3 uses cryptographic, single-use, short-lived state records validated before code exchange.
- **Environment crossover (staging → production)** → Session 2 validates environment selection; staging code paths cannot use production credentials.
- **Unintentional write paths** → Sessions 4–5 implement send/post capabilities behind disabled-by-default gates.
- **Thumbtack API docs may require web research** → Session 1 dispatched to a worker with web access; findings carry as plan assumptions if docs are inaccessible.

## Acceptance criteria

- [ ] The registered staging callback (`/api/integrations/thumbtack/oauth/staging/callback`) produces an OAuth success or safe failure response, never the dashboard SPA
- [ ] MCC cannot use production credentials or endpoints while staging mode is selected
- [ ] Tokens are encrypted at rest, redacted in logs, and refresh safely (serialized)
- [ ] OAuth state is unguessable, short-lived, single-use, and validated before the code exchange
- [ ] Business phone-number reads and job-signal capabilities are implemented behind disabled-by-default write gates
- [ ] Existing capture-only webhook tests (`tests/thumbtack-webhook.test.mjs`) continue to pass unchanged
- [ ] No Thumbtack message, job signal, HCP record, schedule, PM2 action, or production change occurs without explicit approval
- [ ] `.env.example` extended with staging placeholder vars; `lib/config.mjs` validates presence
- [ ] Runbook entry in `docs/` with staging configuration matrix (endpoints, redirect URI, scopes, doc date)

## Codebase primer

### Key paths

| Path | Purpose |
|---|---|
| `server.mjs` | HTTP server, route dispatch. Lines 83–88 register existing thumbtack webhook routes. New OAuth routes wire here. |
| `routes/thumbtack.mjs` | Existing capture-only webhook handler. **Preserve behavior** — do not modify intake logic. |
| `lib/config.mjs` | Env-derived config. Lines 85–93 declare `thumbtackEventsFile`, `thumbtackWebhookSecret`, prod + staging client ID/secret, OAuth URLs, API base URL. Staging URL vars (`THUMBTACK_STAGING_OAUTH_AUTH_URL`, etc.) are NOT yet declared — Session 2 adds them. |
| `lib/http.mjs` | `sendJson()`, `readJsonBody()` — HTTP helpers used by all routes. |
| `tests/thumbtack-webhook.test.mjs` | Existing webhook regression suite — must pass unchanged after all sessions. |
| `.env.example` | PC-local env template. Lines 57–58 declare `THUMBTACK_WEBHOOK_SECRET` only. No staging OAuth vars present yet. |
| `package.json` | ESM (`"type": "module"`), no test script defined. Tests run via `npx vitest`. No crypto/encryption deps — Session 2 may add `node:crypto` (built-in, no dep needed). |

### Contracts and interfaces

**Existing webhook receiver** (`routes/thumbtack.mjs`):
- `POST /api/webhooks/thumbtack` — authenticated via `x-maverick-webhook-token` header, append-only JSONL, capture-only
- `GET /api/webhooks/thumbtack/health` — returns `{ state: 'ready'|'not-configured', mode: 'capture-only' }`
- `createThumbtackWebhookHandler({ secret, eventsFile })` — factory for test injection

**Config vars already declared** (`lib/config.mjs:85-93`):
```js
thumbtackEventsFile          // data dir JSONL path
thumbtackWebhookSecret       // X-Maverick-Webhook-Token
thumbtackClientId            // production (populated in .env)
thumbtackClientSecret        // production (populated in .env)
thumbtackStagingClientId     // staging (NOT populated in .env)
thumbtackStagingClientSecret // staging (NOT populated in .env)
thumbtackOAuthAuthUrl        // production default
thumbtackOAuthTokenUrl       // production default
thumbtackApiBaseUrl          // production default
```

**Config vars to add** (Session 2):
```js
thumbtackStagingOAuthAuthUrl   // THUMBTACK_STAGING_OAUTH_AUTH_URL
thumbtackStagingOAuthTokenUrl  // THUMBTACK_STAGING_OAUTH_TOKEN_URL
thumbtackStagingApiBaseUrl     // THUMBTACK_STAGING_API_BASE_URL
thumbtackTokenEncryptionKey    // THUMBTACK_TOKEN_ENCRYPTION_KEY
thumbtackTokenStorePath        // THUMBTACK_TOKEN_STORE_PATH (optional, default in data dir)
```

**New routes to register** (`server.mjs`):
- `GET /api/integrations/thumbtack/oauth/staging/start` — initiates staging OAuth
- `GET /api/integrations/thumbtack/oauth/staging/callback` — OAuth callback (exact registered URI)

**Registered staging redirect URI** (from PLAN.md original scope):
```
https://carterspc.tailf72e3f.ts.net:8443/api/integrations/thumbtack/oauth/staging/callback
```

### Conventions

- ESM modules (`.mjs`), `node:` protocol imports
- No TypeScript in existing route/lib code
- Test framework: `vitest` (v4.1.8), tests in `tests/*.test.mjs`
- Test command: `npx vitest run` (full suite) or `npx vitest run tests/<file>` (single file)
- No lint/format script configured
- Commit messages: `feat:` / `fix:` / `test:` / `docs:` conventional prefixes
- HTTP helpers from `lib/http.mjs` — `sendJson(res, status, obj)`, `readJsonBody(req, maxBytes)`
- Config pattern: `export const x = process.env.VAR || ''` in `lib/config.mjs`

## Dependency graph

```
Wave 1: [Session 1: Research staging contract]              ← standalone, read-only research
         [Session 2: Config + token store]                   ← independent of Session 1 (adds config vars + encryption module)
Wave 2: [Session 3: OAuth boundary]                          ← depends on S1 (staging endpoints) + S2 (token store)
Wave 3: [Session 4: API adapters]                            ← depends on S2 (token store) + S3 (OAuth/token acquisition)
Wave 4: [Session 5: Safe validation + regression + runbook]  ← depends on S1-S4 (full system)
```

Sessions 1 and 2 are in the same wave but touch **different files** (S1: `docs/thumbtack-staging-runbook.md` config matrix only; S2: `.env.example`, `lib/config.mjs`, `lib/thumbtack-token-store.mjs`, `tests/thumbtack-token-store.test.mjs`). No file collisions.

## Execution mode

- **Wave 1 (S1 + S2):** parallel — 2 independent sessions, file-disjoint
- **Wave 2 (S3):** sequential — 1 session, depends on both W1 outputs
- **Wave 3 (S4):** sequential — 1 session, depends on OAuth boundary
- **Wave 4 (S5):** sequential — 1 session, integration + validation gate

All single-session waves run sequentially. Only Wave 1 has parallelism. Given the credential-heavy, security-sensitive nature of this build, **worktree-less execution on main** is acceptable (solo developer, ≤6 sessions, file-disjoint W1 sessions).

## Session definitions

### Session 1: Research staging contract

**Wave:** 1
**Executor:** deepseek-v4-flash (parallel)
**Depends on:** (none)
**Estimated context:** ~30k tokens

**Tasks:**
1. Research the current official Thumbtack Partner API documentation: environments, OAuth 2.0 authorization-code flow, Business Associate Phone Numbers API, Negotiation Messages API, and Job Signals API.
2. Record the exact staging authorization URL, token URL, API base URL, authorization parameters, required scopes, token-refresh semantics, and any PKCE requirement. Do NOT infer staging hostnames from production defaults — find staging-specific documentation.
3. Verify whether the staging redirect URI `https://carterspc.tailf72e3f.ts.net:8443/api/integrations/thumbtack/oauth/staging/callback` matches the portal's registered callback format.
4. Verify the approved scope set (Business Associate Phone Numbers + Negotiation Job Signals) against the approval email requirements.
5. Write the staging configuration matrix to `docs/thumbtack-staging-runbook.md` — a short, non-secret reference showing: staging endpoints, redirect URI, allowed scopes, token-refresh semantics, and documentation date. **No secrets, no Client IDs, no URLs with credentials.**

**Files to create/modify:**
- `docs/thumbtack-staging-runbook.md` — create: staging configuration matrix + runbook skeleton (non-secret)

**Verification:**
- `grep -iE 'client.?id|client.?secret|access.?token|refresh.?token|password' docs/thumbtack-staging-runbook.md` → 0 matches (no secrets leaked)
- File exists and contains endpoint URLs, scope list, and doc date

**Commit message:** `docs(thore): add staging contract configuration matrix`

---

### Session 2: Config and encrypted token store

**Wave:** 1
**Executor:** deepseek-v4-flash (parallel)
**Depends on:** (none)
**Estimated context:** ~25k tokens

**Tasks:**
1. Extend `.env.example` with placeholder-only Thumbtack staging configuration vars: `THUMBTACK_STAGING_OAUTH_AUTH_URL`, `THUMBTACK_STAGING_OAUTH_TOKEN_URL`, `THUMBTACK_STAGING_API_BASE_URL`, `THUMBTACK_TOKEN_ENCRYPTION_KEY`, `THUMBTACK_TOKEN_STORE_PATH` (optional).
2. Update `lib/config.mjs` to declare the new staging URL vars and token encryption key/store path. Validate **presence only** (e.g. `process.env.THUMBTACK_STAGING_CLIENT_ID || ''`), never log values. Add a helper `isStagingConfigured()` that returns true only when all staging vars are present.
3. Create `lib/thumbtack-token-store.mjs`:
   - Encrypt access/refresh token material at rest using `node:crypto` (AES-256-GCM with the `THUMBTACK_TOKEN_ENCRYPTION_KEY`).
   - Support one staging principal.
   - Write audit-safe metadata only (environment, issued time, expiry, last refresh outcome).
   - Enforce restrictive file permissions where supported (`fs.chmodSync` to `0o600` on POSIX; no-op on Windows).
   - Implement serialized token refresh: a mutex/queue so concurrent API calls cannot race a rotated refresh token.
   - `loadTokens()` → decrypted token set or null
   - `saveTokens(tokenSet)` → encrypted write
   - `getRefreshLock()` → serialized refresh promise
4. Write `tests/thumbtack-token-store.test.mjs`:
   - Round-trip test: save tokens → load tokens → values match, plaintext never in persisted file
   - `grep -c 'plaintext_value' <store-file>` → 0 (encryption works)
   - Missing encryption key → throws / fails closed
   - Mismatched key → throws
   - Concurrent refresh calls → serialized (only one refresh executes)

**Files to create/modify:**
- `.env.example` — add staging OAuth placeholder vars
- `lib/config.mjs` — declare staging URL vars + encryption key + store path + `isStagingConfigured()`
- `lib/thumbtack-token-store.mjs` — create: encrypted token persistence module
- `tests/thumbtack-token-store.test.mjs` — create: token store unit tests

**Verification:**
- `npx vitest run tests/thumbtack-token-store.test.mjs` → all pass
- `npx vitest run tests/thumbtack-webhook.test.mjs` → still passes (no regression)
- `grep -iE 'client.?secret|access.?token|refresh.?token' .env.example` → only placeholder names, no values

**Commit message:** `feat(thore): add staging config vars and encrypted token store`

---

### Session 3: Staging OAuth boundary

**Wave:** 2
**Executor:** qwen3.6-35b (local, sequential — 1 session in wave) or deepseek-v4-flash
**Depends on:** Session 1 (staging endpoints), Session 2 (token store + config)
**Estimated context:** ~40k tokens

**Tasks:**
1. Create `routes/thumbtack-oauth.mjs`:
   - `GET /api/integrations/thumbtack/oauth/staging/start` — creates a cryptographic, short-lived (e.g. 5-minute TTL), single-use state record; redirects to the exact staging authorization endpoint (from S1 research). Includes required scopes, redirect URI, and client ID from config.
   - `GET /api/integrations/thumbtack/oauth/staging/callback` — the exact registered callback route. Must:
     a. Verify state parameter exists, matches a stored state record, is not expired, and has not been used (single-use).
     b. Verify redirect binding (the callback was initiated by MCC, not a CSRF).
     c. Check for provider error parameters (`error`, `error_description`) before proceeding.
     d. Exchange the authorization code server-side (POST to staging token URL from S1).
     e. Persist the resulting token set through the encrypted token store (`lib/thumbtack-token-store.mjs`).
     f. Return a minimal success/failure page — no tokens, secrets, codes, or raw provider responses exposed.
   - Error handling: declined consent, expired/replayed state, missing code, token-exchange failure, invalid environment selection — all return audit-safe error messages.
   - **No production start route** in this session.
2. Wire the new routes in `server.mjs` (add to the route dispatch block near lines 83–88, alongside existing thumbtack routes).
3. Write `tests/thumbtack-oauth.test.mjs`:
   - Successful callback path with mocked token exchange → state consumed, token persisted, success page returned
   - Expired state → fail closed
   - Replayed state (already consumed) → fail closed
   - Missing `code` parameter → fail closed
   - Provider error (`?error=access_denied`) → fail closed with safe message
   - Token exchange failure (mock 500) → fail closed with safe message
   - Verify no secrets in response body (`grep` response content)
   - State is single-use: second callback with same state → rejected

**Files to create/modify:**
- `routes/thumbtack-oauth.mjs` — create: staging OAuth start + callback handlers
- `server.mjs` — modify: import and register new OAuth routes
- `tests/thumbtack-oauth.test.mjs` — create: OAuth boundary unit tests

**Verification:**
- `npx vitest run tests/thumbtack-oauth.test.mjs` → all pass
- `npx vitest run tests/thumbtack-webhook.test.mjs` → still passes (webhook untouched)
- `npx vitest run tests/thumbtack-token-store.test.mjs` → still passes
- Manual check: response bodies contain no tokens/secrets

**Commit message:** `feat(thore): implement staging OAuth boundary with state validation`

---

### Session 4: Thumbtack API adapters

**Wave:** 3
**Executor:** qwen3.6-35b (local, sequential) or deepseek-v4-flash
**Depends on:** Session 2 (token store), Session 3 (OAuth/token acquisition)
**Estimated context:** ~35k tokens

**Tasks:**
1. Create `lib/thumbtack-api.mjs`:
   - `getValidAccessToken()` — obtains a valid staging access token; refreshes via the token store's serialized refresh if expired.
   - Sends Authorization header without logging it.
   - Implements documented primitives (from S1 research):
     - `getBusinessProfile()` — current business read
     - `getBusinessAssociatePhoneNumbers()` — Business Associate Phone Numbers read
     - `getNegotiation(negotiationId)` — negotiation read
     - `getMessageHistory(negotiationId)` — message-history read
     - `sendMessage(negotiationId, text)` — message send capability, **disabled by default** (`allowWrites` flag)
     - `postJobSignal(jobSignalPayload)` — Job Signals update capability, **disabled by default** (`allowWrites` flag)
   - Normalize Thumbtack payloads at the adapter boundary. Preserve the existing webhook envelope handling (`event.eventType` and `data`) rather than creating a parallel payload shape.
   - Keep idempotency keys / audit records for outbound message or job signal operations, but do not enable them automatically.
   - All HTTP errors caught, logged with redacted request IDs, never logged with auth headers.
2. Write `tests/thumbtack-api.test.mjs`:
   - Mocked HTTP responses for each primitive
   - Asserts correct staging base URL is used (not production)
   - Asserts Authorization header present but not logged
   - Token refresh triggered when access token expired → serialized via token store
   - `sendMessage` / `postJobSignal` throw when `allowWrites` is false (default)
   - Error handling: Thumbtack API error → redacted log, safe rethrow
   - Payload normalization: adapter output shape matches webhook envelope convention

**Files to create/modify:**
- `lib/thumbtack-api.mjs` — create: Thumbtack partner API adapter module
- `tests/thumbtack-api.test.mjs` — create: API adapter unit tests

**Verification:**
- `npx vitest run tests/thumbtack-api.test.mjs` → all pass
- `npx vitest run` → full suite passes (all thumbtack tests + existing tests)
- No production base URL in any adapter code path

**Commit message:** `feat(thore): add narrow Thumbtack API adapters with write gates`

---

### Session 5: Safe validation, regression, and runbook

**Wave:** 4
**Executor:** sequential (orchestrator-guided — involves manual staging OAuth + Carter approval gates)
**Depends on:** Sessions 1–4 (full system)
**Estimated context:** ~15k tokens

**Tasks:**
1. Run focused unit tests + existing webhook regression:
   - `npx vitest run tests/thumbtack-webhook.test.mjs` → webhook receiver unchanged
   - `npx vitest run tests/thumbtack-token-store.test.mjs` → token store passes
   - `npx vitest run tests/thumbtack-oauth.test.mjs` → OAuth boundary passes
   - `npx vitest run tests/thumbtack-api.test.mjs` → API adapters pass
   - `npx vitest run` → full suite green
2. Complete the `docs/thumbtack-staging-runbook.md` started in S1:
   - Manual OAuth authorization steps (using staging account)
   - Read-only validation checklist (fetch business, BAPN data, one negotiation/message-history)
   - **Approval gate**: document that Carter must explicitly approve before any message send or Job Signal post
   - Endpoint status, token-refresh result, and redacted request ID recording format
3. Code review pass (manual or cross-model):
   - Check diff for secret exposure, callback spoofing, state replay, environment crossover, token rotation race, unintentional write paths
   - Use a different model family for final review per multi-agent doctrine (e.g. Claude Code via Hermes bridge)
4. **STOP and request explicit approval from Carter** before any staging message send or Job Signal post. Document what was tested and what remains gated.

**Files to create/modify:**
- `docs/thumbtack-staging-runbook.md` — complete: add validation steps, approval gate documentation, troubleshooting
- (No new code files — this session validates and documents)

**Verification:**
- `npx vitest run` → all tests pass
- `GET /api/webhooks/thumbtack/health` → still returns `ready` / `capture-only`
- No customer-facing action has occurred
- Runbook complete with staging OAuth walkthrough + approval gate

**Commit message:** `docs(thore): complete staging validation runbook and regression evidence`

## Final verification

After all waves complete:

1. Full test suite: `npx vitest run` → all green
2. `git log --oneline` — confirm all 5 session commits present
3. Cross-reference against acceptance criteria checklist above
4. Manual staging OAuth walkthrough (requires Carter + staging credentials)
5. Verify no stubs, TODOs, or placeholder code remaining in production paths
6. `grep -rn 'TODO\|FIXME\|PLACEHOLDER' lib/thumbtack-*.mjs routes/thumbtack-oauth.mjs` → 0 matches
7. Secret leak scan: `grep -rn 'client_secret\|access_token.*=\|refresh_token.*=' lib/thumbtack-*.mjs routes/thumbtack-oauth.mjs` → only in comments/test mocks, never real values

## Archive

- Copy PLAN.md to `C:\Workspace\Archive\Build Plans\MCC\2026-0722_thumbtack-staging-oauth.md`
- Remove PLAN.md from repo root: `git rm PLAN.md`
- Commit: `chore: archive PLAN.md for thumbtack staging oauth build`
