// SPDX-License-Identifier: BUSL-1.1
import { mkdirSync } from 'node:fs';
import { createApp } from './app.ts';
import { clientFromEnv } from './sql.ts';

// local settings (e.g. OPENROUTER_API_KEY for the policy assistant) from a git-ignored .env, when there is one
try { process.loadEnvFile('.env'); } catch { /* none */ }

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
if (!process.env.TURSO_DATABASE_URL && (process.env.NT_DB ?? 'data/lab.db') !== ':memory:') mkdirSync('data', { recursive: true });

const db = await clientFromEnv();
const { server } = await createApp({
  client: db.client,
  secret: process.env.NT_SECRET ? Buffer.from(process.env.NT_SECRET, 'utf8') : undefined,
  labOperator: process.env.NT_LAB_OPERATOR !== '0',
});

server.listen(port, host, () => {
  console.log(`NanoTarget → http://${host}:${port}/   db=${db.kind}:${db.label}`);
});
