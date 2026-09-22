/**
 * Build the publishable `nanotarget` package into packages/nanotarget/dist:
 *   dist/express.js         one ESM bundle of the Express integration + engine (node:* and @libsql/* external)
 *   dist/types/**           .d.ts for the public API (tsc, declaration only)
 *   sdk/nanotarget.js       the browser SDK, served by the middleware
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PKG = 'packages/nanotarget';
rmSync(`${PKG}/dist`, { recursive: true, force: true });
rmSync(`${PKG}/sdk`, { recursive: true, force: true });
mkdirSync(`${PKG}/dist`, { recursive: true });
mkdirSync(`${PKG}/sdk`, { recursive: true });

const pkg = JSON.parse(readFileSync(`${PKG}/package.json`, 'utf8'));
await build({
  entryPoints: ['integrations/express/index.ts'],
  outfile: `${PKG}/dist/express.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  external: ['@libsql/client', '@libsql/client/*', 'express', 'node:*'],
  define: { __NANOTARGET_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `// nanotarget ${pkg.version} — https://nanotarget-mvp.vercel.app` },
});
await build({
  entryPoints: ['integrations/cli/index.ts'],
  outfile: `${PKG}/dist/cli.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  external: ['node:*'],
  banner: { js: '#!/usr/bin/env node' },
});
cpSync('sdk/nanotarget.js', `${PKG}/sdk/nanotarget.js`);
if (existsSync('server/kinematics-model.json')) cpSync('server/kinematics-model.json', `${PKG}/dist/kinematics-model.json`);
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
// the SDK carries the package version too (visible as NanoTarget.version in the browser)
const sdk = readFileSync(`${PKG}/sdk/nanotarget.js`, 'utf8').replace(/version: 'sdk-v\d+'/, `version: 'sdk-v4+${pkg.version}'`);
writeFileSync(`${PKG}/sdk/nanotarget.js`, sdk);
console.log(`built ${PKG} v${pkg.version}`);
