# onehuman

The OneHuman command line. The library is [`@onehumanai/express`](https://www.npmjs.com/package/@onehumanai/express); this package gives its CLI the short name.

```bash
npx onehuman init            # add OneHuman to this Express app: installs @onehumanai/express, asks a few questions, writes the setup
npx onehuman inspect         # print exactly what the SDK sent and what the server derived from it
npx onehuman report --days 30 --out report.html
npx onehuman verify http://localhost:3000 /api/balance
```

Docs: https://onehuman.ai/docs · Source: https://github.com/onehumanai/onehuman · Apache-2.0
