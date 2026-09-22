/**
 * Storage (SQLite dialect) over a SqlClient: node:sqlite locally, libSQL/Turso
 * in serverless deployments. All methods are async.
 *
 * Retention: rooms live 7 days, at most 400 sessions and 2000 events per room.
 * Nothing here stores IPs, user agents, typed text or cookies.
 */
import type { Assessment } from './assess.ts';
import type { Decision, Policy } from './policy.ts';
import type { ClientSnapshot, ServerSignal } from './signals.ts';
import { sqliteClient, type SqlArg, type SqlClient } from './sql.ts';

export const ROOM_TTL_MS = 7 * 86400000;
export const MAX_SESSIONS_PER_ROOM = 400;
export const MAX_EVENTS_PER_ROOM = 2000;

export type SessionRow = {
  id: string;
  room: string;
  label: 'human' | 'agent' | 'unlabelled';
  /** benchmark scenario slug declared in the URL (e.g. "chrome-keyboard-only"); a declaration, never a classifier input */
  scenario: string;
  created: number;
  arrival: ServerSignal | null;
  firstDataAt: number | null;
  firstAgentAt: number | null;
  /** server time when the connection classifier first said agent_attached / signed_agent */
  agentAttachedAt: number | null;
  /** client ms-since-page-start of the evidence that flipped the state */
  agentAttachedClientMs: number | null;
  /** server time of the last successful WebAuthn user-verified assertion (a person reclaimed the session) */
  humanVerifiedAt: number | null;
  lastSeen: number;
};

export type EventRow = {
  id: number;
  room: string;
  session: string;
  kind: 'arrival' | 'signal' | 'interaction' | 'attach' | 'seal';
  payload: unknown;
  created: number;
};

export type DecisionRow = Decision & {
  room: string;
  session: string;
  latencyMs: number;
  dataDelivered: boolean;
  /** produced by the lab's own signed-request simulation; excluded from benchmark statistics */
  simulated: boolean;
  assessment: Assessment;
  created: number;
  prevHash: string;
  hash: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, created INTEGER NOT NULL, app TEXT NOT NULL DEFAULT 'bank');
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'unlabelled',
  scenario TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  arrival TEXT,
  first_data_at INTEGER,
  first_agent_at INTEGER,
  agent_attached_at INTEGER,
  agent_attached_client_ms INTEGER,
  human_verified_at INTEGER,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_room ON sessions(room, created);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events(session, id);
CREATE INDEX IF NOT EXISTS events_room ON events(room, id);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  created INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_room ON decisions(room, seq);
CREATE TABLE IF NOT EXISTS policies (
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  body TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (room, version)
);
CREATE TABLE IF NOT EXISTS nonces (key TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stepups (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires INTEGER NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_room ON credentials(room);
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  task TEXT NOT NULL,
  ua TEXT NOT NULL,
  click TEXT NOT NULL,
  features TEXT NOT NULL,
  verdict TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS samples_label ON samples(label, created);
CREATE INDEX IF NOT EXISTS samples_client ON samples(client, id);
CREATE TABLE IF NOT EXISTS training_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  ua TEXT NOT NULL,
  early TEXT NOT NULL,
  steps TEXT NOT NULL,
  summary TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS training_sessions_client ON training_sessions(client);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  resource TEXT,
  expires INTEGER NOT NULL
);
`;

/** additive migrations for databases created by earlier builds */
const MIGRATIONS = [
  'ALTER TABLE sessions ADD COLUMN agent_attached_at INTEGER',
  'ALTER TABLE sessions ADD COLUMN agent_attached_client_ms INTEGER',
  "ALTER TABLE sessions ADD COLUMN scenario TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE sessions ADD COLUMN human_verified_at INTEGER',
  "ALTER TABLE rooms ADD COLUMN app TEXT NOT NULL DEFAULT 'bank'",
];

export class Store {
  readonly sql: SqlClient;
  private constructor(sql: SqlClient) { this.sql = sql; }

  /** Open a store on a client and make sure the schema exists. */
  static async open(client?: SqlClient, opts: { migrate?: boolean } = {}): Promise<Store> {
    const c = client ?? (await sqliteClient(':memory:'));
    // One round trip decides whether the schema exists; cold starts on a ready database then skip
    // the CREATE/ALTER statements (each of which is a network round trip on libSQL).
    const ready = (await c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rooms','challenges','samples','training_sessions')")).rows.length === 4;
    if (!ready || opts.migrate) {
      await c.executeMultiple(SCHEMA);
      for (const m of MIGRATIONS) { try { await c.execute(m); } catch { /* column exists */ } }
    }
    return new Store(c);
  }

  close() {
    this.sql.close();
  }

  /** Test helper: run a raw statement. */
  exec(sqlText: string, args: SqlArg[] = []) {
    return this.sql.execute(sqlText, args);
  }

  // --- rooms ---------------------------------------------------------------
  async createRoom(now = Date.now(), app = 'bank'): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql.batch([
      { sql: "DELETE FROM rooms WHERE created < ? AND app NOT LIKE 'tenant:%'", args: [now - ROOM_TTL_MS] },
      { sql: 'INSERT INTO rooms (id, created, app) VALUES (?, ?, ?)', args: [id, now, app] },
    ]);
    return id;
  }

  async roomExists(id: string, now = Date.now()): Promise<boolean> {
    // lab rooms expire; a tenant's room (integration package) never does
    return (await this.sql.execute("SELECT 1 AS x FROM rooms WHERE id = ? AND (created > ? OR app LIKE 'tenant:%')", [id, now - ROOM_TTL_MS])).rows.length > 0;
  }

  /** Integration package: one persistent room per tenant with a caller-chosen id. */
  async ensureRoom(id: string, app: string, now = Date.now()): Promise<void> {
    await this.sql.execute('INSERT OR IGNORE INTO rooms (id, created, app) VALUES (?, ?, ?)', [id, now, app]);
  }

  async roomApp(id: string): Promise<string | null> {
    const r = (await this.sql.execute('SELECT app FROM rooms WHERE id = ?', [id])).rows[0];
    return r ? (r.app as string) : null;
  }

  // --- sessions ------------------------------------------------------------
  async createSession(room: string, label: SessionRow['label'], arrival: ServerSignal | null, now = Date.now(), scenario = ''): Promise<string | null> {
    const n = (await this.sql.execute('SELECT COUNT(*) AS n FROM sessions WHERE room = ?', [room])).rows[0]!.n as number;
    if (n >= MAX_SESSIONS_PER_ROOM) return null;
    const id = crypto.randomUUID();
    await this.sql.execute('INSERT INTO sessions (id, room, label, scenario, created, arrival, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, room, label, scenario, now, arrival ? JSON.stringify(arrival) : null, now]);
    if (arrival) await this.addEvent(room, id, 'arrival', arrival, now);
    return id;
  }

  /**
   * Integration package: a session whose id the caller derives from its own authenticated session, so
   * every tab of one login reports under one NanoTarget session. Idempotent; no per-room limit.
   */
  async ensureSession(id: string, room: string, arrival: ServerSignal | null, now = Date.now()): Promise<SessionRow> {
    const existing = await this.getSession(id);
    if (existing) return existing;
    await this.sql.execute('INSERT OR IGNORE INTO sessions (id, room, label, scenario, created, arrival, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, room, 'unlabelled', '', now, arrival ? JSON.stringify(arrival) : null, now]);
    if (arrival) await this.addEvent(room, id, 'arrival', arrival, now);
    return (await this.getSession(id))!;
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const r = (await this.sql.execute('SELECT * FROM sessions WHERE id = ?', [id])).rows[0];
    return r ? this.rowToSession(r) : null;
  }

  async listSessions(room: string): Promise<SessionRow[]> {
    return (await this.sql.execute('SELECT * FROM sessions WHERE room = ? ORDER BY created ASC', [room])).rows.map((r) => this.rowToSession(r));
  }

  async touchSession(id: string, now = Date.now()) {
    await this.sql.execute('UPDATE sessions SET last_seen = ? WHERE id = ?', [now, id]);
  }

  async markFirstData(id: string, now: number) {
    await this.sql.execute('UPDATE sessions SET first_data_at = COALESCE(first_data_at, ?) WHERE id = ?', [now, id]);
  }

  async markFirstAgent(id: string, now: number) {
    await this.sql.execute('UPDATE sessions SET first_agent_at = COALESCE(first_agent_at, ?) WHERE id = ?', [now, id]);
  }

  /** Returns true the first time the session is marked (so callers can emit the attach event once). */
  async markAgentAttached(id: string, now: number, clientMs: number | null): Promise<boolean> {
    const r = await this.sql.execute('UPDATE sessions SET agent_attached_at = ?, agent_attached_client_ms = ? WHERE id = ? AND agent_attached_at IS NULL', [now, clientMs, id]);
    return r.rowsAffected > 0;
  }

  async markHumanVerified(session: string, now = Date.now()) {
    await this.sql.execute('UPDATE sessions SET human_verified_at = ? WHERE id = ?', [now, session]);
  }

  private rowToSession(r: Record<string, unknown>): SessionRow {
    return {
      id: r.id as string,
      room: r.room as string,
      label: r.label as SessionRow['label'],
      scenario: (r.scenario as string | null) ?? '',
      created: Number(r.created),
      arrival: r.arrival ? (JSON.parse(r.arrival as string) as ServerSignal) : null,
      firstDataAt: r.first_data_at == null ? null : Number(r.first_data_at),
      firstAgentAt: r.first_agent_at == null ? null : Number(r.first_agent_at),
      agentAttachedAt: r.agent_attached_at == null ? null : Number(r.agent_attached_at),
      agentAttachedClientMs: r.agent_attached_client_ms == null ? null : Number(r.agent_attached_client_ms),
      humanVerifiedAt: r.human_verified_at == null ? null : Number(r.human_verified_at),
      lastSeen: Number(r.last_seen),
    };
  }

  // --- events --------------------------------------------------------------
  async addEvent(room: string, session: string, kind: EventRow['kind'], payload: unknown, now = Date.now()): Promise<number> {
    const res = await this.sql.execute('INSERT INTO events (room, session, kind, payload, created) VALUES (?, ?, ?, ?, ?)', [room, session, kind, JSON.stringify(payload), now]);
    await this.sql.execute('DELETE FROM events WHERE room = ? AND id NOT IN (SELECT id FROM events WHERE room = ? ORDER BY id DESC LIMIT ?)', [room, room, MAX_EVENTS_PER_ROOM]);
    return res.lastInsertRowid ?? 0;
  }

  /** Latest early signal and last N interaction samples inside the behavioral window. */
  async hasEvent(session: string, kind: EventRow['kind']): Promise<boolean> {
    return (await this.sql.execute('SELECT 1 FROM events WHERE session = ? AND kind = ? LIMIT 1', [session, kind])).rows.length > 0;
  }
  async recentSignals(session: string, now = Date.now(), windowMs = 120000, limit = 5): Promise<{ early: ClientSnapshot['early']; interactions: NonNullable<ClientSnapshot['interaction']>[] }> {
    const rows = (await this.sql.execute("SELECT kind, payload FROM events WHERE session = ? AND kind IN ('signal','interaction') AND created > ? ORDER BY id DESC LIMIT 60", [session, now - windowMs])).rows as { kind: string; payload: string }[];
    let early: ClientSnapshot['early'] = null;
    const interactions: NonNullable<ClientSnapshot['interaction']>[] = [];
    for (const r of rows) {
      const p = JSON.parse(r.payload);
      if (r.kind === 'signal' && !early) early = p;
      if (r.kind === 'interaction' && interactions.length < limit) interactions.push(p);
    }
    if (!early) {
      const last = (await this.sql.execute("SELECT payload FROM events WHERE session = ? AND kind = 'signal' ORDER BY id DESC LIMIT 1", [session])).rows[0] as { payload: string } | undefined;
      if (last) early = JSON.parse(last.payload);
    }
    return { early, interactions: interactions.reverse() };
  }

  async listEvents(room: string, limit = 200): Promise<EventRow[]> {
    return (await this.sql.execute('SELECT * FROM events WHERE room = ? ORDER BY id DESC LIMIT ?', [room, limit])).rows.map((r) => ({
      id: Number(r.id),
      room: r.room as string,
      session: r.session as string,
      kind: r.kind as EventRow['kind'],
      payload: JSON.parse(r.payload as string),
      created: Number(r.created),
    }));
  }

  // --- decisions (hash-chained audit) -------------------------------------
  async lastDecision(room: string): Promise<{ seq: number; hash: string }> {
    const r = (await this.sql.execute('SELECT seq, hash FROM decisions WHERE room = ? ORDER BY seq DESC LIMIT 1', [room])).rows[0];
    return r ? { seq: Number(r.seq), hash: r.hash as string } : { seq: 0, hash: 'genesis' };
  }

  async insertDecision(row: DecisionRow, seq: number) {
    const { room, session, created, prevHash, hash, ...body } = row;
    await this.sql.execute('INSERT INTO decisions (id, room, session, seq, body, created, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [row.id, room, session, seq, JSON.stringify(body), created, prevHash, hash]);
  }

  private rowToDecision(r: Record<string, unknown>): DecisionRow & { seq: number } {
    return {
      ...(JSON.parse(r.body as string) as Omit<DecisionRow, 'room' | 'session' | 'created' | 'prevHash' | 'hash'>),
      room: r.room as string,
      session: r.session as string,
      seq: Number(r.seq),
      created: Number(r.created),
      prevHash: r.prev_hash as string,
      hash: r.hash as string,
    };
  }

  async listDecisions(room: string, limit = 300): Promise<(DecisionRow & { seq: number })[]> {
    return (await this.sql.execute('SELECT * FROM decisions WHERE room = ? ORDER BY seq DESC LIMIT ?', [room, limit])).rows.map((r) => this.rowToDecision(r));
  }

  async getDecision(id: string): Promise<(DecisionRow & { seq: number }) | null> {
    const r = (await this.sql.execute('SELECT * FROM decisions WHERE id = ?', [id])).rows[0];
    return r ? this.rowToDecision(r) : null;
  }

  // --- policies ------------------------------------------------------------
  async savePolicy(room: string, policy: Policy, now = Date.now()) {
    await this.sql.execute('INSERT INTO policies (room, version, body, created) VALUES (?, ?, ?, ?)', [room, policy.version, JSON.stringify(policy), now]);
  }

  async currentPolicy(room: string): Promise<Policy | null> {
    const r = (await this.sql.execute('SELECT body FROM policies WHERE room = ? ORDER BY created DESC, rowid DESC LIMIT 1', [room])).rows[0];
    return r ? (JSON.parse(r.body as string) as Policy) : null;
  }

  async policyHistory(room: string): Promise<{ version: string; created: number; enforcement: string }[]> {
    return (await this.sql.execute('SELECT version, created, body FROM policies WHERE room = ? ORDER BY created DESC LIMIT 50', [room])).rows.map((r) => ({
      version: r.version as string,
      created: Number(r.created),
      enforcement: (JSON.parse(r.body as string) as Policy).enforcement,
    }));
  }

  // --- nonces (replay protection for signatures and tokens) ---------------
  /** Returns true when the key was fresh (and is now consumed). */
  // ---- sandbox samples (pointer kinematics dataset) ----------------------
  async addSample(row: { client: string; label: string; source: string; task: string; ua: string; click: unknown; features: unknown; verdict: string }, now = Date.now()): Promise<number> {
    const r = await this.sql.execute('INSERT INTO samples (client, label, source, task, ua, click, features, verdict, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [row.client, row.label, row.source, row.task, row.ua, JSON.stringify(row.click), JSON.stringify(row.features), row.verdict, now]);
    return Number(r.lastInsertRowid ?? 0);
  }
  async sampleStats(): Promise<{ label: string; source: string; verdict: string; n: number }[]> {
    const r = await this.sql.execute('SELECT label, source, verdict, COUNT(*) AS n FROM samples GROUP BY label, source, verdict ORDER BY label, source, verdict');
    return r.rows.map((x) => ({ label: String(x.label), source: String(x.source), verdict: String(x.verdict), n: Number(x.n) }));
  }
  async clientSamples(client: string): Promise<{ id: number; task: string; verdict: string; features: unknown; created: number }[]> {
    const r = await this.sql.execute('SELECT id, task, verdict, features, created FROM samples WHERE client = ? ORDER BY id', [client]);
    return r.rows.map((x) => ({ id: Number(x.id), task: String(x.task), verdict: String(x.verdict), features: JSON.parse(String(x.features)), created: Number(x.created) }));
  }
  async listSamples(label: string | null, limit = 5000): Promise<{ id: number; client: string; label: string; source: string; task: string; ua: string; click: unknown; features: unknown; verdict: string; created: number }[]> {
    const r = label
      ? await this.sql.execute('SELECT * FROM samples WHERE label = ? ORDER BY id DESC LIMIT ?', [label, limit])
      : await this.sql.execute('SELECT * FROM samples ORDER BY id DESC LIMIT ?', [limit]);
    return r.rows.map((x) => ({ id: Number(x.id), client: String(x.client), label: String(x.label), source: String(x.source), task: String(x.task), ua: String(x.ua), click: JSON.parse(String(x.click)), features: JSON.parse(String(x.features)), verdict: String(x.verdict), created: Number(x.created) }));
  }

  async addTrainingSession(row: { client: string; label: string; source: string; ua: string; early: unknown; steps: unknown; summary: unknown }, now = Date.now()): Promise<number> {
    const r = await this.sql.execute('INSERT INTO training_sessions (client, label, source, ua, early, steps, summary, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [row.client, row.label, row.source, row.ua, JSON.stringify(row.early), JSON.stringify(row.steps), JSON.stringify(row.summary), now]);
    return Number(r.lastInsertRowid ?? 0);
  }
  async listTrainingSessions(limit = 500): Promise<{ id: number; client: string; label: string; source: string; ua: string; early: unknown; steps: unknown; summary: unknown; created: number }[]> {
    const r = await this.sql.execute('SELECT * FROM training_sessions ORDER BY id DESC LIMIT ?', [limit]);
    return r.rows.map((x) => ({ id: Number(x.id), client: String(x.client), label: String(x.label), source: String(x.source), ua: String(x.ua), early: JSON.parse(String(x.early)), steps: JSON.parse(String(x.steps)), summary: JSON.parse(String(x.summary)), created: Number(x.created) }));
  }

  async consumeNonce(key: string, ttlMs: number, now = Date.now()): Promise<boolean> {
    await this.sql.execute('DELETE FROM nonces WHERE expires < ?', [now]);
    try {
      await this.sql.execute('INSERT INTO nonces (key, expires) VALUES (?, ?)', [key, now + ttlMs]);
      return true;
    } catch {
      return false;
    }
  }

  // --- WebAuthn credentials & challenges ----------------------------------
  async saveCredential(room: string, session: string, cred: { id: string }, now = Date.now()) {
    await this.sql.execute('INSERT OR REPLACE INTO credentials (id, room, session, body, created) VALUES (?, ?, ?, ?, ?)', [cred.id, room, session, JSON.stringify(cred), now]);
  }

  /** Credentials registered in this room (the lab's stand-in for "this user's passkeys"). */
  async credentialsForRoom<T>(room: string): Promise<T[]> {
    return (await this.sql.execute('SELECT body FROM credentials WHERE room = ? ORDER BY created DESC', [room])).rows.map((r) => JSON.parse(r.body as string) as T);
  }

  async getCredential<T>(id: string): Promise<T | null> {
    const r = (await this.sql.execute('SELECT body FROM credentials WHERE id = ?', [id])).rows[0];
    return r ? (JSON.parse(r.body as string) as T) : null;
  }

  async updateCredential(cred: { id: string }) {
    await this.sql.execute('UPDATE credentials SET body = ? WHERE id = ?', [JSON.stringify(cred), cred.id]);
  }

  async createChallenge(id: string, session: string, kind: 'register' | 'assert', resource: string | null, ttlMs: number, now = Date.now()) {
    await this.sql.execute('DELETE FROM challenges WHERE expires < ?', [now]);
    await this.sql.execute('INSERT INTO challenges (id, session, kind, resource, expires) VALUES (?, ?, ?, ?, ?)', [id, session, kind, resource, now + ttlMs]);
  }

  /** Single use: returns the challenge row and deletes it. */
  async consumeChallenge(id: string, session: string, kind: 'register' | 'assert', now = Date.now()): Promise<{ resource: string | null } | null> {
    const r = (await this.sql.execute('SELECT resource, expires FROM challenges WHERE id = ? AND session = ? AND kind = ?', [id, session, kind])).rows[0] as { resource: string | null; expires: number } | undefined;
    await this.sql.execute('DELETE FROM challenges WHERE id = ?', [id]);
    if (!r || Number(r.expires) < now) return null;
    return { resource: r.resource };
  }

  // --- step-up -------------------------------------------------------------
  /** Grant one resource without a challenge (used after a verified WebAuthn assertion). */
  async grantStepUp(session: string, resource: string, ttlMs: number, now = Date.now()) {
    await this.sql.execute('INSERT INTO stepups (id, session, resource, challenge, expires, passed) VALUES (?, ?, ?, ?, ?, 1)', [crypto.randomUUID(), session, resource, 'webauthn', now + ttlMs]);
  }

  async createStepUp(session: string, resource: string, challenge: string, ttlMs: number, now = Date.now()): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql.execute('INSERT INTO stepups (id, session, resource, challenge, expires) VALUES (?, ?, ?, ?, ?)', [id, session, resource, challenge, now + ttlMs]);
    return id;
  }

  async getStepUp(id: string): Promise<{ id: string; session: string; resource: string; challenge: string; expires: number; passed: boolean } | null> {
    const r = (await this.sql.execute('SELECT * FROM stepups WHERE id = ?', [id])).rows[0];
    return r ? { id: r.id as string, session: r.session as string, resource: r.resource as string, challenge: r.challenge as string, expires: Number(r.expires), passed: !!Number(r.passed) } : null;
  }

  async passStepUp(id: string) {
    await this.sql.execute('UPDATE stepups SET passed = 1 WHERE id = ?', [id]);
  }

  /** A passed, unexpired step-up grant for this session+resource, consumed on use. */
  async consumeStepUpGrant(session: string, resource: string, now = Date.now()): Promise<boolean> {
    const r = (await this.sql.execute('SELECT id FROM stepups WHERE session = ? AND resource = ? AND passed = 1 AND expires > ? ORDER BY expires DESC LIMIT 1', [session, resource, now])).rows[0];
    if (!r) return false;
    await this.sql.execute('DELETE FROM stepups WHERE id = ?', [r.id as string]);
    return true;
  }
}
