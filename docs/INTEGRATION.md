# İnteqrasiya — Express / Node (3 sətir)

```bash
npm i nanotarget      # Node ≥ 22.13
```

Yeganə quraşdırma budur. `nanotarget` (Apache-2.0) `nanotarget-engine` paketindən (BUSL-1.1, produksiyada istifadə icazəlidir) asılıdır — npm onu özü gətirir; engine-i ayrıca əlavə etmək və ya import etmək lazım deyil. İstifadə etdiyiniz hər şey `nanotarget/express` və `npx nanotarget` altındadır.

Bank, CRM və ya sığorta şirkəti NanoTarget-i öz backend-inə **middleware** kimi qoşur. Qaydalar şirkətin öz JSON faylındadır, maskalama şirkətin öz funksiyasıdır, autentifikasiyaya toxunulmur, məlumat bazası şirkətin öz diskindədir (on-prem).

```js
import { nanotarget } from 'nanotarget/express';

const nt = await nanotarget({ secret: process.env.NT_SECRET, policy: './nanotarget.policy.json', db: 'sqlite:./nanotarget.db' });
app.use(nt.middleware());                                    // 1. SDK + onun API-si /nanotarget altında
app.get('/api/balance', nt.protect('balance.read'),          // 2. qərar nöqtəsi: məlumatı qaytaran endpoint
  (req, res) => nt.send(req, res, account, maskBalance));    // 3. allow → tam, mask → sizin mask funksiyanız
```

Səhifəyə bir teq: `<script src="/nanotarget/sdk.js"></script>` və ekranda göstərilən həssas elementə `data-nt-sensitive="full"`. Sorğuları `NanoTarget.fetch(url)` ilə göndərin (adi `fetch`-in üstündə, klik telemetriyasını başlığa əlavə edir).

İşləyən nümunə: `node examples/express-bank/server.mjs` → http://localhost:3000

## Nə baş verir

1. `middleware()` hər brauzerə (və ya `identify()` ilə hər login sessiyasına) bir NanoTarget sessiyası verir; SDK səhifədən passiv siqnalları (`/nanotarget/signals`) göndərir.
2. `protect('balance.read')` sorğu gələndə qərar verir: server müşahidələri (imza, başlıqlar) + SDK telemetriyası (markerlər, oxuma partlayışı, kursor kinematikası) → `assess` → sizin qaydanız → audit sətri (hash-zəncir).
3. Nəticə `req.nt`-də: `decision` (`allow | mask | block | step_up`), `masked`, `actor`, `score`, `reasonCodes`, `stepUp`, `token()`.
   - `block` → 403 və `step_up` → 428 avtomatik cavablanır (`respond: false` ilə özünüz idarə edə bilərsiniz).
   - `mask` → handler-iniz çağırılır, `req.nt.masked === true`; `nt.send(req, res, full, mask)` maskanı tətbiq edir.
4. Agent qoşulan an SDK ekrandakı `data-nt-sensitive="full"` sahələri yerindəcə gizlədir (`nt:sealed` hadisəsi), səhifə istəsə yenidən sorğu göndərir.

## Seçimlər

| Seçim | Mənası | Default |
|---|---|---|
| `secret` | ≥32 bayt; tokenlər və tenant otağı bundan çıxır, dəyişməz olmalıdır | — (məcburi) |
| `policy` | JSON faylının yolu və ya obyekt. `apiKey` varsa ilk startda portala 1-ci versiya kimi gedir, sonra server qaydanı portaldan oxuyur (aşağıya bax) | `apiKey` yoxdursa məcburi |
| `policyFromPortal` | `false` — qayda yalnız fayldan (internetsiz server) | `apiKey` varsa `true` |
| `db` | `sqlite:./nanotarget.db` · `memory` · `libsql://host?authToken=…` | `sqlite:./nanotarget.db` |
| `basePath` | SDK və API-nin yolu | `/nanotarget` |
| `identify(req)` | sizin login sessiya/istifadəçi id-niz → bir loginin bütün tabları bir NanoTarget sessiyası | cookie ilə brauzer başına |
| `cookie` | cookie adı | `nt_sid` |
| `respond` | block/step_up-ı middleware cavablasın | `true` |
| `webauthnReclaim` | agent bloklanandan sonra "Mən insanam" passkey yolu | `true` |
| `tenant` | çoxtenant quraşdırmada otaq adı | `default` |

## Qayda portalda saxlanılır

`apiKey` verilibsə, qaydanın əsas yeri portaldır:
- **İlk start:** `nanotarget.policy.json` portala gedir və 1-ci versiya olur — təsdiq istəmir.
- **Sonra:** server hər dəqiqə qaydanı portaldan oxuyur. Portalda edilən dəyişiklik bir dəqiqəyə tətbiq olunur, deploy lazım deyil.
- **Faylı developer və ya agent dəyişəndə:** dəyişiklik portala gedir. Default olaraq dərhal tətbiq olunur. Portalın Policy səhifəsində "Ask me before a change from code takes effect" açılsa, dəyişiklik təsdiq gözləyir.
- **Qorumanı zəiflədən dəyişiklik** (qaydanın silinməsi, `block` → `allow`, `enforce` → `observe`) təsdiq və hesab şifrəsi istəyir. Bu yoxlamanı söndürmək də şifrə istəyir.
- **İmza:** portal hər versiyanı yalnız sizin açar üçün imzalayır. Server portalın açarını ilk dəfə yadda saxlayır və imzasız və ya dəyişdirilmiş qaydanı qəbul etmir. Portal əlçatmaz olanda son imzalı nüsxə ilə işləyir.
- **Qaydanın haradan gəldiyini görmək:** hər dəyişiklikdə log sətri yazılır, `nt.policySource()` və `/nanotarget/health` da göstərir. `NODE_ENV=production` deyilsə, cavabda `X-NT-Policy-Source: portal | cache | file` başlığı olur.

## Qayda faylı

```json
{
  "version": "acme-bank-policy-1",
  "enforcement": "observe",
  "rules": [
    { "resource": "balance.read", "title": "Balans",
      "onAgent": "block", "onArtifact": "mask", "onUnknown": "allow", "onHumanLike": "allow",
      "actOn": ["verified", "strong", "control", "behavioral"], "minScore": 65 }
  ]
}
```

- `enforcement: "observe"` — heç nə bloklanmır, amma hər qərar "əgər enforce olsaydı" ilə yazılır. **İlk 1–2 həftə belə başlayın**, sonra `enforce`.
- Budaqlar: `onAgent` (agent sübutu), `onArtifact` (yalnız mühit izi: AI tətbiqinin brauzeri, genişləndirmə), `onUnknown` (siqnal kifayət deyil — insan sayılmır!), `onHumanLike` (kinematik/davranış insan sübutu və ya passkey).
- `actOn` — hansı sübut mərtəbələri `onAgent`-i işə sala bilər; `minScore` yalnız davranış mərtəbəsi üçün.

## Step-up və insan geri alması

- `step_up` cavabında `stepUp.challenge` var; demo axını `POST /nanotarget/step-up {id, answer}`. Real sistemdə buranı öz OTP/push axınınızla əvəz edirsiniz: təsdiqdən sonra `nt.engine.store.grantStepUp(sessionId, resource, ttlMs)` çağırın, növbəti sorğu keçir.
- Agent blokundan sonra istifadəçi Touch ID/passkey ilə sessiyanı 5 dəqiqəlik geri alır: `POST /nanotarget/webauthn/register|assert` (SDK-nın nümunə UI-si `web/product.js`-dədir).

## Digər platformalar

Eyni HTTP müqaviləsi ilə Spring (Java), ASP.NET, Go, Python üçün paketlər planlaşdırılır. Onlara qədər istənilən stack qərarı `POST /v1/decide` ilə ala bilər (engine-in `decide()` funksiyasının HTTP forması) — Node xidməti şirkətin şəbəkəsində sidecar kimi işləyir.

## SDK nə toplayır (məxfilik)

Yalnız metadata: klik basma müddəti, pressure, kursor yolunun nöqtələri (ekran koordinatları, 1.5 s), klaviatura *fasilələri* (düymə adları yox), məlum agent alətlərinin DOM markerləri və qlobal adları, sənədin görünürlük halı. Mətn, düymə identifikasiyası və form məzmunu heç vaxt göndərilmir.
