# Contributing

Thanks for taking the time. NanoTarget is small enough to understand in an afternoon; this page tells you where things are and what a good change looks like.

## Setup

```bash
git clone https://github.com/ArifBabayev05/NanoTarget.git
cd NanoTarget
npm install
npm run dev        # http://localhost:8787 (node:sqlite in data/lab.db)
npm run check      # tsc + tests — must pass before a PR
```

Node ≥ 22.13 (the engine uses `node:sqlite`). No build step for development; TypeScript runs directly.

## Where to change what

| Want to… | Look at |
| --- | --- |
| Add a detection signal | `sdk/nanotarget.js` (collect) → `server/signals.ts` (validate) → `server/assess.ts` (weigh) → `server/connection.ts` (attach-time) |
| Change how a click is judged | `server/kinematics.ts` (features + rules), `server/kinematics-model.ts` (learned model) |
| Retrain the model | `node scripts/kinematics-train.mjs` — grouped CV by client, zero-FP thresholds; commit `server/kinematics-model.json` |
| Add a policy branch or mode | `server/policy.ts` |
| Change the integration API | `integrations/express/index.ts` + `docs/INTEGRATION.md` + package README |
| Add a training task | `web/training.js` `TASKS` |

## Rules we hold ourselves to

1. **Zero human false positives is the constraint, not a target.** Any change to kinematics or assessment must keep `node scripts/kinematics-eval.mjs` at 0 misjudged real-browser human clicks and `node scripts/training-eval.mjs --recompute` at 0 engine misses on human runs.
2. **"Unknown" is never human.** Do not add a path that treats missing telemetry as evidence of a person.
3. **Environment ≠ agent.** An installed extension or an AI app's browser is a trace about the browser, not the hand. It must not, on its own, block a person.
4. **Page-side observation with standard web APIs only.** We do not reverse-engineer vendors' bundled code or ship per-vendor fingerprints beyond publicly visible DOM markers and globals.
5. **Metadata only.** The SDK never sends page text, key identities or form values. Keep it that way.
6. **Measure, then change thresholds.** Every threshold in `kinematics.ts` has a comment with the measurement behind it. Add yours.

## Pull requests

- One concern per PR. Tests for behaviour changes (`tests/`).
- If you touch detection, include the before/after of `npm run eval` in the description.
- Commit messages in imperative mood; reference the docs section you updated.

## Reporting a false positive

The most valuable issue you can file. Please include: browser + OS + input device, what you clicked, and — if you ran the training lab — the run code shown at the end. Never include real personal data.
