# @onehumanai/sdk

The OneHuman browser SDK. It runs in your page and tells your server when an AI agent takes over a signed-in session, and it hides values you mark the moment one attaches.

Most apps do not install this directly: [`@onehumanai/express`](https://www.npmjs.com/package/@onehumanai/express) serves the same file at `/onehuman/sdk.js`:

```html
<script src="/onehuman/sdk.js"></script>
<div data-oh-sensitive="full">$4,939.10</div>
```

Install it only if you bundle your front end yourself:

```bash
npm i @onehumanai/sdk
```

```js
window.OneHumanConfig = { endpoint: '/onehuman/signals' };   // where @onehumanai/express answers
await import('@onehumanai/sdk');                              // defines window.OneHuman
```

Docs: https://onehuman.ai/docs · Source: https://github.com/onehumanai/onehuman · Apache-2.0
