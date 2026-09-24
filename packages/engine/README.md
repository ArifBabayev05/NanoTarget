# nanotarget-engine

The engine behind [`nanotarget`](https://www.npmjs.com/package/nanotarget): AI-agent detection inside signed-in sessions, the per-resource policy (allow · mask · step up · block), the hash-chained audit log and signed decision proofs.

**You normally do not install this directly.** `npm i nanotarget` brings it in, and `nanotarget/express` is the API you use. Documentation: https://nanotarget-mvp.vercel.app/docs

## Licence

Business Source License 1.1 — see [LICENSE](./LICENSE).

- **Production use is granted**, including protecting your own applications and the services you provide to your customers, on your own infrastructure, at any scale.
- The one thing not granted is offering NanoTarget itself to third parties as a competing hosted or embedded product.
- Each version converts to Apache 2.0 (or GPL 2.0+, at your option) four years after it is published.

The open parts — the browser SDK, the middleware, the CLI and the proof verifier — are Apache 2.0, in the `nanotarget` package.
