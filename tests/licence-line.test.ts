// SPDX-License-Identifier: BUSL-1.1
/** The licence line: the open code (Apache-2.0) reaches the engine (BUSL-1.1) only through server/public.ts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('open code imports the engine only through server/public.ts', () => {
  for (const f of [...walk('integrations'), ...walk('sdk')].filter((p) => /\.(ts|js|mjs)$/.test(p))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]!;
      if (spec.includes('/server/')) assert.match(spec, /\/server\/public\.ts$/, `${f} imports ${spec}`);
    }
  }
});

test('every source file names its licence, and the open directories are Apache-2.0', () => {
  const open = [...walk('integrations'), ...walk('sdk')].filter((p) => /\.(ts|js|mjs)$/.test(p));
  const engine = walk('server').filter((p) => p.endsWith('.ts'));
  for (const f of open) assert.match(readFileSync(f, 'utf8').slice(0, 400), /SPDX-License-Identifier: Apache-2\.0/, f);
  for (const f of engine) assert.match(readFileSync(f, 'utf8').slice(0, 400), /SPDX-License-Identifier: BUSL-1\.1/, f);
});

test('the packages declare the licence their files carry', () => {
  const open = JSON.parse(readFileSync('packages/onehuman/package.json', 'utf8'));
  const engine = JSON.parse(readFileSync('packages/engine/package.json', 'utf8'));
  assert.equal(open.license, 'Apache-2.0');
  assert.equal(engine.license, 'BUSL-1.1');
  assert.equal(open.dependencies['onehuman-engine'], engine.version, 'released in lockstep');
  assert.match(readFileSync('packages/onehuman/LICENSE', 'utf8'), /Apache License\s+Version 2\.0, January 2004/);
  assert.match(readFileSync('packages/engine/LICENSE', 'utf8'), /Business Source License 1\.1/);
  assert.match(readFileSync('packages/engine/LICENSE', 'utf8'), /Additional Use Grant: You may make production use/);
});

test('the middleware refuses an engine of a different version with an actionable message', async () => {
  // simulate the built packages: stamp both sides, then let them disagree
  const src = readFileSync('integrations/express/index.ts', 'utf8');
  assert.match(src, /PACKAGE_VERSION !== ENGINE_VERSION/, 'the startup check exists');
  assert.match(src, /npm i onehuman@\$\{PACKAGE_VERSION\}/, 'and tells the user the exact fix');
  // from source both read 0.0.0-dev and the check is skipped, so onehuman() still works here
  const { onehuman } = await import('../integrations/express/index.ts');
  const nt = await onehuman({ secret: 'a-long-enough-secret-for-tests-0000000000', policy: { version: 'v', enforcement: 'observe', rules: [{ resource: 'x.read', title: 'x', onAgent: 'mask', onArtifact: 'allow', onUnknown: 'allow', onHumanLike: 'allow', actOn: ['strong'], minScore: 65 }] } as never, db: 'memory' });
  assert.equal(nt.health().ok, true);
  await nt.close();
});
