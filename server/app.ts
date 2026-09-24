// SPDX-License-Identifier: BUSL-1.1
/**
 * HTTP application: wires routes, pages, the SDK and static files.
 *
 * `createApp()` returns a plain `(req, res)` handler so the same code runs as a
 * long-lived Node server (dev, self-hosted) or as a serverless function (Vercel).
 */
import { createServer, type Server } from 'node:http';
import { createPrivateKey, hkdfSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APPS, publicApp } from './apps.ts';
import { Store } from './db.ts';
import { NanoTarget } from './engine.ts';
import { attachModel, KINEMATICS_VERSION } from './kinematics.ts';
import { SIGNAL_VERSION } from './assess.ts';
import { loadModel, predict } from './kinematics-model.ts';
import { cookies, json, serveStatic, url, UUID, type Req, type Res } from './http.ts';
import { accountRoutes } from './routes/account.ts';
import { adminRoutes } from './routes/admin.ts';
import { labRoutes, type LabOperator } from './routes/lab.ts';
import { resourceRoutes } from './routes/resources.ts';
import { sandboxRoutes } from './routes/sandbox.ts';
import { portalRoutes } from './routes/portal.ts';
import { webauthnRoutes } from './routes/webauthn.ts';
import type { SqlClient } from './sql.ts';
import { httpsDirectoryLoader, KNOWN_OPERATORS, type KeyLoader, type OperatorKey } from './web-bot-auth.ts';

const ROOT = process.env.NT_ROOT ?? process.cwd();
const WEB = join(ROOT, 'web');
const SDK = join(ROOT, 'sdk');
const DOCS = join(ROOT, 'docs');

export type AppOptions = {
  /** storage client; default in-memory sqlite */
  client?: SqlClient;
  secret?: Buffer;
  labOperator?: boolean;
  /** serverless deployments: no SSE, secure cookies */
  serverless?: boolean;
  /** storage is per-instance memory: warn on pages */
  ephemeral?: boolean;
};

export type Handler = (req: Req, res: Res) => Promise<void>;

/**
 * Lab operator key pair. With a secret it is derived deterministically (HKDF →
 * Ed25519 seed) so every serverless instance holds the same key; otherwise random.
 */
async function labOperatorKeys(secret: Buffer | undefined): Promise<{ privateKey: CryptoKey; publicJwk: OperatorKey }> {
  if (secret) {
    const seed = Buffer.from(hkdfSync('sha256', secret, 'nanotarget', 'lab-operator-ed25519', 32));
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const jwk = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }).export({ format: 'jwk' }) as { x: string; d: string };
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d }, { name: 'Ed25519' }, false, ['sign']);
    return { privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: 'lab-key-1' } };
  }
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as OperatorKey;
  return { privateKey: pair.privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: 'lab-key-1' } };
}

export async function createApp(opts: AppOptions = {}): Promise<{ handler: Handler; server: Server; engine: NanoTarget; store: Store; labOperator: LabOperator }> {
  const store = await Store.open(opts.client);
  const model = await loadModel();
  attachModel(model ? { predict: (f) => predict(model, f), humanAbove: model.humanAbove, syntheticBelow: model.syntheticBelow } : null);
  const secret = opts.secret ?? randomBytes(32);
  const serverless = opts.serverless ?? false;
  const ephemeral = opts.ephemeral ?? false;

  // Optional lab operator: an Ed25519 key pair so the verified-signature path can be
  // demonstrated without ChatGPT's private key.
  let labOperator: LabOperator = null;
  let keyLoader: KeyLoader = httpsDirectoryLoader;
  if (opts.labOperator !== false) {
    const keys = await labOperatorKeys(opts.secret);
    labOperator = { operator: 'https://lab-operator.nanotarget.test', privateKey: keys.privateKey, publicJwk: keys.publicJwk };
    KNOWN_OPERATORS[labOperator.operator] = 'memory://lab';
    keyLoader = async (operator) => (operator === labOperator!.operator ? [keys.publicJwk] : httpsDirectoryLoader(operator));
  }

  const engine = new NanoTarget({ store, secret, keyLoader });
  engine.policyForApp = (app) => APPS[app]?.policy ?? null;
  const lab = labRoutes(engine, labOperator);
  const account = accountRoutes(engine);
  const admin = adminRoutes(engine);
  const wa = webauthnRoutes(engine);
  const resources = resourceRoutes(engine);
  const sandbox = sandboxRoutes(engine);

  const CSP = "default-src 'self'; img-src 'self' data: chrome-extension:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' chrome-extension:; frame-ancestors 'none'";
  const secure = (req: Req) => serverless || url(req).protocol === 'https:';
  const portal = portalRoutes(engine, { secure });

  /** Serve an HTML file with the session id and flags embedded. */
  async function page(res: Res, file: string, meta: Record<string, string>, headers: Record<string, string> = {}) {
    let html: string;
    try { html = await readFile(join(WEB, file), 'utf8'); } catch { json(res, 500, { error: 'missing_ui', file }); return; }
    const tags = Object.entries(meta).map(([k, v]) => `<meta name="${k}" content="${v.replace(/"/g, '&quot;')}">`).join('\n');
    html = html.replace('<head>', `<head>\n${tags}`);
    const body = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, ...headers });
    res.end(body);
  }

  /** An application page: ensures a room for this app, creates a session, embeds ids. `file` = product UI or technical lab UI. */
  const appPage = (appId: string, file = 'product.html') => async (req: Req, res: Res) => {
    const app = APPS[appId]!;
    const u = url(req);
    let room = u.searchParams.get('room');
    const roomOk = room && UUID.test(room) && (await store.roomExists(room)) && (await store.roomApp(room)) === appId;
    if (!roomOk) {
      room = await store.createRoom(Date.now(), appId);
      const next = new URL(u.href);
      next.searchParams.set('room', room);
      res.writeHead(302, { Location: next.pathname + next.search, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const as = u.searchParams.get('as');
    const label = as === 'human' || as === 'agent' ? as : 'unlabelled';
    const scenarioRaw = u.searchParams.get('scenario') ?? '';
    const scenario = /^[a-z0-9][a-z0-9-]{0,39}$/.test(scenarioRaw) ? scenarioRaw : '';
    const arrival = await engine.observe(req);
    const session = await store.createSession(room!, label, arrival, Date.now(), scenario);
    const headers: Record<string, string> = {};
    if (session) headers['Set-Cookie'] = `${engine.sessionCookie}=${session}; Path=/; HttpOnly; SameSite=Lax${secure(req) ? '; Secure' : ''}`;
    await page(res, file, { 'nt-session': session ?? '', 'nt-app': app.id, 'nt-serverless': serverless ? '1' : '0', 'nt-ephemeral': ephemeral ? '1' : '0' }, headers);
  };

  const landing = async (_req: Req, res: Res) => page(res, 'index.html', { 'nt-serverless': serverless ? '1' : '0', 'nt-ephemeral': ephemeral ? '1' : '0' });

  const dashboard = async (req: Req, res: Res) => {
    const room = url(req).searchParams.get('room');
    if (!room || !UUID.test(room) || !(await store.roomExists(room))) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    await page(res, 'dashboard.html', { 'nt-app': (await store.roomApp(room)) ?? 'bank', 'nt-serverless': serverless ? '1' : '0' });
  };

  const appsApi = async (_req: Req, res: Res) => json(res, 200, { apps: Object.values(APPS).map(publicApp) });

  type RouteHandler = (req: Req, res: Res) => void | Promise<void>;
  // The lab (training + sandbox + dataset endpoints) is the operator's, not the public's. With NT_LAB_KEY set,
  // it answers 404 unless the request carries the key (?key=… once, then a cookie); unset = open, for local work.
  const LAB_KEY = process.env.NT_LAB_KEY ?? '';
  const PUBLIC_DOCS = new Set(['INTEGRATION.md', 'INTEGRATION-AGENT.md']);
  const labOpen = (req: Req, res: Res): boolean => {
    if (!LAB_KEY) return true;
    if (url(req).searchParams.get('key') === LAB_KEY) {
      res.setHeader('Set-Cookie', `nt_lab=${LAB_KEY}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure(req) ? '; Secure' : ''}`);
      return true;
    }
    return cookies(req).nt_lab === LAB_KEY;
  };
  const labPage = (file: string) => async (req: Req, res: Res) => {
    if (!labOpen(req, res)) return json(res, 404, { error: 'not_found' });
    return page(res, file, { 'nt-serverless': serverless ? '1' : '0', 'nt-lab-key': LAB_KEY });
  };
  const labApi = (h: RouteHandler): RouteHandler => async (req, res) => (labOpen(req, res) ? h(req, res) : json(res, 404, { error: 'not_found' }));

  const routes: [string, string, RouteHandler][] = [
    ['GET', '/', landing],
    ['GET', '/bank', appPage('bank')],
    ['GET', '/crm', appPage('crm')],
    ['GET', '/insurance', appPage('insurance')],
    ['GET', '/dashboard', labApi(dashboard)],
    ['GET', '/sandbox', labPage('sandbox.html')],
    ['POST', '/api/v1/sandbox/samples', sandbox.addSample],
    ['GET', '/api/v1/sandbox/stats', labApi(sandbox.stats)],
    ['GET', '/api/v1/sandbox/export', labApi(sandbox.exportSamples)],
    ['POST', '/api/v1/sandbox/assess-run', sandbox.assessRun],
    // the lab pages load the SDK without a session; its passive pushes land here instead of 404
    ['POST', '/api/v1/sandbox/noop', async (_req, res) => json(res, 200, { ok: true })],
    ['GET', '/training', labPage('training.html')],
    // customer portal + middleware telemetry
    ['GET', '/docs', async (_req, res) => page(res, 'docs.html', {})],
    ['GET', '/trust', async (_req, res) => page(res, 'trust.html', {})],
    ['GET', '/privacy', async (_req, res) => page(res, 'trust.html', {})],
    ['GET', '/portal', async (_req, res) => page(res, 'portal.html', { 'nt-serverless': serverless ? '1' : '0' })],
    ['POST', '/api/v1/portal/signup', portal.signup],
    ['POST', '/api/v1/portal/login', portal.login],
    ['POST', '/api/v1/portal/logout', portal.logout],
    ['GET', '/api/v1/portal/me', portal.me],
    ['POST', '/api/v1/portal/keys', portal.createKey],
    ['POST', '/api/v1/portal/keys/revoke', portal.revokeKey],
    ['POST', '/api/v1/portal/keys/rename', portal.renameKey],
    ['POST', '/api/v1/portal/keys/lookup', portal.lookupKey],
    ['POST', '/api/v1/portal/keys/rotate', portal.rotateKey],
    ['POST', '/api/v1/portal/keys/delete', portal.deleteKey],
    ['POST', '/api/v1/portal/account/password', portal.changePassword],
    ['GET', '/api/v1/portal/events', portal.events],
    ['GET', '/api/v1/portal/proofs', portal.proofs],
    ['POST', '/api/v1/portal/feedback', portal.feedback],
    ['POST', '/api/v1/proof/verify', portal.verifyBundle],
    ['GET', '/api/v1/proof-keys', async (_req, res) => json(res, 200, engine.proofKeys())],
    ['GET', '/api/v1/portal/admin-keys', portal.listAdminKeys],
    ['POST', '/api/v1/portal/admin-keys', portal.createAdminKey],
    ['POST', '/api/v1/portal/admin-keys/revoke', portal.revokeAdminKey],
    ['GET', '/api/v1/portal/stats', portal.stats],
    ['GET', '/api/v1/portal/overview', portal.overview],
    ['POST', '/api/v1/ingest', portal.ingest],
    ['GET', '/api/v1/apps', appsApi],
    ['GET', '/api/v1/version', async (_req, res) => json(res, 200, { signal: SIGNAL_VERSION, kinematics: KINEMATICS_VERSION, model: model ? { version: model.version, trainedAt: model.trainedAt, humanAbove: model.humanAbove, syntheticBelow: model.syntheticBelow, report: model.report } : null })],
    ['POST', '/api/v1/rooms', lab.createRoom],
    ['GET', '/api/v1/session', lab.me],
    ['GET', '/api/v1/connection', lab.connection],
    ['GET', '/api/v1/stream', serverless ? (_r, res) => json(res, 501, { error: 'sse_unavailable', message: 'Serverless rejimdə canlı axın yoxdur; səhifə sorğu ilə yenilənir.' }) : lab.stream],
    ['POST', '/api/v1/signals', lab.signals],
    ['GET', '/api/v1/journal', lab.journal],
    ['GET', '/api/v1/benchmark', lab.benchmark],
    ['GET', '/api/v1/audit', lab.audit],
    ['POST', '/api/v1/step-up', lab.stepUp],
    ['POST', '/api/v1/webauthn/register/options', wa.registerOptions],
    ['POST', '/api/v1/webauthn/register', wa.register],
    ['POST', '/api/v1/webauthn/assert/options', wa.assertOptions],
    ['POST', '/api/v1/webauthn/assert', wa.assert],
    ['GET', '/api/v1/webauthn/status', wa.status],
    ['POST', '/api/v1/simulate/signed', lab.simulateSigned],
    ['GET', '/api/v1/policy', admin.getPolicy],
    ['GET', '/api/v1/policy-default', async (req, res) => { const room = url(req).searchParams.get('room') ?? ''; const app = UUID.test(room) ? (await store.roomApp(room)) ?? 'bank' : 'bank'; json(res, 200, { policy: engine.defaultPolicyFor(app) }); }],
    ['PUT', '/api/v1/policy', admin.putPolicy],
    // legacy bank routes (kept for the original tests and SDK examples)
    ['GET', '/api/v1/account/profile', account.profile],
    ['GET', '/api/v1/account/balance', account.balance],
    ['GET', '/api/v1/account/transactions', account.transactions],
    ['POST', '/api/v1/account/export', account.exportRequest],
    ['GET', '/api/v1/account/export/file', account.exportFile],
  ];

  const handler: Handler = async (req, res) => {
    try {
      const u = url(req);
      const method = req.method ?? 'GET';
      const route = routes.find(([m, p]) => m === method && p === u.pathname);
      if (route) { await route[2](req, res); return; }
      if (u.pathname === '/api/v1/manage' || u.pathname.startsWith('/api/v1/manage/')) { await portal.manage(req, res); return; }
      if (await resources.handle(req, res)) return;
      if (method === 'GET' && u.pathname.startsWith('/sdk/') && (await serveStatic(res, SDK, u.pathname.slice(5)))) return;
      // Only the integration guides are public. The research log, the evaluation and the internal
      // runbooks describe how detection actually works; they stay behind the operator key.
      if (method === 'GET' && u.pathname.startsWith('/docs/')) {
        const file = u.pathname.slice(6);
        if (!PUBLIC_DOCS.has(file) && !labOpen(req, res)) { json(res, 404, { error: 'not_found' }); return; }
        if (await serveStatic(res, DOCS, file)) return;
      }
      if (method === 'GET' && u.pathname !== '/' && (await serveStatic(res, WEB, u.pathname.slice(1)))) return;
      json(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error('request failed', err);
      if (!res.headersSent) json(res, 500, { error: 'internal', message: 'Daxili xəta. Yenidən cəhd et.' });
      else res.end();
    }
  };

  const server = createServer((req, res) => { void handler(req, res); });
  return { handler, server, engine, store, labOperator };
}
