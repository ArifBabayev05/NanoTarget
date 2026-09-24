// SPDX-License-Identifier: BUSL-1.1
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

/**
 * Append a decision to its room's chain. With a `seal`, the decision is also signed (see proof.ts): the
 * proof covers the row's chain hash, so it is made after hashing and stored in the same insert.
 */
export async function appendDecision(store: Store, body: Omit<DecisionRow, 'prevHash' | 'hash'>, seal?: (row: DecisionRow, seq: number) => string): Promise<DecisionRow & { seq: number; proof: string | null }> {
  const last = await store.lastDecision(body.room);
  const hash = hashDecision(last.hash, body);
  const row: DecisionRow = { ...body, prevHash: last.hash, hash };
  const seq = last.seq + 1;
  const proof = seal ? seal(row, seq) : null;
  await store.insertDecision(row, seq, proof);
  return { ...row, seq, proof };
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
