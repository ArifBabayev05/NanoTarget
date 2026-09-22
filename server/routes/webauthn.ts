/**
 * WebAuthn routes. In the lab, credentials are scoped to the room (the room is
 * the "user"). In production they belong to the authenticated account.
 *
 *   POST /api/v1/webauthn/register/options  → { challenge, rp, user, pubKeyCredParams, authenticatorSelection }
 *   POST /api/v1/webauthn/register          ← { challengeId, id, clientDataJSON, attestationObject }
 *   POST /api/v1/webauthn/assert/options    → { challenge, allowCredentials, userVerification }
 *   POST /api/v1/webauthn/assert            ← { challengeId, id, clientDataJSON, authenticatorData, signature, resource? }
 *
 * A successful assertion marks the session human-verified for HUMAN_RECLAIM_TTL_MS
 * and grants the requested resource once.
 */
import { CHALLENGE_TTL_MS, HUMAN_RECLAIM_TTL_MS, STEP_UP_TTL_MS, type NanoTarget } from '../engine.ts';
import { json, readJson, sameOrigin, url, type Req, type Res } from '../http.ts';
import { newChallenge, rpFromUrl, verifyAssertion, verifyRegistration, type StoredCredential } from '../webauthn.ts';
import { bus } from '../bus.ts';

export function webauthnRoutes(engine: NanoTarget) {
  const store = engine.store;

  const registerOptions = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const r = await engine.resolveSession(req);
    if (!r) return json(res, 401, { error: 'no_session' });
    const { rpId } = rpFromUrl(url(req));
    const challenge = newChallenge();
    await store.createChallenge(challenge, r.session.id, 'register', null, CHALLENGE_TTL_MS);
    const existing = await store.credentialsForRoom<StoredCredential>(r.room);
    json(res, 200, {
      challengeId: challenge,
      publicKey: {
        challenge,
        rp: { id: rpId, name: 'NanoTarget Lab' },
        user: { id: Buffer.from(r.room).toString('base64url'), name: `lab-${r.room.slice(0, 8)}`, displayName: 'NanoTarget demo istifadəçisi' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }, { type: 'public-key', alg: -8 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.id })),
        attestation: 'none',
        timeout: CHALLENGE_TTL_MS,
      },
    });
  };

  const register = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const r = await engine.resolveSession(req);
    if (!r) return json(res, 401, { error: 'no_session' });
    const body = (await readJson(req, 64000)) as Record<string, unknown> | null | undefined;
    if (!body || typeof body.challengeId !== 'string' || typeof body.clientDataJSON !== 'string' || typeof body.attestationObject !== 'string') return json(res, 400, { error: 'bad_request' });
    if (!(await store.consumeChallenge(body.challengeId, r.session.id, 'register'))) return json(res, 400, { error: 'challenge', message: 'Qeydiyyat sorğusu tapılmadı və ya vaxtı bitib.' });
    const { rpId, origin } = rpFromUrl(url(req));
    try {
      const cred = verifyRegistration({ clientDataJSON: body.clientDataJSON, attestationObject: body.attestationObject }, { challenge: body.challengeId, origin, rpId }, typeof body.label === 'string' ? body.label.slice(0, 40) : 'passkey');
      await store.saveCredential(r.room, r.session.id, cred);
      json(res, 201, { ok: true, credential: { id: cred.id, alg: cred.alg, label: cred.label } });
    } catch (e) {
      json(res, 400, { error: 'registration_failed', message: (e as Error).message });
    }
  };

  const assertOptions = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const r = await engine.resolveSession(req);
    if (!r) return json(res, 401, { error: 'no_session' });
    const body = (await readJson(req, 2000)) as { resource?: unknown } | null | undefined;
    const resource = body && typeof body.resource === 'string' && /^[a-z][a-z0-9_.]{1,60}$/.test(body.resource) ? body.resource : null;
    const creds = await store.credentialsForRoom<StoredCredential>(r.room);
    if (!creds.length) return json(res, 404, { error: 'no_credentials', message: 'Bu otaqda passkey qeydiyyatı yoxdur.' });
    const { rpId } = rpFromUrl(url(req));
    const challenge = newChallenge();
    await store.createChallenge(challenge, r.session.id, 'assert', resource, CHALLENGE_TTL_MS);
    json(res, 200, { challengeId: challenge, publicKey: { challenge, rpId, allowCredentials: creds.map((c) => ({ type: 'public-key', id: c.id })), userVerification: 'required', timeout: CHALLENGE_TTL_MS } });
  };

  const assert = async (req: Req, res: Res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const r = await engine.resolveSession(req);
    if (!r) return json(res, 401, { error: 'no_session' });
    const body = (await readJson(req, 64000)) as Record<string, unknown> | null | undefined;
    if (!body || typeof body.challengeId !== 'string' || typeof body.id !== 'string' || typeof body.clientDataJSON !== 'string' || typeof body.authenticatorData !== 'string' || typeof body.signature !== 'string') return json(res, 400, { error: 'bad_request' });
    const ch = await store.consumeChallenge(body.challengeId, r.session.id, 'assert');
    if (!ch) return json(res, 400, { error: 'challenge', message: 'Təsdiq sorğusu tapılmadı və ya vaxtı bitib.' });
    const cred = await store.getCredential<StoredCredential>(body.id);
    if (!cred) return json(res, 404, { error: 'unknown_credential' });
    const { rpId, origin } = rpFromUrl(url(req));
    const result = verifyAssertion({ credentialId: body.id, clientDataJSON: body.clientDataJSON, authenticatorData: body.authenticatorData, signature: body.signature }, cred, { challenge: body.challengeId, origin, rpId });
    if (!result.ok) return json(res, 403, { error: 'assertion_failed', message: result.reason });
    cred.signCount = result.newSignCount;
    await store.updateCredential(cred);
    const now = Date.now();
    await store.markHumanVerified(r.session.id, now);
    if (ch.resource) await store.grantStepUp(r.session.id, ch.resource, STEP_UP_TTL_MS, now);
    await store.addEvent(r.room, r.session.id, 'attach', { state: 'human_verified', atMs: null, evidence: [{ code: 'HUMAN_VERIFIED_WEBAUTHN', atMs: 0, detail: `credential ${cred.id.slice(0, 8)}…, UV=true` }], tools: [], version: 'webauthn-v1' }, now);
    bus.publish({ type: 'decision', room: r.room, session: r.session.id, at: now, id: `webauthn-${now}`, resource: ch.resource ?? 'session.reclaim', decision: 'allow', actor: 'human_like', reasonCodes: ['HUMAN_VERIFIED_WEBAUTHN'] });
    json(res, 200, { ok: true, humanVerifiedAt: now, validForMs: HUMAN_RECLAIM_TTL_MS, reclaim: { until: now + HUMAN_RECLAIM_TTL_MS }, granted: ch.resource, message: ch.resource ? 'Təsdiq qəbul edildi. Əməliyyatı bir dəfə təkrar et.' : 'Sessiya insan tərəfindən geri alındı.' });
  };

  const status = async (req: Req, res: Res) => {
    const r = await engine.resolveSession(req);
    if (!r) return json(res, 401, { error: 'no_session' });
    const creds = await store.credentialsForRoom<StoredCredential>(r.room);
    const s = (await store.getSession(r.session.id))!;
    json(res, 200, { credentials: creds.map((c) => ({ id: c.id, alg: c.alg, label: c.label, createdAt: c.createdAt })), humanVerifiedAt: s.humanVerifiedAt, validForMs: HUMAN_RECLAIM_TTL_MS });
  };

  return { registerOptions, register, assertOptions, assert, status };
}
