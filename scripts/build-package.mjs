// SPDX-License-Identifier: BUSL-1.1
/**
 * Build the two publishable packages:
 *
 *   packages/engine      nanotarget-engine   BUSL-1.1    the engine: detection, policy, audit, proofs (server/public.ts)
 *     dist/engine.js       one ESM bundle (node:* and @libsql/* external)
 *     dist/kinematics-model.json
 *     dist/types/**        .d.ts of the engine's public surface
 *
 *   packages/nanotarget  nanotarget           Apache-2.0  what customers link into their code
 *     dist/express.js      the Express/Connect middleware — imports nanotarget-engine, contains none of it
 *     dist/cli.js          scan · verify · verify-proof · secret — no engine code at all
 *     dist/types/**        .d.ts of the middleware, engine types referenced by package name
 *     sdk/nanotarget.js    the browser SDK, served by the middleware
 *
 * The line between the two licences is enforced here, not by convention: if the open bundle would contain
 * any file from server/ other than through the engine package, the build stops.
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const OPEN = 'packages/nanotarget';
const ENGINE = 'packages/engine';
const ROOT = resolve('.');
const SERVER = join(ROOT, 'server') + '/';
const PUBLIC = join(ROOT, 'server', 'public.ts');

for (const d of [`${OPEN}/dist`, `${OPEN}/sdk`, `${ENGINE}/dist`]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }

const openPkg = JSON.parse(readFileSync(`${OPEN}/package.json`, 'utf8'));
const enginePkg = JSON.parse(readFileSync(`${ENGINE}/package.json`, 'utf8'));
if (openPkg.version !== enginePkg.version) throw new Error(`versions differ: nanotarget ${openPkg.version} vs nanotarget-engine ${enginePkg.version} — release them together`);
if (openPkg.dependencies?.['nanotarget-engine'] !== enginePkg.version) throw new Error(`nanotarget must depend on nanotarget-engine@${enginePkg.version} exactly`);

// ---------------------------------------------------------------- the engine (BUSL-1.1)
await build({
  entryPoints: ['server/public.ts'],
  outfile: `${ENGINE}/dist/engine.js`,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true, legalComments: 'none',
  external: ['@libsql/client', '@libsql/client/*', 'node:*'],
  define: { __NANOTARGET_ENGINE_VERSION__: JSON.stringify(enginePkg.version) },
  banner: { js: `// nanotarget-engine ${enginePkg.version} — BUSL-1.1 (see LICENSE) — https://nanotarget-mvp.vercel.app` },
});
if (existsSync('server/kinematics-model.json')) cpSync('server/kinematics-model.json', `${ENGINE}/dist/kinematics-model.json`);
execSync('npx tsc -p tsconfig.engine.json', { stdio: 'inherit' });

// ---------------------------------------------------------------- the open package (Apache-2.0)
/** Route the engine's public surface to the package; refuse any other way into server/. */
const licenceLine = {
  name: 'licence-line',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (!args.path.startsWith('.') || !args.resolveDir) return undefined;
      const target = resolve(args.resolveDir, args.path);
      if (target === PUBLIC) return { path: 'nanotarget-engine', external: true };
      if (target.startsWith(SERVER)) throw new Error(`licence line: ${args.importer} imports ${args.path} — the open package may reach the engine only through server/public.ts`);
      return undefined;
    });
  },
};
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'none', plugins: [licenceLine] };
await build({
  ...common,
  entryPoints: ['integrations/express/index.ts'],
  outfile: `${OPEN}/dist/express.js`,
  sourcemap: true,
  external: ['nanotarget-engine', '@libsql/client', '@libsql/client/*', 'express', 'node:*'],
  define: { __NANOTARGET_VERSION__: JSON.stringify(openPkg.version) },
  banner: { js: `// nanotarget ${openPkg.version} — Apache-2.0 — https://nanotarget-mvp.vercel.app` },
});
await build({
  ...common,
  entryPoints: ['integrations/cli/index.ts'],
  outfile: `${OPEN}/dist/cli.js`,
  external: ['node:*'],
  banner: { js: '#!/usr/bin/env node' },
});
// Belt and braces: no engine module may appear in the open bundles.
for (const f of ['express.js', 'cli.js']) {
  const code = readFileSync(`${OPEN}/dist/${f}`, 'utf8');
  for (const marker of ['class NanoTarget', 'function assess(', 'function judgeClick(', 'function proverFromSecret(']) {
    if (code.includes(marker)) throw new Error(`licence line: ${f} contains engine code (${marker})`);
  }
}
cpSync('sdk/nanotarget.js', `${OPEN}/sdk/nanotarget.js`);
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
// the middleware's declarations point at the engine package, not at files this package does not ship
const types = `${OPEN}/dist/types`;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(types).filter((p) => p.endsWith('.d.ts'))) {
  const s = readFileSync(f, 'utf8');
  const t = s.replace(/(["'])(?:\.\.\/)+server\/public(?:\.(?:js|ts))?\1/g, '"nanotarget-engine"');
  if (t !== s) writeFileSync(f, t);
}
rmSync(`${types}/server`, { recursive: true, force: true });
for (const f of walk(types)) if (readFileSync(f, 'utf8').match(/\/server\//)) throw new Error(`licence line: ${f} still references server/`);

// the SDK carries the package version too (visible as NanoTarget.version in the browser)
const sdk = readFileSync(`${OPEN}/sdk/nanotarget.js`, 'utf8').replace(/version: 'sdk-v\d+'/, `version: 'sdk-v4+${openPkg.version}'`);
writeFileSync(`${OPEN}/sdk/nanotarget.js`, sdk);
console.log(`built ${ENGINE} v${enginePkg.version} (BUSL-1.1) and ${OPEN} v${openPkg.version} (Apache-2.0)`);
