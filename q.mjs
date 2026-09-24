import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.env.local')) for (const line of readFileSync('.env.local','utf8').split('\n')) { const m=line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); }
const { clientFromEnv } = await import('./server/sql.ts');
const { client } = await clientFromEnv();
const q = async (s, a=[]) => (await client.execute(s, a)).rows;
console.log('accounts (newest 6):'); for (const r of await q("SELECT id, email, created FROM accounts ORDER BY created DESC LIMIT 6")) console.log('  ', r.email, new Date(Number(r.created)).toISOString());
console.log('api keys (newest 10):'); for (const r of await q("SELECT k.id, a.email, k.name, k.prefix, k.created, k.revoked, k.last_seen, k.events, k.env, (SELECT COUNT(*) FROM telemetry t WHERE t.key_id=k.id) AS tel FROM api_keys k JOIN accounts a ON a.id=k.account ORDER BY k.created DESC LIMIT 10")) console.log('  ', r.email.padEnd(28), String(r.name).padEnd(20), r.prefix, 'created', new Date(Number(r.created)).toISOString().slice(0,16), 'revoked', r.revoked?'Y':'-', 'last_seen', r.last_seen? new Date(Number(r.last_seen)).toISOString().slice(0,16):'never', 'events', r.events, 'telemetryRows', r.tel);
const key = (await q("SELECT id FROM api_keys WHERE prefix='nt_live_2e041b9'"))[0].id;
console.log('\nrows for vibe:');
for (const r of await q("SELECT at, session, resource, decision, actor, state, tools, reasons, enforcement, version, proof_ok FROM telemetry WHERE key_id=? ORDER BY id", [key])) console.log('  ', new Date(Number(r.at)).toISOString().slice(5,19), r.session.slice(0,8), String(r.resource).padEnd(22), String(r.decision).padEnd(7), String(r.actor).padEnd(13), String(r.state).padEnd(18), r.tools, r.reasons, r.enforcement, r.version, 'proof', r.proof_ok);
