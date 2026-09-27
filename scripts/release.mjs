// SPDX-License-Identifier: BUSL-1.1
/**
 * One-command release of the `onehumanai` npm package.
 *
 *   npm run release -- current          # publish the version in package.json as it is
 *   npm run release -- patch            # 0.6.0 → 0.6.1
 *   npm run release -- 1.0.0            # exact version
 *   npm run release -- patch --dry-run  # everything except publish/commit/tag
 *
 * Steps: typecheck+tests → bump the version → build (the build enforces the licence line) →
 * npm publish → git commit + tag onehumanai-vX.Y.Z. Requires `npm login` as an owner of `onehumanai`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';
const run = (cmd, opts = {}) => { console.log(`\n$ ${cmd}`); return execSync(cmd, { stdio: 'inherit', ...opts }); };
const PKG = 'packages/onehumanai';
const read = () => JSON.parse(readFileSync(`${PKG}/package.json`, 'utf8'));

if (!dry) {
  try { execSync('npm whoami', { stdio: 'pipe' }); } catch { console.error('\nnpm-ə daxil olunmayıb: əvvəl `npm login` et, sonra yenidən `npm run release`.'); process.exit(1); }
}
run('npm run check');

// the package reports to https://onehuman.ai by default: never publish while that address does not answer as the portal
if (!dry && !args.includes('--skip-portal-check')) {
  const ok = await fetch('https://onehuman.ai/api/v1/policy-keys', { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
  if (!ok) { console.error('\nhttps://onehuman.ai portal kimi cavab vermir. Əvvəl domeni yoxla, sonra yenidən `npm run release`.'); process.exit(1); }
}

const current = read().version;
if (bump !== 'current') run(`npm version ${bump} --no-git-tag-version`, { cwd: PKG });
const version = read().version;
console.log(`\nversion ${current} → ${version}`);

run('node scripts/build-package.mjs');
run(`npm publish --access public${dry ? ' --dry-run' : ''}`, { cwd: PKG });
if (dry) { console.log(`\n(dry run) onehumanai@${version} hazırdır; heç nə nəşr olunmadı.`); process.exit(0); }
try {
  run(`git add ${PKG}/package.json ${PKG}/CHANGELOG.md`);
  run(`git commit -m "release: onehumanai@${version}"`);
  run(`git tag onehumanai-v${version}`);
} catch { console.warn('git commit/tag alınmadı (repo təmiz deyil?) — nəşr uğurludur, tag-i əl ilə qoy.'); }
console.log(`\n✓ nəşr olundu: https://www.npmjs.com/package/onehumanai`);
