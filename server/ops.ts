// SPDX-License-Identifier: BUSL-1.1
/**
 * The operators' view of onehuman.ai itself (/ops): who visited, from which kind of device, what they tried in the
 * demos, which accounts and integrations are live, and every page and state-changing call in order.
 *
 *   access   a signed-in portal account whose id is in ONEHUMAN_OPS_ACCOUNTS (comma-separated); anyone else gets
 *            the same 404 as an unknown path, so the page does not advertise itself
 *   privacy  no raw IP and no raw user agent are stored: a keyed hash of both identifies a device, plus the browser
 *            and OS family, mobile or not, and the country/city the host reports; visits are kept 90 days
 */
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Store } from './db.ts';
import { clientIp } from './limits.ts';
import { json, url, type Req, type Res } from './http.ts';
import type { Row } from './sql.ts';

const KEEP_MS = 90 * 86400000;
const DAY = 86400000;

// ---------------------------------------------------------------------------------------------- devices

/** Browser and OS family from a user agent; the raw string is never stored. */
export function uaFamily(ua: string): { browser: string; os: string; mobile: boolean; bot: boolean } {
  // link previews (a link shared in WhatsApp, Telegram, Slack…) open the page too; they are not people
  const bot = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|WhatsApp|Telegram|Slack|Discord|LinkedIn|Twitter|Viber|SkypeUriPreview|vkShare|Pinterest|redditbot|Iframely|Google-Read-Aloud/i.test(ua);
  const app = /\bClaude\/[\d.]+/.test(ua) ? 'Claude app' : /ChatGPT|Atlas\//.test(ua) ? 'ChatGPT Atlas' : /Comet\//.test(ua) ? 'Comet' : null;
  const browser = app
    ?? (/Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /^curl\//.test(ua) ? 'curl' : /python|node|axios|go-http|wget|java\//i.test(ua) ? 'script' : ua ? 'other' : 'none');
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  return { browser, os, mobile: /Mobi|iPhone|Android.+Mobile/.test(ua), bot };
}

/** Pages, and the calls that change something. Polling, SDK signals and customer telemetry have their own tables. */
function kindOf(method: string, path: string): 'page' | 'action' | null {
  if (path.startsWith('/api/v1/ops') || path === '/ops' || path === '/api/v1/visit') return null;
  if (method === 'GET') {
    if (path.startsWith('/api/') || path.startsWith('/sdk/') || path.startsWith('/onehuman/') || /\.[a-z0-9]{1,5}$/i.test(path)) return null;
    return 'page';
  }
  if (!path.startsWith('/api/')) return null;
  if (/^\/api\/v1\/(signals|ingest|sandbox\/noop|key-policy)/.test(path)) return null;
  return 'action';
}

export function visitLog(store: Store, secret: Buffer | undefined, accountOf: (req: Req) => Promise<string | null>) {
  const key = secret ? Buffer.from(hkdfSync('sha256', secret, 'onehuman', 'ops-device-id', 32)) : randomBytes(32);
  const deviceOf = (req: Req): string => createHmac('sha256', key).update(`${clientIp(req)}|${String(req.headers['user-agent'] ?? '')}`).digest('hex').slice(0, 16);

  // A flood from one client must not become a flood of log rows: at most PER_MINUTE rows per device per instance,
  // and answers that were refused for rate (429) are not logged at all.
  const PER_MINUTE = 60;
  const recent = new Map<string, { n: number; at: number }>();
  const allowed = (device: string) => {
    const now = Date.now(); const w = recent.get(device);
    if (!w || now - w.at > 60e3) { recent.set(device, { n: 1, at: now }); if (recent.size > 20000) recent.clear(); return true; }
    return ++w.n <= PER_MINUTE;
  };

  /** a page served from the CDN cache, counted by its beacon */
  async function page(req: Req, path: string, referrer: string | null): Promise<void> {
    try {
      const device = deviceOf(req);
      if (!allowed(device)) return;
      const fam = uaFamily(String(req.headers['user-agent'] ?? ''));
      const h = (n: string) => { const v = req.headers[n]; const x = Array.isArray(v) ? v[0] : v; return x ? decodeURIComponent(x).slice(0, 60) : null; };
      await store.addVisit({ at: Date.now(), device, account: null, method: 'GET', path, kind: 'page', status: 200, ms: 0, ...fam, country: h('x-vercel-ip-country'), city: h('x-vercel-ip-city'), referrer: referrer || null }, KEEP_MS);
    } catch { /* never breaks anything */ }
  }

  /** called after the response is sent; never throws */
  async function record(req: Req, res: Res, startedAt: number): Promise<void> {
    try {
      const u = url(req);
      const method = req.method ?? 'GET';
      const kind = kindOf(method, u.pathname);
      if (!kind || res.statusCode === 429) return;
      if (kind === 'page' && String(res.getHeader('Cache-Control') ?? '').startsWith('public')) return;   // edge-cached page: its beacon counts it
      if (!allowed(deviceOf(req))) return;
      const ua = String(req.headers['user-agent'] ?? '');
      const fam = uaFamily(ua);
      // internet-wide scanners probing for leaked files are not visitors, whatever browser they claim
      if (/^\/(\.env|\.git|wp-|wordpress|xmlrpc|phpmyadmin|cgi-bin|vendor\/|\.aws|\.ssh|server-status)|\.(php|asp|aspx|jsp|bak|sql)$/i.test(u.pathname)) fam.bot = true;
      const h = (n: string) => { const v = req.headers[n]; const s = Array.isArray(v) ? v[0] : v; return s ? decodeURIComponent(s).slice(0, 60) : null; };
      let referrer: string | null = null;
      try { const r = req.headers.referer; if (r) { const rh = new URL(r).host; if (rh && rh !== req.headers.host) referrer = rh.slice(0, 80); } } catch { /* bad referer */ }
      const account = u.pathname.startsWith('/api/v1/portal') || u.pathname === '/portal' ? await accountOf(req).catch(() => null) : null;
      await store.addVisit({
        at: startedAt, device: deviceOf(req), account, method, path: u.pathname.slice(0, 160), kind, status: res.statusCode, ms: Date.now() - startedAt,
        ...fam, country: h('x-vercel-ip-country'), city: h('x-vercel-ip-city'), referrer,
      }, KEEP_MS);
    } catch { /* the log must never break a request */ }
  }
  return { deviceOf, record, page };
}

// ---------------------------------------------------------------------------------------------- the view

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? null : String(v));
const parse = (v: unknown): unknown => { try { return JSON.parse(String(v)); } catch { return null; } };

export function opsRoutes(store: Store, deps: { accountOf: (req: Req) => Promise<string | null>; admins: () => Set<string> }) {
  const isOps = async (req: Req) => {
    const admins = deps.admins();
    if (!admins.size) return false;
    const account = await deps.accountOf(req).catch(() => null);
    return !!account && admins.has(account);
  };
  const since = (req: Req) => {
    const r = url(req).searchParams.get('range') ?? '7d';
    const days = r === 'all' ? 3650 : Math.min(3650, Math.max(1, parseInt(r, 10) || 7));
    return Date.now() - days * DAY;
  };
  const guard = (h: (req: Req, res: Res) => Promise<void>) => async (req: Req, res: Res) => {
    if (!(await isOps(req))) return json(res, 404, { error: 'not_found' });
    res.setHeader('Cache-Control', 'no-store');
    await h(req, res);
  };
  const q = (sql: string, args: (string | number | null)[] = []) => store.report(sql, args);
  const emails = async (ids: string[]) => {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, string>();
    const rows = await q(`SELECT id, email FROM accounts WHERE id IN (${uniq.map(() => '?').join(',')})`, uniq);
    return new Map(rows.map((r) => [String(r.id), String(r.email)]));
  };
  const counts = (rows: Row[], k = 'k') => rows.map((r) => ({ key: s(r[k]) ?? '—', n: n(r.n) }));

  const overview = guard(async (req, res) => {
    const from = since(req);
    const human = 'bot = 0';
    const [dev, views, series, pages, countries, browsers, oses, refs] = await Promise.all([
      q(`SELECT COUNT(DISTINCT device) AS n, SUM(mobile) AS m FROM (SELECT device, MAX(mobile) AS mobile FROM visits WHERE at >= ? AND ${human} GROUP BY device)`, [from]),
      q(`SELECT COUNT(*) AS n FROM visits WHERE at >= ? AND ${human} AND kind = 'page'`, [from]),
      q(`SELECT at / ${DAY} AS d, COUNT(DISTINCT device) AS devices, SUM(kind = 'page') AS views FROM visits WHERE at >= ? AND ${human} GROUP BY d ORDER BY d`, [from]),
      q(`SELECT path AS k, COUNT(*) AS n, COUNT(DISTINCT device) AS devices FROM visits WHERE at >= ? AND ${human} AND kind = 'page' GROUP BY path ORDER BY n DESC LIMIT 20`, [from]),
      q(`SELECT COALESCE(country, '?') AS k, COUNT(DISTINCT device) AS n FROM visits WHERE at >= ? AND ${human} GROUP BY k ORDER BY n DESC LIMIT 15`, [from]),
      q(`SELECT browser AS k, COUNT(DISTINCT device) AS n FROM visits WHERE at >= ? AND ${human} GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT os AS k, COUNT(DISTINCT device) AS n FROM visits WHERE at >= ? AND ${human} GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT referrer AS k, COUNT(DISTINCT device) AS n FROM visits WHERE at >= ? AND ${human} AND referrer IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 10`, [from]),
    ]);
    const [demo, decisions, actors, apps, tools, portal, integ, assist, feedback, samples, bots] = await Promise.all([
      q(`SELECT COUNT(DISTINCT r.id) AS rooms, COUNT(DISTINCT r.device) AS devices, COUNT(s.id) AS sessions,
           SUM(s.first_agent_at IS NOT NULL OR s.agent_attached_at IS NOT NULL) AS agent, SUM(s.human_verified_at IS NOT NULL) AS passkey
         FROM sessions s JOIN rooms r ON r.id = s.room WHERE s.created >= ? AND r.app NOT LIKE 'tenant:%'`, [from]),
      q(`SELECT json_extract(d.body, '$.decision') AS k, COUNT(*) AS n FROM decisions d JOIN rooms r ON r.id = d.room WHERE d.created >= ? AND r.app NOT LIKE 'tenant:%' GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT json_extract(d.body, '$.actor') AS k, COUNT(*) AS n FROM decisions d JOIN rooms r ON r.id = d.room WHERE d.created >= ? AND r.app NOT LIKE 'tenant:%' GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT r.app AS k, COUNT(s.id) AS n FROM sessions s JOIN rooms r ON r.id = s.room WHERE s.created >= ? AND r.app NOT LIKE 'tenant:%' GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT t.value AS k, COUNT(DISTINCT d.session) AS n FROM decisions d JOIN rooms r ON r.id = d.room, json_each(COALESCE(json_extract(d.body, '$.tools'), '[]')) t
         WHERE d.created >= ? AND r.app NOT LIKE 'tenant:%' GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM accounts WHERE created >= ?) AS newAccounts,
           (SELECT COUNT(*) FROM api_keys WHERE revoked IS NULL) AS keys, (SELECT COUNT(*) FROM api_keys WHERE last_seen >= ?) AS liveKeys,
           (SELECT COUNT(*) FROM telemetry WHERE at >= ?) AS events, (SELECT COUNT(DISTINCT key_id || session) FROM telemetry WHERE at >= ?) AS sessions,
           (SELECT COUNT(DISTINCT key_id || session) FROM telemetry WHERE at >= ? AND (state IN ('agent_attached', 'signed_agent') OR actor = 'agent_likely')) AS agentSessions`, [from, from, from, from, from]),
      q(`SELECT COUNT(*) AS n FROM key_policies WHERE seen_at >= ?`, [from]),
      q(`SELECT COUNT(*) AS n FROM assist_log WHERE at >= ?`, [from]),
      q(`SELECT feedback AS k, COUNT(*) AS n FROM telemetry WHERE feedback_at >= ? GROUP BY k`, [from]),
      q(`SELECT label || ' → ' || verdict AS k, COUNT(*) AS n FROM samples WHERE created >= ? GROUP BY k ORDER BY n DESC`, [from]),
      q(`SELECT COUNT(DISTINCT device) AS n FROM visits WHERE at >= ? AND bot = 1`, [from]),
    ]);
    json(res, 200, {
      from,
      visitors: { devices: n(dev[0]?.n), mobile: n(dev[0]?.m), views: n(views[0]?.n), bots: n(bots[0]?.n) },
      series: series.map((r) => ({ day: n(r.d) * DAY, devices: n(r.devices), views: n(r.views) })),
      pages: pages.map((r) => ({ key: s(r.k), n: n(r.n), devices: n(r.devices) })),
      countries: counts(countries), browsers: counts(browsers), os: counts(oses), referrers: counts(refs),
      demo: { rooms: n(demo[0]?.rooms), devices: n(demo[0]?.devices), sessions: n(demo[0]?.sessions), agentSessions: n(demo[0]?.agent), passkey: n(demo[0]?.passkey),
        decisions: counts(decisions), actors: counts(actors), apps: counts(apps), tools: counts(tools) },
      portal: { accounts: n(portal[0]?.accounts), newAccounts: n(portal[0]?.newAccounts), keys: n(portal[0]?.keys), liveKeys: n(portal[0]?.liveKeys),
        events: n(portal[0]?.events), sessions: n(portal[0]?.sessions), agentSessions: n(portal[0]?.agentSessions), integrationsSeen: n(integ[0]?.n), assistCalls: n(assist[0]?.n),
        feedback: counts(feedback) },
      lab: { samples: counts(samples) },
    });
  });

  const devices = guard(async (req, res) => {
    const from = since(req);
    const rows = await q(`
      WITH v AS (SELECT device, MIN(at) AS first, MAX(at) AS last, SUM(kind = 'page') AS views, SUM(kind = 'action') AS actions,
                   MAX(browser) AS browser, MAX(os) AS os, MAX(mobile) AS mobile, MAX(country) AS country, MAX(city) AS city,
                   GROUP_CONCAT(DISTINCT account) AS accounts, GROUP_CONCAT(DISTINCT CASE WHEN kind = 'page' THEN path END) AS paths
                 FROM visits WHERE at >= ? AND bot = 0 GROUP BY device)
      SELECT v.*,
        (SELECT COUNT(*) FROM rooms r WHERE r.device = v.device) AS rooms,
        (SELECT COUNT(*) FROM sessions x JOIN rooms r ON r.id = x.room WHERE r.device = v.device) AS sessions,
        (SELECT COUNT(*) FROM sessions x JOIN rooms r ON r.id = x.room WHERE r.device = v.device AND (x.first_agent_at IS NOT NULL OR x.agent_attached_at IS NOT NULL)) AS agentSessions,
        (SELECT COUNT(*) FROM decisions d JOIN rooms r ON r.id = d.room WHERE r.device = v.device) AS decisions
      FROM v ORDER BY last DESC LIMIT 500`, [from]);
    const mail = await emails(rows.flatMap((r) => String(r.accounts ?? '').split(',')));
    json(res, 200, { devices: rows.map((r) => ({
      device: s(r.device), first: n(r.first), last: n(r.last), views: n(r.views), actions: n(r.actions), browser: s(r.browser), os: s(r.os), mobile: !!n(r.mobile),
      country: s(r.country), city: s(r.city), paths: String(r.paths ?? '').split(',').filter(Boolean).slice(0, 12),
      accounts: String(r.accounts ?? '').split(',').filter(Boolean).map((a) => mail.get(a) ?? a),
      rooms: n(r.rooms), sessions: n(r.sessions), agentSessions: n(r.agentSessions), decisions: n(r.decisions),
    })) });
  });

  const demo = guard(async (req, res) => {
    const from = since(req);
    const device = url(req).searchParams.get('device');
    const rows = await q(`
      SELECT x.id, x.room, r.app, r.device, x.label, x.created, x.last_seen, x.first_agent_at, x.agent_attached_at, x.human_verified_at,
        (SELECT COUNT(*) FROM events e WHERE e.session = x.id) AS events,
        (SELECT json_group_array(json_object('d', json_extract(d.body, '$.decision'), 'a', json_extract(d.body, '$.actor'), 'r', json_extract(d.body, '$.resource')))
           FROM decisions d WHERE d.session = x.id) AS decs,
        (SELECT json_group_array(DISTINCT t.value) FROM decisions d, json_each(COALESCE(json_extract(d.body, '$.tools'), '[]')) t WHERE d.session = x.id) AS tools,
        (SELECT browser || ' · ' || os || COALESCE(' · ' || country, '') FROM visits v WHERE v.device = r.device ORDER BY v.id DESC LIMIT 1) AS client
      FROM sessions x JOIN rooms r ON r.id = x.room
      WHERE x.created >= ? AND r.app NOT LIKE 'tenant:%' ${device ? 'AND r.device = ?' : ''}
      ORDER BY x.created DESC LIMIT 400`, device ? [from, device] : [from]);
    json(res, 200, { sessions: rows.map((r) => ({
      id: s(r.id), room: s(r.room), app: s(r.app), device: s(r.device), client: s(r.client), label: s(r.label), created: n(r.created), lastSeen: n(r.last_seen),
      firstAgentAt: r.first_agent_at == null ? null : n(r.first_agent_at), attachedAt: r.agent_attached_at == null ? null : n(r.agent_attached_at),
      passkeyAt: r.human_verified_at == null ? null : n(r.human_verified_at), events: n(r.events),
      decisions: (parse(r.decs) as { d: string; a: string; r: string }[] | null) ?? [], tools: ((parse(r.tools) as string[] | null) ?? []).filter(Boolean),
    })) });
  });

  const session = guard(async (req, res) => {
    const id = url(req).searchParams.get('id') ?? '';
    const [row] = await q(`SELECT x.*, r.app, r.device FROM sessions x JOIN rooms r ON r.id = x.room WHERE x.id = ?`, [id]);
    if (!row) return json(res, 404, { error: 'not_found' });
    const [events, decisions] = await Promise.all([
      q('SELECT id, kind, created, substr(payload, 1, 4000) AS payload FROM events WHERE session = ? ORDER BY id LIMIT 400', [id]),
      q('SELECT seq, created, body FROM decisions WHERE session = ? ORDER BY seq LIMIT 200', [id]),
    ]);
    json(res, 200, {
      session: { id, app: s(row.app), device: s(row.device), label: s(row.label), created: n(row.created), lastSeen: n(row.last_seen), arrival: parse(row.arrival),
        firstAgentAt: row.first_agent_at == null ? null : n(row.first_agent_at), attachedAt: row.agent_attached_at == null ? null : n(row.agent_attached_at),
        passkeyAt: row.human_verified_at == null ? null : n(row.human_verified_at) },
      events: events.map((e) => ({ id: n(e.id), kind: s(e.kind), at: n(e.created), payload: parse(e.payload) ?? s(e.payload) })),
      decisions: decisions.map((d) => ({ seq: n(d.seq), at: n(d.created), body: parse(d.body) })),
    });
  });

  const portal = guard(async (req, res) => {
    const from = since(req);
    const [accounts, keys, feedback] = await Promise.all([
      q(`SELECT a.id, a.email, a.created, (SELECT COUNT(*) FROM api_keys k WHERE k.account = a.id) AS keys, (SELECT COUNT(*) FROM admin_keys k WHERE k.account = a.id AND k.revoked IS NULL) AS adminKeys,
           (SELECT MAX(k.last_seen) FROM api_keys k WHERE k.account = a.id) AS lastSeen, (SELECT COUNT(*) FROM assist_log l WHERE l.account = a.id) AS assist,
           (SELECT MAX(v.at) FROM visits v WHERE v.account = a.id) AS lastVisit
         FROM accounts a ORDER BY a.created DESC LIMIT 500`),
      q(`SELECT k.id, k.account, a.email, k.name, k.prefix, k.env, k.created, k.revoked, k.last_seen, k.events,
           p.n AS policyN, p.seen_version, p.seen_source, p.seen_at, (SELECT COUNT(*) FROM key_resources kr WHERE kr.key_id = k.id) AS resources,
           (SELECT COUNT(*) FROM telemetry t WHERE t.key_id = k.id AND t.at >= ?) AS eventsInRange,
           (SELECT COUNT(DISTINCT t.session) FROM telemetry t WHERE t.key_id = k.id AND t.at >= ? AND t.(state IN ('agent_attached', 'signed_agent') OR actor = 'agent_likely')) AS agentSessions,
           (SELECT GROUP_CONCAT(DISTINCT t.enforcement) FROM telemetry t WHERE t.key_id = k.id AND t.at >= ?) AS modes
         FROM api_keys k JOIN accounts a ON a.id = k.account LEFT JOIN key_policies p ON p.key_id = k.id ORDER BY COALESCE(k.last_seen, k.created) DESC LIMIT 500`, [from, from, from]),
      q(`SELECT t.id, t.at, t.resource, t.decision, t.actor, t.feedback, t.feedback_note, t.feedback_at, k.name AS keyName, a.email FROM telemetry t
           JOIN api_keys k ON k.id = t.key_id JOIN accounts a ON a.id = k.account WHERE t.feedback_at IS NOT NULL ORDER BY t.feedback_at DESC LIMIT 200`),
    ]);
    json(res, 200, {
      accounts: accounts.map((a) => ({ id: s(a.id), email: s(a.email), created: n(a.created), keys: n(a.keys), adminKeys: n(a.adminKeys), lastSeen: a.lastSeen == null ? null : n(a.lastSeen), assist: n(a.assist), lastVisit: a.lastVisit == null ? null : n(a.lastVisit) })),
      keys: keys.map((k) => ({ id: s(k.id), email: s(k.email), name: s(k.name), prefix: s(k.prefix), env: s(k.env), created: n(k.created), revoked: k.revoked == null ? null : n(k.revoked),
        lastSeen: k.last_seen == null ? null : n(k.last_seen), events: n(k.events), eventsInRange: n(k.eventsInRange), agentSessions: n(k.agentSessions), modes: s(k.modes),
        policy: k.policyN == null ? null : { n: n(k.policyN), seenVersion: s(k.seen_version), seenSource: s(k.seen_source), seenAt: k.seen_at == null ? null : n(k.seen_at) }, resources: n(k.resources) })),
      feedback: feedback.map((f) => ({ id: n(f.id), at: n(f.at), resource: s(f.resource), decision: s(f.decision), actor: s(f.actor), verdict: s(f.feedback), note: s(f.feedback_note), feedbackAt: n(f.feedback_at), key: s(f.keyName), email: s(f.email) })),
    });
  });

  const log = guard(async (req, res) => {
    const p = url(req).searchParams;
    const before = parseInt(p.get('before') ?? '', 10);
    const device = p.get('device');
    const where = ['1 = 1'];
    const args: (string | number)[] = [];
    if (Number.isFinite(before)) { where.push('id < ?'); args.push(before); }
    if (device) { where.push('device = ?'); args.push(device); }
    if (p.get('bots') !== '1') where.push('bot = 0');
    const rows = await q(`SELECT * FROM visits WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`, args);
    const mail = await emails(rows.map((r) => String(r.account ?? '')));
    json(res, 200, { rows: rows.map((r) => ({
      id: n(r.id), at: n(r.at), device: s(r.device), account: r.account ? mail.get(String(r.account)) ?? s(r.account) : null, method: s(r.method), path: s(r.path), kind: s(r.kind),
      status: n(r.status), ms: n(r.ms), browser: s(r.browser), os: s(r.os), mobile: !!n(r.mobile), bot: !!n(r.bot), country: s(r.country), city: s(r.city), referrer: s(r.referrer),
    })) });
  });

  return { isOps, overview, devices, demo, session, portal, log };
}
