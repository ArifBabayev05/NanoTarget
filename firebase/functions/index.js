import { onRequest } from 'firebase-functions/v2/https';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.NT_ROOT = dirname(fileURLToPath(import.meta.url));
const { handler } = await import('./app.js');
export const app = onRequest({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 30, concurrency: 80, minInstances: 0 }, (req, res) => handler(req, res));
