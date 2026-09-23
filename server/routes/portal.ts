/**
 * Customer portal + telemetry ingest.
 *
 * A customer signs up, creates API keys (one per project), puts a key into `nanotarget({ apiKey })`,
 * and the middleware reports every decision here — metadata only: hashed session, resource, decision,
 * actor, connection state, detected tools, reason codes. The portal turns that into the one number a
 * security team has never had: how many of their logged-in sessions had an AI agent in them.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NanoTarget } from '../engine.ts';
import { cookies, json, readJson, sameOrigin, url, type Req, type Res } from '../http.ts';
import type { TelemetryEvent } from '../db.ts';

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

export function portalRoutes(engine: NanoTarget, opts: { secure: (req: Req) => boolean }) {
  const store = engine.store;
  const setSession = (req: Req, res: Res, id: string | null) =>
    res.setHeader('Set-Cookie', id
      ? `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${opts.secure(req) ? '; Secure' : ''}`
      : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  const accountOf = async (req: Req): Promise<string | null> => {
    const sid = cookies(req)[COOKIE];
    return sid ? store.portalSession(sid) : null;
  };
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
    const name = typeof b?.name === 'string' && NAME.test(b.name.trim()) ? b.name.trim() : 'Default';
    if ((await store.listApiKeys(account)).filter((k) => !k.revoked).length >= 20) return json(res, 400, { error: 'too_many', message: 'Revoke a key before creating another (limit 20).' });
    const k = newApiKey();
    const id = await store.createApiKey(account, name, k.prefix, k.hash);
    // the raw key is shown exactly once; only its hash is stored
    json(res, 201, { id, name, prefix: k.prefix, key: k.raw });
  };

  const revokeKey = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const b = (await readJson(req, 2000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const id = typeof b?.id === 'string' ? b.id : '';
    json(res, 200, { ok: await store.revokeApiKey(id, account) });
  };

  const stats = async (req: Req, res: Res) => {
    const account = await accountOf(req);
    if (!account) return json(res, 401, { error: 'unauthenticated' });
    const u = url(req);
    const key = u.searchParams.get('key') ?? '';
    const range = RANGES[u.searchParams.get('range') ?? '7d'] ?? RANGES['7d']!;
    if (!(await store.apiKeyOwned(key, account))) return json(res, 404, { error: 'not_found' });
    const now = Date.now();
    json(res, 200, { key, range: { since: now - range.since, bucketMs: range.bucket }, now, ...(await store.telemetryStats(key, now - range.since, range.bucket)) });
  };

  /** POST /api/v1/ingest — Authorization: Bearer nt_live_…; body { events: [...] } */
  const ingest = async (req: Req, res: Res) => {
    const auth = (req.headers.authorization ?? '').toString();
    const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!/^nt_live_[a-f0-9]{40}$/.test(raw)) return json(res, 401, { error: 'bad_key' });
    const key = await store.apiKeyByHash(hashKey(raw));
    if (!key || key.revoked) return json(res, 401, { error: 'bad_key' });
    const now = Date.now();
    const w = ingestWindow.get(key.id);
    if (w && now - w.at < 60_000) { if (w.n >= 120) return json(res, 429, { error: 'rate_limited' }); w.n++; } else ingestWindow.set(key.id, { n: 1, at: now });
    const b = (await readJson(req, 200_000).catch(() => null)) as Record<string, unknown> | null | undefined;
    const list = Array.isArray(b?.events) ? (b!.events as unknown[]).slice(0, 200) : null;
    if (!list) return json(res, 400, { error: 'bad_body', message: 'Send { events: [...] }.' });
    const events: TelemetryEvent[] = [];
    for (const e of list) {
      const ev = parseEvent(e, now);
      if (ev) events.push(ev);
    }
    await store.insertTelemetry(key.id, events, now);
    json(res, 202, { accepted: events.length, dropped: list.length - events.length });
  };

  return { signup, login, logout, me, createKey, revokeKey, stats, ingest };
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
  return { at, session, resource, decision, actor, state, tools, reasons, enforcement, version };
}
