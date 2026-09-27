// SPDX-License-Identifier: BUSL-1.1
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
import { sqliteClient, type Row, type SqlArg, type SqlClient } from './sql.ts';

/** demo rooms (and their sessions, events, decisions) are kept this long: long enough to read a test campaign's results */
export const ROOM_TTL_MS = 60 * 86400000;
export const MAX_SESSIONS_PER_ROOM = 400;
export const MAX_EVENTS_PER_ROOM = 2000;

/**
 * How much the store keeps. The lab and the portal's demo rooms cap a room (a public demo must not grow without
 * bound). A customer's own server has one room for all its visitors, so there the caps are per session and by age:
 * no session limit, the newest events of each session, nothing older than a week.
 */
export type StoreLimits = { sessionsPerRoom: number | null; eventsPerRoom: number | null; eventsPerSession: number | null; eventMaxAgeMs: number | null };
export const LAB_LIMITS: StoreLimits = { sessionsPerRoom: MAX_SESSIONS_PER_ROOM, eventsPerRoom: MAX_EVENTS_PER_ROOM, eventsPerSession: null, eventMaxAgeMs: null };
export const SERVER_LIMITS: StoreLimits = { sessionsPerRoom: null, eventsPerRoom: null, eventsPerSession: 300, eventMaxAgeMs: 7 * 24 * 3600e3 };

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
  /** 'raw': a byte-exact copy of what a page sent, kept only when the server records raw payloads */
  kind: 'arrival' | 'signal' | 'interaction' | 'attach' | 'seal' | 'raw';
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
  /** agent products seen in the session when this decision was made (e.g. claude-chrome), and the connection state */
  tools?: string[];
  connection?: string;
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
-- customer portal: an account owns API keys; each key is a project the middleware reports into
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS portal_sessions (id TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  revoked INTEGER,
  last_seen INTEGER,
  events INTEGER NOT NULL DEFAULT 0,
  expires INTEGER,
  env TEXT NOT NULL DEFAULT 'production'
);
-- management keys: an agent or a CI job administers the account with one of these
CREATE TABLE IF NOT EXISTS admin_keys (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  revoked INTEGER,
  last_seen INTEGER,
  calls INTEGER NOT NULL DEFAULT 0
);
-- what the middleware reports: one row per decision, metadata only (no payloads, no identities)
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  session TEXT NOT NULL,
  resource TEXT NOT NULL,
  decision TEXT NOT NULL,
  actor TEXT NOT NULL,
  state TEXT NOT NULL,
  tools TEXT NOT NULL,
  reasons TEXT NOT NULL,
  enforcement TEXT NOT NULL,
  version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_key_at ON telemetry (key_id, at);
CREATE TABLE IF NOT EXISTS key_policies (
  key_id TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated INTEGER NOT NULL,
  require_approval INTEGER NOT NULL DEFAULT 0,
  confirm_weakening INTEGER NOT NULL DEFAULT 1,
  last_file_hash TEXT,
  seen_version TEXT,
  seen_source TEXT,
  seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS policy_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  from_n INTEGER,
  to_n INTEGER,
  body TEXT,
  summary TEXT NOT NULL,
  weakening TEXT,
  decided_by TEXT,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS policy_changes_key ON policy_changes (key_id, id);
CREATE TABLE IF NOT EXISTS key_resources (
  key_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (key_id, resource)
);
CREATE TABLE IF NOT EXISTS policy_cache (
  tag TEXT PRIMARY KEY,
  envelope TEXT NOT NULL,
  pinned_key TEXT NOT NULL,
  fetched INTEGER NOT NULL,
  pushed_file_hash TEXT
);
CREATE TABLE IF NOT EXISTS signature_bundles (
  seq INTEGER PRIMARY KEY,
  jws TEXT NOT NULL,
  issued INTEGER NOT NULL,
  added INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assist_log (
  account TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assist_log_account ON assist_log (account, at);
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
-- visits to this website (onehuman.ai itself, not customers' apps): pages and state-changing API calls, for the
-- operators' view. No raw IP and no raw user agent: a keyed hash of both, plus browser/OS family and country.
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  device TEXT NOT NULL,
  account TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  status INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  mobile INTEGER NOT NULL,
  bot INTEGER NOT NULL,
  country TEXT,
  city TEXT,
  referrer TEXT
);
CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
CREATE INDEX IF NOT EXISTS visits_device ON visits(device, at);
-- rate-limit counters shared by every serverless instance (server/limits.ts)
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key, win));
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  resource TEXT,
  expires INTEGER NOT NULL
);
`;

/** additive migrations for databases created by earlier builds */
/** The newest column of each migrated table. Add a line here whenever MIGRATIONS gains a column. */
const SCHEMA_MARKERS: [string, string][] = [['decisions', 'proof'], ['telemetry', 'feedback_at'], ['api_keys', 'proof_keys'], ['sessions', 'human_verified_at'], ['key_policies', 'seen_at'], ['policy_changes', 'decided_at'], ['key_resources', 'last_seen'], ['policy_cache', 'pushed_file_hash'], ['assist_log', 'at'], ['telemetry', 'computed'], ['signature_bundles', 'added'], ['rooms', 'device'], ['visits', 'referrer'], ['rate_limits', 'n']];

const MIGRATIONS = [
  'ALTER TABLE sessions ADD COLUMN agent_attached_at INTEGER',
  'ALTER TABLE sessions ADD COLUMN agent_attached_client_ms INTEGER',
  "ALTER TABLE sessions ADD COLUMN scenario TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE sessions ADD COLUMN human_verified_at INTEGER',
  "ALTER TABLE rooms ADD COLUMN app TEXT NOT NULL DEFAULT 'bank'",
  'ALTER TABLE api_keys ADD COLUMN expires INTEGER',
  "ALTER TABLE api_keys ADD COLUMN env TEXT NOT NULL DEFAULT 'production'",
  'ALTER TABLE decisions ADD COLUMN proof TEXT',
  'ALTER TABLE telemetry ADD COLUMN proof TEXT',
  'ALTER TABLE telemetry ADD COLUMN proof_kid TEXT',
  'ALTER TABLE telemetry ADD COLUMN proof_ok INTEGER',
  'ALTER TABLE api_keys ADD COLUMN proof_keys TEXT',
  'ALTER TABLE telemetry ADD COLUMN eid TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS telemetry_eid ON telemetry (key_id, eid)',
  'ALTER TABLE telemetry ADD COLUMN feedback TEXT',
  'ALTER TABLE telemetry ADD COLUMN feedback_note TEXT',
  'ALTER TABLE telemetry ADD COLUMN feedback_at INTEGER',
  'ALTER TABLE telemetry ADD COLUMN computed TEXT',
  'ALTER TABLE rooms ADD COLUMN device TEXT',
  'CREATE INDEX IF NOT EXISTS rooms_device ON rooms(device, created)',
  'CREATE INDEX IF NOT EXISTS rooms_created ON rooms(created)',
];

export type KeyPolicyRow = {
  keyId: string; n: number; body: unknown; updated: number; requireApproval: boolean; confirmWeakening: boolean;
  lastFileHash: string | null; seen: { version: string; source: string; at: number } | null;
};
export type PolicyChangeRow = {
  id: number; at: number; actor: string; origin: string; status: string; fromN: number | null; toN: number | null;
  body: unknown; summary: string[]; weakening: string[]; decidedBy: string | null; decidedAt: number | null;
};
export type ApiKeyRow = { id: string; name: string; prefix: string; created: number; revoked: number | null; lastSeen: number | null; events: number; expires: number | null; env: string };
/** stored JSON columns are written by us, but a bad row must not take a whole page down */
const safeList = (v: unknown): string[] => { try { const a: unknown = JSON.parse(String(v)); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const apiKeyRow = (x: Row): ApiKeyRow => ({ id: String(x.id), name: String(x.name), prefix: String(x.prefix), created: Number(x.created), revoked: x.revoked == null ? null : Number(x.revoked), lastSeen: x.last_seen == null ? null : Number(x.last_seen), events: Number(x.events), expires: x.expires == null ? null : Number(x.expires), env: String(x.env ?? 'production') });

export type TelemetryEvent = { at: number; session: string; resource: string; decision: string;
  /** what the rules chose — in observe mode `decision` is allow and this is what protect mode would have done */
  computed?: string | null; actor: string; state: string; tools: string[]; reasons: string[]; enforcement: string; version: string;
  /** signed decision proof (compact JWS), its key id, and whether the signature checked out at ingest */
  proof?: string | null; proofKid?: string | null; proofOk?: boolean | null;
  /** the reporter's id for this event: a retried batch carries the same ids, so nothing is counted twice */
  eid?: string | null };
export type TelemetryStats = {
  decisions: Record<string, number>;
  actors: Record<string, number>;
  states: Record<string, number>;
  resources: { resource: string; decision: string; n: number }[];
  tools: { tool: string; sessions: number }[];
  sessions: { total: number; agent: number };
  series: { t: number; n: number; agent: number; gated: number }[];
  recent: { id: number; at: number; session: string; resource: string; decision: string; actor: string; state: string; tools: string[]; reasons: string[]; enforcement: string; signed: boolean | null; feedback: string | null }[];
};

export type TelemetryHealth = {
  events: number;
  /** newest reported event, any range */
  last: number | null;
  sessions: number;
  /** sessions whose decisions had browser-SDK signals behind them */
  sdkSessions: number;
  proofs: number;
  proofsOk: number;
  enforcement: string | null;
  version: string | null;
  people: { sessions: number; stopped: number; engineStopped: number; gradedWrong: number; askedToConfirm: number; askedSessions: number };
  agents: { sessions: number; gated: number };
};

export type TelemetryWeek = {
  decisions: number; sessions: number; agentSessions: number; agentGated: number; peopleStopped: number; stepUps: number; signed: number;
  tools: { tool: string; sessions: number }[];
  agentResources: { resource: string; n: number; gated: number }[];
};

export type TelemetryOverview = {
  series: { key: string; t: number; n: number; agent: number; gated: number }[];
  totals: { key: string; n: number; sessions: number; agentSessions: number; gated: number; last: number }[];
};

export class Store {
  readonly sql: SqlClient;
  readonly limits: StoreLimits;
  private inserts = 0;
  private roomInserts = 0;
  private roomTrims = 0;
  private constructor(sql: SqlClient, limits: StoreLimits) { this.sql = sql; this.limits = limits; }

  /** Open a store on a client and make sure the schema exists. */
  static async open(client?: SqlClient, opts: { migrate?: boolean; limits?: StoreLimits } = {}): Promise<Store> {
    const c = client ?? (await sqliteClient(':memory:'));
    // One round trip decides whether the schema exists; cold starts on a ready database then skip
    // the CREATE/ALTER statements (each of which is a network round trip on libSQL).
    // A database is ready when every table exists AND the newest migrated columns exist: a deployment that
    // predates a column must still get its ALTERs, or every insert naming that column fails.
    const probe = (await c.execute(`SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('rooms','challenges','samples','training_sessions','telemetry','admin_keys')) AS tables,
      ${SCHEMA_MARKERS.map(([t, col]) => `(SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE name='${col}')`).join(' + ')} AS columns`)).rows[0] ?? {};
    const ready = Number(probe.tables) === 6 && Number(probe.columns) === SCHEMA_MARKERS.length;
    if (!ready || opts.migrate) {
      await c.executeMultiple(SCHEMA);
      for (const m of MIGRATIONS) { try { await c.execute(m); } catch { /* column exists */ } }
    }
    return new Store(c, opts.limits ?? LAB_LIMITS);
  }

  close() {
    this.sql.close();
  }

  /** Test helper: run a raw statement. */
  exec(sqlText: string, args: SqlArg[] = []) {
    return this.sql.execute(sqlText, args);
  }

  // --- rooms ---------------------------------------------------------------
  async createRoom(now = Date.now(), app = 'bank', device: string | null = null): Promise<string> {
    const id = crypto.randomUUID();
    // expired rooms go now and then, children first: the remote database may not enforce ON DELETE CASCADE
    const expired = "SELECT id FROM rooms WHERE created < ? AND app NOT LIKE 'tenant:%'";
    const cut = now - ROOM_TTL_MS;
    const prune = ++this.roomInserts % 50 === 1
      ? ['challenges', 'stepups'].map((t) => ({ sql: `DELETE FROM ${t} WHERE session IN (SELECT id FROM sessions WHERE room IN (${expired}))`, args: [cut] }))
        .concat(['events', 'decisions', 'credentials', 'policies', 'sessions', 'rooms'].map((t) => ({ sql: t === 'rooms' ? `DELETE FROM rooms WHERE id IN (${expired})` : `DELETE FROM ${t} WHERE room IN (${expired})`, args: [cut] })))
      : [];
    await this.sql.batch([
      ...prune,
      { sql: 'INSERT INTO rooms (id, created, app, device) VALUES (?, ?, ?, ?)', args: [id, now, app, device] },
    ]);
    return id;
  }
  /** demo rooms this device opened since `since` — a cheap brake on scripted room creation */
  async roomsByDevice(device: string, since: number): Promise<number> {
    return Number((await this.sql.execute('SELECT COUNT(*) AS n FROM rooms WHERE device = ? AND created >= ?', [device, since])).rows[0]?.n ?? 0);
  }

  // --- visits (this website's own log, read in /ops) -------------------------
  async addVisit(v: { at: number; device: string; account: string | null; method: string; path: string; kind: string; status: number; ms: number; browser: string; os: string; mobile: boolean; bot: boolean; country: string | null; city: string | null; referrer: string | null }, keepMs: number): Promise<void> {
    await this.sql.execute('INSERT INTO visits (at, device, account, method, path, kind, status, ms, browser, os, mobile, bot, country, city, referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.at, v.device, v.account, v.method, v.path, v.kind, v.status, v.ms, v.browser, v.os, v.mobile ? 1 : 0, v.bot ? 1 : 0, v.country, v.city, v.referrer]);
    if (Math.random() < 0.01) await this.sql.execute('DELETE FROM visits WHERE at < ?', [v.at - keepMs]);
  }

  /** count one hit on `key` in the current window of `windowMs`; returns the count so far */
  async hitLimit(key: string, windowMs: number, now = Date.now()): Promise<number> {
    const win = Math.floor(now / windowMs) * windowMs;   // the window's start time
    const r = await this.sql.execute('INSERT INTO rate_limits (key, win, n) VALUES (?, ?, 1) ON CONFLICT (key, win) DO UPDATE SET n = n + 1 RETURNING n', [key, win]);
    if (Math.random() < 0.005) await this.sql.execute('DELETE FROM rate_limits WHERE win < ?', [now - 2 * 86400000]).catch(() => {});
    return Number(r.rows[0]?.n ?? 1);
  }

  /** read-only reporting query for the operators' view (/ops) */
  async report(sqlText: string, args: SqlArg[] = []): Promise<Row[]> {
    return (await this.sql.execute(sqlText, args)).rows as Row[];
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
    if (this.limits.sessionsPerRoom !== null) {
      const n = (await this.sql.execute('SELECT COUNT(*) AS n FROM sessions WHERE room = ?', [room])).rows[0]!.n as number;
      if (n >= this.limits.sessionsPerRoom) return null;
    }
    const id = crypto.randomUUID();
    await this.sql.execute('INSERT INTO sessions (id, room, label, scenario, created, arrival, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, room, label, scenario, now, arrival ? JSON.stringify(arrival) : null, now]);
    if (arrival) await this.addEvent(room, id, 'arrival', arrival, now);
    return id;
  }

  /**
   * Integration package: a session whose id the caller derives from its own authenticated session, so
   * every tab of one login reports under one OneHuman session. Idempotent; no per-room limit.
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
    const L = this.limits;
    if (L.eventsPerRoom !== null && ++this.roomTrims % 20 === 1) await this.sql.execute('DELETE FROM events WHERE room = ? AND id NOT IN (SELECT id FROM events WHERE room = ? ORDER BY id DESC LIMIT ?)', [room, room, L.eventsPerRoom]);
    // per session: an indexed look at this session only, never a scan of everyone's events
    if (L.eventsPerSession !== null) await this.sql.execute('DELETE FROM events WHERE session = ? AND id < (SELECT id FROM events WHERE session = ? ORDER BY id DESC LIMIT 1 OFFSET ?)', [session, session, L.eventsPerSession - 1]);
    // by age: now and then, not on every insert
    if (L.eventMaxAgeMs !== null && ++this.inserts % 500 === 1) await this.sql.execute('DELETE FROM events WHERE created < ?', [now - L.eventMaxAgeMs]);
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

  async insertDecision(row: DecisionRow, seq: number, proof: string | null = null) {
    const { room, session, created, prevHash, hash, ...body } = row;
    await this.sql.execute('INSERT INTO decisions (id, room, session, seq, body, created, prev_hash, hash, proof) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [row.id, room, session, seq, JSON.stringify(body), created, prevHash, hash, proof]);
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

  /** The signed proof of one decision (proof.ts). Kept out of rowToDecision: it is not part of the hashed body. */
  async decisionProof(id: string): Promise<string | null> {
    const r = (await this.sql.execute('SELECT proof FROM decisions WHERE id = ?', [id])).rows[0];
    return r && typeof r.proof === 'string' ? r.proof : null;
  }
  /** Every signed decision of one session, oldest first — what a business hands an auditor about one customer. */
  async sessionProofs(session: string, limit = 5000): Promise<{ id: string; seq: number; proof: string }[]> {
    const r = await this.sql.execute('SELECT id, seq, proof FROM decisions WHERE session = ? AND proof IS NOT NULL ORDER BY created, seq LIMIT ?', [session, limit]);
    return r.rows.map((x) => ({ id: String(x.id), seq: Number(x.seq), proof: String(x.proof) }));
  }

  /**
   * The light fields of every real decision in a time range, for reports: read with json_extract so a month of
   * decisions does not load each assessment. `room` null = every room in this database.
   */
  async decisionsBetween(from: number, to: number, room: string | null = null): Promise<{ session: string; created: number; resource: string; decision: string; computed: string; actor: string; enforced: boolean; branch: string; tools: string[]; signed: boolean; policyVersion: string }[]> {
    const rows = (await this.sql.execute(`SELECT session, created, json_extract(body,'$.resource') AS resource, json_extract(body,'$.decision') AS decision,
      json_extract(body,'$.computed') AS computed, json_extract(body,'$.actor') AS actor, json_extract(body,'$.enforced') AS enforced, json_extract(body,'$.branch') AS branch,
      json_extract(body,'$.tools') AS tools, json_extract(body,'$.policyVersion') AS pv, proof IS NOT NULL AS signed
      FROM decisions WHERE created >= ? AND created < ? AND COALESCE(json_extract(body,'$.simulated'), 0) = 0${room ? ' AND room = ?' : ''} ORDER BY created`, room ? [from, to, room] : [from, to])).rows;
    return rows.map((r) => ({
      session: String(r.session), created: Number(r.created), resource: String(r.resource ?? ''), decision: String(r.decision ?? 'allow'),
      computed: String(r.computed ?? r.decision ?? 'allow'), actor: String(r.actor ?? 'unknown'), enforced: Number(r.enforced) === 1 || r.enforced === true,
      branch: String(r.branch ?? ''), tools: safeList(r.tools ?? '[]'), signed: Number(r.signed) === 1, policyVersion: String(r.pv ?? ''),
    }));
  }
  /** agent products seen per session from the connection record, for decisions made before tools were stored on them */
  async attachToolsBetween(from: number, to: number): Promise<Map<string, string[]>> {
    const rows = (await this.sql.execute("SELECT session, json_extract(payload,'$.tools') AS tools FROM events WHERE kind = 'attach' AND created >= ? AND created < ?", [from, to])).rows;
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(String(r.session), [...new Set([...(out.get(String(r.session)) ?? []), ...safeList(r.tools ?? '[]')])]);
    return out;
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

  // --- customer portal -----------------------------------------------------
  async createAccount(email: string, passHash: string, now = Date.now()): Promise<string | null> {
    const id = crypto.randomUUID();
    try { await this.sql.execute('INSERT INTO accounts (id, email, pass, created) VALUES (?, ?, ?, ?)', [id, email, passHash, now]); } catch { return null; }
    return id;
  }
  async accountByEmail(email: string): Promise<{ id: string; email: string; pass: string; created: number } | null> {
    const r = await this.sql.execute('SELECT id, email, pass, created FROM accounts WHERE email = ?', [email]);
    const x = r.rows[0]; return x ? { id: String(x.id), email: String(x.email), pass: String(x.pass), created: Number(x.created) } : null;
  }
  async setAccountPassword(id: string, passHash: string): Promise<boolean> {
    const r = await this.sql.execute('UPDATE accounts SET pass = ? WHERE id = ?', [passHash, id]);
    return r.rowsAffected > 0;
  }
  async accountById(id: string): Promise<{ id: string; email: string; created: number } | null> {
    const r = await this.sql.execute('SELECT id, email, created FROM accounts WHERE id = ?', [id]);
    const x = r.rows[0]; return x ? { id: String(x.id), email: String(x.email), created: Number(x.created) } : null;
  }
  async createPortalSession(account: string, ttlMs: number, now = Date.now()): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql.batch([
      { sql: 'DELETE FROM portal_sessions WHERE expires < ?', args: [now] },
      { sql: 'INSERT INTO portal_sessions (id, account, expires) VALUES (?, ?, ?)', args: [id, account, now + ttlMs] },
    ]);
    return id;
  }
  async portalSession(id: string, now = Date.now()): Promise<string | null> {
    const r = await this.sql.execute('SELECT account FROM portal_sessions WHERE id = ? AND expires > ?', [id, now]);
    return r.rows[0] ? String(r.rows[0].account) : null;
  }
  async deletePortalSession(id: string) { await this.sql.execute('DELETE FROM portal_sessions WHERE id = ?', [id]); }
  /** after a password change: every other sign-in of the account ends */
  async deleteOtherPortalSessions(account: string, keep: string) { await this.sql.execute('DELETE FROM portal_sessions WHERE account = ? AND id <> ?', [account, keep]); }

  async createApiKey(account: string, key: { name: string; prefix: string; hash: string; expires?: number | null; env?: string }, now = Date.now()): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql.execute('INSERT INTO api_keys (id, account, name, prefix, hash, created, expires, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, account, key.name, key.prefix, key.hash, now, key.expires ?? null, key.env ?? 'production']);
    return id;
  }
  async listApiKeys(account: string): Promise<ApiKeyRow[]> {
    const r = await this.sql.execute('SELECT id, name, prefix, created, revoked, last_seen, events, expires, env FROM api_keys WHERE account = ? ORDER BY created', [account]);
    return r.rows.map(apiKeyRow);
  }
  async apiKeyById(id: string, account: string): Promise<ApiKeyRow | null> {
    const r = await this.sql.execute('SELECT id, name, prefix, created, revoked, last_seen, events, expires, env FROM api_keys WHERE id = ? AND account = ?', [id, account]);
    return r.rows[0] ? apiKeyRow(r.rows[0]) : null;
  }
  /** find the key a raw string belongs to — the portal's "paste a key" search; the hash never leaves here */
  async apiKeyIdByHash(hash: string, account: string): Promise<string | null> {
    const r = await this.sql.execute('SELECT id FROM api_keys WHERE hash = ? AND account = ?', [hash, account]);
    return r.rows[0] ? String(r.rows[0].id) : null;
  }
  async renameApiKey(id: string, account: string, name: string): Promise<boolean> {
    const r = await this.sql.execute('UPDATE api_keys SET name = ? WHERE id = ? AND account = ?', [name, id, account]);
    return r.rowsAffected > 0;
  }
  async apiKeyByHash(hash: string): Promise<{ id: string; account: string; revoked: number | null; expires: number | null } | null> {
    const r = await this.sql.execute('SELECT id, account, revoked, expires FROM api_keys WHERE hash = ?', [hash]);
    const x = r.rows[0];
    return x ? { id: String(x.id), account: String(x.account), revoked: x.revoked == null ? null : Number(x.revoked), expires: x.expires == null ? null : Number(x.expires) } : null;
  }

  // --- management keys ------------------------------------------------------
  async createAdminKey(account: string, name: string, prefix: string, hash: string, now = Date.now()): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql.execute('INSERT INTO admin_keys (id, account, name, prefix, hash, created) VALUES (?, ?, ?, ?, ?, ?)', [id, account, name, prefix, hash, now]);
    return id;
  }
  async listAdminKeys(account: string): Promise<{ id: string; name: string; prefix: string; created: number; revoked: number | null; lastSeen: number | null; calls: number }[]> {
    const r = await this.sql.execute('SELECT id, name, prefix, created, revoked, last_seen, calls FROM admin_keys WHERE account = ? ORDER BY created', [account]);
    return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), prefix: String(x.prefix), created: Number(x.created), revoked: x.revoked == null ? null : Number(x.revoked), lastSeen: x.last_seen == null ? null : Number(x.last_seen), calls: Number(x.calls) }));
  }
  async adminKeyByHash(hash: string): Promise<{ id: string; account: string; revoked: number | null } | null> {
    const r = await this.sql.execute('SELECT id, account, revoked FROM admin_keys WHERE hash = ?', [hash]);
    const x = r.rows[0]; return x ? { id: String(x.id), account: String(x.account), revoked: x.revoked == null ? null : Number(x.revoked) } : null;
  }
  async touchAdminKey(id: string, now = Date.now()) {
    await this.sql.execute('UPDATE admin_keys SET last_seen = ?, calls = calls + 1 WHERE id = ?', [now, id]);
  }
  async revokeAdminKey(id: string, account: string, now = Date.now()): Promise<boolean> {
    const r = await this.sql.execute('UPDATE admin_keys SET revoked = ? WHERE id = ? AND account = ? AND revoked IS NULL', [now, id, account]);
    return r.rowsAffected > 0;
  }
  async apiKeyOwned(id: string, account: string): Promise<boolean> {
    const r = await this.sql.execute('SELECT 1 FROM api_keys WHERE id = ? AND account = ?', [id, account]);
    return r.rows.length > 0;
  }
  async revokeApiKey(id: string, account: string, now = Date.now()): Promise<boolean> {
    const r = await this.sql.execute('UPDATE api_keys SET revoked = ? WHERE id = ? AND account = ? AND revoked IS NULL', [now, id, account]);
    return r.rowsAffected > 0;
  }
  /** rotation keeps the key's identity — name, environment and its whole history — and only the secret changes */
  async rotateApiKey(id: string, account: string, prefix: string, hash: string): Promise<boolean> {
    const r = await this.sql.execute('UPDATE api_keys SET prefix = ?, hash = ? WHERE id = ? AND account = ? AND revoked IS NULL', [prefix, hash, id, account]);
    return r.rowsAffected > 0;
  }
  /** removing a revoked key takes its reported decisions with it */
  async deleteApiKey(id: string, account: string): Promise<boolean> {
    const owned = await this.sql.execute('SELECT 1 FROM api_keys WHERE id = ? AND account = ? AND revoked IS NOT NULL', [id, account]);
    if (!owned.rows.length) return false;
    await this.sql.batch([
      { sql: 'DELETE FROM telemetry WHERE key_id = ?', args: [id] as SqlArg[] },
      { sql: 'DELETE FROM key_policies WHERE key_id = ?', args: [id] as SqlArg[] },
      { sql: 'DELETE FROM policy_changes WHERE key_id = ?', args: [id] as SqlArg[] },
      { sql: 'DELETE FROM key_resources WHERE key_id = ?', args: [id] as SqlArg[] },
      { sql: 'DELETE FROM api_keys WHERE id = ? AND account = ?', args: [id, account] as SqlArg[] },
    ]);
    return true;
  }

  // --- portal-managed policy (per API key) ---------------------------------------------------------
  /** The policy the portal holds for one key, its settings, and what the key's server last said it runs. */
  async keyPolicy(keyId: string): Promise<KeyPolicyRow | null> {
    const r = (await this.sql.execute('SELECT * FROM key_policies WHERE key_id = ?', [keyId])).rows[0];
    if (!r) return null;
    return {
      keyId, n: Number(r.n), body: JSON.parse(String(r.body)), updated: Number(r.updated),
      requireApproval: Number(r.require_approval) === 1, confirmWeakening: Number(r.confirm_weakening) === 1,
      lastFileHash: r.last_file_hash == null ? null : String(r.last_file_hash),
      seen: r.seen_at == null ? null : { version: String(r.seen_version ?? ''), source: String(r.seen_source ?? ''), at: Number(r.seen_at) },
    };
  }
  /** Write a new version (or the first one). Settings are kept; a first write takes the defaults. */
  async putKeyPolicy(keyId: string, n: number, body: unknown, now = Date.now()) {
    await this.sql.execute(`INSERT INTO key_policies (key_id, n, body, updated) VALUES (?, ?, ?, ?)
      ON CONFLICT(key_id) DO UPDATE SET n = excluded.n, body = excluded.body, updated = excluded.updated`, [keyId, n, JSON.stringify(body), now]);
  }
  async setKeyPolicySettings(keyId: string, s: { requireApproval?: boolean; confirmWeakening?: boolean }) {
    if (s.requireApproval !== undefined) await this.sql.execute('UPDATE key_policies SET require_approval = ? WHERE key_id = ?', [s.requireApproval ? 1 : 0, keyId]);
    if (s.confirmWeakening !== undefined) await this.sql.execute('UPDATE key_policies SET confirm_weakening = ? WHERE key_id = ?', [s.confirmWeakening ? 1 : 0, keyId]);
  }
  async setKeyPolicyFileHash(keyId: string, hash: string) {
    await this.sql.execute('UPDATE key_policies SET last_file_hash = ? WHERE key_id = ?', [hash, keyId]);
  }
  /** What the key's server reported it is running, and where the policy came from (portal, cache or file). */
  async setKeyPolicySeen(keyId: string, version: string, source: string, now = Date.now()) {
    await this.sql.execute('UPDATE key_policies SET seen_version = ?, seen_source = ?, seen_at = ? WHERE key_id = ?', [version.slice(0, 80), source.slice(0, 20), now, keyId]);
  }
  async addPolicyChange(c: { keyId: string; actor: string; origin: string; status: string; fromN: number | null; toN: number | null; body: unknown; summary: string[]; weakening: string[] }, now = Date.now()): Promise<number> {
    const r = await this.sql.execute('INSERT INTO policy_changes (key_id, at, actor, origin, status, from_n, to_n, body, summary, weakening) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [c.keyId, now, c.actor.slice(0, 120), c.origin, c.status, c.fromN, c.toN, c.body == null ? null : JSON.stringify(c.body), JSON.stringify(c.summary.slice(0, 60)), c.weakening.length ? JSON.stringify(c.weakening.slice(0, 60)) : null]);
    return Number(r.lastInsertRowid);
  }
  async decidePolicyChange(keyId: string, id: number, status: 'applied' | 'rejected' | 'superseded', by: string, toN: number | null, now = Date.now()): Promise<boolean> {
    const r = await this.sql.execute("UPDATE policy_changes SET status = ?, decided_by = ?, decided_at = ?, to_n = COALESCE(?, to_n) WHERE id = ? AND key_id = ? AND status = 'pending'", [status, by.slice(0, 120), now, toN, id, keyId]);
    return r.rowsAffected > 0;
  }
  async policyChanges(keyId: string, opts: { status?: string; limit?: number } = {}): Promise<PolicyChangeRow[]> {
    const r = opts.status
      ? await this.sql.execute('SELECT * FROM policy_changes WHERE key_id = ? AND status = ? ORDER BY id DESC LIMIT ?', [keyId, opts.status, opts.limit ?? 50])
      : await this.sql.execute('SELECT * FROM policy_changes WHERE key_id = ? ORDER BY id DESC LIMIT ?', [keyId, opts.limit ?? 50]);
    return r.rows.map((x) => ({
      id: Number(x.id), at: Number(x.at), actor: String(x.actor), origin: String(x.origin), status: String(x.status),
      fromN: x.from_n == null ? null : Number(x.from_n), toN: x.to_n == null ? null : Number(x.to_n),
      body: x.body == null ? null : JSON.parse(String(x.body)), summary: safeList(x.summary), weakening: x.weakening == null ? [] : safeList(x.weakening),
      decidedBy: x.decided_by == null ? null : String(x.decided_by), decidedAt: x.decided_at == null ? null : Number(x.decided_at),
    }));
  }
  /** The protected resources a key's server declared (every oh.protect() call it registered). */
  async noteKeyResources(keyId: string, resources: string[], now = Date.now()) {
    if (!resources.length) return;
    await this.sql.batch(resources.slice(0, 200).map((res) => ({ sql: 'INSERT INTO key_resources (key_id, resource, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(key_id, resource) DO UPDATE SET last_seen = excluded.last_seen', args: [keyId, res, now, now] as SqlArg[] })));
  }
  async keyResources(keyId: string): Promise<{ resource: string; firstSeen: number; lastSeen: number }[]> {
    const r = await this.sql.execute('SELECT resource, first_seen, last_seen FROM key_resources WHERE key_id = ? ORDER BY resource', [keyId]);
    return r.rows.map((x) => ({ resource: String(x.resource), firstSeen: Number(x.first_seen), lastSeen: Number(x.last_seen) }));
  }
  /** Resources the key reported decisions for (traffic), newest first — catches endpoints the server never declared. */
  async telemetryResources(keyId: string, since: number): Promise<{ resource: string; n: number; last: number }[]> {
    const r = await this.sql.execute('SELECT resource, COUNT(*) AS n, MAX(at) AS last FROM telemetry WHERE key_id = ? AND at >= ? GROUP BY resource ORDER BY last DESC LIMIT 200', [keyId, since]);
    return r.rows.map((x) => ({ resource: String(x.resource), n: Number(x.n), last: Number(x.last) }));
  }

  // --- the server's own copy of the portal policy (engine side) --------------------------------------
  /** The last signed envelope this server accepted from the portal, the portal key it pinned, and the file hash it last proposed. */
  async policyCache(tag: string): Promise<{ envelope: string; pinnedKey: string; fetched: number; pushedFileHash: string | null } | null> {
    const r = (await this.sql.execute('SELECT envelope, pinned_key, fetched, pushed_file_hash FROM policy_cache WHERE tag = ?', [tag])).rows[0];
    return r ? { envelope: String(r.envelope), pinnedKey: String(r.pinned_key), fetched: Number(r.fetched), pushedFileHash: r.pushed_file_hash == null ? null : String(r.pushed_file_hash) } : null;
  }
  async putPolicyCache(tag: string, c: { envelope: string; pinnedKey: string; fetched: number }) {
    await this.sql.execute(`INSERT INTO policy_cache (tag, envelope, pinned_key, fetched) VALUES (?, ?, ?, ?)
      ON CONFLICT(tag) DO UPDATE SET envelope = excluded.envelope, pinned_key = excluded.pinned_key, fetched = excluded.fetched`, [tag, c.envelope, c.pinnedKey, c.fetched]);
  }
  async setPolicyCachePushed(tag: string, fileHash: string, pinnedKey: string) {
    const r = await this.sql.execute('UPDATE policy_cache SET pushed_file_hash = ? WHERE tag = ?', [fileHash, tag]);
    if (!r.rowsAffected) await this.sql.execute('INSERT INTO policy_cache (tag, envelope, pinned_key, fetched, pushed_file_hash) VALUES (?, ?, ?, 0, ?)', [tag, '', pinnedKey, fileHash]);
  }

  /** Agent signature bundles, newest first. They arrive signed; the portal only stores and serves them. */
  async latestSignatureBundle(): Promise<{ seq: number; jws: string; issued: number } | null> {
    const r = (await this.sql.execute('SELECT seq, jws, issued FROM signature_bundles ORDER BY seq DESC LIMIT 1')).rows[0];
    return r ? { seq: Number(r.seq), jws: String(r.jws), issued: Number(r.issued) } : null;
  }
  async addSignatureBundle(seq: number, jws: string, issued: number): Promise<boolean> {
    const r = await this.sql.execute('INSERT OR IGNORE INTO signature_bundles (seq, jws, issued, added) VALUES (?, ?, ?, ?)', [seq, jws, issued, Date.now()]);
    return r.rowsAffected > 0;
  }

  /** The policy assistant's use per account, for its daily limit. */
  async noteAssist(account: string) {
    await this.sql.execute('INSERT INTO assist_log (account, at) VALUES (?, ?)', [account, Date.now()]);
  }
  /** every account together: the assistant's spend has one ceiling for the whole portal */
  async assistCountAll(since: number): Promise<number> {
    return Number((await this.sql.execute('SELECT COUNT(*) AS n FROM assist_log WHERE at > ?', [since])).rows[0]?.n ?? 0);
  }
  async assistCount(account: string, since: number): Promise<number> {
    return Number((await this.sql.execute('SELECT COUNT(*) AS n FROM assist_log WHERE account = ? AND at > ?', [account, since])).rows[0]?.n ?? 0);
  }

  /** Remember the public keys a deployment reports with its events; old keys stay so old proofs keep verifying. */
  async rememberProofKeys(keyId: string, keys: { kty: string; crv: string; x: string; kid: string }[]) {
    if (!keys.length) return;
    const r = (await this.sql.execute('SELECT proof_keys FROM api_keys WHERE id = ?', [keyId])).rows[0];
    let known: { kty: string; crv: string; x: string; kid: string; first: number }[] = [];
    try { known = r?.proof_keys ? JSON.parse(String(r.proof_keys)) : []; } catch { known = []; }
    let changed = false;
    for (const k of keys) if (!known.some((q) => q.kid === k.kid)) { known.push({ kty: k.kty, crv: k.crv, x: k.x, kid: k.kid, first: Date.now() }); changed = true; }
    if (changed) await this.sql.execute('UPDATE api_keys SET proof_keys = ? WHERE id = ?', [JSON.stringify(known.slice(-10)), keyId]);
  }
  async proofKeysFor(keyId: string): Promise<{ kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; first: number }[]> {
    const r = (await this.sql.execute('SELECT proof_keys FROM api_keys WHERE id = ?', [keyId])).rows[0];
    try { return r?.proof_keys ? JSON.parse(String(r.proof_keys)) : []; } catch { return []; }
  }
  /**
   * The customer's verdict on one reported decision: `correct`, or `wrong` (a person was stopped, or an agent was
   * let through). This is the only ground truth a security product ever gets from the field; the false-stop rate
   * on the overview is computed from it.
   */
  async setTelemetryFeedback(keyId: string, id: number, feedback: 'correct' | 'wrong' | null, note: string | null, now = Date.now()): Promise<boolean> {
    const r = await this.sql.execute('UPDATE telemetry SET feedback = ?, feedback_note = ?, feedback_at = ? WHERE id = ? AND key_id = ?', [feedback, note, feedback ? now : null, id, keyId]);
    return r.rowsAffected > 0;
  }
  /** Feedback totals for one key in range: how many gated decisions were marked wrong (false stops), how many allows were (misses). */
  async telemetryFeedback(keyId: string, since: number): Promise<{ reviewed: number; falseStops: number; misses: number; gated: number }> {
    const r = (await this.sql.execute(`SELECT
      SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END) AS reviewed,
      SUM(CASE WHEN feedback = 'wrong' AND decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS false_stops,
      SUM(CASE WHEN feedback = 'wrong' AND decision = 'allow' THEN 1 ELSE 0 END) AS misses,
      SUM(CASE WHEN decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS gated
      FROM telemetry WHERE key_id = ? AND at >= ?`, [keyId, since])).rows[0] ?? {};
    return { reviewed: Number(r.reviewed ?? 0), falseStops: Number(r.false_stops ?? 0), misses: Number(r.misses ?? 0), gated: Number(r.gated ?? 0) };
  }

  /**
   * Integration health for one key: is the server reporting, does the page send browser signals, do the
   * signatures verify, is the policy enforcing — and the number a bank asks first: how many people were stopped.
   * "People stopped" counts decisions the engine itself called human-like that were still blocked or masked,
   * plus gated decisions the customer graded wrong. A person the engine could not tell apart is asked to
   * confirm with a passkey (step_up) — counted separately, never as blocked.
   */
  async telemetryHealth(keyId: string, since: number): Promise<TelemetryHealth> {
    const [agg, last] = await Promise.all([
      this.sql.execute(`SELECT COUNT(*) AS n, MAX(at) AS last, COUNT(DISTINCT session) AS sessions,
        COUNT(DISTINCT CASE WHEN reasons NOT LIKE '%"NO_CLIENT_TELEMETRY"%' THEN session END) AS sdk_sessions,
        SUM(CASE WHEN proof IS NOT NULL THEN 1 ELSE 0 END) AS proofs,
        SUM(CASE WHEN proof_ok = 1 THEN 1 ELSE 0 END) AS proofs_ok,
        COUNT(DISTINCT CASE WHEN actor = 'human_like' THEN session END) AS human_sessions,
        SUM(CASE WHEN actor = 'human_like' AND decision IN ('block','mask') THEN 1 ELSE 0 END) AS human_gated,
        SUM(CASE WHEN feedback = 'wrong' AND decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS false_stops,
        SUM(CASE WHEN decision = 'step_up' THEN 1 ELSE 0 END) AS step_ups,
        COUNT(DISTINCT CASE WHEN decision = 'step_up' THEN session END) AS step_up_sessions,
        COUNT(DISTINCT CASE WHEN (state IN ('agent_attached','signed_agent') OR actor = 'agent_likely') THEN session END) AS agent_sessions,
        SUM(CASE WHEN (state IN ('agent_attached','signed_agent') OR actor = 'agent_likely') AND decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS agent_gated
        FROM telemetry WHERE key_id = ? AND at >= ?`, [keyId, since]),
      this.sql.execute('SELECT at, enforcement, version FROM telemetry WHERE key_id = ? ORDER BY at DESC, id DESC LIMIT 1', [keyId]),
    ]);
    const a = agg.rows[0] ?? {};
    const l = last.rows[0];
    const n = (v: unknown) => Number(v ?? 0);
    return {
      events: n(a.n), last: l ? n(l.at) : null, sessions: n(a.sessions), sdkSessions: n(a.sdk_sessions),
      proofs: n(a.proofs), proofsOk: n(a.proofs_ok), enforcement: l ? String(l.enforcement) : null, version: l ? String(l.version) : null,
      people: { sessions: n(a.human_sessions), stopped: n(a.human_gated) + n(a.false_stops), engineStopped: n(a.human_gated), gradedWrong: n(a.false_stops), askedToConfirm: n(a.step_ups), askedSessions: n(a.step_up_sessions) },
      agents: { sessions: n(a.agent_sessions), gated: n(a.agent_gated) },
    };
  }

  /** One week against the week before, for the weekly report. `end` is exclusive. */
  async telemetryWeek(keyId: string, start: number, end: number): Promise<TelemetryWeek> {
    const agentCase = "(state IN ('agent_attached','signed_agent') OR actor = 'agent_likely')";
    const [agg, tools, res] = await Promise.all([
      this.sql.execute(`SELECT COUNT(*) AS n, COUNT(DISTINCT session) AS sessions, COUNT(DISTINCT CASE WHEN ${agentCase} THEN session END) AS agent_sessions,
        SUM(CASE WHEN ${agentCase} AND decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS agent_gated,
        SUM(CASE WHEN actor = 'human_like' AND decision IN ('block','mask') THEN 1 ELSE 0 END) + SUM(CASE WHEN feedback = 'wrong' AND decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS people_stopped,
        SUM(CASE WHEN decision = 'step_up' THEN 1 ELSE 0 END) AS step_ups,
        SUM(CASE WHEN proof_ok = 1 THEN 1 ELSE 0 END) AS signed
        FROM telemetry WHERE key_id = ? AND at >= ? AND at < ?`, [keyId, start, end]),
      this.sql.execute("SELECT tools, COUNT(DISTINCT session) AS n FROM telemetry WHERE key_id = ? AND at >= ? AND at < ? AND tools != '[]' GROUP BY tools", [keyId, start, end]),
      this.sql.execute(`SELECT resource, COUNT(*) AS n, SUM(CASE WHEN decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS gated FROM telemetry WHERE key_id = ? AND at >= ? AND at < ? AND ${agentCase} GROUP BY resource ORDER BY n DESC LIMIT 6`, [keyId, start, end]),
    ]);
    const a = agg.rows[0] ?? {};
    const n = (v: unknown) => Number(v ?? 0);
    const toolCounts: Record<string, number> = {};
    for (const x of tools.rows) { let arr: unknown = []; try { arr = JSON.parse(String(x.tools)); } catch { /* ignore */ } if (Array.isArray(arr)) for (const t of arr) toolCounts[String(t)] = (toolCounts[String(t)] ?? 0) + n(x.n); }
    return {
      decisions: n(a.n), sessions: n(a.sessions), agentSessions: n(a.agent_sessions), agentGated: n(a.agent_gated), peopleStopped: n(a.people_stopped), stepUps: n(a.step_ups), signed: n(a.signed),
      tools: Object.entries(toolCounts).sort((x, y) => y[1] - x[1]).map(([tool, sessions]) => ({ tool, sessions })),
      agentResources: res.rows.map((x) => ({ resource: String(x.resource), n: n(x.n), gated: n(x.gated) })),
    };
  }

  /** Signed decisions for one key (optionally one session), oldest first, for a proof bundle. */
  async telemetryProofs(keyId: string, since: number, session: string | null, limit = 5000): Promise<{ at: number; session: string; proof: string; ok: boolean }[]> {
    const r = session
      ? await this.sql.execute('SELECT at, session, proof, proof_ok FROM telemetry WHERE key_id = ? AND at >= ? AND session = ? AND proof IS NOT NULL ORDER BY id LIMIT ?', [keyId, since, session, limit])
      : await this.sql.execute('SELECT at, session, proof, proof_ok FROM telemetry WHERE key_id = ? AND at >= ? AND proof IS NOT NULL ORDER BY id LIMIT ?', [keyId, since, limit]);
    return r.rows.map((x) => ({ at: Number(x.at), session: String(x.session), proof: String(x.proof), ok: Number(x.proof_ok) === 1 }));
  }

  /**
   * Store reported events. A reporter retries a batch when the answer did not reach it (a timeout on a cold
   * start), so events that carry an id already stored for this key are dropped, and only new ones count.
   * Returns how many were new.
   */
  async insertTelemetry(keyId: string, events: TelemetryEvent[], now = Date.now()): Promise<number> {
    const ids = events.map((e) => e.eid).filter((x): x is string => !!x);
    if (ids.length) {
      const seen = new Set((await this.sql.execute(`SELECT eid FROM telemetry WHERE key_id = ? AND eid IN (${ids.map(() => '?').join(',')})`, [keyId, ...ids])).rows.map((r) => String(r.eid)));
      const once = new Set<string>();
      events = events.filter((e) => !e.eid || (!seen.has(e.eid) && !once.has(e.eid) && once.add(e.eid)));
    }
    if (!events.length) return 0;
    await this.sql.batch([
      ...events.map((e) => ({ sql: 'INSERT OR IGNORE INTO telemetry (key_id, at, session, resource, decision, computed, actor, state, tools, reasons, enforcement, version, proof, proof_kid, proof_ok, eid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [keyId, e.at, e.session, e.resource, e.decision, e.computed ?? e.decision, e.actor, e.state, JSON.stringify(e.tools), JSON.stringify(e.reasons), e.enforcement, e.version, e.proof ?? null, e.proofKid ?? null, e.proofOk == null ? null : e.proofOk ? 1 : 0, e.eid ?? null] as SqlArg[] })),
      { sql: 'UPDATE api_keys SET last_seen = ?, events = events + ? WHERE id = ?', args: [now, events.length, keyId] },
    ]);
    return events.length;
  }
  /** one key's reported decisions in a range, in the shape the design-partner report is built from */
  async telemetryDecisions(keyId: string, from: number, to: number): Promise<{ session: string; created: number; resource: string; decision: string; computed: string; actor: string; tools: string[]; signed: boolean; enforced: boolean }[]> {
    const rows = (await this.sql.execute('SELECT session, at, resource, decision, COALESCE(computed, decision) AS computed, actor, tools, enforcement, proof IS NOT NULL AS signed FROM telemetry WHERE key_id = ? AND at >= ? AND at < ? ORDER BY at', [keyId, from, to])).rows;
    return rows.map((r) => ({ session: String(r.session), created: Number(r.at), resource: String(r.resource), decision: String(r.decision), computed: String(r.computed), actor: String(r.actor), tools: safeList(r.tools), signed: Number(r.signed) === 1, enforced: r.enforcement === 'enforce' }));
  }
  /** everything the portal shows for one key since `since` */
  async telemetryStats(keyId: string, since: number, bucketMs: number): Promise<TelemetryStats> {
    const agentCase = "(state IN ('agent_attached','signed_agent') OR actor = 'agent_likely')";
    const [dec, act, st, res, tools, sess, series, recent] = await Promise.all([
      this.sql.execute('SELECT decision, COUNT(*) AS n FROM telemetry WHERE key_id = ? AND at >= ? GROUP BY decision', [keyId, since]),
      this.sql.execute('SELECT actor, COUNT(*) AS n FROM telemetry WHERE key_id = ? AND at >= ? GROUP BY actor', [keyId, since]),
      this.sql.execute('SELECT state, COUNT(*) AS n FROM telemetry WHERE key_id = ? AND at >= ? GROUP BY state', [keyId, since]),
      this.sql.execute('SELECT resource, decision, COUNT(*) AS n FROM telemetry WHERE key_id = ? AND at >= ? GROUP BY resource, decision ORDER BY n DESC LIMIT 60', [keyId, since]),
      this.sql.execute("SELECT tools, COUNT(DISTINCT session) AS n FROM telemetry WHERE key_id = ? AND at >= ? AND tools != '[]' GROUP BY tools", [keyId, since]),
      this.sql.execute(`SELECT COUNT(DISTINCT session) AS total, COUNT(DISTINCT CASE WHEN ${agentCase} THEN session END) AS agent FROM telemetry WHERE key_id = ? AND at >= ?`, [keyId, since]),
      this.sql.execute(`SELECT CAST(at / ? AS INTEGER) * ? AS t, COUNT(*) AS n, SUM(CASE WHEN ${agentCase} THEN 1 ELSE 0 END) AS agent, SUM(CASE WHEN decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS gated FROM telemetry WHERE key_id = ? AND at >= ? GROUP BY t ORDER BY t`, [bucketMs, bucketMs, keyId, since]),
      this.sql.execute('SELECT id, at, session, resource, decision, actor, state, tools, reasons, enforcement, proof_ok, feedback FROM telemetry WHERE key_id = ? AND at >= ? ORDER BY id DESC LIMIT 60', [keyId, since]),
    ]);
    const toolCounts: Record<string, number> = {};
    for (const x of tools.rows) { let arr: unknown = []; try { arr = JSON.parse(String(x.tools)); } catch { /* ignore */ } if (Array.isArray(arr)) for (const t of arr) toolCounts[String(t)] = (toolCounts[String(t)] ?? 0) + Number(x.n); }
    const s0 = sess.rows[0] ?? {};
    return {
      decisions: Object.fromEntries(dec.rows.map((x) => [String(x.decision), Number(x.n)])),
      actors: Object.fromEntries(act.rows.map((x) => [String(x.actor), Number(x.n)])),
      states: Object.fromEntries(st.rows.map((x) => [String(x.state), Number(x.n)])),
      resources: res.rows.map((x) => ({ resource: String(x.resource), decision: String(x.decision), n: Number(x.n) })),
      tools: Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).map(([tool, sessions]) => ({ tool, sessions })),
      sessions: { total: Number(s0.total ?? 0), agent: Number(s0.agent ?? 0) },
      series: series.rows.map((x) => ({ t: Number(x.t), n: Number(x.n), agent: Number(x.agent), gated: Number(x.gated) })),
      recent: recent.rows.map((x) => ({ id: Number(x.id), at: Number(x.at), session: String(x.session), resource: String(x.resource), decision: String(x.decision), actor: String(x.actor), state: String(x.state), tools: safeList(x.tools), reasons: safeList(x.reasons), enforcement: String(x.enforcement), signed: x.proof_ok == null ? null : Number(x.proof_ok) === 1, feedback: x.feedback == null ? null : String(x.feedback) })),
    };
  }

  /** the decision log, oldest-last, paged by id so an export can walk the whole range */
  async telemetryEvents(keyId: string, since: number, beforeId: number | null, limit: number): Promise<{ id: number; at: number; session: string; resource: string; decision: string; actor: string; state: string; tools: string[]; reasons: string[]; enforcement: string; signed: boolean | null; feedback: string | null }[]> {
    const r = beforeId == null
      ? await this.sql.execute('SELECT id, at, session, resource, decision, actor, state, tools, reasons, enforcement, proof_ok, feedback FROM telemetry WHERE key_id = ? AND at >= ? ORDER BY id DESC LIMIT ?', [keyId, since, limit])
      : await this.sql.execute('SELECT id, at, session, resource, decision, actor, state, tools, reasons, enforcement, proof_ok, feedback FROM telemetry WHERE key_id = ? AND at >= ? AND id < ? ORDER BY id DESC LIMIT ?', [keyId, since, beforeId, limit]);
    return r.rows.map((x) => ({
      id: Number(x.id), at: Number(x.at), session: String(x.session), resource: String(x.resource), decision: String(x.decision),
      actor: String(x.actor), state: String(x.state), tools: safeList(x.tools), reasons: safeList(x.reasons), enforcement: String(x.enforcement),
      signed: x.proof_ok == null ? null : Number(x.proof_ok) === 1, feedback: x.feedback == null ? null : String(x.feedback),
    }));
  }

  /** the overview: every key of an account, per bucket and in total, in two queries */
  async telemetryOverview(account: string, since: number, bucketMs: number): Promise<TelemetryOverview> {
    const agentCase = "(t.state IN ('agent_attached','signed_agent') OR t.actor = 'agent_likely')";
    const [series, totals] = await Promise.all([
      this.sql.execute(`SELECT t.key_id AS key_id, CAST(t.at / ? AS INTEGER) * ? AS b, COUNT(*) AS n, SUM(CASE WHEN ${agentCase} THEN 1 ELSE 0 END) AS agent, SUM(CASE WHEN t.decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS gated FROM telemetry t JOIN api_keys k ON k.id = t.key_id WHERE k.account = ? AND t.at >= ? GROUP BY t.key_id, b ORDER BY b`, [bucketMs, bucketMs, account, since]),
      this.sql.execute(`SELECT t.key_id AS key_id, COUNT(*) AS n, COUNT(DISTINCT t.session) AS sessions, COUNT(DISTINCT CASE WHEN ${agentCase} THEN t.session END) AS agent_sessions, SUM(CASE WHEN t.decision IN ('mask','block','step_up') THEN 1 ELSE 0 END) AS gated, MAX(t.at) AS last FROM telemetry t JOIN api_keys k ON k.id = t.key_id WHERE k.account = ? AND t.at >= ? GROUP BY t.key_id`, [account, since]),
    ]);
    return {
      series: series.rows.map((x) => ({ key: String(x.key_id), t: Number(x.b), n: Number(x.n), agent: Number(x.agent), gated: Number(x.gated) })),
      totals: totals.rows.map((x) => ({ key: String(x.key_id), n: Number(x.n), sessions: Number(x.sessions), agentSessions: Number(x.agent_sessions), gated: Number(x.gated), last: Number(x.last) })),
    };
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
