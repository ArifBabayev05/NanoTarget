// SPDX-License-Identifier: Apache-2.0
// Acme Bank — the smallest possible NanoTarget integration (Express 5).
//   node examples/express-bank/server.mjs   →  http://localhost:3000
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanotarget } from '../../integrations/express/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// --- 1. one line: SDK + its API under /nanotarget, policy from your file, storage on your disk ---
const nt = await nanotarget({ secret: process.env.NT_SECRET ?? 'dev-secret-change-me-dev-secret-change-me', policy: join(here, 'nanotarget.policy.json'), db: 'sqlite:./examples/express-bank/nanotarget.db' });
app.use(nt.middleware());

// --- 2. your data and your own mask functions ---
const account = { owner: 'Aysel Məmmədova', iban: 'AZ21NABZ00000000137010001944', balance: 2920.74, currency: 'AZN' };
const maskBalance = (a) => ({ ...a, balance: null, iban: a.iban.slice(0, 4) + ' •••• ' + a.iban.slice(-4) });
const maskProfile = (a) => ({ owner: a.owner.split(' ')[0] + ' •.', iban: '•••• ' + a.iban.slice(-4) });

// --- 3. protect the endpoints that return the data ---
app.get('/api/balance', nt.protect('balance.read'), (req, res) => nt.send(req, res, account, maskBalance));
app.get('/api/profile', nt.protect('profile.read'), (req, res) => nt.send(req, res, { owner: account.owner, iban: account.iban }, maskProfile));
app.post('/api/transfer', nt.protect('transfer.make'), (req, res) => {
  // req.nt.decision is allow here (block / step_up were answered by protect); your own business checks follow
  res.json({ ok: true, to: req.body?.to ?? null, amount: req.body?.amount ?? 0, _nt: { decision: req.nt.decision, actor: req.nt.actor } });
});

app.use(express.static(join(here, 'public')));
app.listen(3000, () => console.log('Acme Bank on http://localhost:3000  (NanoTarget at', nt.basePath + ')'));
