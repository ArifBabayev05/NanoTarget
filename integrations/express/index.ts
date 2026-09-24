/**
 * NanoTarget for Express / Connect / plain Node http.
 *
 *   import { nanotarget } from 'nanotarget/express';
 *   const nt = await nanotarget({ secret: process.env.NT_SECRET, policy: './nanotarget.policy.json', db: 'sqlite:./nanotarget.db' });
 *   app.use(nt.middleware());                       // serves /nanotarget/sdk.js + the SDK's API
 *   app.get('/api/balance', nt.protect('balance.read'), (req, res) => nt.send(req, res, balance, maskBalance));
 *
 * The company keeps full control: the policy is its JSON file, `mask` is its own function, the decision
 * arrives on `req.nt` and nothing here touches its authentication. Storage is local (sqlite) or libSQL, so the
 * package runs on-prem; telemetry never has to leave the company's network.
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Assessment } from '../../server/assess.ts';
import { Store, type DecisionRow, type SessionRow } from '../../server/db.ts';
import { NanoTarget, publicDecision, type DecideResult } from '../../server/engine.ts';
import { attachModel } from '../../server/kinematics.ts';
import { loadModel, predict } from '../../server/kinematics-model.ts';
import { cookies, json, url } from '../../server/http.ts';
import { parsePolicy, type Policy } from '../../server/policy.ts';
import { labRoutes } from '../../server/routes/lab.ts';
import { webauthnRoutes } from '../../server/routes/webauthn.ts';
import { libsqlClient, sqliteClient, type SqlClient } from '../../server/sql.ts';
import { proofBundle, verifyProof, type ProofJwk } from '../../server/proof.ts';

export type Req = IncomingMessage & { nt?: ProtectResult };
export type Res = ServerResponse;
export type Next = (err?: unknown) => void;

export type NanoTargetOptions = {
  /** path to the policy JSON file, or the policy object itself */
  policy: string | Policy;
  /** ≥ 32 bytes; signs single-use tokens and derives the tenant room id — keep it stable across restarts */
  secret: string | Buffer;
  /** 'memory' | 'sqlite:./nanotarget.db' | 'file:./nanotarget.db' | 'libsql://host?authToken=…'  (default sqlite:./nanotarget.db) */
  db?: string;
  /** where the SDK and its API live (default '/nanotarget') */
  basePath?: string;
  /**
   * Map a request to the company's own authenticated session / user id. When given, every tab of one
   * login shares one NanoTarget session (an agent in one tab marks the whole login). When omitted, a
   * first-party cookie identifies the browser.
   */
  identify?: (req: IncomingMessage) => string | null | undefined | Promise<string | null | undefined>;
  /** cookie name (default 'nt_sid') */
  cookie?: string;
  /** set the Secure flag on the cookie; default: when the request is https or behind x-forwarded-proto=https */
  secure?: boolean;
  /** tenant name; one persistent room per tenant (default 'default') */
  tenant?: string;
  /** protect() answers block (403) and step_up (428) itself; set false to handle them in your handler (default true) */
  respond?: boolean;
  /** show the WebAuthn "I am human" reclaim path on agent blocks (default true) */
  webauthnReclaim?: boolean;
  /**
   * Report decisions to your NanoTarget portal (https://nanotarget-mvp.vercel.app/portal) so you can see how
   * many of your sessions had an AI agent in them. Metadata only — hashed session id, resource, decision,
   * actor, connection state, detected tools, reason codes. Never payloads, identities or IPs.
   * Default: process.env.NT_API_KEY. Without a key nothing leaves your server.
   */
  apiKey?: string;
  /** where reports go (default https://nanotarget-mvp.vercel.app/api/v1/ingest, or NT_TELEMETRY_URL) */
  telemetryUrl?: string;
};

export type ProtectResult = {
  /** allow | mask | block | step_up */
  decision: DecisionRow['decision'];
  /** true → return the masked variant of the data */
  masked: boolean;
  blocked: boolean;
  stepUp: DecideResult['stepUp'];
  actor: Assessment['actor'];
  score: number | null;
  reasonCodes: string[];
  session: SessionRow;
  full: DecisionRow;
  assessment: Assessment;
  /** single-use token bound to this decision (for download URLs) */
  token(): string;
  /**
   * Signed proof of this decision (compact JWS, EdDSA). Server-side only — nothing is added to the
   * response the end user receives. Keep it with your own records if you want; the engine stores it too.
   */
  proof: string | null;
};

const HERE = dirname(fileURLToPath(import.meta.url));
// repo layout: integrations/express/index.ts → ../../sdk ; published layout: dist/express.js → ../sdk
const SDK_PATH = [join(HERE, '..', 'sdk', 'nanotarget.js'), join(HERE, '..', '..', 'sdk', 'nanotarget.js')].find((p) => existsSync(p)) ?? join(HERE, '..', 'sdk', 'nanotarget.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function openClient(db: string): Promise<SqlClient> {
  if (db === 'memory' || db === ':memory:') return sqliteClient(':memory:');
  if (db.startsWith('libsql://') || db.startsWith('https://')) {
    const u = new URL(db);
    const token = u.searchParams.get('authToken') ?? process.env.TURSO_AUTH_TOKEN;
    u.searchParams.delete('authToken');
    return libsqlClient(u.toString(), token ?? undefined);
  }
  const path = db.replace(/^(sqlite|file):/, '');
  return sqliteClient(isAbsolute(path) ? path : resolve(process.cwd(), path));
}

/** RFC 4122-shaped id from an HMAC, so ids are deterministic per (secret, name) and pass the engine's UUID checks. */
function derivedUuid(secret: Buffer, kind: string, name: string): string {
  const h = createHmac('sha256', secret).update(`${kind}\0${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type TelemetryEvent = { at: number; session: string; resource: string; decision: string; actor: string; state: string; tools: string[]; reasons: string[]; enforcement: string; version: string; proof?: string };

/** Buffers decision events and posts them to the portal in the background. Drops rather than blocks. */
function createReporter(apiKey: string, endpoint: string, keys: ProofJwk[]) {
  let queue: TelemetryEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let sending = false;
  let failures = 0;
  const MAX = 500, BATCH = 25, EVERY_MS = 3000;
  async function flush(): Promise<void> {
    if (sending || !queue.length) return;
    if (failures && Date.now() < backoffUntil) return;
    sending = true;
    const batch = queue.splice(0, 100);   // a signed event is ~1 KB; 100 stays well under the ingest limit
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ events: batch, keys }), signal: AbortSignal.timeout(5000) });
      if (r.status === 401) { failures = 999; console.warn('nanotarget: telemetry API key rejected — check apiKey / NT_API_KEY'); queue = []; }
      else if (!r.ok) throw new Error(String(r.status));
      else failures = 0;
    } catch {
      failures++; backoffUntil = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(failures, 5));
      queue = [...batch, ...queue].slice(-MAX);   // keep the newest
    } finally { sending = false; }
  }
  let backoffUntil = 0;
  function push(e: TelemetryEvent) {
    if (failures >= 999) return;
    queue.push(e); if (queue.length > MAX) queue = queue.slice(-MAX);
    if (queue.length >= BATCH) void flush();
    if (!timer) { timer = setInterval(() => { void flush(); }, EVERY_MS); timer.unref?.(); }
  }
  return { push, flush, get pending() { return queue.length; }, close() { if (timer) clearInterval(timer); timer = null; return flush(); } };
}

export async function nanotarget(opts: NanoTargetOptions) {
  const secret = Buffer.isBuffer(opts.secret) ? opts.secret : Buffer.from(opts.secret, 'utf8');
  if (secret.length < 32) throw new Error('nanotarget: secret must be at least 32 bytes');
  const basePath = (opts.basePath ?? '/nanotarget').replace(/\/$/, '');
  const cookieName = opts.cookie ?? 'nt_sid';
  const tenant = opts.tenant ?? 'default';
  const respond = opts.respond ?? true;
  const apiKey = opts.apiKey ?? process.env.NT_API_KEY ?? '';
  const sessionHash = (id: string) => createHash('sha256').update(apiKey).update('\0').update(id).digest('hex').slice(0, 16);

  const store = await Store.open(await openClient(opts.db ?? 'sqlite:./nanotarget.db'));
  const model = await loadModel();
  attachModel(model ? { predict: (f) => predict(model, f), humanAbove: model.humanAbove, syntheticBelow: model.syntheticBelow } : null);
  const engine = new NanoTarget({ store, secret, sessionCookie: cookieName });
  const reporter = apiKey ? createReporter(apiKey, opts.telemetryUrl ?? process.env.NT_TELEMETRY_URL ?? 'https://nanotarget-mvp.vercel.app/api/v1/ingest', engine.proofKeys().keys) : null;
  engine.webauthnReclaimEnabled = opts.webauthnReclaim ?? true;
  const room = derivedUuid(secret, 'room', tenant);
  await store.ensureRoom(room, `tenant:${tenant}`);

  let policy: Policy = await loadPolicy(opts.policy);
  engine.policyForApp = () => policy;
  async function loadPolicy(src: string | Policy): Promise<Policy> {
    const raw = typeof src === 'string' ? JSON.parse(await readFile(src, 'utf8')) : src;
    const version = typeof raw?.version === 'string' ? raw.version : `policy-${tenant}-${Date.now()}`;
    const parsed = parsePolicy(raw, version);
    if (!parsed) throw new Error('nanotarget: policy file is invalid (see docs/INTEGRATION.md for the schema)');
    return parsed;
  }
  /** Re-read the policy file (e.g. on SIGHUP or from an admin endpoint). */
  async function reloadPolicy() { policy = await loadPolicy(opts.policy); return policy; }

  const isSecure = (req: IncomingMessage) => opts.secure ?? (url(req).protocol === 'https:' || req.headers['x-forwarded-proto'] === 'https');
  const setCookie = (req: IncomingMessage, res: ServerResponse, id: string) => {
    const prev = res.getHeader('Set-Cookie');
    const value = `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Lax${isSecure(req) ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', Array.isArray(prev) ? [...prev, value] : prev ? [String(prev), value] : value);
  };

  /** The NanoTarget session for this request: derived from `identify()` or from the first-party cookie. Creates it on first sight. */
  async function sessionFor(req: IncomingMessage, res: ServerResponse): Promise<SessionRow> {
    const identity = opts.identify ? await opts.identify(req) : null;
    if (identity) {
      const id = derivedUuid(secret, 'session', String(identity));
      const existing = await store.getSession(id);
      if (existing) { if (cookies(req)[cookieName] !== id) setCookie(req, res, id); return existing; }
      const s = await store.ensureSession(id, room, await engine.observe(req));
      setCookie(req, res, id);
      return s;
    }
    const fromCookie = cookies(req)[cookieName];
    if (fromCookie && UUID.test(fromCookie)) { const s = await store.getSession(fromCookie); if (s && s.room === room) return s; }
    const id = await store.createSession(room, 'unlabelled', await engine.observe(req));
    if (!id) throw new Error('nanotarget: session limit reached');
    setCookie(req, res, id);
    return (await store.getSession(id))!;
  }

  const lab = labRoutes(engine, null);
  const wa = webauthnRoutes(engine);
  const api: Record<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>> = {
    'POST /signals': lab.signals,
    'GET /connection': lab.connection,
    'GET /session': lab.me,
    'POST /step-up': lab.stepUp,
    'POST /webauthn/register/options': wa.registerOptions,
    'POST /webauthn/register': wa.register,
    'POST /webauthn/assert/options': wa.assertOptions,
    'POST /webauthn/assert': wa.assert,
    'GET /webauthn/status': wa.status,
  };
  let sdkCache: Buffer | null = null;

  /** Serves `${basePath}/sdk.js` and the SDK's API; everything else passes through. */
  function middleware() {
    return async (req: Req, res: Res, next: Next) => {
      try {
        const u = url(req);
        if (!u.pathname.startsWith(basePath + '/')) return next();
        const sub = u.pathname.slice(basePath.length);
        if (sub === '/sdk.js' && req.method === 'GET') {
          sdkCache ??= await readFile(SDK_PATH);
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Content-Length': sdkCache.length });
          res.end(sdkCache);
          return;
        }
        // the public key that verifies this deployment's decision proofs — an auditor fetches it from here
        if (sub === '/proof-keys' && req.method === 'GET') {
          const body = JSON.stringify(engine.proofKeys());
          res.writeHead(200, { 'Content-Type': 'application/jwk-set+json', 'Cache-Control': 'public, max-age=3600', 'Content-Length': Buffer.byteLength(body) });
          res.end(body);
          return;
        }
        const handler = api[`${req.method} ${sub}`];
        if (!handler) return next();
        // the engine's routes resolve the session from the request cookie; with identify() (or on a very first
        // request) that cookie may only exist on the response, so it is made visible on the request too
        const session = await sessionFor(req, res);
        if (cookies(req)[cookieName] !== session.id) req.headers.cookie = `${req.headers.cookie ? req.headers.cookie + '; ' : ''}${cookieName}=${session.id}`;
        await handler(req, res);
      } catch (e) { next(e); }
    };
  }

  /** Decide for `resource`; the result is on `req.nt`. Block → 403, step-up → 428 (unless `respond: false`). */
  function protect(resource: string, local: { respond?: boolean } = {}) {
    const answer = local.respond ?? respond;
    return async (req: Req, res: Res, next: Next) => {
      try {
        const session = await sessionFor(req, res);
        const result = await engine.decide({ room, session, resource, request: req, snapshot: engine.snapshotFrom(req) });
        const d = result.decision;
        req.nt = {
          decision: d.decision, masked: d.decision === 'mask', blocked: d.decision === 'block', stepUp: result.stepUp,
          actor: d.actor, score: d.score, reasonCodes: d.reasonCodes, session, full: d, assessment: result.assessment,
          token: () => engine.issueToken(d), proof: result.proof,
        };
        res.setHeader('X-NT-Decision', d.id);
        res.setHeader('X-NT-Policy', d.policyVersion);
        if (reporter) report(session, resource, d, result);
        if (answer && d.decision === 'block') return json(res, 403, { error: 'blocked', resource, decision: publicDecision(d), stepUp: result.stepUp });
        if (answer && d.decision === 'step_up') return json(res, 428, { error: 'step_up_required', resource, decision: publicDecision(d), stepUp: result.stepUp });
        next();
      } catch (e) { next(e); }
    };
  }

  /** One event per decision, off the request path: what happened, to which resource, who was acting, which tool. */
  function report(session: SessionRow, resource: string, d: DecisionRow, result: DecideResult) {
    if (!reporter) return;
    engine.connectionFor(session).then((c) => {
      reporter.push({
        at: Date.now(), session: sessionHash(session.id), resource, decision: d.decision, actor: d.actor, state: c.state,
        tools: c.tools.slice(0, 8), reasons: d.reasonCodes.slice(0, 8), enforcement: policy.enforcement, version: result.assessment.version,
        ...(result.proof ? { proof: result.proof } : {}),
      });
    }).catch(() => {});
  }

  /** Respond with `full`, or with `mask(full)` when the decision says mask. Adds the decision summary under `_nt`. */
  function send<T>(req: Req, res: Res, full: T, mask: (full: T) => unknown) {
    const nt = req.nt;
    const body = nt?.masked ? mask(full) : full;
    json(res, 200, { ...(body as object), _nt: nt ? { decision: nt.decision, actor: nt.actor, score: nt.score, reasonCodes: nt.reasonCodes } : null });
  }

  /** the background reporter (null without an apiKey): `await nt.telemetry?.flush()` before exit if you want the last events delivered */
  const telemetry = reporter ? { flush: () => reporter.flush(), get pending() { return reporter.pending; } } : null;
  // --- proofs: what a business hands an auditor --------------------------------------------------
  /** the JWK Set that verifies this deployment's proofs (also served at `${basePath}/proof-keys`) */
  const proofKeys = () => engine.proofKeys();
  /** the signed proof of one decision, by its id (`req.nt.full.id`, or the `X-NT-Decision` header you log) */
  const proofFor = (decisionId: string) => store.decisionProof(decisionId);
  /** every signed decision for one session, as a self-contained file an auditor can check offline */
  async function proofBundleFor(sessionId: string) {
    const rows = await store.sessionProofs(sessionId);
    return proofBundle(rows.map((r) => r.proof), engine.proofKeys().keys, { session: sessionId, decisions: rows.length });
  }
  /** check a proof against this deployment's key — or pass `keys` to check one from another deployment */
  const checkProof = (jws: string, keys = engine.proofKeys().keys) => verifyProof(jws, keys);

  return { middleware, protect, send, sessionFor, reloadPolicy, get policy() { return policy; }, engine, store, room, basePath, telemetry,
    proofKeys, proofFor, proofBundle: proofBundleFor, verifyProof: checkProof,
    close: async () => { await reporter?.close(); store.close(); } };
}

export type NanoTargetInstance = Awaited<ReturnType<typeof nanotarget>>;

// Express users get `req.nt` typed without importing anything else.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { nt?: ProtectResult }
  }
}
