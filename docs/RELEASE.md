# Buraxılış — `onehuman` npm paketi

Paket: https://www.npmjs.com/package/onehuman  · mənbə: `integrations/express/`, `sdk/onehuman.js`, `server/**` → bir ESM bundle (`dist/express.js`, ~120 KB) + tiplər + SDK.

## Bir dəfə
```bash
npm login          # npm hesabı (2FA tövsiyə olunur)
```

## Hər buraxılış
```bash
npm run release -- current   # ilk dəfə: package.json-dakı 0.1.0 nəşr olunur
npm run release -- patch     # sonra: 0.1.0 → 0.1.1 (düzəlişlər)
npm run release -- minor     # 0.1.x → 0.2.0 (yeni imkan)
npm run release -- patch --dry-run   # nəşr etmədən hər şeyi yoxla
```
Skript: `npm run check` (tip + 96 test) → paketi yığ → versiya → `npm publish` → git commit + tag `onehuman-vX.Y.Z`. Hər buraxılışdan əvvəl `packages/onehuman/CHANGELOG.md`-yə bir sətir yaz.

## Müştəri tərəfində
```bash
npm i onehuman            # Node ≥ 22.13; sqlite daxildir, libSQL istəyə görə
```
```js
import { onehuman } from 'onehuman/express';
```

## Yoxlanılıb (21.09.2026)
`npm pack` → boş layihədə `npm i ./onehuman-0.1.0.tgz express` → server: allow 200, AI-brauzer UA ilə mask, `/onehuman/sdk.js` 200. Tarball 124 KB, 24 fayl.
