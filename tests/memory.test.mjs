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
