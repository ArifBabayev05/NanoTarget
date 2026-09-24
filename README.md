<p align="center">
  <img src="web/favicon.svg" width="56" alt="">
</p>
<h1 align="center">NanoTarget</h1>
<p align="center">
  Session-level control over AI browser agents.<br>
  Detect the moment an agent attaches to a signed-in session, decide per endpoint what it may see, and let the person take the session back.
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/nanotarget"><img alt="npm" src="https://img.shields.io/npm/v/nanotarget?color=3ddc84&label=npm"></a>
  <a href="https://github.com/ArifBabayev05/NanoTarget/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ArifBabayev05/NanoTarget/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache-2.0 SDK, BUSL-1.1 engine" src="https://img.shields.io/badge/license-Apache--2.0%20SDK%20%C2%B7%20BUSL--1.1%20engine-blue"></a>
  <a href="https://nanotarget-mvp.vercel.app"><img alt="demo" src="https://img.shields.io/badge/live-demo-0f8a4b"></a>
</p>

---

Customers now hand their signed-in banking, CRM and insurance sessions to Claude, ChatGPT, Codex and other agentic browsers. The agent inherits the session — same cookies, same IP, same browser — and nothing on the server can tell. Bot management stops bots at the door; enterprise browser tools watch employees. Neither sees the agent a legitimate customer invited into their own session.

NanoTarget works inside the session:

- **Attach-time detection** — agent-tool markers, injected globals, evaluated-script reads, focus emulation and Web Bot Auth signatures are seen before the agent's first action (measured 0.1–0.5 s for Claude in Chrome, 0.14 s for Codex).
- **Pointer physics per click** — a hand's path is curved, its tremor grows with speed and comes in bursts, it slows onto the target and holds 83–225 ms; drivers teleport and release in 1–4 ms; generated curves are parabola-clean. A boosted-tree model, cross-validated across people and devices: AUC 0.999, zero human false positives.
- **Per-endpoint policy** — `allow · mask · step_up · block`, in your JSON; masking in your code; decisions on your server.
- **Seal on attach** — data already on screen is redacted in the browser the instant an indicator appears.
- **Passkey reclaim** — once an agent attached, the session stays "agent" until the person proves presence with WebAuthn (Touch ID) and takes it back.

Live demo: **https://nanotarget-mvp.vercel.app** · Package: **https://www.npmjs.com/package/nanotarget**

## Install

```bash
npm i nanotarget          # Node ≥ 22.13 · Express 4/5, Connect, Next.js custom server, plain node:http
npx nanotarget scan .     # what an AI agent could reach in this codebase + a draft policy
```

```js
import { nanotarget } from 'nanotarget/express';

const nt = await nanotarget({
  secret: process.env.NT_SECRET,
  policy: './nanotarget.policy.json',
  db: 'sqlite:./nanotarget.db',
  identify: (req) => req.session?.userId ?? null,
});
app.use(nt.middleware());                                            // serves /nanotarget/sdk.js + its API
app.get('/api/balance', nt.protect('balance.read'), (req, res) => nt.send(req, res, balance, maskBalance));
```

```html
<script src="/nanotarget/sdk.js"></script>   <!-- call protected endpoints with NanoTarget.fetch(url) -->
```

Integration is designed to be done by an AI coding agent: hand it the npm link and say "install this". The package README is its protocol — threat model, exposure map, decision matrix, mask design, nine decisions, verification. See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) and [`docs/INTEGRATION-AGENT.md`](docs/INTEGRATION-AGENT.md).

## How it decides

```
signals (untrusted, from the SDK) + server observations (trusted)
    → assess()    tiers: verified · strong · control · behavioral · artifact
    → evaluate()  your policy: onAgent / onArtifact / onUnknown / onHumanLike
    → audit       hash-chained decision log
    → response    allow | mask | 428 step-up | 403 block (+ passkey reclaim)
```

"Unknown" is a first-class outcome and is never treated as human. Environment traces (an AI app's built-in browser, an installed agent extension) never outweigh kinematic evidence of a hand. Details and every measured number are in [`docs/HESABAT.md`](docs/HESABAT.md) (research log) and [`docs/EVAL.md`](docs/EVAL.md) (auto-generated evaluation report).

## Repository

| Path | What |
| --- | --- |
| `server/` | Engine: signals, assessment, kinematics + model, policy, audit, WebAuthn, Web Bot Auth, storage (sqlite / libSQL) |
| `sdk/nanotarget.js` | Browser SDK: attach-time probes, pointer trajectories, seal-on-attach |
| `integrations/express/` | The `nanotarget/express` middleware |
| `integrations/cli/` | `npx nanotarget scan | verify | secret` |
| `packages/nanotarget/` | Published npm package (built by `scripts/build-package.mjs`) |
| `web/` | Landing, three demo applications, training lab, sandbox |
| `scripts/` | Training, evaluation, adversarial generation, reports |
| `tests/` | 105 tests (`npm test`) |
| `docs/` | Integration guide, research log, evaluation, competitive landscape |

## Development

```bash
npm install
npm run dev            # http://localhost:8787
npm run check          # typecheck + tests
npm run eval           # regenerate docs/EVAL.md from the sample store
npm run build:package  # packages/nanotarget/dist
```

The engine has no runtime dependencies beyond Node. `@libsql/client` is optional (Turso/serverless storage).

## Threat model and limits

- Detects agents operating **inside the browser session** (extensions, in-app browsers, driver-based bots). It does not cover server-to-server API keys, mobile apps without the SDK, or a person deliberately relaying data by hand.
- Pointer physics is an arms race. Generated and noise-dressed curves are caught today; a bot replaying a recorded human trajectory with a plausible press is not distinguishable per click — the session layers (attach markers, read traps, signatures) and per-tenant trajectory reuse detection are the answer there. This is stated in the research log, not hidden.
- Touch input is currently informative only: no agent-touch baseline exists yet, so touch clicks are never treated as human evidence.

## Contributing

Issues and pull requests are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports: [`SECURITY.md`](SECURITY.md).

## License

NanoTarget is licensed in two parts. © 2026 Arif Babayev.

| Part | Licence | What it means for you |
| --- | --- | --- |
| Browser SDK, Express middleware, CLI, proof verifier — the `nanotarget` package | [Apache 2.0](LICENSE-APACHE) | Use, modify and ship it anywhere, including closed-source products. Patent grant included. |
| Engine, portal, tooling — the `nanotarget-engine` package and the rest of this repository | [Business Source License 1.1](LICENSE-BSL) | **Production use is granted**, including protecting your own apps and the services you give your customers. Not granted: offering NanoTarget itself to others as a competing hosted or embedded product. Each version becomes Apache 2.0 four years after release. |

Versions before 0.4.0 were published under MIT and stay available under it. Contributions need the one-line [CLA](CLA.md). Alternative licensing: see [SECURITY.md](SECURITY.md) for the contact.
