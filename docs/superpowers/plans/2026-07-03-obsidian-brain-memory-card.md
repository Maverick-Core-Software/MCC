# Obsidian Brain Memory Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Obsidian brain vault (`C:\Workspace\Active\brain`) into the orchestrator tab's MEMORY CONTEXT card alongside the existing Claude-memory source, read directly from disk.

**Architecture:** `lib/memory.mjs` gains a `loadBrainIndex()` that walks the vault's markdown files and maps them to the existing memory shape (`source: 'brain'`); `loadMemoryIndex()` merges both sources and the existing `/api/memory` route serves the richer payload unchanged. The frontend card shows a per-source count breakdown and tags each match with its source.

**Tech Stack:** Node.js ESM (`.mjs`), built-in `node:test` for the check (no test framework exists in this repo), React (Vite) frontend.

**Spec:** `docs/superpowers/specs/2026-07-03-obsidian-brain-memory-card-design.md`

**Rules for the executor:**
- Run all commands from `C:\Workspace\Active\MCC` in PowerShell.
- Do NOT touch PM2 or restart any process. Carter restarts the server himself.
- `rtk` is not installed in this shell — use plain `git`.

---

### Task 1: `brainPath` config + `loadBrainIndex()`

**Files:**
- Modify: `lib/config.mjs` (around line 59, next to `memoryPath`)
- Modify: `lib/memory.mjs`
- Create: `tests/memory.test.mjs`

- [ ] **Step 1: Add the config export**

In `lib/config.mjs`, directly below the `memoryPath` export (line 59):

```js
export const brainPath = process.env.BRAIN_VAULT_PATH || 'C:\\Workspace\\Active\\brain';
```

- [ ] **Step 2: Write the failing test**

Create `tests/memory.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBrainIndex, scoreMemories } from '../lib/memory.mjs';

function makeFixtureVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
  fs.mkdirSync(path.join(root, 'knowledge'));
  fs.mkdirSync(path.join(root, '.obsidian'));
  fs.writeFileSync(path.join(root, 'knowledge', 'glossary.md'),
    '# Glossary\n\nTerms and acronyms for the Maverick stack.\n\nSee [[preferences]].\n');
  fs.writeFileSync(path.join(root, 'index.md'), '---\ndescription: Master index\n---\n\n# Brain\n\nCatalog.\n');
  fs.writeFileSync(path.join(root, '.obsidian', 'ignored.md'), '# should be skipped\n');
  fs.writeFileSync(path.join(root, 'knowledge', 'big.md'), '# Big\n\n' + 'x'.repeat(5000) + '\n');
  return root;
}

test('loadBrainIndex maps vault notes to the memory shape', () => {
  const root = makeFixtureVault();
  const index = loadBrainIndex(root);
  assert.equal(index.state, 'online');

  const glossary = index.memories.find((m) => m.id === 'knowledge/glossary');
  assert.ok(glossary, 'expected knowledge/glossary note');
  assert.equal(glossary.type, 'knowledge');
  assert.equal(glossary.source, 'brain');
  assert.equal(glossary.description, 'Terms and acronyms for the Maverick stack.');
  assert.deepEqual(glossary.related, ['preferences']);

  const indexNote = index.memories.find((m) => m.id === 'index');
  assert.equal(indexNote.type, 'root');
  assert.equal(indexNote.description, 'Master index');

  assert.ok(!index.memories.some((m) => m.id.includes('ignored')), '.obsidian must be skipped');

  const big = index.memories.find((m) => m.id === 'knowledge/big');
  assert.ok(big.body.length <= 2048, 'payload body is truncated');
  assert.ok(big.searchBody.length > 2048, 'full body kept for search');
  assert.ok(!JSON.stringify(big).includes('searchBody'), 'searchBody must not serialize');
});

test('loadBrainIndex handles a missing vault', () => {
  const index = loadBrainIndex('C:\\definitely\\not\\a\\vault');
  assert.equal(index.state, 'missing');
  assert.equal(index.memories.length, 0);
  assert.equal(index.warnings.length, 1);
});

test('scoreMemories returns matches from both sources', () => {
  const memories = [
    { id: 'pm2-topology', description: 'PM2 service topology', type: 'project', source: 'claude', body: 'pm2 windows service' },
    { id: 'knowledge/infrastructure', description: 'Homelab and services', type: 'knowledge', source: 'brain', body: 'proxmox pm2 services' },
    { id: 'unrelated', description: 'nothing here', type: 'user', source: 'claude', body: 'cooking recipes' },
  ];
  const results = scoreMemories(memories, 'pm2 services');
  const sources = new Set(results.map((m) => m.source));
  assert.ok(sources.has('claude') && sources.has('brain'));
  assert.ok(!results.some((m) => m.id === 'unrelated'));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/memory.test.mjs`
Expected: FAIL — `loadBrainIndex` / `scoreMemories` are not exported.

- [ ] **Step 4: Implement `loadBrainIndex()`**

In `lib/memory.mjs`:

Change the import line to include `brainPath`:

```js
import { memoryPath, brainPath, seoAppUrl } from './config.mjs';
```

Add below `redactMemoryBody` (after line 40):

```js
const BRAIN_BODY_LIMIT = 2048;

function firstBodyLine(body) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed.replace(/^>\s*/, '').slice(0, 200);
  }
  return '';
}

function walkMarkdown(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMarkdown(full);
    return entry.name.toLowerCase().endsWith('.md') ? [full] : [];
  });
}

// Brain vault notes: id = relative path sans .md, type = top-level folder.
export function loadBrainIndex(rootPath = brainPath) {
  if (!fs.existsSync(rootPath)) {
    return { sourcePath: rootPath, state: 'missing', memories: [], warnings: [`Brain vault not found: ${rootPath}`] };
  }
  const warnings = [];
  const memories = walkMarkdown(rootPath).sort().flatMap((sourcePath) => {
    try {
      const text = fs.readFileSync(sourcePath, 'utf8');
      const parsed = parseMemoryFrontmatter(text) || { metadata: {}, body: text.trim() };
      const relative = path.relative(rootPath, sourcePath).replace(/\\/g, '/');
      const body = redactMemoryBody(parsed.body);
      const stat = fs.statSync(sourcePath);
      const memory = {
        id: relative.replace(/\.md$/i, ''),
        description: parsed.description || firstBodyLine(body),
        type: relative.includes('/') ? relative.split('/')[0] : 'root',
        nodeType: 'brain-note',
        source: 'brain',
        related: [...parsed.body.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]),
        body: body.slice(0, BRAIN_BODY_LIMIT),
        sourcePath,
        updatedAt: stat.mtime.toISOString()
      };
      // Full body stays searchable but is excluded from JSON payloads.
      Object.defineProperty(memory, 'searchBody', { value: body, enumerable: false });
      return [memory];
    } catch (error) {
      warnings.push(`Skipped ${sourcePath}: ${error.message}`);
      return [];
    }
  });
  return { sourcePath: rootPath, state: 'online', memories, warnings };
}
```

Note: `searchBody` is non-enumerable so `assert.ok(big.searchBody...)` still reads it, but `JSON.stringify` (and therefore `/api/memory`) omits it.

- [ ] **Step 5: Extract `scoreMemories()` from `searchMemory()`**

In `lib/memory.mjs`, replace the existing `searchMemory` (lines 98–109) with:

```js
export function scoreMemories(memories, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  if (!terms.length) return memories.slice(0, 8);
  const scored = memories.map((memory) => {
    const haystack = `${memory.id} ${memory.description} ${memory.type} ${memory.searchBody || memory.body}`.toLowerCase();
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return { ...memory, score };
  }).filter((memory) => memory.score > 0);
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, 8);
}

export function searchMemory(query) {
  const index = loadMemoryIndex();
  return { ...index, results: scoreMemories(index.memories, query) };
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/memory.test.mjs`
Expected: all 3 tests PASS. (Task 2's merge isn't done yet, but nothing in these tests depends on it.)

- [ ] **Step 7: Commit**

```powershell
git add lib/config.mjs lib/memory.mjs tests/memory.test.mjs
git commit -m "feat(memory): read Obsidian brain vault via loadBrainIndex"
```

---

### Task 2: Merge brain + Claude sources in `loadMemoryIndex()`

**Files:**
- Modify: `lib/memory.mjs` (the existing `loadMemoryIndex`, lines 42–96 in the original file)

- [ ] **Step 1: Rename the existing loader and tag its memories**

Rename the existing `export function loadMemoryIndex()` to `function loadClaudeIndex()` (drop the `export`; nothing outside this file imports it — `server.mjs` and `routes/orchestrator.mjs` use `getMemoryIndex`, verify with `git grep loadMemoryIndex`). Inside it, add `source: 'claude'` to the memory object literal (next to `nodeType`):

```js
      return [{
        id: parsed.name,
        description: parsed.description || '',
        type: parsed.metadata?.type || 'unknown',
        nodeType: parsed.metadata?.node_type || 'memory',
        source: 'claude',
        originSessionId: parsed.metadata?.originSessionId || null,
        related,
        body: redactMemoryBody(parsed.body),
        sourcePath,
        updatedAt: stat.mtime.toISOString()
      }];
```

Also update its two early-return/summary objects: the top-of-function `state: 'missing'` return keeps its shape, and remove the `count`/`typeCounts` computation from its final return (the merged loader computes those now) — final return becomes:

```js
  return {
    sourcePath: memoryPath,
    state: 'online',
    memories,
    warnings,
    updatedAt: new Date().toISOString()
  };
```

- [ ] **Step 2: Add the merged `loadMemoryIndex()`**

Below `loadClaudeIndex` and `loadBrainIndex`:

```js
export function loadMemoryIndex() {
  const claude = loadClaudeIndex();
  const brain = loadBrainIndex();
  const memories = [...claude.memories, ...brain.memories];
  const typeCounts = memories.reduce((counts, memory) => {
    counts[memory.type] = (counts[memory.type] || 0) + 1;
    return counts;
  }, {});
  const sourceCounts = memories.reduce((counts, memory) => {
    counts[memory.source] = (counts[memory.source] || 0) + 1;
    return counts;
  }, {});
  return {
    sourcePath: claude.sourcePath,
    brainPath: brain.sourcePath,
    // online if either source loaded, so the SEO-app fallback in
    // getMemoryIndex only fires when there is no local memory at all
    state: claude.state === 'online' || brain.state === 'online' ? 'online' : 'missing',
    count: memories.length,
    typeCounts,
    sourceCounts,
    memories,
    warnings: [...claude.warnings, ...brain.warnings],
    updatedAt: new Date().toISOString()
  };
}
```

`getMemoryIndex()` (the SEO-app fallback wrapper) needs no changes.

- [ ] **Step 3: Add a merge test**

Append to `tests/memory.test.mjs`:

```js
test('loadMemoryIndex merges sources and counts them', async () => {
  const { loadMemoryIndex } = await import('../lib/memory.mjs');
  const index = loadMemoryIndex();
  assert.ok(['online', 'missing'].includes(index.state));
  assert.equal(index.count, index.memories.length);
  assert.ok(index.memories.every((m) => m.source === 'claude' || m.source === 'brain'));
  const summed = Object.values(index.sourceCounts || {}).reduce((a, b) => a + b, 0);
  assert.equal(summed, index.count);
});
```

(This runs against the real machine paths — assertions are shape-only so it passes whether or not the dirs exist.)

- [ ] **Step 4: Run the tests**

Run: `node --test tests/memory.test.mjs`
Expected: all 4 tests PASS.

- [ ] **Step 5: Sanity-check the live payload shape**

Run: `node -e "import('./lib/memory.mjs').then(m => { const i = m.loadMemoryIndex(); console.log(i.state, i.count, JSON.stringify(i.sourceCounts)); })"`
Expected: something like `online 24 {"claude":4,"brain":20}` (numbers vary). Must not throw.

- [ ] **Step 6: Commit**

```powershell
git add lib/memory.mjs tests/memory.test.mjs
git commit -m "feat(memory): merge Claude memories and brain vault into one index"
```

---

### Task 3: Memory card UI — source breakdown + per-match source tag

**Files:**
- Modify: `src/pages/OrchestratorPage.jsx` (MEMORY CONTEXT panel, lines 378–399)

- [ ] **Step 1: Show the source breakdown in the summary**

In the `memorySummary` div, replace:

```jsx
          <strong>{memoryContext.count ?? memoryContext.memories?.length ?? 0} MEMORIES</strong>
```

with:

```jsx
          <strong>
            {memoryContext.count ?? memoryContext.memories?.length ?? 0} MEMORIES
            {memoryContext.sourceCounts ? ` · ${memoryContext.sourceCounts.claude || 0} CLAUDE / ${memoryContext.sourceCounts.brain || 0} BRAIN` : ''}
          </strong>
```

- [ ] **Step 2: Tag each match with its source**

In the `memoryMatch` row, replace:

```jsx
              <span>{memory.type}</span>
```

with:

```jsx
              <span>{memory.type}{memory.source ? ` · ${memory.source}` : ''}</span>
```

(The existing `.memoryMatch span` style is already uppercase/blue — no CSS changes needed.)

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 4: Commit**

```powershell
git add src/pages/OrchestratorPage.jsx
git commit -m "feat(dashboard): show brain/claude source breakdown in memory card"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full test run**

Run: `node --test tests/memory.test.mjs`
Expected: 4/4 PASS.

- [ ] **Step 2: Confirm real vault notes appear in search**

Run: `node -e "import('./lib/memory.mjs').then(m => { const r = m.searchMemory('grizzly price book'); console.log(r.results.map(x => x.source + ':' + x.id).join('\n')); })"`
Expected: output includes `brain:knowledge/grizzly-pricebook` (the vault note).

- [ ] **Step 3: Report**

Do NOT restart PM2 or the server. Report that the change is committed and the card will show brain notes after Carter's next `npm run build` + server restart (or note that step 3.3's build already produced fresh `dist/` output if the server serves `dist/`).
