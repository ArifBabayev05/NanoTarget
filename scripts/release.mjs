// SPDX-License-Identifier: BUSL-1.1
/**
 * One-command release of both packages, always together and at the same version:
 *
 *   onehuman-engine   BUSL-1.1    published first
 *   onehuman           Apache-2.0  depends on exactly that engine version
 *
 *   npm run release -- minor            # 0.3.x → 0.4.0 (the first release under the split licences)
 *   npm run release -- patch            # 0.4.0 → 0.4.1
 *   npm run release -- 1.0.0            # exact version
 *   npm run release -- patch --dry-run  # everything except publish/commit/tag
 *
 * Steps: typecheck+tests → bump both versions → build both (the build enforces the licence line) →
 * npm publish engine → npm publish onehuman → git commit + tag onehuman-vX.Y.Z.
 * Requires `npm login` (an account that maintains `onehuman`; the engine package is created on first publish).
 * With two-factor auth npm asks for a one-time code for each of the two packages.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';
const run = (cmd, opts = {}) => { console.log(`\n$ ${cmd}`); return execSync(cmd, { stdio: 'inherit', ...opts }); };
const OPEN = 'packages/onehuman';
const ENGINE = 'packages/engine';
const read = (p) => JSON.parse(readFileSync(`${p}/package.json`, 'utf8'));
const write = (p, j) => writeFileSync(`${p}/package.json`, JSON.stringify(j, null, 2) + '\n');

if (!dry) {
  try { execSync('npm whoami', { stdio: 'pipe' }); } catch { console.error('\nnpm-ə daxil olunmayıb: əvvəl `npm login` et, sonra yenidən `npm run release`.'); process.exit(1); }
}
run('npm run check');

// the package reports to https://onehuman.ai by default: never publish while that address does not answer as the portal
if (!dry && !args.includes('--skip-portal-check')) {
  const ok = await fetch('https://onehuman.ai/api/v1/policy-keys', { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
  if (!ok) { console.error('\nhttps://onehuman.ai portal kimi cavab vermir (DNS hələ Vercel-ə yönəlməyib?). Əvvəl domeni qoş, sonra yenidən `npm run release`.'); process.exit(1); }
}

// one version for both; the open package pins the engine to it exactly
const current = read(OPEN).version;
if (bump !== 'current') run(`npm version ${bump} --no-git-tag-version`, { cwd: OPEN });
const version = read(OPEN).version;
const engine = read(ENGINE); engine.version = version; write(ENGINE, engine);
const open = read(OPEN); open.dependencies = { ...(open.dependencies || {}), 'onehuman-engine': version }; write(OPEN, open);
console.log(`\nversion ${current} → ${version} (both packages)`);

run('node scripts/build-package.mjs');
run(`npm publish --access public${dry ? ' --dry-run' : ''}`, { cwd: ENGINE });
run(`npm publish --access public${dry ? ' --dry-run' : ''}`, { cwd: OPEN });
if (dry) { console.log(`\n(dry run) onehuman-engine@${version} və onehuman@${version} hazırdır; heç nə nəşr olunmadı.`); process.exit(0); }
try {
  run(`git add ${OPEN}/package.json ${OPEN}/CHANGELOG.md ${ENGINE}/package.json`);
  run(`git commit -m "release: onehuman@${version} + onehuman-engine@${version}"`);
  run(`git tag onehuman-v${version}`);
} catch { console.warn('git commit/tag alınmadı (repo təmiz deyil?) — nəşr uğurludur, tag-i əl ilə qoy.'); }
console.log(`\n✓ nəşr olundu:\n  https://www.npmjs.com/package/onehuman (Apache-2.0)\n  https://www.npmjs.com/package/onehuman-engine (BUSL-1.1)`);
