/** Portal + ingest end to end: sign up, create a key, report decisions with it, read them back. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import { parseEvent, hashPassword, verifyPassword, newApiKey, newAdminKey, hashKey } from '../server/routes/portal.ts';

let base = '';
let app: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  app = await createApp({ labOperator: false });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => { app.server.close(); app.store.close(); });

const jar: string[] = [];
const hdr = () => ({ 'Content-Type': 'application/json', Origin: base, Cookie: jar.join('; ') });
const keep = (r: Response) => { const c = r.headers.get('set-cookie'); if (c) { const kv = c.split(';')[0]!; const i = jar.findIndex((x) => x.split('=')[0] === kv.split('=')[0]); if (i >= 0) jar[i] = kv; else jar.push(kv); } };

test('passwords: scrypt round-trips and rejects the wrong one; keys hash deterministically', () => {
  const h = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong', h));
  const k = newApiKey();
  assert.match(k.raw, /^nt_live_[a-f0-9]{40}$/);
  assert.equal(k.prefix, k.raw.slice(0, 15));
  assert.equal(k.hash, hashKey(k.raw));
});

test('parseEvent keeps well-formed metadata and drops the rest', () => {
  const now = Date.now();
  const ok = parseEvent({ at: now - 1000, session: 'abcdef0123456789', resource: 'balance.read', decision: 'mask', actor: 'agent_likely', state: 'agent_attached', tools: ['claude-chrome'], reasons: ['AGENT_CONTROL_MARKER'], enforcement: 'observe', version: 'assess-v7' }, now);
  assert.ok(ok); assert.equal(ok!.decision, 'mask'); assert.deepEqual(ok!.tools, ['claude-chrome']);
  assert.equal(parseEvent({ session: 'x', resource: 'r', decision: 'mask' }, now), null, 'session must be a hash');
  assert.equal(parseEvent({ session: 'abcdef0123456789', resource: 'r', decision: 'delete' }, now), null, 'unknown decision');
  assert.equal(parseEvent({ session: 'abcdef0123456789', resource: 'balance.read', decision: 'allow', actor: 'weird', state: 'nope' }, now)!.actor, 'unknown');
});

let rawKey = '', keyId = '';
test('signup → key → ingest → stats', async () => {
  let r = await fetch(`${base}/api/v1/portal/signup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ email: 'ops@bank.example', password: 'longenough1' }) });
  assert.equal(r.status, 201); keep(r);
  r = await fetch(`${base}/api/v1/portal/signup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ email: 'ops@bank.example', password: 'longenough1' }) });
  assert.equal(r.status, 409, 'duplicate e-mail');

  r = await fetch(`${base}/api/v1/portal/me`, { headers: hdr() });
  assert.equal(r.status, 200); const me = await r.json(); assert.equal(me.account.email, 'ops@bank.example'); assert.deepEqual(me.keys, []);

  r = await fetch(`${base}/api/v1/portal/keys`, { method: 'POST', headers: hdr(), body: JSON.stringify({ name: 'production', expiresInDays: 30, env: 'staging' }) });
  assert.equal(r.status, 201); const k = await r.json(); rawKey = k.key; keyId = k.id;
  assert.equal(k.env, 'staging'); assert.ok(k.expires && k.expires > Date.now(), 'expiry is set 30 days out');
  assert.match(rawKey, /^nt_live_/);
  r = await fetch(`${base}/api/v1/portal/me`, { headers: hdr() }); const me2 = await r.json();
  assert.equal(me2.keys.length, 1); assert.equal(me2.keys[0].prefix, rawKey.slice(0, 15)); assert.ok(!('key' in me2.keys[0]), 'raw key is never listed again');

  // a wrong key is refused; the right one accepts a batch, dropping malformed rows
  r = await fetch(`${base}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nt_live_' + '0'.repeat(40) }, body: JSON.stringify({ events: [] }) });
  assert.equal(r.status, 401);
  const now = Date.now();
  const ev = (over: Record<string, unknown>) => ({ at: now, session: 'a1b2c3d4e5f60718', resource: 'balance.read', decision: 'allow', actor: 'human_like', state: 'no_indication', tools: [], reasons: ['HUMAN_KINEMATICS'], enforcement: 'observe', version: 'assess-v7', ...over });
  r = await fetch(`${base}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` }, body: JSON.stringify({ events: [
    ev({}), ev({ resource: 'transactions.search' }),
    ev({ session: 'ffffffffffffffff', decision: 'mask', actor: 'agent_likely', state: 'agent_attached', tools: ['claude-chrome'], reasons: ['AGENT_CONTROL_MARKER'] }),
    ev({ session: 'ffffffffffffffff', resource: 'report.export', decision: 'block', actor: 'agent_likely', state: 'agent_attached', tools: ['claude-chrome'] }),
    { garbage: true },
  ] }) });
  assert.equal(r.status, 202); const acc = await r.json(); assert.equal(acc.accepted, 4); assert.equal(acc.dropped, 1);

  r = await fetch(`${base}/api/v1/portal/stats?key=${keyId}&range=24h`, { headers: hdr() });
  assert.equal(r.status, 200); const st = await r.json();
  assert.deepEqual(st.decisions, { allow: 2, mask: 1, block: 1 });
  assert.equal(st.sessions.total, 2); assert.equal(st.sessions.agent, 1, 'one of two sessions had an agent');
  assert.deepEqual(st.tools, [{ tool: 'claude-chrome', sessions: 1 }]);
  assert.equal(st.recent.length, 4); assert.equal(st.recent[0].resource, 'report.export', 'newest first');
  assert.ok(st.series.length >= 1 && st.series.reduce((a: number, b: { n: number }) => a + b.n, 0) === 4);
  for (const b of st.series) assert.equal(b.t % st.range.bucketMs, 0, 'series points sit on bucket boundaries');
  assert.equal(st.series.length, 1, 'four events within a minute share one bucket');

  // the overview aggregates every key of the account per bucket
  r = await fetch(`${base}/api/v1/portal/overview?range=24h`, { headers: hdr() });
  assert.equal(r.status, 200); const ov = await r.json();
  assert.equal(ov.totals.length, 1); assert.equal(ov.totals[0].key, keyId); assert.equal(ov.totals[0].n, 4); assert.equal(ov.totals[0].agentSessions, 1); assert.equal(ov.totals[0].gated, 2);
  assert.ok(ov.series.every((b: { t: number }) => b.t % ov.range.bucketMs === 0));

  // another account cannot read this key; a revoked key stops ingesting
  const jar2: string[] = [];
  r = await fetch(`${base}/api/v1/portal/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: 'other@corp.example', password: 'longenough2' }) });
  jar2.push(r.headers.get('set-cookie')!.split(';')[0]!);
  r = await fetch(`${base}/api/v1/portal/stats?key=${keyId}`, { headers: { Cookie: jar2.join('; ') } });
  assert.equal(r.status, 404);
  r = await fetch(`${base}/api/v1/portal/keys/revoke`, { method: 'POST', headers: hdr(), body: JSON.stringify({ id: keyId }) });
  assert.equal((await r.json()).ok, true);
  r = await fetch(`${base}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` }, body: JSON.stringify({ events: [ev({})] }) });
  assert.equal(r.status, 401);
});

test('login works with the right password, sign-out clears the session', async () => {
  const jar3: string[] = [];
  let r = await fetch(`${base}/api/v1/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: 'ops@bank.example', password: 'nope-nope' }) });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/api/v1/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: 'OPS@bank.example', password: 'longenough1' }) });
  assert.equal(r.status, 200); jar3.push(r.headers.get('set-cookie')!.split(';')[0]!);
  r = await fetch(`${base}/api/v1/portal/me`, { headers: { Cookie: jar3.join('; ') } }); assert.equal(r.status, 200);
  r = await fetch(`${base}/api/v1/portal/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: jar3.join('; ') }, body: '{}' }); assert.equal(r.status, 200);
  r = await fetch(`${base}/api/v1/portal/me`, { headers: { Cookie: jar3.join('; ') } }); assert.equal(r.status, 401);
});

test('management keys drive the whole account over HTTP, the way an agent would', async () => {
  const am = newAdminKey();
  assert.match(am.raw, /^nt_admin_[a-f0-9]{40}$/);
  assert.equal(am.hash, hashKey(am.raw));

  // sign in as a fresh account and mint a management key from the portal
  const H = { 'Content-Type': 'application/json', Origin: base };
  let r = await fetch(`${base}/api/v1/portal/signup`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'agent@corp.example', password: 'longenough3' }) });
  const c = r.headers.get('set-cookie')!.split(';')[0]!;
  r = await fetch(`${base}/api/v1/portal/admin-keys`, { method: 'POST', headers: { ...H, Cookie: c }, body: JSON.stringify({ name: 'claude-code' }) });
  assert.equal(r.status, 201); const admin = await r.json();
  assert.match(admin.key, /^nt_admin_/);
  const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.key}` };

  // an unknown management key is refused
  r = await fetch(`${base}/api/v1/manage/keys`, { headers: { Authorization: 'Bearer nt_admin_' + '0'.repeat(40) } });
  assert.equal(r.status, 401);

  // me → keys (empty) → create → list → stats → revoke, all without touching the portal UI
  r = await fetch(`${base}/api/v1/manage/me`, { headers: A });
  assert.equal(r.status, 200); const meJson = await r.json();
  assert.equal(meJson.account.email, 'agent@corp.example');
  assert.ok(Array.isArray(meJson.endpoints) && meJson.endpoints.length >= 5, 'the API describes itself');

  r = await fetch(`${base}/api/v1/manage/keys`, { headers: A });
  assert.deepEqual((await r.json()).keys, []);
  r = await fetch(`${base}/api/v1/manage/keys`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'from-agent', expiresInDays: 7, env: 'development' }) });
  assert.equal(r.status, 201); const made = await r.json();
  assert.match(made.key, /^nt_live_/); assert.equal(made.env, 'development');

  // the key it just made really works for ingest
  r = await fetch(`${base}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${made.key}` }, body: JSON.stringify({ events: [{ at: Date.now(), session: 'abcdef0123456789', resource: 'balance.read', decision: 'mask', actor: 'agent_likely', state: 'agent_attached', tools: ['claude-chrome'], reasons: ['AGENT_CONTROL_MARKER'], enforcement: 'observe', version: 'assess-v7' }] }) });
  assert.equal((await r.json()).accepted, 1);

  r = await fetch(`${base}/api/v1/manage/stats?key=${made.id}&range=24h`, { headers: A });
  assert.equal(r.status, 200); const st = await r.json();
  assert.deepEqual(st.decisions, { mask: 1 }); assert.equal(st.sessions.agent, 1);
  r = await fetch(`${base}/api/v1/manage/overview?range=24h`, { headers: A });
  assert.equal((await r.json()).totals[0].n, 1);

  r = await fetch(`${base}/api/v1/manage/keys/${made.id}`, { method: 'DELETE', headers: A });
  assert.equal((await r.json()).ok, true);
  r = await fetch(`${base}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${made.key}` }, body: JSON.stringify({ events: [] }) });
  assert.equal(r.status, 401, 'a revoked key stops working immediately');

  // one account's management key cannot see another account's key
  r = await fetch(`${base}/api/v1/manage/stats?key=${keyId}`, { headers: A });
  assert.equal(r.status, 404);
  r = await fetch(`${base}/api/v1/manage/nonsense`, { headers: A });
  assert.equal(r.status, 404);
});

test('an expired key is refused at ingest', async () => {
  const H = { 'Content-Type': 'application/json', Origin: base };
  let r = await fetch(`${base}/api/v1/portal/signup`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'exp@corp.example', password: 'longenough4' }) });
  const c = r.headers.get('set-cookie')!.split(';')[0]!;
  r = await fetch(`${base}/api/v1/portal/keys`, { method: 'POST', headers: { ...H, Cookie: c }, body: JSON.stringify({ name: 'short-lived', expiresInDays: 7 }) });
  const k = await r.json();
  // move its expiry into the past, the way time would
  await app.store.exec('UPDATE api_keys SET expires = ? WHERE id = ?', [Date.now() - 1000, k.id]);
  r = await fetch(`${base}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.key}` }, body: JSON.stringify({ events: [] }) });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'expired');
});

test('paste-a-key lookup finds the owner key and refuses a foreign one', async () => {
  let r = await fetch(`${base}/api/v1/portal/lookup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ key: rawKey }) });
  assert.equal(r.status, 404, 'route lives under /keys/lookup');
  r = await fetch(`${base}/api/v1/portal/keys/lookup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ key: rawKey }) });
  assert.equal(r.status, 200); assert.equal((await r.json()).id, keyId);
  r = await fetch(`${base}/api/v1/portal/keys/lookup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ key: newApiKey().raw }) });
  assert.equal((await r.json()).id, null);
  r = await fetch(`${base}/api/v1/portal/keys/lookup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ key: 'not-a-key' }) });
  assert.equal(r.status, 400);
});

test('renaming a key works and stays inside the account', async () => {
  let r = await fetch(`${base}/api/v1/portal/keys/rename`, { method: 'POST', headers: hdr(), body: JSON.stringify({ id: keyId, name: 'prod · bank-web' }) });
  assert.equal((await r.json()).ok, true);
  r = await fetch(`${base}/api/v1/portal/me`, { headers: hdr() });
  const mine = (await r.json()).keys.find((x: { id: string }) => x.id === keyId);
  assert.equal(mine.name, 'prod · bank-web');
});
