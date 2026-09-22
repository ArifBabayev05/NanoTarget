# Changelog

## 0.2.0 — 2026-09-22
- Learned per-click model (gradient-boosted trees, grouped CV AUC 0.999, zero human false positives) shipped in `dist/kinematics-model.json`; physics features against humanised bots (roughness, noise–speed coupling, kurtosis, autocorrelation); decisive rules for generated and noise-dressed curves.
- Kinematics v16 / assessment v7: keyboard activation neutral, approach retained across clicks and reloads, cyborg-session handling, dominance rule.
- README rewritten as a security-analysis protocol for AI coding agents: threat model, exposure map, default decision matrix, mask design, nine decisions, verification.
- README/AGENTS.md gained a **block and step-up design** section (sibling leaks, retry idempotency, grant scope, recovery, observability, token-bound downloads) and a **worked exposure map** showing the two rows integrations miss — an aggregate endpoint that embeds a protected value, and the profile write that is the account-takeover path — plus a **mask cookbook** (ready implementations per data class plus the seven rules that decide a mask's quality: mask the join, mask derived values, cap volume, keep the contract, never mask irreversible actions, don't leak through errors, assert the real value is absent) and a paste-ready prompt for the user's coding agent.
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
