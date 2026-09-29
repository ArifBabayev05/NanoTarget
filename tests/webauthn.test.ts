// SPDX-License-Identifier: BUSL-1.1
/**
 * WebAuthn verification with a software authenticator (P-256). Builds real
 * clientDataJSON / attestationObject / authenticatorData the way a browser
 * would, then checks the server-side verifier and the reclaim flow end to end.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { verifyAssertion, verifyRegistration, type StoredCredential } from '../server/webauthn.ts';
import { createApp } from '../server/app.ts';
import { pinStrictPolicy } from './strict-policy.ts';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

// --- minimal CBOR encoder for the attestation object -----------------------
function cbor(v: unknown): Buffer {
  if (typeof v === 'number') {
    if (v >= 0) return cborUint(0, v);
    return cborUint(1, -1 - v);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborUint(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([cborUint(3, b.length), b]); }
  if (v instanceof Map) { const parts = [cborUint(5, v.size)]; for (const [k, val] of v) parts.push(cbor(k), cbor(val)); return Buffer.concat(parts); }
  throw new Error('cbor enc: unsupported');
}
function cborUint(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}

class SoftAuthenticator {
  priv: KeyObject; pub: KeyObject; credId = Buffer.from('cred-' + Math.random().toString(36).slice(2)); counter = 0;
  constructor() { const kp = generateKeyPairSync('ec', { namedCurve: 'P-256' }); this.priv = kp.privateKey; this.pub = kp.publicKey; }
  authData(rpId: string, flags: number, withCred: boolean): Buffer {
    const rpIdHash = createHash('sha256').update(rpId).digest();
    const head = Buffer.alloc(37); rpIdHash.copy(head, 0); head[32] = flags; head.writeUInt32BE(this.counter, 33);
    if (!withCred) return head;
    const jwk = this.pub.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
    const credLen = Buffer.alloc(2); credLen.writeUInt16BE(this.credId.length);
    return Buffer.concat([head, Buffer.alloc(16), credLen, this.credId, cbor(cose)]);
  }
  register(challenge: string, origin: string, rpId: string, flags = 0x45) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
    const att = new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(rpId, flags, true)]]);
    return { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(cbor(att)) };
  }
  assert(challenge: string, origin: string, rpId: string, flags = 0x05) {
    this.counter++;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
    const authenticatorData = this.authData(rpId, flags, false);
    const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), { key: this.priv, dsaEncoding: 'der' });
    return { credentialId: b64u(this.credId), id: b64u(this.credId), clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature) };
  }
}

const RP = { rpId: 'lab.example', origin: 'https://lab.example' };

test('registration parses COSE key, requires UP+UV, binds challenge/origin/rpId', () => {
  const a = new SoftAuthenticator();
  const cred = verifyRegistration(a.register('ch1', RP.origin, RP.rpId), { challenge: 'ch1', ...RP });
  assert.equal(cred.alg, -7);
  assert.equal((cred.publicKeyJwk as { kty: string }).kty, 'EC');
  assert.throws(() => verifyRegistration(a.register('ch1', RP.origin, RP.rpId), { challenge: 'other', ...RP }), /challenge/);
  assert.throws(() => verifyRegistration(a.register('ch1', 'https://evil.example', RP.rpId), { challenge: 'ch1', ...RP }), /origin/);
  assert.throws(() => verifyRegistration(a.register('ch1', RP.origin, 'other.example'), { challenge: 'ch1', ...RP }), /rpIdHash/);
  assert.throws(() => verifyRegistration(a.register('ch1', RP.origin, RP.rpId, 0x41), { challenge: 'ch1', ...RP }), /not verified/);
});

test('assertion verifies signature, UV flag, counter, and rejects tampering', () => {
  const a = new SoftAuthenticator();
  const cred: StoredCredential = verifyRegistration(a.register('ch1', RP.origin, RP.rpId), { challenge: 'ch1', ...RP });
  const ok = verifyAssertion(a.assert('ch2', RP.origin, RP.rpId), cred, { challenge: 'ch2', ...RP });
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.newSignCount, 1); cred.signCount = ok.newSignCount; }
  // UV missing (only UP) → rejected: a click on the authenticator without biometrics/PIN is not enough
  assert.match((verifyAssertion(a.assert('ch3', RP.origin, RP.rpId, 0x01), cred, { challenge: 'ch3', ...RP }) as { reason: string }).reason, /not verified/);
  // replayed counter → rejected
  const replay = a.assert('ch4', RP.origin, RP.rpId); a.counter = 0;
  const r1 = verifyAssertion(replay, cred, { challenge: 'ch4', ...RP }); assert.equal(r1.ok, true); if (r1.ok) cred.signCount = r1.newSignCount;
  a.counter = 1; // authenticator counter rewound below stored value
  assert.match((verifyAssertion(a.assert('ch5', RP.origin, RP.rpId), cred, { challenge: 'ch5', ...RP }) as { reason: string }).reason, /sign count/);
  // wrong origin, wrong challenge, other key
  a.counter = 50;
  assert.match((verifyAssertion(a.assert('ch6', 'https://evil.example', RP.rpId), cred, { challenge: 'ch6', ...RP }) as { reason: string }).reason, /origin/);
  assert.match((verifyAssertion(a.assert('ch7', RP.origin, RP.rpId), cred, { challenge: 'nope', ...RP }) as { reason: string }).reason, /challenge/);
  const b = new SoftAuthenticator(); b.credId = a.credId; b.counter = 60;
  assert.match((verifyAssertion(b.assert('ch8', RP.origin, RP.rpId), cred, { challenge: 'ch8', ...RP }) as { reason: string }).reason, /bad signature/);
});

// --- end to end: register, get blocked as agent, reclaim with WebAuthn -------
let base = '';
let app: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  app = await createApp({ labOperator: false });
  pinStrictPolicy(app);
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => { app.server.close(); app.store.close(); });

async function open(label: 'human' | 'agent') {
  const first = await fetch(`${base}/bank`, { redirect: 'manual' });
  const u = new URL(first.headers.get('location')!, base); u.searchParams.set('as', label);
  const page = await fetch(u, { redirect: 'manual' });
  const cookie = page.headers.get('set-cookie')!.split(';')[0]!;
  return { room: u.searchParams.get('room')!, cookie, q: `?room=${u.searchParams.get('room')}`, h: { cookie, 'Content-Type': 'application/json', origin: base } };
}
const earlyBase = { startedMs: 0, observedMs: 500, webdriver: false, firstInteractionMs: null, dataDomMs: null, markers: [], environment: { codexModelContext: false, modelContextApi: false, clipboardBridge: false, clipboardBridgeAtMs: null, agentGlobals: [], extensionsInstalled: [], focusWhileHiddenMs: null }, focusConflict: { count: 0, firstAtMs: null, peers: 0 }, webmcpInvocations: 0 };

test('agent→human handover: blocked session is reclaimed by a user-verified passkey, then the agent evidence returns', async () => {
  const s = await open('human');
  const rp = { rpId: '127.0.0.1', origin: base };
  const auth = new SoftAuthenticator();
  // 1. register a passkey while the session is clean
  const ro = await (await fetch(`${base}/api/v1/webauthn/register/options${s.q}`, { method: 'POST', headers: s.h })).json();
  assert.equal(ro.publicKey.authenticatorSelection.userVerification, 'required');
  const reg = await fetch(`${base}/api/v1/webauthn/register${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ro.challengeId, id: b64u(auth.credId), ...auth.register(ro.challengeId, rp.origin, rp.rpId) }) });
  assert.equal(reg.status, 201);
  // registering with the same challenge again fails (single use)
  const again = await fetch(`${base}/api/v1/webauthn/register${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ro.challengeId, id: b64u(auth.credId), ...auth.register(ro.challengeId, rp.origin, rp.rpId) }) });
  assert.equal(again.status, 400);

  // 2. an agent attaches (control marker) → balance blocked, response advertises the reclaim path
  await fetch(`${base}/api/v1/signals${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ early: { ...earlyBase, markers: [{ name: 'claude-stop', atMs: 900 }] }, interaction: null }) });
  const blocked = await fetch(`${base}/api/v1/account/balance${s.q}`, { headers: { cookie: s.cookie } });
  assert.equal(blocked.status, 403);
  const bd = await blocked.json();
  assert.equal(bd.stepUp?.reclaim, true);
  assert.equal(bd.stepUp?.webauthn, true);

  // 3. the agent leaves; a person presses Touch ID
  const ao = await (await fetch(`${base}/api/v1/webauthn/assert/options${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ resource: 'balance.read' }) })).json();
  assert.equal(ao.publicKey.userVerification, 'required');
  // an assertion without UV (agent could only press, not verify) is rejected
  const noUv = await fetch(`${base}/api/v1/webauthn/assert${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ao.challengeId, ...auth.assert(ao.challengeId, rp.origin, rp.rpId, 0x01) }) });
  assert.equal(noUv.status, 403);
  // challenge was consumed by the failed attempt → need a new one
  const ao2 = await (await fetch(`${base}/api/v1/webauthn/assert/options${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ resource: 'balance.read' }) })).json();
  const ok = await fetch(`${base}/api/v1/webauthn/assert${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ao2.challengeId, ...auth.assert(ao2.challengeId, rp.origin, rp.rpId) }) });
  assert.equal(ok.status, 200);

  // 4. the session is human-verified: balance allowed, actor human_like, agent evidence suppressed
  const r = await fetch(`${base}/api/v1/account/balance${s.q}`, { headers: { cookie: s.cookie, 'X-OH-Sample': JSON.stringify({ early: { ...earlyBase, observedMs: 5000 }, interaction: null }) } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.decision.actor, 'human_like');
  assert.ok(d.decision.reasonCodes.includes('HUMAN_VERIFIED_WEBAUTHN'));
  assert.ok(!d.decision.reasonCodes.includes('AGENT_ATTACHED_EARLIER'));
  assert.equal(typeof d.balance.available, 'number');

  // 5. a live operator signature would still win over a reclaim (not exercised here: lab operator disabled)
  const st = await (await fetch(`${base}/api/v1/webauthn/status${s.q}`, { headers: { cookie: s.cookie } })).json();
  assert.equal(st.credentials.length, 1);
  assert.ok(st.humanVerifiedAt > 0);
});

test('reclaim expires: after HUMAN_RECLAIM_TTL the sticky agent evidence applies again', async () => {
  const s = await open('human');
  const sess = (await app.store.getSession(s.cookie.split('=')[1]!))!;
  await fetch(`${base}/api/v1/signals${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ early: { ...earlyBase, markers: [{ name: 'codex-overlay', atMs: 300 }] }, interaction: null }) });
  // simulate a verification that happened 10 minutes ago
  await app.store.exec('UPDATE sessions SET human_verified_at = ? WHERE id = ?', [Date.now() - 10 * 60000, sess.id]);
  // agent has left (marker gone in this snapshot) but the stale verification does not help
  const r = await fetch(`${base}/api/v1/account/balance${s.q}`, { headers: { cookie: s.cookie, 'X-OH-Sample': JSON.stringify({ early: { ...earlyBase, observedMs: 9000 }, interaction: null }) } });
  assert.equal(r.status, 403);
  const codes = (await r.json()).decision.reasonCodes;
  assert.ok(codes.includes('AGENT_ATTACHED_EARLIER'), codes.join(','));
  assert.ok(!codes.includes('HUMAN_VERIFIED_WEBAUTHN'));
});

test('an AI agent asks, the person approves: no code for the agent, one passkey approval opens one action, the session stays the agent\'s', async () => {
  const s = await open('human');
  const rp = { rpId: '127.0.0.1', origin: base };
  const auth = new SoftAuthenticator();
  const ro = await (await fetch(`${base}/api/v1/webauthn/register/options${s.q}`, { method: 'POST', headers: s.h, body: '{}' })).json();
  assert.equal((await fetch(`${base}/api/v1/webauthn/register${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ro.challengeId, id: b64u(auth.credId), ...auth.register(ro.challengeId, rp.origin, rp.rpId) }) })).status, 201);
  // this room's rules: a transfer by an agent needs the person's approval
  const rule = { resource: 'transfer.create', title: 'Transfers', onAgent: 'step_up', onArtifact: 'step_up', onUnknown: 'step_up', onHumanLike: 'allow', actOn: ['verified', 'strong', 'control', 'behavioral'], minScore: 65 };
  assert.equal((await fetch(`${base}/api/v1/policy${s.q}`, { method: 'PUT', headers: s.h, body: JSON.stringify({ enforcement: 'enforce', rules: [rule, { ...rule, resource: 'balance.read', onAgent: 'block' }] }) })).status, 200);
  await fetch(`${base}/api/v1/signals${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ early: { ...earlyBase, markers: [{ name: 'claude-stop', atMs: 900 }] }, interaction: null }) });

  const ask = await fetch(`${base}/api/v1/r/transfer.create${s.q}&f.amount=250`, { method: 'POST', headers: s.h });
  assert.equal(ask.status, 428);
  const { stepUp } = await ask.json();
  assert.equal(stepUp.approve, true);
  assert.equal(stepUp.challenge, '', 'the page an agent reads never carries the code');
  // typing any code is refused: only a passkey approves an agent's request
  const typed = await fetch(`${base}/api/v1/step-up${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ id: stepUp.id, answer: 'ABC123' }) });
  assert.equal(typed.status, 403);
  assert.equal((await typed.json()).error, 'passkey_required');

  const ao = await (await fetch(`${base}/api/v1/webauthn/assert/options${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ resource: 'transfer.create', purpose: 'approve' }) })).json();
  const ok = await fetch(`${base}/api/v1/webauthn/assert${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ao.challengeId, ...auth.assert(ao.challengeId, rp.origin, rp.rpId) }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).approved, 'transfer.create');

  const once = await fetch(`${base}/api/v1/r/transfer.create${s.q}&f.amount=250`, { method: 'POST', headers: s.h });
  assert.equal(once.status, 200);
  assert.ok((await once.json()).decision.reasonCodes.includes('STEP_UP_PASSED'));
  // one approval, one action; and the session was not handed back: other resources still see the agent
  assert.equal((await fetch(`${base}/api/v1/r/transfer.create${s.q}&f.amount=250`, { method: 'POST', headers: s.h })).status, 428);
  assert.equal((await fetch(`${base}/api/v1/r/balance.read${s.q}`, { headers: s.h })).status, 403);
  const st = await (await fetch(`${base}/api/v1/webauthn/status${s.q}`, { headers: { cookie: s.cookie } })).json();
  assert.equal(st.humanVerifiedAt, null);
});

test('the owner decides for their own agent: stricter at once, wider only with a passkey, never past the company\'s block; every change is signed', async () => {
  const s = await open('human');
  const rp = { rpId: '127.0.0.1', origin: base };
  const auth = new SoftAuthenticator();
  const ro = await (await fetch(`${base}/api/v1/webauthn/register/options${s.q}`, { method: 'POST', headers: s.h, body: '{}' })).json();
  assert.equal((await fetch(`${base}/api/v1/webauthn/register${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ro.challengeId, id: b64u(auth.credId), ...auth.register(ro.challengeId, rp.origin, rp.rpId) }) })).status, 201);
  const rule = (resource: string, onAgent: string) => ({ resource, title: resource, onAgent, onArtifact: onAgent, onUnknown: 'allow', onHumanLike: 'allow', actOn: ['verified', 'strong', 'control', 'behavioral'], minScore: 65 });
  assert.equal((await fetch(`${base}/api/v1/policy${s.q}`, { method: 'PUT', headers: s.h, body: JSON.stringify({ enforcement: 'enforce', rules: [rule('transfer.create', 'step_up'), rule('balance.read', 'mask'), rule('card.details', 'block')] }) })).status, 200);
  await fetch(`${base}/api/v1/signals${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ early: { ...earlyBase, markers: [{ name: 'claude-stop', atMs: 900 }] }, interaction: null }) });
  const set = (resource: string, choice: string | null) => fetch(`${base}/api/v1/access${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ resource, choice }) });
  const permit = async (resource: string, choice: 'allow' | 'default') => {
    const ao = await (await fetch(`${base}/api/v1/webauthn/assert/options${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ resource, purpose: 'permit', choice }) })).json();
    return fetch(`${base}/api/v1/webauthn/assert${s.q}`, { method: 'POST', headers: s.h, body: JSON.stringify({ challengeId: ao.challengeId, ...auth.assert(ao.challengeId, rp.origin, rp.rpId) }) });
  };
  const view = async () => (await fetch(`${base}/api/v1/access${s.q}`, { headers: s.h })).json();

  const first = await view();
  assert.equal(first.connected, true);
  assert.deepEqual(first.actions.map((a: { resource: string; effective: string; mayLoosen: boolean }) => [a.resource, a.effective, a.mayLoosen]), [['transfer.create', 'step_up', true], ['balance.read', 'mask', true], ['card.details', 'block', false]]);

  // the agent tries to widen its own access: refused
  assert.equal((await (await set('transfer.create', 'allow')).json()).error, 'passkey_required');
  assert.equal((await (await set('card.details', 'allow')).json()).error, 'not_allowed', 'the company\'s block is not the owner\'s to lift');
  assert.equal((await fetch(`${base}/api/v1/r/transfer.create${s.q}&f.amount=250`, { method: 'POST', headers: s.h })).status, 428);

  // stricter: at once, no passkey
  assert.equal((await set('balance.read', 'never')).status, 200);
  const denied = await fetch(`${base}/api/v1/r/balance.read${s.q}`, { headers: s.h });
  assert.equal(denied.status, 403);
  assert.ok((await denied.json()).decision.reasonCodes.includes('OWNER_DENIED'));
  assert.equal((await (await set('balance.read', null)).json()).error, 'passkey_required', 'lifting a never is wider too');

  // wider, with the owner's passkey: transfers go through for the hour, each one marked as the owner's permission
  const ok = await permit('transfer.create', 'allow');
  assert.equal(ok.status, 200);
  for (let i = 0; i < 2; i++) {
    const t = await fetch(`${base}/api/v1/r/transfer.create${s.q}&f.amount=250`, { method: 'POST', headers: s.h });
    assert.equal(t.status, 200);
    assert.ok((await t.json()).decision.reasonCodes.includes('OWNER_ALLOWED'));
  }
  assert.equal((await permit('balance.read', 'default')).status, 200);
  const masked = await fetch(`${base}/api/v1/r/balance.read${s.q}`, { headers: s.h });
  assert.equal(masked.status, 200);
  assert.equal((await masked.json()).masked, true);

  // "close everything to it"
  assert.equal((await set('*', 'never')).status, 200);
  assert.equal((await fetch(`${base}/api/v1/r/transfer.create${s.q}&f.amount=250`, { method: 'POST', headers: s.h })).status, 403);
  const after = await view();
  assert.ok(after.actions.every((a: { effective: string }) => a.effective === 'block'));
  assert.ok(after.activity.some((a: { resource: string; owner: string }) => a.resource === 'access.transfer.create' && a.owner === 'allowed'));
  assert.ok(after.activity.some((a: { resource: string; owner: string }) => a.resource === 'transfer.create' && a.owner === 'allowed'));
  const { verifyChain } = await import('../server/audit.ts');
  assert.equal((await verifyChain(app.store, s.room)).ok, true, 'owner changes sit in the signed chain');
});

test('an owner\'s choice never touches a person at the controls', async () => {
  const { applyOwnerChoice } = await import('../server/policy.ts');
  type D = Parameters<typeof applyOwnerChoice>[0]; type R = NonNullable<Parameters<typeof applyOwnerChoice>[1]>;
  const d: D = { id: 'x', resource: 'balance.read', decision: 'allow', computed: 'allow', enforced: true, actor: 'human_like', score: 10, tiers: [], reasonCodes: [], policyVersion: 'p', signalVersion: 'v', branch: 'human_like' };
  const r: R = { resource: 'balance.read', title: 'b', onAgent: 'mask', onArtifact: 'mask', onUnknown: 'allow', onHumanLike: 'allow', actOn: ['verified'], minScore: 65 };
  assert.equal(applyOwnerChoice(d, r, 'never').decision, 'allow');
  const agent = applyOwnerChoice({ ...d, branch: 'agent', decision: 'mask', computed: 'mask', enforced: false }, r, 'never');
  assert.equal(agent.computed, 'block');
  assert.equal(agent.decision, 'allow', 'observe mode records the owner\'s choice without enforcing it');
});
