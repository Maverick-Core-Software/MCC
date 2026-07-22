import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(rootDir, 'ecosystem.config.linux.json');
const envLoaderUrl = pathToFileURL(path.join(rootDir, 'lib', 'load-env.mjs')).href;
const configModuleUrl = pathToFileURL(path.join(rootDir, 'lib', 'config.mjs')).href;

function childEnv(overrides = {}) {
  const env = { ...process.env };
  const removed = new Set(['MCC_ENV_FILE', 'MCC_ENV_LOADER_TEST', 'MCC_ENV_LOCAL_TEST', 'PORT']);
  for (const key of Object.keys(env)) {
    if (removed.has(key.toUpperCase())) delete env[key];
  }
  return { ...env, ...overrides };
}

function runProbe(script, { cwd = rootDir, env } = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

test('CT103 PM2 ecosystem is data-only JSON with no PC-only settings', () => {
  const raw = fs.readFileSync(configPath, 'utf8');
  const ecosystem = JSON.parse(raw);
  const [app] = ecosystem.apps;

  assert.equal(ecosystem.apps.length, 1);
  assert.equal(app.name, 'mav-console');
  assert.equal(app.script, 'server.mjs');
  assert.equal(app.cwd, '/opt/mcc');
  assert.deepEqual(app.env, {
    NODE_ENV: 'production',
    MCC_ENV_FILE: '/etc/mcc/mav-console.env',
  });
  for (const pcOnlyVar of [
    'SEO_APP_URL', 'HCP_PROJECT_DIR', 'LOCAL_MODEL_URL', 'GBP_PHOTOS_FOLDER',
    'GBP_PHOTOS_LOCAL_CACHE', 'PI_EXECUTABLE', 'PI_MODEL',
  ]) {
    assert.ok(!Object.hasOwn(app.env, pcOnlyVar), `${pcOnlyVar} must not be a CT103 PM2 setting`);
  }
});

test('MCC_ENV_FILE overrides inherited PM2 values before MCC configuration without exposing its value', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-env-file-'));
  const envFile = path.join(dir, 'mav-console.env');
  const secret = 'ct103-env-file-secret';
  fs.writeFileSync(envFile, `PORT=43123\nMCC_ENV_LOADER_TEST=${secret}\n`);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const serverSource = fs.readFileSync(path.join(rootDir, 'server.mjs'), 'utf8');
  assert.match(serverSource, /import '\.\/lib\/load-env\.mjs';/);
  assert.ok(
    serverSource.indexOf("import './lib/load-env.mjs';") < serverSource.indexOf("from './lib/config.mjs'"),
    'the environment loader must precede config-dependent imports',
  );

  const result = runProbe(
    `await import(${JSON.stringify(envLoaderUrl)}); const config = await import(${JSON.stringify(configModuleUrl)}); process.stdout.write(JSON.stringify({ port: config.port }));`,
    { env: childEnv({ MCC_ENV_FILE: envFile, PORT: '39999' }) },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { port: 43123 });
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
});

test('the normal local .env path is used when MCC_ENV_FILE is absent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-local-env-'));
  fs.writeFileSync(path.join(dir, '.env'), 'MCC_ENV_LOCAL_TEST=loaded-from-local-dotenv\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = runProbe(
    `await import(${JSON.stringify(envLoaderUrl)}); process.stdout.write(process.env.MCC_ENV_LOCAL_TEST || '');`,
    { cwd: dir, env: childEnv() },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'loaded-from-local-dotenv');
});
