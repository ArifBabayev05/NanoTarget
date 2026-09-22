import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { nanotarget } from '../integrations/express/index.ts';
import { EMPTY_READING } from '../server/signals.ts';

const policy = {
  version: 'test-policy-1',
  enforcement: 'enforce',
  rules: [
    { resource: 'balance.read', title: 'Balans', onAgent: 'block', onArtifact: 'mask', onUnknown: 'allow', onHumanLike: 'allow', actOn: ['verified', 'strong', 'control', 'behavioral'], minScore: 65 },
    { resource: 'transfer.make', title: 'Köçürmə', onAgent: 'block', onArtifact: 'step_up', onUnknown: 'step_up', onHumanLike: 'allow', actOn: ['verified', 'strong', 'control', 'behavioral'], minScore: 65 },
  ],
};
const early = { startedMs: 0, observedMs: 500, webdriver: false, firstInteractionMs: null, dataDomMs: null, markers: [] as { name: string; atMs: number }[], environment: { codexModelContext: false, modelContextApi: false, clipboardBridge: false, clipboardBridgeAtMs: null, agentGlobals: [], extensionsInstalled: [], focusWhileHiddenMs: null }, focusConflict: { count: 0, firstAtMs: null, peers: 0 }, webmcpInvocations: 0, reading: { ...EMPTY_READING } };

const secret = 'test-secret-test-secret-test-secret-1234';
const nt = await nanotarget({ secret, policy: policy as never, db: 'memory', identify: (req) => (req.headers['x-user'] as string | undefined) || null });
const app = express();
app.use(express.json());
app.use(nt.middleware());
const account = { balance: 2920.74, iban: 'AZ21NABZ00000000137010001944' };
app.get('/api/balance', nt.protect('balance.read'), (req, res) => nt.send(req, res, account, (a) => ({ ...a, balance: null })));
app.post('/api/transfer', nt.protect('transfer.make'), (req, res) => res.json({ ok: true, decision: req.nt!.decision }));
app.get('/api/manual', nt.protect('balance.read', { respond: false }), (req, res) => res.json({ handled: req.nt!.decision }));
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.close(); nt.close(); });

const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

test('serves the SDK next to its API and the SDK derives the endpoint from its own URL', async () => {
  const r = await fetch(`${base}/nanotarget/sdk.js`);
  assert.equal(r.status, 200);
  const js = await r.text();
  assert.ok(js.includes("'/signals'"));
  assert.ok(js.includes('sdk-v4'));
});

test('first request creates a session cookie and an unknown actor is allowed by this policy', async () => {
  const r = await fetch(`${base}/api/balance`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie') ?? '', /^nt_sid=[0-9a-f-]{36}; Path=\/; HttpOnly; SameSite=Lax/);
  const d = await r.json();
  assert.equal(d.balance, 2920.74);
  assert.equal(d._nt.decision, 'allow');
  assert.ok(r.headers.get('x-nt-decision'));
});

test('identify(): two tabs of one login share one session; an agent marker in one blocks the other', async () => {
  const h = { 'x-user': 'user-42' };
  const a = await fetch(`${base}/api/balance`, { headers: h });
  assert.equal(a.status, 200);
  // tab 2 (no cookie) posts an agent control marker via the SDK endpoint
  const sig = await fetch(`${base}/nanotarget/signals`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ early: { ...early, markers: [{ name: 'claude-stop', atMs: 900 }, { name: 'claude-cursor', atMs: 900 }] }, interaction: null }) });
  assert.equal(sig.status, 200);
  assert.equal((await sig.json()).connection.state, 'agent_attached');
  // tab 1 asks again with only its cookie → the login is agent-attached → block with reclaim offer
  const b = await fetch(`${base}/api/balance`, { headers: { cookie: cookieOf(a) } });
  assert.equal(b.status, 403);
  const d = await b.json();
  assert.equal(d.error, 'blocked');
  assert.ok(d.decision.reasonCodes.includes('AGENT_ATTACHED_EARLIER') || d.decision.reasonCodes.includes('AGENT_CONTROL_MARKER'));
  assert.equal(d.stepUp?.reclaim, true);
});

test('artifact-only evidence takes the mask branch and the company mask function is applied', async () => {
  const r = await fetch(`${base}/api/balance`, { headers: { 'x-user': 'user-7', 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.2553.1 Chrome/152.0.0.0 Safari/537.36' } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.balance, null, 'masked by the company function');
  assert.equal(d.iban, account.iban);
  assert.equal(d._nt.decision, 'mask');
});

test('step_up answers 428 with a challenge; respond:false hands the decision to the handler', async () => {
  const r = await fetch(`${base}/api/transfer`, { method: 'POST', headers: { 'x-user': 'user-9', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 428);
  const d = await r.json();
  assert.equal(d.error, 'step_up_required');
  assert.match(d.stepUp.challenge, /^[0-9A-F]{6}$/);
  const m = await fetch(`${base}/api/manual`, { headers: { 'x-user': 'user-9' } });
  assert.equal(m.status, 200);
  assert.equal((await m.json()).handled, 'allow');
});

test('policy from a file is validated; a broken file is rejected at start-up', async () => {
  await assert.rejects(nanotarget({ secret, policy: { version: 'x', enforcement: 'enforce', rules: [{ resource: 'a' }] } as never, db: 'memory' }), /policy file is invalid/);
  await assert.rejects(nanotarget({ secret: 'short', policy: policy as never, db: 'memory' }), /at least 32 bytes/);
});
