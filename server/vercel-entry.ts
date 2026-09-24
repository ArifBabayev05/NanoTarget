// SPDX-License-Identifier: BUSL-1.1
/**
 * Vercel serverless entry. One function serves every route; `vercel.json`
 * rewrites all paths here. Storage is Turso (libSQL over HTTP) so all
 * instances share rooms, sessions and decisions.
 *
 * Without TURSO_DATABASE_URL the app still boots on an in-memory database so
 * the landing page and docs render; rooms then live only inside one instance
 * and the page shows a warning. Set the variable to make the lab real.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp, type Handler } from '../server/app.ts';
import { libsqlClient, sqliteClient } from '../server/sql.ts';

let handlerPromise: Promise<Handler> | null = null;

async function boot(): Promise<Handler> {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  const secret = process.env.NT_SECRET ? Buffer.from(process.env.NT_SECRET, 'utf8') : undefined;
  if (url) {
    const client = await libsqlClient(url, token);
    const app = await createApp({ client, secret, labOperator: true, serverless: true });
    return app.handler;
  }
  console.warn('TURSO_DATABASE_URL is not set: running on an ephemeral in-memory database');
  const app = await createApp({ client: await sqliteClient(':memory:'), secret, labOperator: true, serverless: true, ephemeral: true });
  return app.handler;
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  handlerPromise ??= boot().catch((e) => { handlerPromise = null; throw e; });
  const h = await handlerPromise;
  await h(req, res);
}

// Vercel's Node runtime accepts either `module.exports = fn` or a default export; esbuild (cjs) maps `export default` to `.default`,
// so export both shapes explicitly.
export default handler;
export { handler };
