// SPDX-License-Identifier: Apache-2.0
/**
 * `onehuman init` — set OneHuman up in this project by answering a few questions.
 *
 * It reads the project (the same scan as `onehuman scan`), asks what to protect and how, shows every file it
 * would write or change, and writes nothing until the person says yes. For an Express app it wires the code
 * itself: a small `onehuman.js` next to the server, `app.use(onehuman.middleware())`, and
 * `onehuman.protect('…')` on each chosen route. For other servers it writes the rules and the environment and
 * prints the lines to add.
 *
 *   npx onehuman init [dir]            ask, show the plan, apply on yes
 *   npx onehuman init [dir] --yes      take every recommended answer (for CI and coding agents)
 *   npx onehuman init [dir] --no-install   do not run the package manager
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { scan, type RouteHit, type ScanResult } from './scan.ts';

type Mode = 'allow' | 'mask' | 'step_up' | 'block';
const PRESETS: Record<string, { label: string; what: string; m: [Mode, Mode, Mode, Mode] }> = {
  open: { label: 'Open to everyone', what: 'agents and people see everything', m: ['allow', 'allow', 'allow', 'allow'] },
  hide: { label: 'AI agents see it with details hidden', what: 'values hidden from an agent, people see everything', m: ['mask', 'mask', 'allow', 'allow'] },
  refuse: { label: 'Refuse AI agents', what: 'an agent is turned away, people see everything', m: ['block', 'mask', 'allow', 'allow'] },
  guard: { label: 'Refuse AI agents, passkey when unsure', what: 'an agent is turned away; when unsure, the person confirms with a passkey', m: ['block', 'step_up', 'step_up', 'allow'] },
  passkey: { label: 'Everyone confirms with a passkey', what: 'for the few critical actions: payouts, contact changes, bulk export', m: ['block', 'step_up', 'step_up', 'step_up'] },
};
const PRESET_KEYS = Object.keys(PRESETS);

const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1'), dim = c('2'), green = c('32'), cyan = c('36'), yellow = c('33');

type Choice<T> = { label: string; value: T; hint?: string };

function suggestPreset(r: RouteHit): string {
  if (r.proposal.onAgent === 'allow') return 'open';
  if (r.proposal.onAgent === 'mask') return r.kind === 'read' ? 'hide' : 'refuse';
  if (r.kind === 'download' || /transfer|withdraw|payout|pay\b|delete/i.test(r.path)) return 'guard';
  return r.proposal.onUnknown === 'step_up' ? 'guard' : 'refuse';
}
const titleOf = (res: string) => res.replace(/[._-]+/g, ' ').replace(/^./, (x) => x.toUpperCase());

/** `req.session.userId` → `req.session?.userId`, so a request without a login gives null instead of throwing */
const safeChain = (expr: string) => expr.replace(/\?\./g, '.').replace(/\./g, '?.').replace(/^req\?\./, 'req.');

type Style = { esm: boolean; ts: boolean; ext: string; importSuffix: string };
function styleOf(file: string, text: string, pkgType: string | undefined): Style {
  const ext = extname(file);
  const ts = ext === '.ts' || ext === '.mts' || ext === '.tsx';
  const esm = ext === '.mjs' || ext === '.mts' || (ext !== '.cjs' && (/^\s*import\s[\s\S]*?from\s|^\s*export\s/m.test(text) || (!/\brequire\s*\(/.test(text) && pkgType === 'module')));
  // follow how this file already imports its neighbours: './x.js' or './x'
  const rel = text.match(/from\s+['"](\.{1,2}\/[^'"]+)['"]/);
  const importSuffix = rel ? (/\.(m?js|ts)$/.test(rel[1]!) ? (rel[1]!.match(/\.(m?js|ts)$/)![0]) : '') : ts ? '' : ext === '.mjs' ? '.mjs' : '.js';
  return { esm, ts, ext: ts ? '.ts' : ext === '.mjs' || ext === '.cjs' ? ext : '.js', importSuffix };
}

type Edit = { file: string; before: string | null; after: string; changes: string[] };

export async function runInit(dir: string, flags: { yes: boolean; install: boolean }) {
  const root = resolve(dir);
  const rl = flags.yes ? null : createInterface({ input: process.stdin, output: process.stdout });
  if (!flags.yes && !process.stdin.isTTY) {
    console.error('onehuman init asks questions. In a script, run `npx onehuman init --yes` to take the recommended answers.');
    process.exit(2);
  }
  const say = (s = '') => console.log(s);

  async function choose<T>(question: string, choices: Choice<T>[], def = 0): Promise<T> {
    if (flags.yes || choices.length === 1) return choices[def]!.value;
    say(`\n${bold('? ' + question)}`);
    choices.forEach((ch, i) => say(`  ${cyan(String(i + 1) + ')')} ${ch.label}${i === def ? dim('  (recommended)') : ''}${ch.hint ? dim('  — ' + ch.hint) : ''}`));
    for (;;) {
      const a = (await rl!.question(`  Choose [${def + 1}]: `)).trim();
      if (!a) return choices[def]!.value;
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1]!.value;
      say(yellow(`  Type a number from 1 to ${choices.length}.`));
    }
  }
  async function pickMany<T>(question: string, choices: Choice<T>[], defaults: number[]): Promise<T[]> {
    if (flags.yes) return defaults.map((i) => choices[i]!.value);
    say(`\n${bold('? ' + question)}`);
    choices.forEach((ch, i) => say(`  ${cyan(String(i + 1).padStart(2) + ')')} ${defaults.includes(i) ? green('●') : dim('○')} ${ch.label}${ch.hint ? dim('  ' + ch.hint) : ''}`));
    for (;;) {
      const a = (await rl!.question(`  Numbers separated by commas, "all" or "none" [${defaults.length === choices.length ? 'all' : defaults.map((i) => i + 1).join(',') || 'none'}]: `)).trim().toLowerCase();
      if (!a) return defaults.map((i) => choices[i]!.value);
      if (a === 'all') return choices.map((x) => x.value);
      if (a === 'none') return [];
      const nums = a.split(/[\s,]+/).map(Number);
      if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= choices.length)) return [...new Set(nums)].map((n) => choices[n - 1]!.value);
      say(yellow('  For example: 1,3,4'));
    }
  }
  async function text(question: string, def = ''): Promise<string> {
    if (flags.yes) return def;
    return (await rl!.question(`\n${bold('? ' + question)} ${def ? dim(`[${def}] `) : ''}`)).trim() || def;
  }
  async function confirm(question: string, def = true): Promise<boolean> {
    if (flags.yes) return def;
    const a = (await rl!.question(`\n${bold('? ' + question)} ${dim(def ? '(Y/n)' : '(y/N)')} `)).trim().toLowerCase();
    return a ? a.startsWith('y') || a === 'hə' || a === 'he' : def;
  }

  // ---------------------------------------------------------------- read the project
  say(`\n${bold('OneHuman setup')} ${dim('— a few questions; nothing is written until you say yes.')}`);
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) { say(yellow(`\nNo package.json in ${root}. Run this in your Node server's folder, or pass it: npx onehuman init ./server`)); rl?.close(); process.exit(2); }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { type?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const r: ScanResult = scan(root);
  for (const x of r.routes) x.file = resolve(root, x.file);   // the scan reports paths relative to the project
  const detected = deps.express ? 'express' : deps.fastify ? 'fastify' : deps.next ? 'next' : deps.koa ? 'koa' : deps['@nestjs/core'] ? 'nestjs' : r.frameworks[0] ?? 'unknown';
  say(dim(`\nRead ${r.filesScanned} files: ${r.routes.length} routes${r.frameworks.length ? ` (${r.frameworks.join(', ')})` : ''}, ${r.routes.filter((x) => x.sensitivity >= 25).length} that an AI agent with a customer's login could misuse.`));

  // ---------------------------------------------------------------- 1. the server
  const framework = await choose('Which server does this app use?', [
    { label: 'Express (or Connect / plain Node http)', value: 'express', hint: 'OneHuman wires the code itself' },
    { label: 'Fastify', value: 'fastify', hint: 'rules and settings written; you add 3 lines' },
    { label: 'Next.js', value: 'next', hint: 'rules and settings written; you add a custom server' },
    { label: 'Something else', value: 'other', hint: 'rules and settings written, plus a prompt for your coding agent' },
  ], ['express', 'fastify', 'next'].indexOf(detected) >= 0 ? ['express', 'fastify', 'next'].indexOf(detected) : 0);

  // ---------------------------------------------------------------- 2. what to protect, and how
  const candidates = r.routes.filter((x) => x.sensitivity >= 25).sort((a, b) => b.sensitivity - a.sensitivity).slice(0, 40);
  let chosen: RouteHit[] = [];
  if (candidates.length) {
    const w = Math.max(...candidates.map((x) => x.path.length));
    chosen = await pickMany('Which parts of your app should OneHuman protect?', candidates.map((x) => ({
      value: x,
      label: `${x.method.padEnd(6)} ${x.path.padEnd(w)}`,
      hint: `${relative(root, x.file)}:${x.line} · ${x.signals.filter((s) => s !== 'excluded-pattern').join(', ') || 'sensitive'}`,
    })), candidates.map((_, i) => i));
  } else say(dim('\nNo sensitive routes found automatically. You can add rules later in the portal or in onehuman.policy.json.'));

  const presetFor = new Map<RouteHit, string>(chosen.map((x) => [x, suggestPreset(x)]));
  if (chosen.length) {
    say(`\n${bold('Suggested protection:')}`);
    for (const x of chosen) say(`  ${x.method.padEnd(6)} ${x.path}  →  ${green(PRESETS[presetFor.get(x)!]!.label)}`);
    const how = await choose('Use these suggestions?', [
      { label: 'Yes, use the suggestions', value: 'suggested' },
      { label: 'Let me choose for each one', value: 'each' },
    ]);
    if (how === 'each') {
      for (const x of chosen) {
        const cur = PRESET_KEYS.indexOf(presetFor.get(x)!);
        presetFor.set(x, await choose(`${x.method} ${x.path} — when an AI agent asks for it:`, PRESET_KEYS.map((k) => ({ value: k, label: PRESETS[k]!.label, hint: PRESETS[k]!.what })), cur));
      }
    }
  }

  // ---------------------------------------------------------------- 3. who is logged in
  const exprs = [...new Set(r.identity.map((i) => i.expression).filter((e) => /^req\.(session|user|auth)\b/.test(e)))].slice(0, 5);
  const identity = await choose<string | null>('How does your server know who is logged in?', [
    ...exprs.map((e) => ({ value: e, label: `${e}`, hint: 'found in your code' })),
    { value: '__custom', label: 'Something else — I will type it' },
    { value: null, label: 'No login, or not sure', hint: 'one session per browser, from a cookie' },
  ], 0);
  let identifyExpr: string | null = identity;
  if (identity === '__custom') identifyExpr = (await text('Expression for the logged-in user id (for example req.user.id):', 'req.user.id')) || null;

  // ---------------------------------------------------------------- 4. start mode
  const enforcement = await choose('How should it start?', [
    { value: 'observe', label: 'Just watch — record everything, block nothing', hint: 'look at Activity first, switch on later' },
    { value: 'enforce', label: 'Protect now — apply the rules from the first request' },
  ]);

  // ---------------------------------------------------------------- 5. the portal
  let apiKey = process.env.ONEHUMAN_API_KEY ?? '';
  const portal = await choose('Connect to the OneHuman portal?', [
    { value: 'key', label: apiKey ? 'Yes — use ONEHUMAN_API_KEY from this shell' : 'Yes — I have an API key', hint: 'see agents, change rules without a deploy' },
    { value: 'later', label: 'Later', hint: 'everything works on your server without it' },
  ], apiKey ? 0 : 1);
  if (portal === 'key' && !apiKey) {
    for (;;) {
      apiKey = await text('Paste the API key from https://onehuman.ai/portal (starts with nt_live_):');
      if (!apiKey || /^nt_live_[a-f0-9]{40}$/.test(apiKey)) break;
      say(yellow('  That does not look like a key. It starts with nt_live_ and has 40 more characters. Leave it empty to skip.'));
    }
  }

  // ---------------------------------------------------------------- 6. the page
  const htmlCandidates = [...r.frontend.entryHtml, 'public/index.html', 'index.html', 'static/index.html', 'views/index.html', 'client/index.html', 'src/index.html'];
  const html = [...new Set(htmlCandidates)].map((f) => resolve(root, f)).find((f) => existsSync(f) && /<\/head>/i.test(readFileSync(f, 'utf8')) && !readFileSync(f, 'utf8').includes('/onehuman/sdk.js'));
  const addScript = html ? await confirm(`Add the page script to ${relative(root, html)}? It lets OneHuman see an agent in the browser the moment it attaches.`, true) : false;

  // ---------------------------------------------------------------- the plan
  const edits: Edit[] = [];
  const notes: string[] = [];
  const read = (f: string) => { const hit = edits.find((e) => e.file === f); return hit ? hit.after : readFileSync(f, 'utf8'); };
  const put = (file: string, after: string, change: string) => {
    const hit = edits.find((e) => e.file === file);
    if (hit) { hit.after = after; hit.changes.push(change); } else edits.push({ file, before: existsSync(file) ? readFileSync(file, 'utf8') : null, after, changes: [change] });
  };

  // the rules
  const rules = chosen.map((x) => {
    const m = PRESETS[presetFor.get(x)!]!.m;
    return { resource: x.resource, title: titleOf(x.resource), onAgent: m[0], onArtifact: m[1], onUnknown: m[2], onHumanLike: m[3], actOn: ['verified', 'strong', 'control', 'behavioral'], minScore: 65 };
  });
  const policyFile = join(root, 'onehuman.policy.json');
  if (existsSync(policyFile)) notes.push('onehuman.policy.json already exists — kept as it is.');
  else put(policyFile, JSON.stringify({ version: 'app-1', enforcement, rules }, null, 2) + '\n', `${rules.length} rule${rules.length === 1 ? '' : 's'}, ${enforcement === 'observe' ? 'watching only' : 'protection on'}`);

  // the environment
  const envFile = join(root, '.env');
  const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const envAdd: string[] = [];
  if (!/^ONEHUMAN_SECRET=/m.test(envText)) envAdd.push(`ONEHUMAN_SECRET=${randomBytes(32).toString('hex')}`);
  if (apiKey && !/^ONEHUMAN_API_KEY=/m.test(envText)) envAdd.push(`ONEHUMAN_API_KEY=${apiKey}`);
  if (envAdd.length) put(envFile, envText + (envText && !envText.endsWith('\n') ? '\n' : '') + `# OneHuman\n${envAdd.join('\n')}\n`, `adds ${envAdd.map((l) => l.split('=')[0]).join(', ')} (the secret is new and random; keep it stable)`);
  const giFile = join(root, '.gitignore');
  const gi = existsSync(giFile) ? readFileSync(giFile, 'utf8') : '';
  const giAdd = ['.env', 'onehuman.db*'].filter((l) => !gi.split('\n').some((x) => x.trim() === l || (l === '.env' && /^\.env\*?$/.test(x.trim()))));
  if (giAdd.length) put(giFile, gi + (gi && !gi.endsWith('\n') ? '\n' : '') + giAdd.join('\n') + '\n', `ignores ${giAdd.join(', ')} so the secret and the local database are never committed`);
  // load .env at start when the app does not already
  if (!deps.dotenv && !deps['@dotenvx/dotenvx'] && pkg.scripts) {
    const next = { ...pkg.scripts };
    let changed = false;
    for (const k of ['start', 'dev']) {
      const v = next[k];
      if (v && /^node\s/.test(v) && !/--env-file/.test(v)) { next[k] = v.replace(/^node\s/, 'node --env-file-if-exists=.env '); changed = true; }
    }
    if (changed) {
      const raw = readFileSync(pkgPath, 'utf8');
      const indent = raw.match(/^\{\s*\n([ \t]+)"/)?.[1] ?? '  ';
      put(pkgPath, JSON.stringify({ ...JSON.parse(raw), scripts: next }, null, indent) + '\n', 'npm start / npm run dev load .env (node --env-file-if-exists)');
    }
    else notes.push('Make sure your app loads .env when it starts (node --env-file=.env, or dotenv).');
  }

  // the code (Express)
  const protectedFiles = new Set<string>();
  let entry: string | null = null;
  if (framework === 'express') {
    const appRe = /^([ \t]*)(?:const|let|var)\s+(\w+)\s*=\s*express\s*\(\s*\)\s*;?[^\n]*$/m;
    entry = r.routes.map((x) => x.file).concat(listFiles(root)).find((f) => appRe.test(readFileSync(f, 'utf8'))) ?? null;
    if (!entry) notes.push('Could not find `express()` in your code: add `app.use(onehuman.middleware())` right after you create the app.');
    const pkgType = pkg.type;
    const setupDir = entry ? dirname(entry) : root;
    const entryStyle = entry ? styleOf(entry, readFileSync(entry, 'utf8'), pkgType) : { esm: pkgType === 'module', ts: false, ext: '.js', importSuffix: '.js' };
    // the setup file speaks the same module language as the server file, with an extension Node reads that way
    const setupExt = entryStyle.ts ? '.ts' : entryStyle.ext !== '.js' ? entryStyle.ext : entryStyle.esm ? (pkgType === 'module' ? '.js' : '.mjs') : (pkgType === 'module' ? '.cjs' : '.js');
    const setupFile = join(setupDir, `onehuman${setupExt}`);
    const policyRel = relative(root, policyFile).replace(/\\/g, '/');   // read relative to where the app is started: the project root
    const id = identifyExpr ? `  identify: (req${entryStyle.ts ? ': any' : ''}) => ${safeChain(identifyExpr)} ?? null,   // who is logged in: one session per login\n` : '  // identify: (req) => req.session?.userId ?? null,   // add your login id: one session per login, not per browser\n';
    const opts = `{\n  secret: process.env.ONEHUMAN_SECRET${entryStyle.ts ? " ?? ''" : ''},\n  policy: './${policyRel}',\n  apiKey: process.env.ONEHUMAN_API_KEY,   // the portal: agents seen, rules without a deploy (optional)\n${id}}`;
    const header = '// OneHuman — written by `npx onehuman init`. Import `onehuman` wherever a route needs protection.\n// The rules are in onehuman.policy.json; with an API key they live in the portal after the first start.\n';
    if (!existsSync(setupFile)) {
      put(setupFile, entryStyle.esm || entryStyle.ts
        ? `${header}import { onehumanDeferred } from 'onehuman/express';\n\nexport const onehuman = onehumanDeferred(${opts});\n`
        : `${header}const { onehumanDeferred } = require('onehuman/express');\n\nconst onehuman = onehumanDeferred(${opts});\nmodule.exports = { onehuman };\n`, 'creates the OneHuman instance');
    }
    const importLine = (file: string) => {
      const st = styleOf(file, readFileSync(file, 'utf8'), pkgType);
      let rel = relative(dirname(file), setupFile).replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = './' + rel;
      if (st.ts) rel = rel.replace(/\.ts$/, st.importSuffix);   // TypeScript: follow the file's own import style
      return st.esm || st.ts ? `import { onehuman } from '${rel}';` : `const { onehuman } = require('${rel}');`;
    };
    const addImport = (file: string) => {
      let t = read(file);
      if (/\bonehuman\b.*from\s+['"][^'"]*onehuman|require\(['"][^'"]*onehuman/.test(t)) return;
      const line = importLine(file);
      const lines = t.split('\n');
      let at = 0;
      lines.forEach((l, i) => { if (/^\s*import\s.*from\s|^\s*import\s+['"]|^\s*(const|let|var)\s.*=\s*require\(/.test(l)) at = i + 1; });
      if (at === 0 && /^#!/.test(lines[0] ?? '')) at = 1;
      lines.splice(at, 0, line);
      t = lines.join('\n');
      put(file, t, `imports onehuman`);
    };
    if (entry) {
      addImport(entry);
      const t = read(entry);
      const m = appRe.exec(t)!;
      const indent = m[1]!, app = m[2]!;
      if (!t.includes(`${app}.use(onehuman.middleware())`)) {
        const at = m.index + m[0].length;
        put(entry, t.slice(0, at) + `\n${indent}${app}.use(onehuman.middleware());   // OneHuman: the page script and its API, before your routes` + t.slice(at), `${app}.use(onehuman.middleware()) right after the app is created`);
      }
    }
    for (const x of chosen) {
      const t = read(x.file);
      const lines = t.split('\n');
      const esc = x.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\.\\s*${x.method === 'ALL' ? 'all' : x.method.toLowerCase()}\\s*\\(\\s*(['"\`])${esc}\\1\\s*,`);
      let done = false;
      for (let i = x.line - 1; i < Math.min(lines.length, x.line + 2) && !done; i++) {
        const mm = re.exec(lines[i]!);
        if (!mm) continue;
        if (lines[i]!.includes('onehuman.protect(')) { done = true; break; }
        const preset = presetFor.get(x)!;
        const mask = PRESETS[preset]!.m.includes('mask') && x.method === 'GET' ? ", { mask: 'auto' }" : '';
        const cut = mm.index + mm[0].length;
        lines[i] = `${lines[i]!.slice(0, cut)} onehuman.protect('${x.resource}'${mask}),${lines[i]!.slice(cut)}`;
        put(x.file, lines.join('\n'), `${x.method} ${x.path} → onehuman.protect('${x.resource}')`);
        protectedFiles.add(x.file);
        done = true;
      }
      if (!done) notes.push(`Could not place protect() on ${x.method} ${x.path} (${relative(root, x.file)}:${x.line}). Add onehuman.protect('${x.resource}') as the first handler of that route.`);
    }
    for (const f of protectedFiles) addImport(f);
    if (chosen.some((x) => PRESETS[presetFor.get(x)!]!.m.includes('mask'))) notes.push("Routes that hide details use mask: 'auto' — every value hidden, shape and ids kept. For a precise mask, replace it with your own function: onehuman.protect('balance.read', { mask: (body) => ({ ...body, amount: null }) }).");
  } else {
    const snippet = {
      fastify: "import { onehuman } from 'onehuman/express';\nconst oh = await onehuman({ secret: process.env.ONEHUMAN_SECRET, policy: './onehuman.policy.json', apiKey: process.env.ONEHUMAN_API_KEY });\nfastify.addHook('onRequest', (req, reply, done) => oh.middleware()(req.raw, reply.raw, done));\n// on each protected route: { onRequest: (req, reply, done) => oh.protect('balance.read')(req.raw, reply.raw, done) }",
      next: '// Next.js: run the app through a small Express server (server.mjs) and add app.use(oh.middleware()) before the Next handler — see https://onehuman.ai/docs',
      other: '// Paste this into your coding agent:\n// https://www.npmjs.com/package/onehuman — integrate it into my app. Use the rules in onehuman.policy.json and the keys in .env.',
    }[framework as 'fastify' | 'next' | 'other'];
    notes.push(`Add this to your server:\n${snippet}`);
  }
  if (addScript && html) {
    const t = read(html);
    put(html, t.replace(/<\/head>/i, '  <script src="/onehuman/sdk.js"></script>\n</head>'), 'adds the page script in <head>');
    if (r.frontend.kind === 'spa') notes.push('If the page is served by a separate dev server (Vite, webpack), proxy /onehuman to your API server so /onehuman/sdk.js loads.');
  }
  const installed = !!deps.onehuman;

  // ---------------------------------------------------------------- show it, then do it
  say(`\n${bold('Here is what will change:')}`);
  if (!installed && flags.install) say(`  ${cyan('install')}  onehuman  ${dim('(its engine comes with it)')}`);
  for (const e of edits) {
    say(`  ${e.before === null ? green('new    ') : yellow('change ')} ${relative(root, e.file) || basename(e.file)}`);
    for (const ch of e.changes) say(`           ${dim('· ' + ch)}`);
    if (e.before !== null && !e.file.endsWith('.env') && !e.file.endsWith('package.json')) {
      const a = e.before.split('\n'), b = e.after.split('\n');
      const aset = new Map<string, number>(); a.forEach((l) => aset.set(l, (aset.get(l) ?? 0) + 1));
      b.forEach((l, i) => { const n = aset.get(l) ?? 0; if (n > 0) aset.set(l, n - 1); else say(`           ${green('+ ' + String(i + 1).padStart(4) + '  ' + l.trim().slice(0, 110))}`); });
    }
  }
  if (!edits.length && (installed || !flags.install)) { say(dim('  nothing — OneHuman already looks set up here.')); rl?.close(); return; }
  if (!(await confirm('Apply these changes?', true))) { say('\nNothing was written.'); rl?.close(); return; }
  rl?.close();

  if (!installed && flags.install) {
    const pm = existsSync(join(root, 'pnpm-lock.yaml')) ? ['pnpm', 'add'] : existsSync(join(root, 'yarn.lock')) ? ['yarn', 'add'] : existsSync(join(root, 'bun.lockb')) ? ['bun', 'add'] : ['npm', 'install'];
    say(dim(`\n$ ${pm.join(' ')} onehuman`));
    const res = spawnSync(pm[0]!, [...pm.slice(1), 'onehuman'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    if (res.status !== 0) notes.push(`Installing failed — run \`${pm.join(' ')} onehuman\` yourself.`);
  }
  for (const e of edits) writeFileSync(e.file, e.after);

  say(`\n${green('✓')} ${bold('OneHuman is set up.')}`);
  say(`  ${enforcement === 'observe' ? 'It is watching only: nothing is blocked. Look at Activity, then turn protection on in the portal or in onehuman.policy.json.' : 'Protection is on from the first request.'}`);
  say(`\n${bold('Next:')}`);
  say(`  1. Start your app and open a page that calls a protected route.`);
  const port = entry ? (readFileSync(entry, 'utf8').match(/\.listen\(\s*(?:process\.env\.PORT\s*(?:\|\||\?\?)\s*)?(\d{2,5})/)?.[1] ?? '3000') : '3000';
  say(`  2. Check it: ${cyan(`npx onehuman verify http://localhost:${port} ${chosen[0]?.path.replace(/:\w+/g, '1') ?? '/api/…'}`)}`);
  say(`  3. ${apiKey ? 'See it in the portal: https://onehuman.ai/portal' : 'For the portal (agents seen, rules without a deploy): create a key at https://onehuman.ai/portal and add ONEHUMAN_API_KEY to .env.'}`);
  for (const n of notes) say(`\n${yellow('!')} ${n}`);
  say('');
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    let list: string[] = [];
    try { list = readdirSync(d); } catch { return; }
    for (const e of list) {
      if (e === 'node_modules' || e.startsWith('.') || e === 'dist' || e === 'build') continue;
      const p = join(d, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/\.(m?js|cjs|ts|mts)$/.test(e) && st.size < 600_000) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}
