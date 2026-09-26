// SPDX-License-Identifier: Apache-2.0
/**
 * onehuman CLI
 *   npx onehuman init [dir] [--yes] [--no-install]  answer a few questions; OneHuman is set up in this project
 *   npx onehuman scan [dir]                      discover routes, sensitivity, identity; write onehuman.policy.draft.json
 *   npx onehuman scan [dir] --json               same, machine-readable (for AI agents)
 *   npx onehuman scan [dir] --proposal           only the plain-language proposal to show the product owner
 *   npx onehuman verify <baseUrl> <protectedPath> [--base /onehuman]   run the 4 post-integration checks
 *   npx onehuman secret                          print a fresh ONEHUMAN_SECRET
 *   npx onehuman verify-proof <bundle.json> [--keys <jwks.json | https://…/onehuman/proof-keys>]
 *                                                  check signed decision proofs offline (for an auditor)
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderProposal, renderReport, scan } from './scan.ts';
import { runInit } from './init.ts';
import { thumbprint, verifyProof } from '../proof/verify.ts';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const has = (name: string) => rest.includes(name);
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1]!.startsWith('--') && rest[i - 1] !== '--json'));

async function main() {
  if (cmd === 'init') { await runInit(positional[0] ?? process.cwd(), { yes: has('--yes'), install: !has('--no-install') }); return; }
  if (cmd === 'scan') {
    const root = resolve(positional[0] ?? process.cwd());
    const r = scan(root);
    writeFileSync(resolve(root, 'onehuman.policy.draft.json'), JSON.stringify(r.policyDraft, null, 2) + '\n');
    if (has('--json')) console.log(JSON.stringify({ ...r, proposalText: renderProposal(r) }, null, 2));
    else if (has('--proposal')) console.log(renderProposal(r));
    else console.log(renderReport(r));
    return;
  }
  if (cmd === 'verify-proof') {
    // An auditor's check. Nothing is sent anywhere; the only input is the file (and, better, a key you got
    // yourself from the business's own site — the key inside a bundle proves consistency, not origin).
    const file = positional[0];
    if (!file) { console.error('usage: onehuman verify-proof <bundle.json> [--keys <jwks.json | https://…/onehuman/proof-keys>]'); process.exit(2); }
    const bundle = JSON.parse(readFileSync(resolve(file), 'utf8')) as { keys?: { x: string; kid?: string }[]; proofs?: string[] };
    const keySrc = flag('--keys');
    let keys = bundle.keys ?? [];
    if (keySrc) {
      const raw = /^https?:\/\//.test(keySrc) ? await (await fetch(keySrc)).json() : JSON.parse(readFileSync(resolve(keySrc), 'utf8'));
      keys = (raw.keys ?? raw) as { x: string }[];
    }
    const proofs = bundle.proofs ?? [];
    if (!keys.length || !proofs.length) { console.error('The file has no keys or no proofs.'); process.exit(2); }
    let ok = 0;
    for (const [i, jws] of proofs.entries()) {
      const c = verifyProof(jws, keys);
      if (c.valid) {
        ok++;
        const p = c.payload;
        console.log(`✓ ${new Date(p.iat * 1000).toISOString()}  ${p.resource.padEnd(22)} ${p.decision.padEnd(8)} actor=${p.actor.padEnd(13)} delivered=${p.delivered ? 'yes' : 'no '}  decision ${p.jti}  chain #${p.audit.seq}`);
      } else console.log(`✗ proof ${i + 1}: ${c.reason}`);
    }
    console.log(`\n${ok}/${proofs.length} proofs valid, signed by ${[...new Set(keys.map((k) => thumbprint(k.x)))].join(', ')}${keySrc ? '' : '\nKeys came from the bundle itself. For an independent check pass --keys https://<their-site>/onehuman/proof-keys'}`);
    process.exit(ok === proofs.length ? 0 : 1);
  }
  if (cmd === 'verify') {
    const base = positional[0]; const path = positional[1]; const ntBase = flag('--base') ?? '/onehuman';
    if (!base || !path) { console.error('usage: onehuman verify <baseUrl> <protectedPath> [--base /onehuman]'); process.exit(2); }
    const results: { name: string; ok: boolean; detail: string }[] = [];
    const u = (p: string) => new URL(p, base).toString();
    // 1. SDK is served
    const sdk = await fetch(u(`${ntBase}/sdk.js`)).catch(() => null);
    results.push({ name: 'SDK served', ok: !!sdk && sdk.ok && /sdk-v/.test(await sdk.text().catch(() => '')), detail: `GET ${ntBase}/sdk.js → ${sdk?.status ?? 'unreachable'}` });
    // 2. protected endpoint answers with a decision and sets the session cookie
    const r1 = await fetch(u(path)).catch(() => null);
    const cookie = r1?.headers.get('set-cookie')?.split(';')[0] ?? '';
    const b1 = r1 ? await r1.json().catch(() => null) : null;
    const decisionHeader = r1?.headers.get('x-nt-decision');
    results.push({ name: 'Decision on protected endpoint', ok: !!r1 && !!decisionHeader && (r1.status === 200 || r1.status === 403 || r1.status === 428), detail: `GET ${path} → ${r1?.status ?? 'unreachable'}, X-NT-Decision ${decisionHeader ? 'present' : 'MISSING (protect() not applied?)'}, _nt.decision=${b1?._nt?.decision ?? b1?.decision?.decision ?? '-'}` });
    // 3. environment-only evidence (AI app browser UA) reaches the onArtifact branch
    const r2 = await fetch(u(path), { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.2553.1 Chrome/152.0.0.0 Safari/537.36' } }).catch(() => null);
    const b2 = r2 ? await r2.json().catch(() => null) : null;
    const codes2: string[] = b2?._nt?.reasonCodes ?? b2?.decision?.reasonCodes ?? [];
    results.push({ name: 'Environment evidence recognised', ok: codes2.includes('AGENT_APP_BROWSER'), detail: `AI-app UA → ${r2?.status}, decision=${b2?._nt?.decision ?? b2?.decision?.decision ?? '-'}, codes=${codes2.join(',') || '-'}` });
    // 4. attached agent (control markers via the SDK endpoint) changes the decision for the same session
    const early = { startedMs: 0, observedMs: 500, webdriver: false, firstInteractionMs: null, dataDomMs: null, markers: [{ name: 'claude-stop', atMs: 100 }, { name: 'claude-cursor', atMs: 100 }], environment: { codexModelContext: false, modelContextApi: false, clipboardBridge: false, clipboardBridgeAtMs: null, agentGlobals: [], extensionsInstalled: [], focusWhileHiddenMs: null }, focusConflict: { count: 0, firstAtMs: null, peers: 0 }, webmcpInvocations: 0, reading: { loadedHidden: false, readBursts: 0, firstReadBurstMs: null, lastReadBurstReads: 0, readBurstAnonymous: false, textExtracts: 0, firstTextExtractMs: null, visibilityFlickers: 0, firstFlickerMs: null, flickerResize: null, renderWhileHiddenMs: null, firstClick: null } };
    const sig = await fetch(u(`${ntBase}/signals`), { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ early, interaction: null }) }).catch(() => null);
    const sb = sig ? await sig.json().catch(() => null) : null;
    const r3 = await fetch(u(path), { headers: { cookie } }).catch(() => null);
    const b3 = r3 ? await r3.json().catch(() => null) : null;
    const applied = b3?._nt?.decision ?? b3?.decision?.decision;
    const observe = r3?.status === 200 && applied === 'allow' && (b3?._nt?.reasonCodes ?? b3?.decision?.reasonCodes ?? []).some((c: string) => /AGENT_CONTROL_MARKER|AGENT_ATTACHED_EARLIER/.test(c));
    results.push({ name: 'Attached agent changes the decision', ok: sb?.connection?.state === 'agent_attached' && (r3?.status === 403 || applied === 'mask' || applied === 'step_up' || observe), detail: `signals → ${sb?.connection?.state ?? sig?.status ?? 'unreachable'}; then GET ${path} → ${r3?.status}, decision=${applied ?? '-'}${observe ? ' (observe mode: recorded, not enforced)' : ''}` });
    let allOk = true;
    for (const x of results) { allOk &&= x.ok; console.log(`${x.ok ? '✓' : '✗'} ${x.name}\n    ${x.detail}`); }
    console.log(allOk ? '\nAll checks passed.' : '\nSome checks failed — see details above.');
    process.exit(allOk ? 0 : 1);
  }
  if (cmd === 'secret') { console.log(randomBytes(32).toString('base64url')); return; }
  console.log('onehuman <init [dir] [--yes] | scan [dir] [--json] | verify <baseUrl> <protectedPath> [--base /onehuman] | verify-proof <bundle.json> [--keys <jwks|url>] | secret>');
  process.exit(cmd ? 2 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
