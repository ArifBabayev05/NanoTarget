# Buraxılış — `nanotarget` npm paketi

Paket: https://www.npmjs.com/package/nanotarget  · mənbə: `integrations/express/`, `sdk/nanotarget.js`, `server/**` → bir ESM bundle (`dist/express.js`, ~120 KB) + tiplər + SDK.

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
Skript: `npm run check` (tip + 96 test) → paketi yığ → versiya → `npm publish` → git commit + tag `nanotarget-vX.Y.Z`. Hər buraxılışdan əvvəl `packages/nanotarget/CHANGELOG.md`-yə bir sətir yaz.

## Müştəri tərəfində
```bash
npm i nanotarget            # Node ≥ 22.13; sqlite daxildir, libSQL istəyə görə
```
```js
import { nanotarget } from 'nanotarget/express';
```

## Yoxlanılıb (21.09.2026)
`npm pack` → boş layihədə `npm i ./nanotarget-0.1.0.tgz express` → server: allow 200, AI-brauzer UA ilə mask, `/nanotarget/sdk.js` 200. Tarball 124 KB, 24 fayl.
