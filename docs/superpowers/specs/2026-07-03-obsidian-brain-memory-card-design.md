# Obsidian Brain in the Memory Card — Design

**Date:** 2026-07-03
**Status:** Approved by Carter

## Goal

Surface the new Obsidian brain vault (`C:\Workspace\Active\brain`) inside the
MEMORY CONTEXT card on the orchestrator tab, merged with the existing
Claude-memory source. MCC reads the vault directly from disk — no Obsidian
Local REST API dependency; the card works whether or not Obsidian is running.

## Decisions (from brainstorming)

- **Merge both sources** into the one existing card — Claude memories + brain
  notes together, each tagged with its source. No separate brain card.
- **Direct file read** of the vault, not the Local REST API on port 27123.
- Keep existing keyword scoring; no embeddings/semantic search.
- No write-back to the vault. Read-only.

## Backend — `lib/memory.mjs`

### New config (`lib/config.mjs`)

```js
export const brainPath = process.env.BRAIN_VAULT_PATH || 'C:\\Workspace\\Active\\brain';
```

### New `loadBrainIndex()`

- Recursively scans `brainPath` for `*.md`, skipping `.obsidian/` and
  `.smart-env/` directories.
- Vault notes lack the Claude-memory frontmatter schema, so map by convention:
  - `id` — relative path without `.md`, forward slashes (e.g. `knowledge/glossary`)
  - `type` — top-level folder name (`knowledge`, `projects`, `sessions`,
    `inbox`); root-level files (index.md, CLAUDE.md, SETUP.md) get type `root`
  - `description` — frontmatter `description` if present, else the first
    non-empty, non-heading line of the body
  - `related` — `[[wikilink]]` targets, same regex as Claude memories
  - `source: 'brain'`
- Bodies run through the existing `redactMemoryBody()` and are **truncated to
  ~2 KB in the payload** (the grizzly-pricebook note would otherwise bloat
  every `/api/memory` response). The full body is still used for search
  scoring before truncation.
- Vault path missing → `warnings` entry, empty list; the card still shows
  Claude memories (and vice versa).

### Merge

- `loadMemoryIndex()` and `searchMemory()` return the merged set of Claude
  memories (`source: 'claude'`) and brain notes (`source: 'brain'`).
- `count` and `typeCounts` cover the merged set.
- Merged `state` is `'online'` if at least one source loaded, `'missing'` only
  when both are absent — so the SEO-app fallback still triggers only when
  there is no local memory at all.
- `/api/memory` endpoint unchanged — same route, richer payload.
- Free side effect: orchestrator status ("MCC Memory" worker detail) and any
  plan prompt using `getMemoryIndex()` now see brain notes too.

## Frontend — `src/pages/OrchestratorPage.jsx`

- Memory card summary shows a source breakdown next to the count, e.g.
  `24 MEMORIES · 4 CLAUDE / 20 BRAIN`.
- Each match row gets a small `BRAIN` / `CLAUDE` badge.
- Existing layout, states, and warnings otherwise unchanged.

## Error handling

- Unreadable/unparseable note → skipped with a `warnings` entry (existing
  pattern).
- Missing vault → warning, degrade to Claude-memory-only.
- SEO-app fallback behavior in `getMemoryIndex()` unchanged (it only kicks in
  when the Claude memory dir is missing).

## Testing

One small test file asserting:
1. A vault note parses to the expected `id`, `type`, `description`, `source`.
2. Merged search returns entries from both sources.

## Out of scope (YAGNI)

- Local REST API (27123) integration
- Writing to the vault
- Embedding / semantic search
- A new dashboard section or card
