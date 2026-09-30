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
  try { execSync('npm whoami', { stdio: 'pipe' }); } catch { console.error('\nNot logged in to npm: run `npm login`, then `npm run release` again.'); process.exit(1); }
}
run('npm run check');

// the package reports to https://onehuman.ai by default: never publish while that address does not answer as the portal
if (!dry && !args.includes('--skip-portal-check')) {
  const ok = await fetch('https://onehuman.ai/api/v1/policy-keys', { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
  if (!ok) { console.error('\nhttps://onehuman.ai does not answer as the portal. Check the domain, then run `npm run release` again.'); process.exit(1); }
}

const current = read().version;
if (bump !== 'current') run(`npm version ${bump} --no-git-tag-version`, { cwd: PKG });
const version = read().version;
console.log(`\nversion ${current} → ${version}`);

run('node scripts/build-package.mjs');
try { run(`npm publish --access public${dry ? ' --dry-run' : ''}`, { cwd: PKG }); }
catch {
  console.error(`\nnpm publish failed. If npm says "previously staged version", an earlier upload of ${version} is waiting for approval:
open https://www.npmjs.com/package/onehumanai, approve or discard the staged version, or release the next one (npm run release -- patch).
When npm opens a browser to authenticate, finish it there: until then the upload stays staged.`);
  process.exit(1);
}
if (dry) { console.log(`\n(dry run) onehumanai@${version} is ready; nothing was published.`); process.exit(0); }
// npm can accept an upload and still hold it (staged until approved): commit and tag only once the registry serves it
let live = false;
for (let i = 0; i < 12 && !live; i++) {
  live = await fetch(`https://registry.npmjs.org/onehumanai/${version}`).then((r) => r.ok, () => false);
  if (!live) await new Promise((r) => setTimeout(r, 5000));
}
if (!live) {
  console.error(`\nnpm accepted the upload, but onehumanai@${version} is not live yet: it is probably staged, waiting for approval.
Approve it at https://www.npmjs.com/package/onehumanai, then commit and tag: git commit -am "release: onehumanai@${version}" && git tag onehumanai-v${version}`);
  process.exit(1);
}
// the version may already be committed (prepared before the release): then there is nothing to commit, only the tag
try { run(`git add ${PKG}/package.json ${PKG}/CHANGELOG.md`); if (execSync('git diff --cached --name-only').toString().trim()) run(`git commit -m "release: onehumanai@${version}"`); }
catch { console.warn('git commit failed. The package is published; commit package.json and CHANGELOG.md by hand.'); }
try { run(`git tag onehumanai-v${version}`); } catch { console.warn(`git tag failed. The package is published; tag it by hand: git tag onehumanai-v${version}`); }
console.log(`\n✓ published: https://www.npmjs.com/package/onehumanai`);
