# Thumbtack Staging Contract — Configuration Matrix

**Documentation date:** 2026-07-22  
**Source:** [Thumbtack Partner Platform — Developer Docs](https://developers.thumbtack.com/docs)  
**Staging credentials:** Provisioned by Thumbtack during Partner onboarding (separate Client ID + Client Secret)

---

## Environment Endpoints

| Resource | Production | Staging |
|---|---|---|
| **API Base URL** | `https://api.thumbtack.com` | `https://staging-api.thumbtack.com` |
| **OAuth Authorization Server** | `https://auth.thumbtack.com` | `https://staging-auth.thumbtack.com` |
| **Authorization URL** | `https://auth.thumbtack.com/oauth2/auth` | `https://staging-auth.thumbtack.com/oauth2/auth` |
| **Token URL** | `https://auth.thumbtack.com/oauth2/token` | `https://staging-auth.thumbtack.com/oauth2/token` |
| **Partner Website** | `https://thumbtack.com` | `https://staging-partner.thumbtack.com` |

> **Important:** Staging Client ID and Client Secret only work with the staging endpoints. Attempting production authentication with staging credentials (or vice versa) returns an error.

---

## OAuth 2.0 Flow

| Parameter | Value |
|---|---|
| **Flow type** | Authorization Code (standard OAuth 2.0) |
| **PKCE** | Not required. Token endpoint uses HTTP Basic Auth with the Client ID and Client Secret. |
| **Authorization method** | `Authorization: Basic <base64(client_id:client_secret)>` (on token endpoint) |

### Authorization Request (`GET <authorization-url>`)

| Parameter | Required | Value / Notes |
|---|---|---|
| `client_id` | Yes | Staging Client ID (provisioned by Thumbtack) |
| `redirect_uri` | Yes | Registered staging callback URL (see below) |
| `response_type` | Yes | Must be `code` |
| `scope` | Yes | Space-delimited list of requested scopes (see below) |
| `state` | Yes | ≥ 8 characters (docs), ≥ 10 characters (guide), cryptographic random, single-use |
| `audience` | Yes | Must be `urn:partner-api` |

### Token Exchange (`POST <token-url>`)

- **Content-Type:** `application/x-www-form-urlencoded`
- **Authorization:** `Basic <base64(client_id:client_secret)>`
- **Body parameters:**
  - `grant_type`: `authorization_code`
  - `code`: (authorization code from redirect)
  - `redirect_uri`: (must match the authorization request)

### Token Refresh

| Property | Value |
|---|---|
| **Endpoint** | Same Token URL (`POST`) |
| **Authorization** | `Basic <base64(client_id:client_secret)>` |
| **Body** | `grant_type=refresh_token&refresh_token=<token>&token_type=REFRESH` |
| **Response** | New `access_token` + new `refresh_token` (invalidates previous) |
| **Grace period** | 60 seconds — same refresh token may be retried on error |

### Token Lifetimes

| Token | Lifetime | Notes |
|---|---|---|
| Access token | 3600 s (1 hour) | Type: `bearer` |
| Refresh token | 180 days | Single-use; each refresh rotates and resets expiry |
| Auth code | 5 minutes | Exchanged once for token pair |

---

## Registered Staging Redirect URI

```
https://carterspc.tailf72e3f.ts.net:8443/api/integrations/thumbtack/oauth/staging/callback
```

**Format notes:**
- Thumbtack supports multiple redirect URIs per environment.
- The URI can be public or private (Tailscale Funnel / TLS-terminated URLs are acceptable — the redirect runs through the user's browser).
- The registered callback route path: `/api/integrations/thumbtack/oauth/staging/callback`

---

## Approved Scopes (v4 API)

This integration is provisioned as a **supply-side** partner. Scopes follow the `supply::` prefix convention.

| Scope | API Resource | Required For |
|---|---|---|
| `supply::negotiations.write` | `POST /api/v4/negotiations/{negotiationID}/job-status` | Job Signals — sending job-status updates (not_scheduled, appt_scheduled, job_complete, invoice_paid, customer_cancel, pro_cancel) |
| *(Business Associate Phone Numbers scope)* | `GET/POST/PUT/DELETE /api/v4/businesses/{businessID}/associate-phone-numbers` | Business Associate Phone Numbers — register and list business phone numbers for Thumbtack Numbers (inbound call attribution) |

> **Note on scopes:** Per the Thumbtack docs, each API route's required scope is listed under the **AUTHORIZATIONS** section in the API Reference. The exact scope name(s) for Business Associate Phone Numbers are provisioned during client credential setup. Include `offline_access` in all scope requests to enable token refresh.

**Always include:** `offline_access` — this is required in the OAuth scope list to receive a refresh token. Without it, only the 1-hour access token is returned.

---

## API v4 Endpoint Reference

### Base Path

All v4 API requests are prefixed with the environment API base URL + `/api/v4/`.

| Environment | Full Base |
|---|---|
| Production | `https://api.thumbtack.com/api/v4/` |
| Staging | `https://staging-api.thumbtack.com/api/v4/` |

### Key v4 Endpoints (Staging)

| Operation | Method | Path |
|---|---|---|
| List businesses | `GET` | `/api/v4/businesses` |
| Get business info | `GET` | `/api/v4/businesses/{businessID}` |
| List negotiations (leads) | `GET` | `/api/v4/businesses/{businessID}/negotiations` |
| Get negotiation by ID | `GET` | `/api/v4/negotiations/{negotiationID}` |
| Get message history | `GET` | `/api/v4/negotiations/{negotiationID}/messages` |
| Send message | `POST` | `/api/v4/negotiations/{negotiationID}/messages` |
| Post job signal (status) | `POST` | `/api/v4/negotiations/{negotiationID}/job-status` |
| List phone numbers | `GET` | `/api/v4/businesses/{businessID}/associate-phone-numbers` |
| Create phone number | `POST` | `/api/v4/businesses/{businessID}/associate-phone-numbers` |
| Bulk create phone numbers | `POST` | `/api/v4/businesses/{businessID}/associate-phone-numbers-bulk-create` |
| Update phone number | `PUT` | `/api/v4/businesses/{businessID}/associate-phone-numbers/{phoneNumberID}` |
| Delete phone number | `DELETE` | `/api/v4/businesses/{businessID}/associate-phone-numbers/{phoneNumberID}` |

### Notifications

- **Authorization:** Bearer token in `Authorization` header
- **Content-Type:** `application/json` (for requests with bodies)

---

## Legacy v2 API Endpoints (staging-pro-api.thumbtack.com)

The legacy v2 API runs on a separate host (`staging-pro-api.thumbtack.com`) and uses a **different OAuth flow** (pro-api / v2 tokens endpoint). This integration targets the **current v4 API** only. The legacy API is provided for reference:

| Resource | URL |
|---|---|
| Legacy v2 API base | `https://staging-pro-api.thumbtack.com/v2/` |
| Production v2 API base | `https://pro-api.thumbtack.com/v2/` |

---

## Staging Validation Results (2026-07-22)

### OAuth flow
- ✅ Staging OAuth start route (`/api/integrations/thumbtack/oauth/staging/start`) returns 302 redirect to `staging-auth.thumbtack.com` with correct parameters
- ✅ Manual authorization completed in browser — Thumbtack staging login → consent → callback
- ✅ Callback (`/api/integrations/thumbtack/oauth/staging/callback`) exchanged code server-side and persisted encrypted token set
- ✅ Token store verified: AES-256-GCM encrypted at rest, no plaintext leakage, metadata-only outer JSON
- ✅ Token details: `environment=staging`, `tokenType=bearer`, access token 1189 chars, expires 3600s, refresh token present

### API validation
- ✅ API adapter loads token from encrypted store → sends Bearer-authenticated request to `staging-api.thumbtack.com`
- ✅ Error handling verified: HTTP 401 returned with `detail` and `traceID` — adapter logs redacted error, no token leakage
- ⚠️ **Scope limitation:** Current approved scope (`supply::negotiations.write` + `offline_access`) does NOT include `supply::businesses.list`. The `GET /api/v4/businesses` endpoint returns 401 with `"required scope(s) [supply::businesses.list] not found"`. This is expected — Thumbtack provisions this scope separately.
- ℹ️ Business-specific endpoints (`/api/v4/businesses/{businessID}/negotiations`, `/api/v4/businesses/{businessID}/associate-phone-numbers`) require a `businessID` path parameter. To test these, request `supply::businesses.list` scope from Thumbtack or obtain the business ID from the Thumbtack partner portal.

### Write gate verification
- ✅ `sendMessage()` and `postJobSignal()` throw when `allowWrites=false` (default)
- ✅ Write capabilities are fully implemented but disabled — no message or job signal can be sent without explicitly enabling

### Next steps for full staging validation
1. Request `supply::businesses.list` scope from Thumbtack to enable business discovery
2. Re-authorize with expanded scope set
3. Test read primitives with real business data
4. **STOP** — request explicit approval from Carter before testing any write primitive

---

## Security Notes

- **No secrets in this runbook.** Client IDs, Client Secrets, access tokens, and refresh tokens are stored in `.env` (local) or the encrypted token store.
- **Staging and production credentials are never interchangeable.** Using staging credentials against production endpoints (or vice versa) returns an OAuth error.
- **Refresh tokens are single-use with a 60-second grace period.** After exchanging a refresh token, the previous one is invalid. Implement retry logic within the grace period for reliability.
- **Serialized refresh is required.** Concurrent API calls must not race a rotating refresh token — use a mutex or queue in the token store.
