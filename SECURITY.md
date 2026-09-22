# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **arifrb@code.edu.az** with a description, reproduction steps and the affected version. You will get an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

## Scope

In scope: the engine (`server/`), the browser SDK (`sdk/`), the Express integration and CLI (`integrations/`), and the published `nanotarget` package. Bypasses of the detection layers are welcome as research reports as well — see below.

Out of scope: the demo applications' synthetic data, the training lab and sandbox UI, third-party services (Vercel, Turso).

## Detection bypasses

NanoTarget's kinematic layer is an arms race by nature. If you build an agent or a bot that passes as human, we want to hear about it — with a trajectory sample if possible — and will credit you in the research log. Known limits are documented in `docs/HESABAT.md` §20 (recorded-trajectory replay) and the README.

## Supported versions

The latest minor release on npm receives fixes.
