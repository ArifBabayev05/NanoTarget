/**
 * One-command release of the `nanotarget` package.
 *   npm run release -- patch            # 0.1.0 → 0.1.1
 *   npm run release -- minor            # 0.1.x → 0.2.0
 *   npm run release -- 1.0.0            # exact version
 *   npm run release -- current          # publish the version already in packages/nanotarget/package.json (first release)
 *   npm run release -- patch --dry-run  # everything except publish/commit/tag
 * Steps: typecheck+tests → build package → bump version → npm publish → git commit + tag nanotarget-vX.Y.Z.
 * Requires `npm login` once (npm whoami must succeed).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';
const run = (cmd, opts = {}) => { console.log(`\n$ ${cmd}`); return execSync(cmd, { stdio: 'inherit', ...opts }); };
const PKG = 'packages/nanotarget';

if (!dry) {
  try { execSync('npm whoami', { stdio: 'pipe' }); } catch { console.error('\nnpm-ə daxil olunmayıb: əvvəl `npm login` et, sonra yenidən `npm run release`.'); process.exit(1); }
}
run('npm run check');
if (bump !== 'current') run(`npm version ${bump} --no-git-tag-version`, { cwd: PKG }); // `current` = publish the version already in package.json
const version = JSON.parse(readFileSync(`${PKG}/package.json`, 'utf8')).version;
run('node scripts/build-package.mjs');
run(`npm publish --access public${dry ? ' --dry-run' : ''}`, { cwd: PKG });
if (dry) { console.log(`\n(dry run) nanotarget@${version} hazırdır; heç nə nəşr olunmadı, versiya faylda qaldı.`); process.exit(0); }
try {
  run(`git add ${PKG}/package.json ${PKG}/CHANGELOG.md`);
  run(`git commit -m "release: nanotarget@${version}"`);
  run(`git tag nanotarget-v${version}`);
} catch { console.warn('git commit/tag alınmadı (repo təmiz deyil?) — nəşr uğurludur, tag-i əl ilə qoy.'); }
console.log(`\n✓ nanotarget@${version} nəşr olundu: https://www.npmjs.com/package/nanotarget`);
