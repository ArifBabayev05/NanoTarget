import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.env.local')) for (const line of readFileSync('.env.local','utf8').split('\n')) { const m=line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); }
const { clientFromEnv } = await import('./server/sql.ts');
const { client } = await clientFromEnv();
const q = async (s, a=[]) => (await client.execute(s, a)).rows;
const acc = (await q("SELECT id FROM accounts WHERE email='arifrb@code.edu.az'"))[0].id;
for (const r of await q("SELECT name, prefix, created, revoked, last_seen, events, expires, env FROM api_keys WHERE account=? ORDER BY created", [acc])) console.log(String(r.name).padEnd(22), r.prefix, 'created', new Date(Number(r.created)).toISOString().slice(0,16), 'revoked', r.revoked?'Y':'-', 'last', r.last_seen?new Date(Number(r.last_seen)).toISOString().slice(0,16):'never', 'ev', r.events, 'exp', r.expires?new Date(Number(r.expires)).toISOString().slice(0,10):'-', r.env);
console.log('now', new Date().toISOString());
console.log('newest telemetry overall:', (await q("SELECT MAX(at) m FROM telemetry"))[0].m && new Date(Number((await q("SELECT MAX(at) m FROM telemetry"))[0].m)).toISOString());
