// SPDX-License-Identifier: BUSL-1.1
/**
 * One-command release of all four packages, always together and at the same version:
 *
 *   @onehumanai/engine    BUSL-1.1    published first
 *   @onehumanai/sdk       Apache-2.0  the browser SDK alone
 *   @onehumanai/express   Apache-2.0  depends on exactly that engine version
 *   onehuman              Apache-2.0  `npx onehuman …`, depends on exactly that express version
 *
 *   npm run release -- current          # publish the version in package.json as it is
 *   npm run release -- patch            # 0.6.0 → 0.6.1
 *   npm run release -- 1.0.0            # exact version
 *   npm run release -- patch --dry-run  # everything except publish/commit/tag
 *
 * Steps: typecheck+tests → bump every version → build (the build enforces the licence line) →
 * npm publish in dependency order → git commit + tag onehuman-vX.Y.Z.
 * Requires `npm login` as a member of the npm organisation `onehumanai` (and the owner of `onehuman`).
 * With two-factor auth npm asks for a one-time code for each package.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';
const run = (cmd, opts = {}) => { console.log(`\n$ ${cmd}`); return execSync(cmd, { stdio: 'inherit', ...opts }); };
const ENGINE = 'packages/engine';
const SDK = 'packages/sdk';
const OPEN = 'packages/express';
const CLI = 'packages/cli';
const ORDER = [ENGINE, SDK, OPEN, CLI];
const read = (p) => JSON.parse(readFileSync(`${p}/package.json`, 'utf8'));
const write = (p, j) => writeFileSync(`${p}/package.json`, JSON.stringify(j, null, 2) + '\n');

if (!dry) {
  try { execSync('npm whoami', { stdio: 'pipe' }); } catch { console.error('\nnpm-ə daxil olunmayıb: əvvəl `npm login` et, sonra yenidən `npm run release`.'); process.exit(1); }
}
run('npm run check');

// the package reports to https://onehuman.ai by default: never publish while that address does not answer as the portal
if (!dry && !args.includes('--skip-portal-check')) {
  const ok = await fetch('https://onehuman.ai/api/v1/policy-keys', { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
  if (!ok) { console.error('\nhttps://onehuman.ai portal kimi cavab vermir. Əvvəl domeni yoxla, sonra yenidən `npm run release`.'); process.exit(1); }
}

// one version for all; each package pins the one below it exactly
const current = read(OPEN).version;
if (bump !== 'current') run(`npm version ${bump} --no-git-tag-version`, { cwd: OPEN });
const version = read(OPEN).version;
for (const p of [ENGINE, SDK, CLI]) { const j = read(p); j.version = version; write(p, j); }
const open = read(OPEN); open.dependencies = { ...(open.dependencies || {}), '@onehumanai/engine': version }; write(OPEN, open);
const cli = read(CLI); cli.dependencies = { ...(cli.dependencies || {}), '@onehumanai/express': version }; write(CLI, cli);
console.log(`\nversion ${current} → ${version} (all packages)`);

run('node scripts/build-package.mjs');
for (const p of ORDER) run(`npm publish --access public${dry ? ' --dry-run' : ''}`, { cwd: p });
const names = ORDER.map((p) => read(p).name);
if (dry) { console.log(`\n(dry run) ${names.map((n) => `${n}@${version}`).join(', ')} hazırdır; heç nə nəşr olunmadı.`); process.exit(0); }
try {
  run(`git add ${ORDER.map((p) => `${p}/package.json`).join(' ')} ${OPEN}/CHANGELOG.md`);
  run(`git commit -m "release: v${version} (${names.join(', ')})"`);
  run(`git tag onehuman-v${version}`);
} catch { console.warn('git commit/tag alınmadı (repo təmiz deyil?) — nəşr uğurludur, tag-i əl ilə qoy.'); }
console.log(`\n✓ nəşr olundu:\n${names.map((n) => `  https://www.npmjs.com/package/${n}`).join('\n')}`);
