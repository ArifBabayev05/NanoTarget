# Changelog — onehuman-engine

This package is released together with [`onehuman`](https://www.npmjs.com/package/onehuman) at the same version; its changes are listed in that package's CHANGELOG. You install `onehuman`, not this.

## 0.6.0
- Renamed from `nanotarget-engine` to `onehuman-engine` (NanoTarget is now OneHuman). The engine class is `OneHuman`.

## 0.5.0 — 2026-09-24
- Exports `ENGINE_VERSION`; `onehuman` checks it at startup and refuses a mismatched pair with an actionable message.

## 0.4.0 — 2026-09-24
- First release as a separate package (Business Source License 1.1). Before 0.4.0 the engine was bundled inside `onehuman` under MIT.
