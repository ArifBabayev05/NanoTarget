# Buraxılış — npm paketləri (`onehumanai` təşkilatı)

Dörd paket, hamısı eyni versiyada:

| Paket | Lisenziya | Nədir |
|---|---|---|
| `@onehumanai/engine` | BUSL-1.1 | engine (`server/public.ts`) |
| `@onehumanai/sdk` | Apache-2.0 | brauzer SDK-sı tək (`sdk/onehuman.js`) |
| `@onehumanai/express` | Apache-2.0 | müştərinin quraşdırdığı: middleware + SDK + CLI |
| `onehuman` | Apache-2.0 | qısa əmr: `npx onehuman init` |

## Bir dəfə
```bash
npm login          # onehumanai təşkilatının üzvü olan hesab (2FA)
```

## Hər buraxılış
```bash
npm run release -- current           # package.json-dakı versiya nəşr olunur
npm run release -- patch             # 0.6.0 → 0.6.1
npm run release -- patch --dry-run   # nəşr etmədən hər şeyi yoxla
```
Skript: `npm run check` → versiyalar → `node scripts/build-package.mjs` → `npm publish` (engine → sdk → express → onehuman) → git commit + tag `onehuman-vX.Y.Z`. Hər buraxılışdan əvvəl `packages/express/CHANGELOG.md`-yə bir sətir yaz.

## Müştəri tərəfində
```bash
npx onehuman init                    # və ya: npm i @onehumanai/express
```
```js
import { onehuman } from '@onehumanai/express';
```
