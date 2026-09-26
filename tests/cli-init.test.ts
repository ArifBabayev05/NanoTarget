// SPDX-License-Identifier: Apache-2.0
/** `onehuman init --yes` wires an Express app: rules, secret, setup module, middleware and protect() on the chosen routes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoMask } from '../integrations/express/index.ts';

const CLI = new URL('../integrations/cli/index.ts', import.meta.url).pathname;
const run = (dir: string) => spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--no-install'], { encoding: 'utf8' });

test('an ES-module Express app is wired end to end, and a second run changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-init-esm-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bank', type: 'module', scripts: { start: 'node server.js' }, dependencies: { express: '^4' } }, null, 2));
  writeFileSync(join(dir, 'server.js'), [
    "import express from 'express';",
    '',
    'const app = express();',
    "app.get('/api/balance', (req, res) => res.json({ id: 'a', balance: 5, owner: req.session?.userId }));",
    "app.get('/api/statements/export', (req, res) => res.send('csv'));",
    "app.get('/health', (req, res) => res.send('ok'));",
    'app.listen(3000);',
  ].join('\n'));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const server = readFileSync(join(dir, 'server.js'), 'utf8');
  assert.match(server, /^import \{ onehuman \} from '\.\/onehuman\.js';$/m);
  assert.match(server, /const app = express\(\);\napp\.use\(onehuman\.middleware\(\)\);/);
  assert.match(server, /app\.get\('\/api\/balance', onehuman\.protect\('balance\.read', \{ mask: 'auto' \}\),/);
  assert.match(server, /app\.get\('\/api\/statements\/export', onehuman\.protect\('statements\.export'\),/, 'not statements.export.export');
  assert.doesNotMatch(server, /'\/health', onehuman/, 'a health check is not protected');
  const setup = readFileSync(join(dir, 'onehuman.js'), 'utf8');
  assert.match(setup, /identify: \(req\) => req\.session\?\.userId \?\? null/);
  const policy = JSON.parse(readFileSync(join(dir, 'onehuman.policy.json'), 'utf8'));
  assert.equal(policy.enforcement, 'observe', 'the recommended start is watching only');
  assert.deepEqual(policy.rules.map((x: { resource: string }) => x.resource).sort(), ['balance.read', 'statements.export']);
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), /^ONEHUMAN_SECRET=[a-f0-9]{64}$/m);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env$/m);
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.start, 'node --env-file-if-exists=.env server.js');

  const again = run(dir);
  assert.equal(again.status, 0);
  assert.equal(readFileSync(join(dir, 'server.js'), 'utf8'), server, 'idempotent');
});

test('a CommonJS app with routes in their own file gets require() in both files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-init-cjs-'));
  mkdirSync(join(dir, 'routes'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'crm', dependencies: { express: '^4' } }));
  writeFileSync(join(dir, 'app.js'), "const express = require('express');\nconst accounts = require('./routes/accounts');\n\nconst app = express();\napp.use('/api', accounts);\napp.listen(3000);\n");
  writeFileSync(join(dir, 'routes', 'accounts.js'), "const express = require('express');\nconst router = express.Router();\nrouter.get('/customers', (req, res) => res.json([]));\nmodule.exports = router;\n");
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readFileSync(join(dir, 'routes', 'accounts.js'), 'utf8'), /const \{ onehuman \} = require\('\.\.\/onehuman\.js'\);[\s\S]*router\.get\('\/customers', onehuman\.protect\('customers\.read', \{ mask: 'auto' \}\),/);
  assert.match(readFileSync(join(dir, 'app.js'), 'utf8'), /app\.use\(onehuman\.middleware\(\)\);/);
  assert.match(readFileSync(join(dir, 'onehuman.js'), 'utf8'), /require\('onehuman\/express'\)[\s\S]*module\.exports = \{ onehuman \}/);
  assert.ok(!existsSync(join(dir, 'onehuman.mjs')));
});

test("mask: 'auto' hides every value and keeps the shape and ids", () => {
  assert.deepEqual(autoMask({ id: 7, balance: 10.5, owner: 'Ada', active: true, items: [{ _id: 'x', memo: 'rent' }], none: null }),
    { id: 7, balance: null, owner: '••••', active: true, items: [{ _id: 'x', memo: '••••' }], none: null });
});
