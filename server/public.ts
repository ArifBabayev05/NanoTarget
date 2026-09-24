// SPDX-License-Identifier: BUSL-1.1
/**
 * onehuman-engine — the engine's public surface.
 *
 * Everything the open integrations (the Express middleware, future adapters) need from the engine is
 * exported here and nowhere else. The open package imports only this module, so the build can publish it
 * as a separate package under its own licence, and no engine code is ever copied into the open one.
 */
export type { Assessment } from './assess.ts';
export { Store, type DecisionRow, type SessionRow } from './db.ts';
export { OneHuman, publicDecision, type DecideResult } from './engine.ts';
export { attachModel } from './kinematics.ts';
export { loadModel, predict } from './kinematics-model.ts';
export { cookies, json, url } from './http.ts';
export { parsePolicy, type Policy } from './policy.ts';
export { labRoutes } from './routes/lab.ts';
export { webauthnRoutes } from './routes/webauthn.ts';
export { libsqlClient, sqliteClient, type SqlClient } from './sql.ts';
export { proverFromSecret, sessionDigest, type Prover } from './proof.ts';

/**
 * The engine's package version, stamped by the build (`0.0.0-dev` when run from source). `onehuman/express`
 * compares it with its own at startup: the two packages are released together and a mismatch means a broken
 * install (a lockfile pinning an old engine, or the engine added by hand).
 */
declare const __ONEHUMAN_ENGINE_VERSION__: string | undefined;
export const ENGINE_VERSION: string = typeof __ONEHUMAN_ENGINE_VERSION__ === 'string' ? __ONEHUMAN_ENGINE_VERSION__ : '0.0.0-dev';
