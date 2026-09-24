# Changelog

## 0.5.0 — 2026-09-24
- Package descriptions, landing, docs and portal wizard rewritten around one message: `npm i nanotarget` is the only install; the engine comes with it and is never imported. Startup now refuses a mismatched `nanotarget-engine` version with the exact command to fix it.

## 0.4.0 — 2026-09-24 (identical content also published as 0.5.0)
- **Licence split.** `nanotarget` (browser SDK, Express middleware, CLI, proof verifier) is now **Apache 2.0**. The engine moves to its own package, **`nanotarget-engine`**, under the **Business Source License 1.1** with a production-use grant: run it in production, at any scale, to protect your own applications and the services you provide to your customers; offering NanoTarget itself as a competing hosted or embedded product is not granted. Each engine version converts to Apache 2.0 four years after release. Versions up to 0.3.x remain MIT.
- **Nothing changes in your code.** `npm i nanotarget` installs the engine as a dependency; `import { nanotarget } from 'nanotarget/express'` and every option, method and endpoint are the same.
- The proof verifier (`npx nanotarget verify-proof`) is entirely Apache 2.0 and contains no engine code: an auditor needs nothing under the BSL to check a proof.
- **Grade decisions.** In the portal's Activity each decision has right/wrong marks; gated decisions marked wrong count as false stops, allows marked wrong as misses, both shown for the range. `POST /api/v1/manage/feedback` for agents.
- **`GET <basePath>/health`** and `nt.health()`: policy version, reporter state, proof key id, and integration warnings — 503 while one stands.
- **`identify()` guard.** When the same identity arrives from five different clients the middleware logs once, loudly, that it is a constant (every visitor would share one session) and flips health to 503.
- `/trust`: a one-page data-flow summary for security and legal reviewers.
- **Fixed: one visitor split into many sessions.** A page that calls several protected endpoints at load sent them all before the session cookie existed, and each opened its own session — the agent's traces landed in one, the data request in another, and the request looked like `NO_CLIENT_TELEMETRY`. The browser SDK now lets the first call establish the session and holds the others until it has (a later page in the same tab skips the wait).
- **Fixed: reports lost on serverless.** On Vercel, AWS Lambda, Netlify and Azure Functions each report is sent at once (and kept alive with Vercel's `waitUntil`) instead of waiting for a 3-second timer a frozen function never reaches. `telemetryImmediate: true` turns this on anywhere else.
- **Fixed: a retried batch counted twice.** Every report carries an id; the portal stores and counts each once.
- Portal: Activity opens on the key that is actually reporting; a revoked key's history stays viewable; the overview title follows the selected range.
- SDK: transport state is declared before any probe can report during page load.

## 0.3.0 — 2026-09-24
- **Decision proofs.** Every decision is signed server-side (Ed25519, compact JWS, key derived from `secret`) and stored with its audit row; the proof covers the decision, its reasons and its place in the hash chain, never the raw session id. `req.nt.proof`, `nt.proofBundle(sessionId)`, `nt.proofFor(id)`, `nt.verifyProof(jws)`, `nt.proofKeys()`; public key at `<basePath>/proof-keys`. Nothing changes for end users.
- Telemetry carries the proof; the portal verifies each one at ingest (and that it belongs to its event), marks it ✓ in Activity, and exports an auditor bundle. `npx nanotarget verify-proof <bundle> [--keys <url>]` checks one offline.
- Portal: key rotation, revoked-key history and deletion, password change, paged log with CSV export.
- A single click unlocks a session only with the learned model's agreement, not on rule points alone.

## 0.2.2 — 2026-09-23
- **Management API** for agents and CI: `nt_admin_…` keys administer an account over HTTP — list/create/revoke project keys, read overview and per-key stats; `GET /api/v1/manage/me` describes itself. Project keys gained an environment tag and an optional expiry.
- `apiKey` option (or `NT_API_KEY`): the middleware reports each decision to the NanoTarget portal — batched, off the request path, metadata only — and the portal shows the share of sessions with an AI agent, decisions over time, agents seen, resources reached, and a live log.
- Isolated-world reading detection: a side panel taking viewport width plus main-thread work with no input is an attach indicator (`PANEL_PAGE_READ`); each alone is environment evidence.

## 0.2.1 — 2026-09-22
- **Judgement calls**: thirteen code patterns that should move the recommendation away from the default matrix (uncapped lists, aggregates embedding protected values, GraphQL field groups, recovery-data writes, non-idempotent money moves, file links, admin branches, regulated classes, SPA interceptors, SSR loaders, SDK-less clients, non-Node backends), each with the reason to give the user; plus the two habits — trace the number not the route, recommend then ask.
- **Block and step-up design** in README/AGENTS.md, the half the mask cookbook did not cover: sibling leaks (an uncapped search next to a blocked export makes the block decorative), retry idempotency after a 428, per-resource short-lived grants, the passkey way back, audit observability, and token-bound downloads — with code for each.
- **Worked exposure map**: the table the integrating agent should hand the owner before touching code, and the two rows careless integrations miss — an aggregate endpoint that embeds a protected value, and the profile write that is the account-takeover path.
- **Mask cookbook**: ready implementations per data class (money, IBAN/card, names, contact, addresses, documents, lists, aggregates) and the seven rules that decide a mask's quality: mask the join, mask derived values, cap volume, keep the response contract, never mask an irreversible action, don't leak through errors, assert the real value is absent from the serialized mask.
- Paste-ready prompt for the user's own coding agent at the top of the README; wider keyword set; `llms.txt` points at the new sections.

## 0.2.0 — 2026-09-22
- Learned per-click model (gradient-boosted trees, grouped CV AUC 0.999, zero human false positives) shipped in `dist/kinematics-model.json`; physics features against humanised bots (roughness, noise–speed coupling, kurtosis, autocorrelation); decisive rules for generated and noise-dressed curves.
- Kinematics v16 / assessment v7: keyboard activation neutral, approach retained across clicks and reloads, cyborg-session handling, dominance rule.
- README rewritten as a security-analysis protocol for AI coding agents: threat model, exposure map, default decision matrix, mask design, nine decisions, verification.
- `/api/v1/version` reports engine, kinematics and model versions.

## 0.1.3 — 2026-09-21
- `scan --proposal`: plain-language security proposal (what each route exposes, why it matters with an agent in the session, proposed handling) for the product owner; README opens with the agent protocol (install → scan → propose → ask → implement → verify).
- CLI: `npx nanotarget scan` (route discovery, sensitivity scoring, identity detection, draft policy), `npx nanotarget verify` (4 post-integration checks), `npx nanotarget secret`.
- `unseal()` now requires the server's reclaim proof (from `/webauthn/assert`); a plain call is ignored.
- A request from an AI app's built-in browser counts as environment evidence even when the session was opened from a normal browser.
- README rewritten as instructions for AI coding agents: decision questions to ask the user, exact code, policy schema, verification steps. Added AGENTS.md and llms.txt (same guidance) so Claude Code / Cursor / Codex find it.

## 0.1.1, 0.1.2 — 2026-09-21
- Same content as 0.1.0 (release-process runs).

## 0.1.0 — 2026-09-21
- First public build: Express/Connect middleware (`nanotarget/express`), browser SDK (`/nanotarget/sdk.js`).
- Attach-time detection (control markers, tool globals, main-world read traps, focus-while-hidden), pointer kinematics (kin-v4), seal-on-attach for on-screen data, WebAuthn "I am human" reclaim, single-use download tokens, hash-chained audit.
- Storage: node:sqlite (built in) or libSQL/Turso (optional dependency).
