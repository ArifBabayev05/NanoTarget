/**
 * Hash-chained audit log for decisions.
 *
 * Each decision hashes its own body together with the previous decision's
 * hash. Editing or deleting a row breaks every later hash. This detects
 * tampering; it does not prevent it. Production needs a separately protected
 * checkpoint (WORM storage or an external anchor) and access control.
 */
import { createHash } from 'node:crypto';
import type { DecisionRow, Store } from './db.ts';

export function hashDecision(prevHash: string, body: Omit<DecisionRow, 'prevHash' | 'hash'>): string {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return createHash('sha256').update(prevHash).update('\n').update(canonical).digest('hex');
}

export async function appendDecision(store: Store, body: Omit<DecisionRow, 'prevHash' | 'hash'>): Promise<DecisionRow> {
  const last = await store.lastDecision(body.room);
  const hash = hashDecision(last.hash, body);
  const row: DecisionRow = { ...body, prevHash: last.hash, hash };
  await store.insertDecision(row, last.seq + 1);
  return row;
}

export type ChainReport = { ok: boolean; checked: number; brokenAt: number | null };

export async function verifyChain(store: Store, room: string): Promise<ChainReport> {
  const rows = (await store.listDecisions(room, 100000)).sort((a, b) => a.seq - b.seq);
  let prev = 'genesis';
  for (const r of rows) {
    const { prevHash, hash, seq, ...body } = r;
    if (prevHash !== prev) return { ok: false, checked: rows.length, brokenAt: seq };
    if (hashDecision(prev, body) !== hash) return { ok: false, checked: rows.length, brokenAt: seq };
    prev = hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}
