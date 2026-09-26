// SPDX-License-Identifier: BUSL-1.1
/**
 * Customer portal + telemetry ingest.
 *
 * A customer signs up, creates API keys (one per project), puts a key into `onehuman({ apiKey })`,
 * and the middleware reports every decision here — metadata only: hashed session, resource, decision,
 * actor, connection state, detected tools, reason codes. The portal turns that into the one number a
 * security team has never had: how many of their logged-in sessions had an AI agent in them.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { OneHuman } from '../engine.ts';
import { cookies, json, readJson, sameOrigin, url, type Req, type Res } from '../http.ts';
import type { TelemetryEvent, TelemetryHealth } from '../db.ts';
import { proofBundle, thumbprint, verifyProof, type ProofJwk } from '../proof.ts';
import { newsSince } from '../agent-news.ts';
import { policyRoutes } from './policy-portal.ts';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const SHORT = /^[a-zA-Z0-9_.:\-\/ ]{1,80}$/;
const NAME = /^[^\x00-\x1f\x7f<>]{1,80}$/;   // key names: any printable text, no angle brackets
const TOKEN = /^[a-z0-9_]{1,40}$/i;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const COOKIE = 'nt_portal';
const RANGES: Record<string, { since: number; bucket: number }> = {
  '24h': { since: 24 * 3600e3, bucket: 3600e3 },
  '7d': { since: 7 * 24 * 3600e3, bucket: 6 * 3600e3 },
  '30d': { since: 30 * 24 * 3600e3, bucket: 24 * 3600e3 },
};

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = scryptSync(pw, salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex');
/** `nt_live_` + 40 hex chars; the prefix (first 15 chars) is what the portal shows afterwards */
export function newApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `nt_live_${randomBytes(20).toString('hex')}`;
  return { raw, prefix: raw.slice(0, 15), hash: hashKey(raw) };
}
/** `nt_admin_` + 40 hex chars: administers the account over HTTP, so an agent or a CI job can do everything the portal can. */
export function newAdminKey(): { raw: string; prefix: string; hash: string } {
  const raw = `nt_admin_${randomBytes(20).toString('hex')}`;
  return { raw, prefix: raw.slice(0, 16), hash: hashKey(raw) };
}
const EXPIRY_DAYS = new Set([0, 7, 30, 90, 365]);
const ENVS = new Set(['production', 'staging', 'development']);

export function portalRoutes(engine: OneHuman, opts: { secure: (req: Req) => boolean }) {
  const store = engine.store;
  const setSession = (req: Req, res: Res, id: string | null) =>
    res.setHeader('Set-Cookie', id
      ? `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${opts.secure(req) ? '; Secure' : ''}`
      : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  const accountOf = async (req: Req): Promise<string | null> => {
    const sid = cookies(req)[COOKIE];
    return sid ? store.portalSession(sid) : null;
  };

  // the portal-managed policy (./policy-portal.ts): the server authenticates with its API key, the page with the cookie
  const pol = policyRoutes(engine, {
    accountOf,
    checkPassword: async (account, password) => {
      const email = (await store.accountById(account))?.email;
      const acc = email ? await store.accountByEmail(email) : null;
      return !!acc && verifyPassword(password, acc.pass);
    },
    serverKey: async (req, res) => {
      const auth = (req.headers.authorization ?? '').toString();
      const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!/^nt_live_[a-f0-9]{40}$/.test(raw)) { json(res, 401, { error: 'bad_key' }); return null; }
      const hash = hashKey(raw);
      const key = await store.apiKeyByHash(hash);
      if (!key || key.revoked) { json(res, 401, { error: 'bad_key' }); return null; }
      if (key.expires && key.expires < Date.now()) { json(res, 401, { error: 'expired', message: 'This key expired; create a new one in the portal.' }); return null; }
      return { id: key.id, account: key.account, tag: hash.slice(0, 16) };
    },
  });
  // a small in-memory rate limit per key for ingest (serverless instances each have their own; fine)
  const ingestWindow = new Map<string, { n: number; at: number }>();

  const signup = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    if (!EMAIL.test(email)) return json(res, 400, { error: 'bad_email', message: 'Enter a valid e-mail address.' });
    if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'bad_password', message: 'Use at least 8 characters.' });
    const id = await store.createAccount(email, hashPassword(password));
    if (!id) return json(res, 409, { error: 'exists', message: 'An account with this e-mail already exists — sign in instead.' });
    setSession(req, res, await store.createPortalSession(id, SESSION_TTL_MS));
    json(res, 201, { ok: true, account: { email } });
  };

  const login = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    const acc = EMAIL.test(email) ? await store.accountByEmail(email) : null;
    if (!acc || !verifyPassword(password, acc.pass)) return json(res, 401, { error: 'invalid', message: 'E-mail or password is wrong.' });
    setSession(req, res, await store.createPortalSession(acc.id, SESSION_TTL_MS));
    json(res, 200, { ok: true, account: { email: acc.email } });
  };

  const logout = async (req: Req, res: Res) => {
    const sid = cookies(req)[COOKIE];
    if (sid) await store.deletePortalSession(sid);
    setSession(req, res, null);
    json(res, 200, { ok: true });
  };

  const me = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const acc = await store.accountById(account);
    json(res, 200, { account: acc ? { email: acc.email, created: acc.created } : null, keys: await store.listApiKeys(account) });
  };

  const createKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const made = await makeKey(account, b);
    if ('error' in made) return json(res, 400, made);
    json(res, 201, made);
  };

  /** shared by the portal and the management API */
  async function makeKey(account: string, b: Record<string, unknown> | null | undefined) {
    const name = typeof b?.name === 'string' && NAME.test(b.name.trim()) ? b.name.trim() : 'Default';
    const days = typeof b?.expiresInDays === 'number' && EXPIRY_DAYS.has(b.expiresInDays) ? b.expiresInDays : 0;
    const env = typeof b?.env === 'string' && ENVS.has(b.env) ? b.env : 'production';
    if ((await store.listApiKeys(account)).filter((k) => !k.revoked).length >= 20) return { error: 'too_many', message: 'Revoke a key before creating another (limit 20).' };
    const k = newApiKey();
    const expires = days ? Date.now() + days * 86400e3 : null;
    const id = await store.createApiKey(account, { name, prefix: k.prefix, hash: k.hash, expires, env });
    // the raw key is returned exactly once; only its hash is stored
    return { id, name, prefix: k.prefix, env, expires, key: k.raw };
  }

  const renameKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const id = typeof b?.id === 'string' ? b.id : '';
    const name = typeof b?.name === 'string' && NAME.test(b.name.trim()) ? b.name.trim() : '';
    if (!name) return json(res, 400, { error: 'bad_name', message: 'Give the key a name.' });
    json(res, 200, { ok: await store.renameApiKey(id, account, name) });
  };

  /** "paste a key" search: which of my keys is this string? The raw key is hashed here and never stored. */
  const lookupKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const raw = typeof b?.key === 'string' ? b.key.trim() : '';
    if (!/^nt_(live|admin)_[a-f0-9]{40}$/.test(raw)) return json(res, 400, { error: 'bad_key', message: 'That is not a OneHuman key.' });
    json(res, 200, { id: await store.apiKeyIdByHash(hashKey(raw), account) });
  };

  // --- management keys (the portal side) ---
  const listAdminKeys = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    json(res, 200, { keys: await store.listAdminKeys(account) });
  };
  const createAdminKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const name = typeof b?.name === 'string' && NAME.test(b.name.trim()) ? b.name.trim() : 'Management key';
    if ((await store.listAdminKeys(account)).filter((k) => !k.revoked).length >= 5) return json(res, 400, { error: 'too_many', message: 'Revoke a management key before creating another (limit 5).' });
    const k = newAdminKey();
    const id = await store.createAdminKey(account, name, k.prefix, k.hash);
    json(res, 201, { id, name, prefix: k.prefix, key: k.raw });
  };
  const revokeAdminKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 2000).catch(() => null)) as Record<string, unknown> | null | undefined;
    json(res, 200, { ok: await store.revokeAdminKey(typeof b?.id === 'string' ? b.id : '', account) });
  };

  const revokeKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 2000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const id = typeof b?.id === 'string' ? b.id : '';
    json(res, 200, { ok: await store.revokeApiKey(id, account) });
  };

  /** rotate: the key keeps its name, environment and history; the old secret stops working at once */
  const rotateKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 2000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const rotated = await rotate(account, typeof b?.id === 'string' ? b.id : '');
    return 'error' in rotated ? json(res, 404, rotated) : json(res, 200, rotated);
  };

  /** shared by the portal and the management API */
  async function rotate(account: string, id: string) {
    const k = newApiKey();
    if (!(await store.rotateApiKey(id, account, k.prefix, k.hash))) return { error: 'not_found', message: 'No live key with that id.' };
    return { id, prefix: k.prefix, key: k.raw };
  }

  /** deleting is for revoked keys only, and it takes their reported decisions with them */
  const deleteKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 2000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const ok = await store.deleteApiKey(typeof b?.id === 'string' ? b.id : '', account);
    if (!ok) return json(res, 400, { error: 'not_revoked', message: 'Revoke the key first — then it can be deleted.' });
    json(res, 200, { ok });
  };

  const changePassword = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const current = typeof b?.current === 'string' ? b.current : '';
    const next = typeof b?.next === 'string' ? b.next : '';
    const acc = await store.accountByEmail((await store.accountById(account))?.email ?? '');
    if (!acc || !verifyPassword(current, acc.pass)) return json(res, 401, { error: 'invalid', message: 'Current password is wrong.' });
    if (next.length < 8 || next.length > 200) return json(res, 400, { error: 'bad_password', message: 'Use at least 8 characters.' });
    await store.setAccountPassword(account, hashPassword(next));
    json(res, 200, { ok: true });
  };

  /** the decision log, paged — the portal's "load more" and its CSV export read the same rows */
  const events = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const u = url(req);
    const key = u.searchParams.get('key') ?? '';
    if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
    const rows = await eventPage(key, u);
    json(res, 200, { key, events: rows, more: rows.length === pageSize(u) });
  };

  /**
   * GET /api/v1/portal/proofs?key=&range=30d[&session=] — the file a business hands an auditor: every signed
   * decision in range (or for one session) plus the keys that verify them. Only proofs that checked out at
   * ingest are included; the auditor re-checks them anyway.
   */
  const proofs = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const u = url(req);
    const key = u.searchParams.get('key') ?? '';
    if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
    const bundle = await bundleFor(key, u);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="onehuman-proofs-${bundle.range}${bundle.session ? '-' + bundle.session : ''}.json"`, 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(bundle, null, 2));
  };
  async function bundleFor(key: string, u: URL) {
    const rangeName = RANGES[u.searchParams.get('range') ?? '30d'] ? (u.searchParams.get('range') ?? '30d') : '30d';
    const range = RANGES[rangeName]!;
    const sessionRaw = u.searchParams.get('session');
    const session = sessionRaw && /^[a-f0-9]{8,32}$/.test(sessionRaw) ? sessionRaw : null;
    const rows = (await store.telemetryProofs(key, Date.now() - range.since, session)).filter((r) => r.ok);
    const keys = (await store.proofKeysFor(key)).map(({ kty, crv, x, kid }) => ({ kty, crv, x, kid, use: 'sig' as const, alg: 'EdDSA' as const }));
    return proofBundle(rows.map((r) => r.proof), keys, { range: rangeName, session, decisions: rows.length });
  }

  /** POST /api/v1/proof/verify — stateless check of a bundle (or { proofs, keys }). No account, nothing stored. */
  const verifyBundle = async (req: Req, res: Res) => {
    const b = (await readJson(req, 2_000_000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const list = Array.isArray(b?.proofs) ? (b!.proofs as unknown[]).slice(0, 5000) : null;
    const keys = parseProofKeys(b?.keys);
    if (!list || !keys.length) return json(res, 400, { error: 'bad_body', message: 'Send a proof bundle: { keys: [...], proofs: [...] }.' });
    let valid = 0;
    const results = list.map((p) => {
      const c = verifyProof(typeof p === 'string' ? p : '', keys);
      if (c.valid) valid++;
      return c.valid ? { valid: true, decision: c.payload.jti, resource: c.payload.resource, verdict: c.payload.decision, actor: c.payload.actor, delivered: c.payload.delivered, at: new Date(c.payload.iat * 1000).toISOString(), kid: c.kid, seq: c.payload.audit?.seq ?? null } : { valid: false, reason: c.reason };
    });
    json(res, 200, { checked: list.length, valid, invalid: list.length - valid, results });
  };

  const pageSize = (u: URL) => Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 100));
  const eventPage = (key: string, u: URL) => {
    const range = RANGES[u.searchParams.get('range') ?? '7d'] ?? RANGES['7d']!;
    const before = Number(u.searchParams.get('before'));
    return store.telemetryEvents(key, Date.now() - range.since, Number.isFinite(before) && before > 0 ? before : null, pageSize(u));
  };

  const stats = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const u = url(req);
    const key = u.searchParams.get('key') ?? '';
    const range = RANGES[u.searchParams.get('range') ?? '7d'] ?? RANGES['7d']!;
    if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
    const now = Date.now();
    json(res, 200, { key, range: { since: now - range.since, bucketMs: range.bucket }, now, ...(await store.telemetryStats(key, now - range.since, range.bucket)), feedback: await store.telemetryFeedback(key, now - range.since) });
  };

  /**
   * GET /api/v1/portal/health?key=&range=7d — the integration check: four lights (server reporting, browser
   * signals, signatures verify, policy enforcing) and the "people stopped" counter. Everything comes from what
   * the key already reported; nothing is sent to the customer's site.
   */
  const health = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const u = url(req);
    const key = u.searchParams.get('key') ?? '';
    if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
    json(res, 200, await healthFor(key, u));
  };
  async function healthFor(key: string, u: URL) {
    const rangeName = RANGES[u.searchParams.get('range') ?? '7d'] ? (u.searchParams.get('range') ?? '7d') : '7d';
    const now = Date.now();
    const h = await store.telemetryHealth(key, now - RANGES[rangeName]!.since);
    return { key, range: rangeName, now, ...h, checks: integrationChecks(h, now) };
  }

  /**
   * GET /api/v1/portal/weekly?key= — the weekly report: this week against last week for one key, the agents
   * that are new on this site, and what changed in the agents themselves (the same for every customer).
   */
  const weekly = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const key = url(req).searchParams.get('key') ?? '';
    if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
    json(res, 200, await weeklyFor(key));
  };
  async function weeklyFor(key: string, now = Date.now()) {
    const WEEK = 7 * 24 * 3600e3;
    const [cur, prev] = await Promise.all([store.telemetryWeek(key, now - WEEK, now + 60_000), store.telemetryWeek(key, now - 2 * WEEK, now - WEEK)]);
    const seenBefore = new Set(prev.tools.map((t) => t.tool));
    return {
      key, now, from: now - WEEK, week: cur, previous: prev,
      newAgents: cur.tools.filter((t) => !seenBefore.has(t.tool)).map((t) => t.tool),
      goneAgents: prev.tools.filter((t) => !cur.tools.some((c) => c.tool === t.tool)).map((t) => t.tool),
      news: newsSince(now - 4 * WEEK, now),
    };
  }

  /** POST /api/v1/portal/feedback { key, id, verdict: 'correct'|'wrong'|null, note? } — the customer grades one decision. */
  const feedback = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 4000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const key = typeof b?.key === 'string' ? b.key : '';
    const id = typeof b?.id === 'number' && Number.isInteger(b.id) && b.id > 0 ? b.id : 0;
    const verdict = b?.verdict === 'correct' || b?.verdict === 'wrong' ? b.verdict : b?.verdict === null ? null : undefined;
    const note = typeof b?.note === 'string' ? b.note.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) : null;
    if (!id || verdict === undefined || !(await store.apiKeyOwned(key, account))) return json(res, 400, { error: 'bad_feedback', message: 'Send { key, id, verdict: "correct" | "wrong" | null }.' });
    json(res, 200, { ok: await store.setTelemetryFeedback(key, id, verdict, note) });
  };

  const overview = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const range = RANGES[url(req).searchParams.get('range') ?? '7d'] ?? RANGES['7d']!;
    const now = Date.now();
    json(res, 200, { range: { since: now - range.since, bucketMs: range.bucket }, now, keys: await store.listApiKeys(account), ...(await store.telemetryOverview(account, now - range.since, range.bucket)) });
  };

  /** POST /api/v1/ingest — Authorization: Bearer nt_live_…; body { events: [...] } */
  const ingest = async (req: Req, res: Res) => {
    const auth = (req.headers.authorization ?? '').toString();
    const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!/^nt_live_[a-f0-9]{40}$/.test(raw)) return json(res, 401, { error: 'bad_key' });
    const key = await store.apiKeyByHash(hashKey(raw));
    if (!key || key.revoked) return json(res, 401, { error: 'bad_key' });
    const now = Date.now();
    if (key.expires && key.expires < now) return json(res, 401, { error: 'expired', message: 'This key expired; create a new one in the portal.' });
    const w = ingestWindow.get(key.id);
    if (w && now - w.at < 60_000) { if (w.n >= 120) return json(res, 429, { error: 'rate_limited' }); w.n++; } else ingestWindow.set(key.id, { n: 1, at: now });
    const b = (await readJson(req, 400_000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const list = Array.isArray(b?.events) ? (b!.events as unknown[]).slice(0, 200) : null;
    if (!list) return json(res, 400, { error: 'bad_body', message: 'Send { events: [...] }.' });
    const reported = parseProofKeys(b?.keys);
    if (reported.length) await store.rememberProofKeys(key.id, reported);
    const keys = [...reported, ...(await store.proofKeysFor(key.id))];
    const events: TelemetryEvent[] = [];
    let signed = 0;
    for (const e of list) {
      const ev = parseEvent(e, now);
      if (!ev) continue;
      if (ev.proof) {
        // a valid signature is not enough: the proof must be about *this* event, or a deployment could
        // attach one real proof to many made-up events
        const check = verifyProof(ev.proof, keys);
        ev.proofKid = check.valid ? check.kid : null;
        ev.proofOk = check.valid && check.payload.resource === ev.resource && check.payload.decision === ev.decision && check.payload.actor === ev.actor;
        if (ev.proofOk) signed++;
      }
      events.push(ev);
    }
    const stored = await store.insertTelemetry(key.id, events, now);
    json(res, 202, { accepted: events.length, stored, duplicates: events.length - stored, dropped: list.length - events.length, signed });
  };

  /**
   * Management API — everything the portal can do, over HTTP, with `Authorization: Bearer nt_admin_…`.
   * This is what lets a coding agent set OneHuman up end to end without a human opening the portal.
   */
  const manage = async (req: Req, res: Res) => {
    const auth = (req.headers.authorization ?? '').toString();
    const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!/^nt_admin_[a-f0-9]{40}$/.test(raw)) return json(res, 401, { error: 'bad_key', message: 'Send Authorization: Bearer nt_admin_… (create one in the portal under Management keys).' });
    const admin = await store.adminKeyByHash(hashKey(raw));
    if (!admin || admin.revoked) return json(res, 401, { error: 'bad_key' });
    void store.touchAdminKey(admin.id).catch(() => {});
    const account = admin.account;
    const u = url(req);
    const path = u.pathname.replace(/^\/api\/v1\/manage\/?/, '').replace(/\/$/, '');
    const method = req.method ?? 'GET';
    const body = method === 'GET' ? null : ((await readJson(req, 8000).catch(() => null)) as Record<string, unknown> | null | undefined);

    if (path === '' || path === 'me') {
      const acc = await store.accountById(account);
      return json(res, 200, { account: acc ? { email: acc.email, created: acc.created } : null, endpoints: MANAGE_ENDPOINTS });
    }
    if (path === 'keys' && method === 'GET') return json(res, 200, { keys: await store.listApiKeys(account) });
    if (path === 'keys' && method === 'POST') {
      const made = await makeKey(account, body);
      return 'error' in made ? json(res, 400, made) : json(res, 201, made);
    }
    if (path.endsWith('/rotate') && method === 'POST') {
      const rotated = await rotate(account, path.slice(5, -7));
      return 'error' in rotated ? json(res, 404, rotated) : json(res, 200, rotated);
    }
    if (path.startsWith('keys/') && method === 'DELETE') {
      const id = path.slice(5);
      return json(res, 200, { ok: await store.revokeApiKey(id, account) });
    }
    if (path === 'overview' && method === 'GET') {
      const range = RANGES[u.searchParams.get('range') ?? '7d'] ?? RANGES['7d']!;
      const now = Date.now();
      return json(res, 200, { range: { since: now - range.since, bucketMs: range.bucket }, now, keys: await store.listApiKeys(account), ...(await store.telemetryOverview(account, now - range.since, range.bucket)) });
    }
    if (path === 'stats' && method === 'GET') {
      const key = u.searchParams.get('key') ?? '';
      const range = RANGES[u.searchParams.get('range') ?? '7d'] ?? RANGES['7d']!;
      if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found', message: 'No key with that id in this account. List them with GET /api/v1/manage/keys.' });
      const now = Date.now();
      return json(res, 200, { key, range: { since: now - range.since, bucketMs: range.bucket }, now, ...(await store.telemetryStats(key, now - range.since, range.bucket)) });
    }
    if (path === 'feedback' && method === 'POST') {
      const key = typeof body?.key === 'string' ? body.key : '';
      const id = typeof body?.id === 'number' && Number.isInteger(body.id) ? body.id : 0;
      const verdict = body?.verdict === 'correct' || body?.verdict === 'wrong' ? body.verdict : null;
      if (!id || !(await store.apiKeyOwned(key, account))) return json(res, 400, { error: 'bad_feedback' });
      return json(res, 200, { ok: await store.setTelemetryFeedback(key, id, verdict, typeof body?.note === 'string' ? body.note.slice(0, 200) : null) });
    }
    if (path === 'proofs' && method === 'GET') {
      const key = u.searchParams.get('key') ?? '';
      if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
      return json(res, 200, await bundleFor(key, u));
    }
    if (path === 'health' && method === 'GET') {
      const key = u.searchParams.get('key') ?? '';
      if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
      return json(res, 200, await healthFor(key, u));
    }
    if (path === 'weekly' && method === 'GET') {
      const key = u.searchParams.get('key') ?? '';
      if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
      return json(res, 200, await weeklyFor(key));
    }
    if (path === 'events' && method === 'GET') {
      const key = u.searchParams.get('key') ?? '';
      if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
      const rows = await eventPage(key, u);
      return json(res, 200, { key, events: rows, more: rows.length === pageSize(u) });
    }
    const adminName = (await store.listAdminKeys(account)).find((k) => k.id === admin.id)?.name ?? 'key';
    if (await pol.manage(path, method, account, adminName, u, body, res)) return;
    return json(res, 404, { error: 'unknown_endpoint', endpoints: MANAGE_ENDPOINTS });
  };

  return { policy: pol, signup, login, logout, me, createKey, renameKey, lookupKey, revokeKey, rotateKey, deleteKey, changePassword, events, proofs, verifyBundle, feedback, health, weekly, listAdminKeys, createAdminKey, revokeAdminKey, stats, overview, ingest, manage };
}

export const MANAGE_ENDPOINTS = [
  'GET    /api/v1/manage/me                     — whose account this key administers',
  'GET    /api/v1/manage/keys                   — list project keys',
  'POST   /api/v1/manage/keys                   — create one {name, expiresInDays?: 0|7|30|90|365, env?: production|staging|development} → returns the raw key once',
  'POST   /api/v1/manage/keys/:id/rotate        — new secret for the same key → returns the raw key once',
  'DELETE /api/v1/manage/keys/:id               — revoke one',
  'GET    /api/v1/manage/overview?range=7d      — usage across every key',
  'GET    /api/v1/manage/stats?key=:id&range=7d — one key: sessions, agents, resources, recent decisions',
  'GET    /api/v1/manage/events?key=:id&range=7d&before=:id&limit=100 — the decision log, paged',
  'GET    /api/v1/manage/proofs?key=:id&range=30d[&session=:hash] — signed decision proofs + verifying keys (auditor bundle)',
  'GET    /api/v1/manage/health?key=:id&range=7d — integration check (reporting, browser signals, signatures, enforcement) + people stopped',
  'GET    /api/v1/manage/weekly?key=:id           — weekly report: this week vs last, new agents, what changed in the agents',
  'POST   /api/v1/manage/feedback                — {key, id, verdict: correct|wrong, note?} grade one reported decision (false-stop rate)',
  'GET    /api/v1/manage/policy?key=:id          — policy of one key: settings, changes waiting for approval, endpoints without a rule',
  'POST   /api/v1/manage/policy                  — {key, policy} propose a policy: applied at once, or held when the key requires approval or it weakens protection',
];

export type Check = { id: 'reporting' | 'browser' | 'signed' | 'enforcing'; status: 'ok' | 'warn' | 'off'; title: string; detail: string };

/** Plain-language lights for the integration page. Pure, so it is tested directly. */
export function integrationChecks(h: TelemetryHealth, now: number): Check[] {
  const ago = (t: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
  const checks: Check[] = [];
  if (!h.last) checks.push({ id: 'reporting', status: 'off', title: 'Server reporting', detail: 'No decision from this key yet. Put the key in ONEHUMAN_API_KEY and make one request to a protected endpoint.' });
  else if (now - h.last > 24 * 3600e3) checks.push({ id: 'reporting', status: 'warn', title: 'Server reporting', detail: `Last decision ${ago(h.last)}. If the app is live, check that ONEHUMAN_API_KEY is still set on the server.` });
  else checks.push({ id: 'reporting', status: 'ok', title: 'Server reporting', detail: `Last decision ${ago(h.last)} · ${h.events.toLocaleString('en-US')} in range.` });

  if (!h.sessions) checks.push({ id: 'browser', status: 'off', title: 'Browser signals', detail: 'Waits for the first session.' });
  else if (!h.sdkSessions) checks.push({ id: 'browser', status: 'warn', title: 'Browser signals', detail: 'The server decides, but no page sent browser signals, so agents can only be judged by their requests. Add <script src="/onehuman/sdk.js"></script> to the signed-in pages.' });
  else {
    const share = Math.round((h.sdkSessions / h.sessions) * 100);
    checks.push({ id: 'browser', status: share >= 50 ? 'ok' : 'warn', title: 'Browser signals', detail: share >= 50 ? `${share}% of sessions sent browser signals.` : `Only ${share}% of sessions sent browser signals. Some signed-in pages are missing the script tag, or API clients call protected endpoints directly.` });
  }

  if (!h.events) checks.push({ id: 'signed', status: 'off', title: 'Signed decisions', detail: 'Waits for the first decision.' });
  else if (!h.proofs) checks.push({ id: 'signed', status: 'warn', title: 'Signed decisions', detail: 'Decisions arrive without a signature. Update to the latest onehuman package.' });
  else if (h.proofsOk < h.proofs) checks.push({ id: 'signed', status: 'warn', title: 'Signed decisions', detail: `${h.proofs - h.proofsOk} of ${h.proofs} signatures did not verify. Every server instance must use the same ONEHUMAN_SECRET.` });
  else checks.push({ id: 'signed', status: 'ok', title: 'Signed decisions', detail: `${h.proofsOk.toLocaleString('en-US')} decisions signed and verified. Export them for an auditor from Activity.` });

  if (!h.enforcement) checks.push({ id: 'enforcing', status: 'off', title: 'Policy mode', detail: 'Waits for the first decision.' });
  else if (h.enforcement === 'observe') checks.push({ id: 'enforcing', status: 'warn', title: 'Policy mode', detail: 'Observe mode: every decision is recorded, nothing is blocked yet. Set "enforcement": "enforce" in the policy when the numbers look right.' });
  else checks.push({ id: 'enforcing', status: 'ok', title: 'Policy mode', detail: 'Enforcing: agents get the answer your policy gives them.' });
  return checks;
}

const DECISIONS = new Set(['allow', 'mask', 'block', 'step_up']);
const ACTORS = new Set(['human_like', 'agent_likely', 'unknown']);
const STATES = new Set(['signed_agent', 'agent_attached', 'agent_environment', 'no_indication']);
const ENFORCEMENT = new Set(['observe', 'enforce']);

export function parseEvent(x: unknown, now: number): TelemetryEvent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? Math.min(now + 60_000, Math.max(now - 30 * 24 * 3600e3, Math.round(o.at))) : now;
  const session = typeof o.session === 'string' && /^[a-f0-9]{8,32}$/.test(o.session) ? o.session : null;
  const resource = typeof o.resource === 'string' && SHORT.test(o.resource) ? o.resource : null;
  const decision = typeof o.decision === 'string' && DECISIONS.has(o.decision) ? o.decision : null;
  const actor = typeof o.actor === 'string' && ACTORS.has(o.actor) ? o.actor : 'unknown';
  const state = typeof o.state === 'string' && STATES.has(o.state) ? o.state : 'no_indication';
  const enforcement = typeof o.enforcement === 'string' && ENFORCEMENT.has(o.enforcement) ? o.enforcement : 'enforce';
  const version = typeof o.version === 'string' && SHORT.test(o.version) ? o.version : 'unknown';
  const tools = Array.isArray(o.tools) ? o.tools.filter((t): t is string => typeof t === 'string' && /^[a-z0-9_.\-]{1,40}$/i.test(t)).slice(0, 8) : [];
  const reasons = Array.isArray(o.reasons) ? o.reasons.filter((t): t is string => typeof t === 'string' && TOKEN.test(t)).slice(0, 8) : [];
  if (!session || !resource || !decision) return null;
  const proof = typeof o.proof === 'string' && o.proof.length <= 6000 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(o.proof) ? o.proof : null;
  const eid = typeof o.eid === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(o.eid) ? o.eid : null;
  return { at, session, resource, decision, actor, state, tools, reasons, enforcement, version, proof, eid };
}

/** Public keys a deployment reports with its events. The id is recomputed from the key, never trusted. */
export function parseProofKeys(x: unknown): ProofJwk[] {
  if (!Array.isArray(x)) return [];
  const out: ProofJwk[] = [];
  for (const k of x.slice(0, 4)) {
    if (!k || typeof k !== 'object') continue;
    const o = k as Record<string, unknown>;
    if (o.kty !== 'OKP' || o.crv !== 'Ed25519' || typeof o.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(o.x) || 'd' in o) continue;
    out.push({ kty: 'OKP', crv: 'Ed25519', x: o.x, kid: thumbprint(o.x), use: 'sig', alg: 'EdDSA' });
  }
  return out;
}
