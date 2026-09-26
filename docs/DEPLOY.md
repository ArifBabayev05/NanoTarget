# Deploy — Vercel + Turso

Canlı sayt: **https://onehuman.ai**
Vercel layihəsi: `arif-babayev-projs/onehuman-mvp`

## Arxitektura

- Bir serverless funksiya (`api/index.js`, `scripts/build-vercel.mjs` ilə esbuild-dən yığılır) bütün marşrutları verir; `vercel.json` hər yolu ona yönəldir.
- Statik fayllar (`web/`, `sdk/`, `docs/`) funksiyaya `includeFiles` ilə daxil edilir və funksiya özü verir.
- Verilənlər bazası: **Turso (libSQL, HTTP)**. Eyni SQLite dialekti, ona görə lokal `node:sqlite` ilə eyni SQL işləyir. Serverless nüsxələr arasında otaq, sessiya, qərar və audit zənciri paylaşılır.
- `NT_SECRET`: token imzaları və lab operator açarı (HKDF → Ed25519) bu sirrdən çıxır, bütün nüsxələrdə eynidir.
- SSE yoxdur (serverless); səhifə 2.5 s-dən bir sorğu ilə yenilənir.
- Baza qoşulmayıbsa funksiya yaddaşda işləyir və səhifədə xəbərdarlıq göstərir; nəticələr nüsxələr arasında itə bilər.

## Qurulum (tamamlanıb, 20 sentyabr 2026)

- Turso resursu `onehuman-db` Vercel Marketplace-dən yaradılıb, layihəyə bağlıdır (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` production/preview/development). Dashboard: Vercel → Storage.
- `NT_SECRET` bütün mühitlərdə təyin edilib.
- Bundle ESM-dir; libSQL-in WebSocket transportu (`ws`) stub ilə əvəz olunub, çünki Vercel-də `Dynamic require of "events"` xətası verirdi. Yalnız HTTPS libsql URL-ləri istifadə olunur.
- Soyuq start: sxem yoxlaması bir sorğudur, hazır bazada CREATE/ALTER işlənmir. Ölçülən cavab vaxtı ~0.3–0.6 s.

## Gündəlik

```bash
npm run check          # tsc + 80 test
npm run build:vercel   # api/index.js
npx vercel deploy --prod --yes
```

## Məhdudiyyətlər

- Otaq linki publikdir, dashboard-da auth yoxdur (MVP). Sintetik məlumat.
- WebAuthn RP id = host (`onehuman.ai`); passkey bu domenə bağlıdır.
- Hobby plan: funksiya 30 s limit, soyuq start ~0.5–1 s.
