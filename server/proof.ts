/**
 * Decision proofs: every decision the engine makes is signed, so the business can hand an auditor
 * a file and the auditor can check it without trusting NanoTarget, the business, or the database.
 *
 *   proof = compact JWS, EdDSA (Ed25519), header { alg: "EdDSA", typ: "nt-proof", kid }
 *
 * The payload carries what was decided and why — resource, decision, actor, reason codes, policy and
 * engine versions, whether data was delivered — plus the decision's place in the hash-chained audit
 * log (seq, hash, previous hash). It never carries the session id itself (only a digest of it), data,
 * or anything the end user typed. The end user never sees a proof: it is made and kept on the server.
 *
 * The signing key is derived from the engine secret (HKDF), so every instance of one deployment signs
 * with the same key and the public key never changes unless the secret does. Its id (`kid`) is the
 * RFC 7638 thumbprint of the public key. Verification needs only the public JWK: any JOSE library, or
 * `verifyProof()` below, or `npx nanotarget verify-proof bundle.json`.
 */
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject } from 'node:crypto';
import type { DecisionRow } from './db.ts';

export const PROOF_VERSION = 1;
export const PROOF_TYP = 'nt-proof';

export type ProofJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; use: 'sig'; alg: 'EdDSA' };

export type ProofPayload = {
  v: number;
  iss: 'nanotarget';
  /** issued at, seconds */
  iat: number;
  /** the decision id — unique, the handle an auditor asks about */
  jti: string;
  /** digest of the session the decision was made for; the raw id stays in the business's own records */
  sub: string;
  resource: string;
  /** what the response did: allow, mask, step_up, block */
  decision: string;
  /** what the policy computed (differs from `decision` only in observe mode) */
  computed: string;
  enforced: boolean;
  branch: string;
  actor: string;
  score: number | null;
  tiers: string[];
  reasons: string[];
  /** whether the protected data left the server in this response (masked data counts as not delivered) */
  delivered: boolean;
  policy: string;
  engine: string;
  /** the decision's place in the tamper-evident audit chain */
  audit: { seq: number; hash: string; prev: string };
};

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** RFC 7638 thumbprint of an Ed25519 public key: the key's stable id. */
export function thumbprint(x: string): string {
  return createHash('sha256').update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x })).digest('base64url');
}

/** The session digest a proof carries. Anyone holding the session id can recompute it; nobody can reverse it. */
export function sessionDigest(session: string): string {
  return createHash('sha256').update('nt-proof\0').update(session).digest('hex').slice(0, 32);
}

export type Prover = {
  readonly jwk: ProofJwk;
  sign(row: DecisionRow, seq: number): string;
};

/** A signer whose key is derived from the engine secret: same secret, same key, on every instance. */
export function proverFromSecret(secret: Buffer): Prover {
  const seed = Buffer.from(hkdfSync('sha256', secret, 'nanotarget', 'decision-proof-ed25519', 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const x = (createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string }).x;
  const jwk: ProofJwk = { kty: 'OKP', crv: 'Ed25519', x, kid: thumbprint(x), use: 'sig', alg: 'EdDSA' };
  const header = b64u(JSON.stringify({ alg: 'EdDSA', typ: PROOF_TYP, kid: jwk.kid }));
  return {
    jwk,
    sign(row, seq) {
      const payload: ProofPayload = {
        v: PROOF_VERSION, iss: 'nanotarget', iat: Math.floor(row.created / 1000), jti: row.id, sub: sessionDigest(row.session),
        resource: row.resource, decision: row.decision, computed: row.computed, enforced: row.enforced, branch: row.branch,
        actor: row.actor, score: row.score, tiers: row.tiers, reasons: row.reasonCodes, delivered: row.dataDelivered,
        policy: row.policyVersion, engine: row.signalVersion, audit: { seq, hash: row.hash, prev: row.prevHash },
      };
      const input = `${header}.${b64u(JSON.stringify(payload))}`;
      return `${input}.${b64u(sign(null, Buffer.from(input), privateKey))}`;
    },
  };
}

export type ProofCheck =
  | { valid: true; payload: ProofPayload; kid: string }
  | { valid: false; reason: 'malformed' | 'unknown_key' | 'bad_signature' | 'wrong_type' };

const JWS = /^[A-Za-z0-9_-]{10,200}\.[A-Za-z0-9_-]{20,6000}\.[A-Za-z0-9_-]{80,90}$/;
const keyCache = new Map<string, KeyObject>();

/**
 * Check a proof against one or more public keys (JWKs). Pure: no network, no database.
 * A valid proof says exactly one thing: the holder of this key signed this payload, and not a byte
 * of it has changed since.
 */
export function verifyProof(jws: string, keys: { x: string; kid?: string }[]): ProofCheck {
  if (typeof jws !== 'string' || !JWS.test(jws)) return { valid: false, reason: 'malformed' };
  const [h, p, s] = jws.split('.') as [string, string, string];
  let header: { alg?: string; typ?: string; kid?: string };
  let payload: ProofPayload;
  try { header = JSON.parse(fromB64u(h).toString('utf8')); payload = JSON.parse(fromB64u(p).toString('utf8')); } catch { return { valid: false, reason: 'malformed' }; }
  if (header.alg !== 'EdDSA' || header.typ !== PROOF_TYP || payload?.iss !== 'nanotarget') return { valid: false, reason: 'wrong_type' };
  const key = keys.find((k) => (k.kid ?? thumbprint(k.x)) === header.kid && thumbprint(k.x) === header.kid);
  if (!key) return { valid: false, reason: 'unknown_key' };
  let pub = keyCache.get(key.x);
  if (!pub) {
    try { pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x }, format: 'jwk' }); } catch { return { valid: false, reason: 'unknown_key' }; }
    if (keyCache.size > 200) keyCache.clear();
    keyCache.set(key.x, pub);
  }
  if (!verify(null, Buffer.from(`${h}.${p}`), pub, fromB64u(s))) return { valid: false, reason: 'bad_signature' };
  return { valid: true, payload, kid: header.kid! };
}

/** Read a proof's payload without checking it — for display only. Never base a decision on this. */
export function peekProof(jws: string): ProofPayload | null {
  try { const p = jws.split('.')[1]; return p ? (JSON.parse(fromB64u(p).toString('utf8')) as ProofPayload) : null; } catch { return null; }
}

/** The file a business hands an auditor: the proofs, the key that signed them, and how to check them. */
export function proofBundle<M extends Record<string, unknown>>(proofs: string[], keys: ProofJwk[], meta: M = {} as M) {
  return {
    format: 'nanotarget-proof-bundle/1',
    created: new Date().toISOString(),
    ...meta,
    keys,
    proofs,
    verify: 'Each proof is a compact JWS (EdDSA / Ed25519). Check it with the matching key in `keys` using any JOSE library, or run: npx nanotarget verify-proof <this file>',
  };
}
