/** The middleware reports its decisions to the portal with an API key; the portal shows them per key. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import { nanotarget } from '../integrations/express/index.ts';

const portal = await createApp({ labOperator: false });
await new Promise<void>((r) => portal.server.listen(0, '127.0.0.1', () => r()));
const pbase = `http://127.0.0.1:${(portal.server.address() as AddressInfo).port}`;

// a customer account with one key
const H = { 'Content-Type': 'application/json', Origin: pbase };
const signup = await fetch(`${pbase}/api/v1/portal/signup`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'cto@fintech.example', password: 'longenough1' }) });
const cookie = signup.headers.get('set-cookie')!.split(';')[0]!;
const key = await (await fetch(`${pbase}/api/v1/portal/keys`, { method: 'POST', headers: { ...H, Cookie: cookie }, body: JSON.stringify({ name: 'staging' }) })).json();

const policy = { version: 'tele-1', enforcement: 'observe', rules: [{ resource: 'balance.read', title: 'Balance', onAgent: 'mask', onArtifact: 'mask', onUnknown: 'allow', onHumanLike: 'allow', actOn: ['verified', 'strong', 'control', 'behavioral'], minScore: 65 }] };
const nt = await nanotarget({ secret: 'test-secret-test-secret-test-secret-1234', policy: policy as never, db: 'memory', apiKey: key.key, telemetryUrl: `${pbase}/api/v1/ingest` });
const app = express();
app.use(nt.middleware());
app.get('/api/balance', nt.protect('balance.read'), (req, res) => nt.send(req, res, { balance: 10 }, (a) => ({ ...a, balance: null })));
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(async () => { server.close(); await nt.close(); portal.server.close(); portal.store.close(); });

test('decisions made by the middleware arrive in the portal under the right key', async () => {
  assert.ok(nt.telemetry, 'reporter exists when an apiKey is given');
  const r1 = await fetch(`${base}/api/balance`); assert.equal(r1.status, 200);
  const c = (r1.headers.get('set-cookie') ?? '').split(';')[0]!;
  const r2 = await fetch(`${base}/api/balance`, { headers: { Cookie: c } }); assert.equal(r2.status, 200);
  // the event is queued after an async connection lookup; give it a tick, then push the batch
  await new Promise((r) => setTimeout(r, 150));
  await nt.telemetry!.flush();
  const st = await (await fetch(`${pbase}/api/v1/portal/stats?key=${key.id}&range=24h`, { headers: { Cookie: cookie } })).json();
  assert.equal(st.decisions.allow, 2, JSON.stringify(st.decisions));
  assert.equal(st.sessions.total, 1, 'both requests came from one browser session');
  assert.equal(st.recent[0].resource, 'balance.read');
  assert.equal(st.recent[0].enforcement, 'observe');
  assert.match(st.recent[0].session, /^[a-f0-9]{16}$/, 'session ids are hashed before they leave the server');
  assert.equal(nt.telemetry!.pending, 0);
});

test('without an apiKey nothing is reported and no reporter exists', async () => {
  const quiet = await nanotarget({ secret: 'test-secret-test-secret-test-secret-1234', policy: policy as never, db: 'memory' });
  assert.equal(quiet.telemetry, null);
  await quiet.close();
});
