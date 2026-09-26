# onehuman-engine

The engine behind [`onehuman`](https://www.npmjs.com/package/onehuman): AI-agent detection inside signed-in sessions, the per-resource policy (allow · mask · step up · block), the hash-chained audit log and Ed25519-signed decision proofs.

> **Install `onehuman`, not this.** `npm i onehuman` depends on this package and installs it for you. The API you use is `onehuman/express` and `npx onehuman`; nothing here is meant to be imported directly, and its internal exports may change between versions. Documentation: https://onehuman.ai/docs

## Licence

Business Source License 1.1 — see [LICENSE](./LICENSE).

- **Production use is granted**: run it, at any scale, to protect your own applications and the services you provide to your customers, on your own infrastructure.
- Not granted: offering OneHuman itself to third parties as a competing hosted or embedded product.
- Each version converts to Apache 2.0 (or GPL 2.0+, at your option) four years after it is published.

The parts you link into your code — the browser SDK, the middleware, the CLI and the proof verifier — are Apache 2.0, in the `onehuman` package. Versions before 0.4.0 were published as a single MIT package and remain available under MIT.
