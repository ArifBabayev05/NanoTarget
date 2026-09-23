# Changelog

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
