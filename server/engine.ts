/**
 * The NanoTarget engine: everything a company's backend needs to make and
 * record a decision for one protected resource.
 *
 *   signals (untrusted, from SDK) + server observations (trusted)
 *        → assess()  → evaluate(policy) → audit (hash chain) → response
 *
 * `protect()` is a Node http adapter around `decide()`. Express-style
 * `(req, res)` handlers work with it unchanged.
 */
import { randomBytes } from 'node:crypto';
import { assess, type Assessment } from './assess.ts';
import { appendDecision } from './audit.ts';
import { classifyConnection, type Connection } from './connection.ts';
import { bus } from './bus.ts';
import type { DecisionRow, SessionRow, Store } from './db.ts';
import { cookies, headerGetter, json, url, type Req, type Res } from './http.ts';
import { DEFAULT_POLICY, evaluate, type Decision, type Policy } from './policy.ts';
import { parseSnapshot, type ClientSnapshot, type ServerSignal } from './signals.ts';
import { issueToken, verifyToken, type TokenCheck } from './tokens.ts';
import { observeRequest, type KeyLoader } from './web-bot-auth.ts';

export const STEP_UP_TTL_MS = 90000;
export const TOKEN_TTL_MS = 30000;
/** how long a WebAuthn user-verified assertion counts as "a person is here" */
export const HUMAN_RECLAIM_TTL_MS = 5 * 60000;
export const CHALLENGE_TTL_MS = 120000;

export type EngineOptions = {
  store: Store;
  secret?: Buffer;
  defaultPolicy?: Policy;
  keyLoader?: KeyLoader;
  sessionCookie?: string;
};

export type DecideInput = {
  room: string;
  session: SessionRow;
  resource: string;
  request: Req;
  /** snapshot carried with the request (X-NT-Sample) — untrusted */
  snapshot: ClientSnapshot | null;
};

export type DecideResult = {
  decision: DecisionRow;
  assessment: Assessment;
  server: ServerSignal;
  /** `webauthn`: a passkey is registered, the client should prefer the WebAuthn path; `reclaim`: the session is blocked as agent and only WebAuthn can reopen it */
  stepUp: { id: string; challenge: string; expiresAt: number; webauthn?: boolean; reclaim?: boolean } | null;
};

export type ProtectContext = {
  room: string;
  session: SessionRow;
  decision: DecisionRow;
  assessment: Assessment;
  /** true when the handler must return masked data */
  masked: boolean;
  /** issue a single-use token bound to this decision (for download URLs) */
  token(): string;
};

export class NanoTarget {
  readonly store: Store;
  readonly secret: Buffer;
  readonly defaultPolicy: Policy;
  readonly keyLoader: KeyLoader | undefined;
  readonly sessionCookie: string;
  /** requests carrying this token in X-NT-Lab-Simulated are lab simulations and are excluded from benchmarks */
  readonly simulationToken: string;
  /** when true, an agent-blocked resource advertises the WebAuthn reclaim path */
  webauthnReclaimEnabled = true;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.secret = opts.secret ?? randomBytes(32);
    this.defaultPolicy = opts.defaultPolicy ?? DEFAULT_POLICY;
    this.keyLoader = opts.keyLoader;
    this.sessionCookie = opts.sessionCookie ?? 'nt_sid';
    this.simulationToken = randomBytes(16).toString('hex');
  }

  /**
   * Connection classification for a session from its arrival request and the
   * latest passive snapshot. Records the first agent_attached / signed_agent
   * moment as an `attach` event. No user action is needed for this.
   */
  async connectionFor(session: SessionRow, now = Date.now()): Promise<Connection> {
    const recent = await this.store.recentSignals(session.id, now, 24 * 3600000, 0);
    const c = classifyConnection(session.arrival, recent.early);
    if (c.state === 'agent_attached' || c.state === 'signed_agent') {
      // Server time of the attach: the evidence's page-relative time mapped onto the session
      // start, never later than now (covers sessions re-evaluated after the fact).
      const at = c.atMs != null ? Math.min(now, session.created + c.atMs) : now;
      if (await this.store.markAgentAttached(session.id, at, c.atMs)) {
        await this.store.addEvent(session.room, session.id, 'attach', c, at);
        await this.store.markFirstAgent(session.id, at);
        bus.publish({ type: 'attach', room: session.room, session: session.id, at, sinceStartMs: at - session.created, connection: c });
      }
    }
    return c;
  }

  async policyFor(room: string): Promise<Policy> {
    const saved = await this.store.currentPolicy(room);
    if (saved) return saved;
    const app = await this.store.roomApp(room);
    return this.defaultPolicyFor(app ?? 'bank');
  }

  /** Default policy per simulated application; overridden by `policyForApp` when set. */
  policyForApp: ((app: string) => Policy | null) | null = null;
  defaultPolicyFor(app: string): Policy {
    return this.policyForApp?.(app) ?? this.defaultPolicy;
  }

  /** Server-side observation of one request (signature, fetch metadata). */
  observe(req: Req): Promise<ServerSignal> {
    return observeRequest({ method: req.method ?? 'GET', url: url(req).href, headers: headerGetter(req) }, {
      keyLoader: this.keyLoader,
      consumeNonce: (key, ttl) => this.store.consumeNonce(key, ttl),
    });
  }

  /**
   * Resolve the lab session. The page-bound X-NT-Session header wins over the profile-wide
   * cookie, so two tabs in one browser profile never report under each other's session.
   * Production replaces this with the application's own authenticated session lookup.
   */
  async resolveSession(req: Req): Promise<{ room: string; session: SessionRow } | null> {
    const header = req.headers['x-nt-session'];
    const fromHeader = typeof header === 'string' && /^[0-9a-f-]{36}$/i.test(header) ? header : null;
    const sid = fromHeader ?? cookies(req)[this.sessionCookie];
    if (!sid) return null;
    const session = await this.store.getSession(sid);
    if (!session || !(await this.store.roomExists(session.room))) return null;
    const room = url(req).searchParams.get('room');
    if (room && room !== session.room) return null;
    return { room: session.room, session };
  }

  /** Parse the untrusted snapshot header. Malformed → null (treated as no telemetry). */
  snapshotFrom(req: Req): ClientSnapshot | null {
    const raw = req.headers['x-nt-sample'];
    if (typeof raw !== 'string' || raw.length > 12000) return null;
    try {
      return parseSnapshot(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Store a snapshot as events and return the current assessment (no decision, no audit). */
  async ingest(room: string, session: SessionRow, snapshot: ClientSnapshot, now = Date.now()): Promise<{ assessment: Assessment; connection: Connection }> {
    if (snapshot.early) await this.store.addEvent(room, session.id, 'signal', snapshot.early, now);
    // first report of on-screen redaction by the SDK: keep it as its own timeline event
    if (snapshot.early?.reading.seal && !(await this.store.hasEvent(session.id, 'seal'))) await this.store.addEvent(room, session.id, 'seal', snapshot.early.reading.seal, now);
    if (snapshot.interaction) await this.store.addEvent(room, session.id, 'interaction', snapshot.interaction, now);
    await this.store.touchSession(session.id, now);
    const connection = await this.connectionFor(session, now);
    const recent = await this.store.recentSignals(session.id, now, 120000, 6);
    const assessment = assess({ server: session.arrival, early: recent.early, interactions: recent.interactions, current: null });
    if (assessment.actor === 'agent_likely') await this.store.markFirstAgent(session.id, now);
    return { assessment, connection };
  }

  async decide(input: DecideInput, now = Date.now()): Promise<DecideResult> {
    const t0 = performance.now();
    const thisRequest = await this.observe(input.request);
    // The stronger of "this request" and "how the session arrived".
    const arrival = input.session.arrival;
    const sigStatus = thisRequest.signature.status;
    // A request arriving now from an AI application's built-in browser is environment evidence now, even if
    // the session was opened from a normal browser (shared login across tabs/devices via identify()).
    const env = thisRequest.environment?.agentAppToken ? thisRequest.environment : arrival?.environment ?? thisRequest.environment;
    const server: ServerSignal = sigStatus === 'verified' || sigStatus === 'replay' || !arrival ? thisRequest : { ...arrival, environment: env, checkedMs: thisRequest.checkedMs };

    if (input.snapshot?.early) await this.store.addEvent(input.room, input.session.id, 'signal', input.snapshot.early, now);
    if (input.snapshot?.interaction) await this.store.addEvent(input.room, input.session.id, 'interaction', input.snapshot.interaction, now);
    await this.store.touchSession(input.session.id, now);
    const simulated = input.request.headers['x-nt-lab-simulated'] === this.simulationToken;
    if (!simulated) await this.connectionFor(input.session, now);
    // Once an agent has attached to this session, the fact sticks: a control indicator that
    // disappeared (agent paused, or a person took over) does not make the session clean again.
    // The only way back is a WebAuthn user-verified assertion (a person pressed Touch ID / a
    // passkey) — and that reclaim covers a short window, after which the agent evidence returns.
    const fresh = await this.store.getSession(input.session.id);
    const attachedEarlier = fresh?.agentAttachedAt ?? null;
    const reclaimed = fresh?.humanVerifiedAt != null && now - fresh.humanVerifiedAt <= HUMAN_RECLAIM_TTL_MS && (attachedEarlier === null || fresh.humanVerifiedAt > attachedEarlier);
    const recent = await this.store.recentSignals(input.session.id, now, 120000, 6);
    const assessment = assess({ server, early: recent.early, interactions: recent.interactions, current: null, attachedEarlierMs: attachedEarlier === null || reclaimed ? null : attachedEarlier - input.session.created, humanVerified: reclaimed });

    const policy = await this.policyFor(input.room);
    let decision: Decision = evaluate(policy, input.resource, assessment, crypto.randomUUID());
    let stepUp: DecideResult['stepUp'] = null;
    if (decision.decision === 'step_up' || (decision.decision === 'block' && decision.branch === 'agent' && !reclaimed && this.webauthnReclaimEnabled)) {
      if (await this.store.consumeStepUpGrant(input.session.id, input.resource, now)) {
        decision = { ...decision, decision: 'allow', reasonCodes: [...decision.reasonCodes, 'STEP_UP_PASSED'] };
      } else if (decision.decision === 'step_up') {
        const challenge = randomBytes(3).toString('hex').toUpperCase();
        const id = await this.store.createStepUp(input.session.id, input.resource, challenge, STEP_UP_TTL_MS, now);
        stepUp = { id, challenge, expiresAt: now + STEP_UP_TTL_MS, webauthn: (await this.store.credentialsForRoom(input.room)).length > 0 };
      } else {
        // blocked as agent: offer the WebAuthn reclaim path in the response, decision stays block
        stepUp = { id: '', challenge: '', expiresAt: now + STEP_UP_TTL_MS, webauthn: true, reclaim: true };
      }
    }

    const row = await appendDecision(this.store, {
      ...decision,
      room: input.room,
      session: input.session.id,
      latencyMs: Math.round((performance.now() - t0) * 10) / 10,
      dataDelivered: decision.decision === 'allow',
      simulated,
      assessment,
      created: now,
    });
    if (row.dataDelivered && !simulated) await this.store.markFirstData(input.session.id, now);
    if (assessment.actor === 'agent_likely' && !simulated) await this.store.markFirstAgent(input.session.id, now);
    bus.publish({ type: 'decision', room: input.room, session: input.session.id, at: now, id: row.id, resource: row.resource, decision: row.decision, actor: row.actor, reasonCodes: row.reasonCodes });
    return { decision: row, assessment, server, stepUp };
  }

  issueToken(decision: DecisionRow): string {
    return issueToken(this.secret, { session: decision.session, resource: decision.resource, decision: decision.decision, decisionId: decision.id }, TOKEN_TTL_MS);
  }

  /** Verify and consume a single-use token. */
  async redeemToken(token: string, session: string, resource: string): Promise<TokenCheck | { ok: false; reason: 'reused' }> {
    const check = verifyToken(this.secret, token, { session, resource });
    if (!check.ok) return check;
    if (!(await this.store.consumeNonce(`jti:${check.claims.jti}`, Math.max(1000, check.claims.exp - Date.now() + 1000)))) return { ok: false, reason: 'reused' };
    return check;
  }

  /**
   * Node http adapter. Resolves the session, decides, writes the audit row and
   * either responds (block / step-up) or calls the handler with the context.
   */
  protect(resource: string, handler: (req: Req, res: Res, ctx: ProtectContext) => void | Promise<void>) {
    return async (req: Req, res: Res): Promise<void> => {
      const resolved = await this.resolveSession(req);
      if (!resolved) {
        json(res, 401, { error: 'no_session', message: 'Sessiya tapılmadı. Səhifəni yenidən aç.' });
        return;
      }
      const result = await this.decide({ room: resolved.room, session: resolved.session, resource, request: req, snapshot: this.snapshotFrom(req) });
      const { decision, assessment } = result;
      const headers = { 'X-NT-Decision': decision.id, 'X-NT-Policy': decision.policyVersion };
      if (decision.decision === 'block') {
        json(res, 403, { error: 'blocked', resource, decision: publicDecision(decision), assessment, stepUp: result.stepUp }, headers);
        return;
      }
      if (decision.decision === 'step_up') {
        json(res, 428, { error: 'step_up_required', resource, decision: publicDecision(decision), assessment, stepUp: result.stepUp }, headers);
        return;
      }
      res.setHeader('X-NT-Decision', decision.id);
      res.setHeader('X-NT-Policy', decision.policyVersion);
      await handler(req, res, {
        room: resolved.room,
        session: resolved.session,
        decision,
        assessment,
        masked: decision.decision === 'mask',
        token: () => this.issueToken(decision),
      });
    };
  }
}

/** What a client may see about a decision (the audit row keeps more). */
export function publicDecision(d: DecisionRow) {
  return {
    id: d.id,
    resource: d.resource,
    decision: d.decision,
    computed: d.computed,
    enforced: d.enforced,
    branch: d.branch,
    actor: d.actor,
    score: d.score,
    tiers: d.tiers,
    reasonCodes: d.reasonCodes,
    policyVersion: d.policyVersion,
    signalVersion: d.signalVersion,
    latencyMs: d.latencyMs,
    created: d.created,
  };
}
