# NanoTarget — Claude versiyası: nə quruldu, nə ölçüldü, nə sübut olunmadı

**Tarix:** 18 sentyabr 2026
**Kod:** `YCombinator/nanotarget-claude`
**Mənbə:** `NANOTARGET-FULL-REPORT.md`, `research/01…05`, `nanotarget-mvp` kodu, `research/browser-agent-lab/evidence`

## 1. Məqsəd

Mövcud MVP ölçmə laboratoriyasıdır: siqnal toplayır, izahlı bal verir, jurnal göstərir. Hesabatın əsas prinsipi isə budur: **qərar düymədə yox, həssas məlumatı qaytaran backend sorğusunda verilməlidir.** Bu versiya həmin prinsipi əsas məhsul kimi qurur: siqnal toplama yalnız girişdir, əsas iş policy mühərriki, qərar tokenləri, audit zənciri və inteqrasiya edilə bilən middleware-dir.

## 2. MVP ilə fərqlər

| Mövzu | Mövcud MVP | Bu versiya |
|---|---|---|
| Həssas data | Bundle-da sintetik sabitlər, DOM-a birbaşa düşür | Yalnız serverdə, sessiyaya görə yaradılır; səhifədə heç bir hesab məlumatı yoxdur |
| Qərar nöqtəsi | Jurnal + yalnız imzalı sorğuda 403 | Hər qorunan endpoint `engine.protect(resource)` ilə sarılır; `allow / mask / step_up / block` |
| Sübut səviyyələri | Tək bal + ayrıca marker müşahidəsi | 4 tier: `verified`, `strong`, `behavioral`, `artifact`; qayda hansı tier-ə reaksiya verəcəyini seçir |
| Naməlum | `unknown` verdict | Qaydada ayrıca `onUnknown` budağı; heç vaxt insan sayılmır |
| Qayda | Yox | Otaq üzrə versiyalanmış policy, `observe`/`enforce` rejimi, dashboard |
| İxrac | Client-side CSV blob | İki addım: qərar → 30 s birdəfəlik HMAC token → fayl; replay 403 |
| İmza | Verified → 403 səhifə | Verified → `verified` tier → qayda; nonce/digest ilə replay qoruması; operator allowlist |
| Audit | Event cədvəli | SHA-256 hash zənciri, `/api/v1/audit` yoxlayır |
| Eksperimental izlər | Ayrı lab skriptləri | SDK-da clipboard körpüsü, fokus konflikti probu, WebMCP hook; default qaydada blok üçün kifayət etmir |
| Benchmark | Sessiya müqayisə cədvəli | Etiket üzrə: aşkarlanan, məlumatdan əvvəl, blok, step-up, mask, həssas data verilib, sonda naməlum, median gecikmə; yanlış blok və buraxılmış agent sayı |
| Stack | Next.js + Cloudflare D1 + 30+ paket | Node 24, `node:sqlite`, sıfır runtime asılılıq, 42 test |

## 3. Arxitektura

```
sdk/nanotarget.js  ──► POST /api/v1/signals      (untrusted; validate → events)
                    └► X-NT-Sample header        (qərar anında təzə snapshot)

GET /api/v1/account/balance
  └► engine.protect('balance.read')
       ├─ observeRequest()   Web Bot Auth (RFC 9421) + nonce replay; Sec-Fetch; UA major
       ├─ assess()           tiers → actor: agent_likely | human_like | unknown
       ├─ evaluate(policy)   rule.onAgent / onUnknown / onHumanLike; actOn tiers; minScore
       ├─ appendDecision()   hash-chain audit; policyVersion + signalVersion
       └─ handler(ctx)       yalnız allow/mask-da işləyir; ctx.masked → maskalanmış data
```

Fayllar: `server/assess.ts`, `server/policy.ts`, `server/engine.ts`, `server/web-bot-auth.ts`, `server/tokens.ts`, `server/audit.ts`, `server/db.ts`, `server/routes/*`, `sdk/nanotarget.js`, `public/app.js`, `public/dashboard.js`.

## 4. Defolt qayda

| Resurs | Agent ehtimalı | Naməlum | İnsanabənzər |
|---|---|---|---|
| `profile.read` | mask | allow | allow |
| `balance.read` | block | allow | allow |
| `transactions.search` | mask | allow | allow |
| `report.export` | block | step_up | allow |

`actOn = [verified, strong, behavioral]`, `minScore = 65`. `artifact` tier yalnız qaydada açıq seçilərsə təsir edir.

## 5. Canlı sınaq — Claude daxili brauzeri agent kimi

Sınaq bu sessiyada Claude-un öz built-in brauzeri ilə (CDP əsaslı klik) aparıldı. Otaq `c65d6891…`, sessiya `53aad518`, etiket `agent`.

| Addım | Resurs | Qərar | Aktor · bal | Səbəb kodları |
|---|---|---|---|---|
| Profilə bax | `profile.read` | allow | unknown · 52 | SINGLE_ATOMIC_CLICK, INSUFFICIENT_ACTIONS |
| Balansı göstər | `balance.read` | allow | unknown · 66 | ATOMIC_CLICKS, INSUFFICIENT_ACTIONS |
| “ödəniş” axtar | `transactions.search` | **mask** | agent_likely · 79 | ATOMIC_CLICKS |
| CSV endir | `report.export` | **block** | agent_likely · 87 | ATOMIC_CLICKS |
| İmzalı sorğu (lab açarı) №1 | `balance.read` | **block** | agent_likely · 100 | VERIFIED_OPERATOR_SIGNATURE |
| İmzalı sorğu №2 (eyni nonce) | `balance.read` | **block** | agent_likely · 100 | SIGNATURE_REPLAY |

Zamanlama (sessiya açılışından): ilk qərar 24.8 s, ilk həssas məlumat 24.8 s, ilk agent siqnalı 26.9 s. **Nəticə: davranış siqnalı balansdan təxminən 2 s gec gəldi.** Bu, əsas hesabatdakı “giriş anında qoruma deyil” tapıntısını təsdiqləyir. Server qərar gecikməsi hər sorğuda 1–2.2 ms.

Digər müşahidələr: `navigator.webdriver=false`, `isTrusted=true`, məlum DOM izi yox, clipboard körpüsü yox, fokus konflikti 0 (tək tab). Claude daxili brauzerində hər klik ≤12 ms basma, 0 hərəkət kimi göründü; bu, `behavioral` tier-i 3-cü əməliyyatda işə saldı.

Etiketsiz sessiya `89738cba`: ilk əməliyyat ixrac → `step_up` (428), kod dialoqda təsdiqləndi → `allow` + `STEP_UP_PASSED`, fayl 685 bayt endirildi, eyni link ikinci dəfə HTTP 403 `reused`.

## 5a. İkinci sınaq — Claude daxili brauzeri özünü necə göstərir?

Claude-un öz built-in brauzerində səhifədən və serverdən görünən hər şey yoxlanıldı.

| Kanal | Müşahidə | Sinif |
|---|---|---|
| HTTP `User-Agent` | `… Claude/2.2553.1 Chrome/152.0.7977.76 …` | Mühit izi: Claude desktop tətbiqinin daxili brauzeri. İnsan da həmin paneldə klikləyə bilər. |
| `Sec-CH-UA*` başlıqları | Yoxdur (adi Chrome hər sorğuda göndərir) | Mühit izi |
| Web Bot Auth imzası | Yoxdur | — |
| `navigator.webdriver` | `false` | İşləmir |
| `event.isTrusted` | `true` | İşləmir |
| Səhifə qlobalları | Baseline-dan kənar heç nə yoxdur; `modelContext`, `__codexWebMcpModelContext`, `chrome.runtime` yoxdur | İşləmir |
| `navigator.userActivation` | Klikdən sonra `isActive=true` | İşləmir |
| **`document.visibilityState` klik anında** | **`hidden`** — panel gizli ikən agent klikləyir; insan gizli səhifəyə klikləyə bilməz | **Güclü namizəd** (`HIDDEN_DOCUMENT_CLICK`) |
| **`PointerEvent.pressure` pointerdown-da** | **`0`** (`buttons=1` ikən); spesifikasiyaya görə real siçan 0.5 verir | **Davranış namizədi** (`ZERO_PRESSURE_POINTER`) |
| `pointermove` sayı | 0; `movementX/Y = 0` | Mövcud `ATOMIC_CLICKS` qaydası ilə üst-üstə düşür |

Bu üç siqnal SDK-ya və qiymətləndiriciyə əlavə edildi. Yenidən sınaq: eyni brauzerdə **ilk klik** balansda `block` verdi (`HIDDEN_DOCUMENT_CLICK`, `AGENT_APP_BROWSER`, bal 100), yəni bu rejimdə məlumatdan əvvəl aşkarlama alındı. Şərtlər: panel gizli idi; panel görünəndə `hidden` siqnalı olmayacaq, `pressure=0` qalacaq. `pressure` üçün Force Touch trackpad və toxunma ekranlarında insan baseline-ı hələ yoxdur; buna görə `ZERO_PRESSURE_POINTER` `behavioral` tier-dədir və 3 əməliyyat tələb edir. Codex daxili brauzeri və Claude in Chrome bu iki siqnalla hələ ölçülməyib.

## 5b. İstifadəçinin sınaqları (16:14–16:22) və “qoşulma anı” nəticəsi

Eyni otaqda Arif özü və agentlər test etdi. Xam data `data/lab.db`-dədir.

| Sessiya | Rejim | UA / client hints | Kliklər (hold, hərəkət, pressure, hidden) | Nəticə |
|---|---|---|---|---|
| `b84f3211` | **İnsan, adi Chrome** | 153 / var | 83–108 ms, 45–106 hərəkət, **0.5**, false ×4 | 4 qərar, hamısı `allow`; 3-cü əməliyyatdan `human_like`, bal 10. **Yanlış blok yoxdur.** |
| `08399f04` | İnsan, Claude paneli | 152, `Claude/2.2553.1` / yox | düymə klikləri qeydə alınmadı | baseline natamam; təkrar lazım |
| `f211d5f9` | **Agent, Claude paneli** | 152, `Claude/2.2553.1` / yox | 0–1 ms, 0 hərəkət, **0**, **true** ×5 | ilk klikdə `mask`, sonra `block`; **heç bir həssas data verilmədi**; ilk agent siqnalı 11.5 s (ilk klik anı) |
| `6c3ffd84` | **Agent, Claude in Chrome ekstenşnı** | 153 / var | 1–3 ms, 0 hərəkət, **0.5**, false | `claude-stop` + `claude-cursor` markerləri **123 ms-də**, ilk klikdən 21 s əvvəl. Köhnə qaydada artefakt sayıldı, 2 qərar `allow` oldu; davranış yalnız 3-cü əməliyyatda tutdu. |

Nəticə: Claude in Chrome üçün qoşulma anı siqnalı **var idi**, problem qaydada idi. Ekstenşn mənbəyi (v1.0.93, yalnız oxunub) bunu təsdiqləyir: `agent-visual-indicator.js` `SHOW_AGENT_INDICATORS` mesajı ilə `#claude-agent-stop-container`, `#claude-phantom-cursor`, `#claude-agent-glow-border` yaradır və `HIDE_AGENT_INDICATORS` ilə silir; `#claude-agent-animation-styles` isə agent dayandıqdan sonra da qalır (keçmiş iz). Codex ekstenşnı (v1.26.901) `scripting.executeScript({world:"MAIN", injectImmediately:true})` ilə səhifə dünyasına `__codexChromeExtensionHostFetch`, `__codexChromeExtensionPageSelectionObserver` kimi qloballar və `#codex-agent-overlay-root` yeridir. Hər iki ekstenşn `<all_urls>` üçün web-accessible resurs açır (`images/cursor-chat.png`, `assets/agent-visual-indicator.js-*`), yəni səhifə quraşdırılmanı 1 sorğu ilə görə bilər.

Bu build-də əlavə edilən “qoşulma anı” qatı (`assess-v2`):

| Siqnal | Səviyyə | Nə vaxt işləyir | Sınaqda |
|---|---|---|---|
| `AGENT_CONTROL_MARKER` (claude-stop/cursor/glow, codex-overlay) | **control** — default qaydada blok üçün kifayət edir | Claude in Chrome / Codex ekstenşnı tabı idarə edərkən, səhifə yüklənəndən ~100–200 ms sonra | 123 ms |
| `FOCUS_WHILE_HIDDEN` (passiv, klik tələb etmir) | strong | Agent gizli tab/paneldə işləyərkən (focus emulation) | Claude paneli, gizli ikən |
| `HIDDEN_DOCUMENT_CLICK`, `ZERO_PRESSURE_POINTER` | strong / behavioral | Claude panelində ilk klikdə | ilk klikdə |
| `AGENT_APP_BROWSER` (UA `Claude/x`, `Sec-CH-UA` yox) | artifact → `onArtifact` budağı | Claude desktop panelində, ilk HTTP sorğusunda | 0 ms |
| `AGENT_EXTENSION_INSTALLED` | artifact → `onArtifact` | Chrome-da ekstenşn quraşdırılıbsa (aktiv olmasa da) | — |
| `AGENT_PAGE_GLOBALS` (`__codex*`, `__browserUse*`) | artifact → `onArtifact` | Codex ekstenşnı və Codex daxili brauzeri səhifəyə skript yeridəndə | — |

Qaydaya yeni `onArtifact` budağı əlavə edildi: aktor naməlum, amma mühit izi varsa (defolt: balans `mask`, ixrac `step_up`). Beləliklə Claude panelində və ya ekstenşn quraşdırılmış Chrome-da insan bloklanmır, amma həssas əməliyyatda əlavə təsdiq alır.

**Hələ qoşulma anında görünməyən rejim:** Codex daxili brauzeri (yalnız `__codexWebMcpModelContext`, insan da eyni), Claude paneli görünən vəziyyətdə heç klik olmadan (yalnız UA tokeni). Bu iki rejimdə ilk qərar `onArtifact` budağı ilə verilir; deterministik agent sübutu ilk klikə qədər yoxdur.

## 5c. Üçüncü sınaq dəsti (16:38–16:52) və “qoşulma anı” təsnifatı

| Sessiya | Rejim | Qoşulma anında görünən | Agent qoşuldu | İlk əməliyyat |
|---|---|---|---|---|
| `de5d98cb` | **İnsan, Claude paneli** | UA `Claude/2.2553.1`, `Sec-CH-UA` yox | — | 5.2 s; kliklər 100–150 ms, 41–86 hərəkət, **pressure 0.5** |
| `e25fa2ef` | **Agent, Claude in Chrome** (səhifəni əvvəl açıb, sonra agent qoşulub) | 78 ms-də: hər iki ekstenşn quraşdırılıb (`claude-chrome`, `codex-chrome`) | **26.1 s** — `claude-stop`, `claude-cursor`, `claude-glow` eyni anda yarandı | 61.6 s → ilk qərar `mask`, heç bir həssas data verilmədi |
| `1813a73b`, `20ef4997` | **Agent, Codex daxili brauzeri** | 56 ms / 1.3 s: `__codexWebMcpModelContext`, `modelContext` API | — | əməliyyat etmədi |
| `45dcbb3a`, `201b7514` | Agent, Claude paneli | UA tokeni | — | əməliyyat etmədi |

Nəticələr:

1. **Agent açıq taba sonradan qoşulanda anı tutmaq mümkündür.** Claude in Chrome 26.1 s-də qoşuldu, SDK markeri dərhal gördü, server bunu ilk əməliyyatdan 35 s əvvəl qeyd etdi.
2. **Claude panelində insan baseline-ı alındı:** `pressure=0.5`, `hidden=false`. Yəni `pressure=0` və gizli sənədə klik yalnız agentdə görünür. Amma bu iki siqnal ilk klikdə yaranır, qoşulma anında yox.
3. **Fokus konflikti insan sessiyasında 61 dəfə işlədi.** Claude paneli bütün tablarda focus emulation saxlayır; siqnal agent-app mühitində məlumat vermir və oradan çıxarıldı.
4. **Codex daxili brauzeri** qoşulma anında yalnız mühit qlobalı verir; agentin aktiv olub-olmadığı ilk əməliyyata qədər bilinmir.

Bu build-də ayrıca `connection.ts` təsnifatı əlavə edildi. Hər sessiya üçün, əməliyyat gözləmədən, dörd vəziyyətdən biri verilir və vəziyyət `agent_attached`-ə keçən an `attach` hadisəsi kimi saxlanır:

| Vəziyyət | Mənbə | Nəyi sübut edir |
|---|---|---|
| `signed_agent` | Web Bot Auth imzası | operator kimliyi (kriptoqrafik) |
| `agent_attached` | aktiv idarə markeri, webdriver, gizli ikən fokus, WebMCP çağırışı | agent aləti bu taba qoşulub |
| `agent_environment` | UA tokeni, Codex qlobalı, quraşdırılmış ekstenşn, keçmiş izlər | agent tətbiqi/aləti var; insan da ola bilər |
| `no_indication` | — | heç nə; insan sübutu deyil |

`GET /api/v1/connection` bu vəziyyəti verir; benchmark-da “qoşulub / əməliyyatdan əvvəl / median qoşulma vaxtı / insan etiketli yanlış qoşulma” sayğacları var. Lab-ın öz imza simulyasiyası `simulated` bayrağı ilə statistikadan çıxarılır.

## 5d. Dördüncü sınaq (17:08) və canlı axın

`7633e9de` (etiket `agent`, Chrome 153): 237 ms-də hər iki ekstenşnın quraşdırıldığı, **464 ms-də** Claude aktiv idarə markerləri göründü; server qoşulmanı 0.46 s-də qeyd etdi; ilk əməliyyat 51.8 s-də gəldi və `mask` aldı, balans `block`. Markerlər Claude ekstenşnına aiddir; bu sınaqda Codex ekstenşnının overlay-i və qlobalları görünmədi, yəni Codex ekstenşnı rejimi hələ ölçülməmiş sayılır.

Əlavə edilən development:

- `server/bus.ts` + `GET /api/v1/stream` — Server-Sent Events. `attach` və `decision` hadisələri baş verən an göndərilir; səhifə bunu banner kimi göstərir. Bank backend-i eyni axına qoşulub sessiyanı dərhal məhdudlaşdıra bilər.
- **Yapışqan qoşulma.** Sessiyaya bir dəfə agent qoşulubsa (`agent_attached_at`), göstərici sonradan itsə də hər qərar `AGENT_ATTACHED_EARLIER` (control) alır. Agentin “dayanıb insana ötürməsi” sessiyanı təmizləmir.
- Lab-ın imza simulyasiyası `simulated` bayrağı ilə benchmark-dan çıxarıldı; insan qrupunda yanlış blok sayı 0-a düşdü.

## 5e. Claude daxili brauzerində qoşulma anı — oxuma izləri (18 sentyabr, axşam)

Sual: Claude-un öz panelində (deterministik marker olmayan rejim) agenti klikdən əvvəl tutmaq olarmı? Yanaşma: agent klikdən əvvəl səhifəni **oxuyur** — screenshot, mətn, accessibility ağacı. Bu oxumaların səhifədən görünən yan təsirləri ölçüldü (Claude-un öz brauzeri ilə, səhifə tərəfindən, adi web API-lərlə).

| Agent aləti | Səhifədə görünən iz | SDK siqnalı |
|---|---|---|
| `get_page_text` | `<main>`/`<body>` üzərində `innerText` oxunuşu, stack-də URL-siz `<anonymous>` skript | `MAIN_WORLD_TEXT_EXTRACT` |
| `read_page` | 1299 `getBoundingClientRect` + `textContent` oxunuşu bir neçə ms-də, `<anonymous>` skript | `MAIN_WORLD_READ_BURST` |
| `find` | 1843 `textContent` oxunuşu, eyni profil | `MAIN_WORLD_READ_BURST` |
| `read_page`/`find` sonrası | səhifə qlobalında `__claudeElementMap`, `__claudeElementReverseMap`, `__claudeRefCounter`, `__generateAccessibilityTree` **qalıcı** | `AGENT_TOOL_GLOBALS` (control) |
| `screenshot` | ilk çəkimdə gizli sənəd 5–17 ms `visible` olur, bəzən 1024×768 `resize`; stabil deyil | `VISIBILITY_FLICKER` (istinad edilmir) |
| ilk `click` | `pressure=0`, 0 hərəkət, ≤2 ms basma, sənəd gizli; fokus gizli ikən **qazanılır** | `SYNTHETIC_FIRST_CLICK`, `FOCUS_WHILE_HIDDEN` |
| boş dayanma | gizli sənəddə rAF 120 Hz işləyir; gizli yükləndi | `RENDER_WHILE_HIDDEN`, `LOADED_HIDDEN` (yalnız mühit) |

Niyə səhifənin öz kodu və ekstenşnlar bura düşmür: səhifə skriptlərinin stack kadrlarında URL var (`app.js:12`); ekstenşn content-skriptləri izolyasiya olunmuş dünyada işləyir və əsas dünyanın `Node.prototype` sarğılarına toxunmur. Yalnız `Runtime.evaluate` ilə əsas dünyaya yeridilən skript URL-siz `<anonymous>` görünür. Məlum yanlış-pozitiv: developer DevTools konsolundan DOM gəzintisi.

Canlı nəticələr (hər biri təzə sessiya, `?as=agent`, klik yox):

| Sessiya | Agentin ilk işi | `agent_attached` anı | İlk qorunan əməliyyat |
|---|---|---|---|
| `e8e84b69` | yalnız `get_page_text` | **3.16 s** | — |
| `b0b0be70` | yalnız `find` | **3.16 s** | — |
| `0a63e2a7` | screenshot → qorunmayan düyməyə klik | **10.41 s** (klik anı) | — |
| `cba9eeca` | screenshot → `find` → balans kliki | **5.21 s** | 12.2 s → `block`, bal 100 |

İnsan baseline-ı ilə uyğunluq: Claude panelindəki insan sessiyası (`de5d98cb`) kliklərdə `pressure 0.5`, 41–86 hərəkət verdi; `SYNTHETIC_FIRST_CLICK` şərtinə düşmür. `FOCUS_WHILE_HIDDEN` yalnız "gizli ikən fokus qazanıldı" halına məhdudlaşdırıldı ki, paneli bağlayan insan fokusu saxlasa da tetiklənməsin. Oxuma tələləri üçün insan yenidən sınamalıdır (aşağıda).

Qalan boşluq: agent yalnız screenshot çəkib heç nə etməsə, vəziyyət `agent_environment` qalır. Bu agent heç bir məlumata da toxunmur. Codex daxili brauzeri bu build ilə hələ ölçülməyib (limit).

## 5f. Codex Chrome ekstenşnı — təmiz sınaq (20 sentyabr, `b69d49ae`)

Claude ekstenşnı söndürülmüş, yeni tab, Chrome 153, `?as=agent`.

| Ölçü | Nəticə |
|---|---|
| `agent_attached` anı | **0.14 s** (`codex-overlay` idarə göstəricisi 138 ms-də, `codex-badge` 187 ms-də) |
| Oxuma partlayışı | 5.2 s-də `MAIN_WORLD_READ_BURST` — ikinci vendor üçün müstəqil təsdiq |
| Alət qlobalları | clipboard körpüsü və avtomatlaşdırma qlobalları 38 s-də (`AGENT_TOOL_GLOBALS`) |
| İlk təmas | 21.3 s; pressure 0, 1 hərəkət, 2 ms basma |
| İlk qorunan əməliyyat | 21.3 s → profil `mask` (bal 98); balans/ixrac `block`, axtarış `mask` |
| Həssas məlumat verildi? | **Xeyr** |

Qoşulma anı ilk əməliyyatdan 21 s əvvəl qeyd olundu. Jurnalda görünən dublikat sorğular agentin eyni düyməyə iki dəfə klikləməsindəndir; hər ikisi eyni qərarı alıb.

### Rejimlər üzrə yekun (20 sentyabr)

| Rejim | Qoşulma anında aşkarlama | Sübut |
|---|---|---|
| Claude in Chrome ekstenşnı | bəli, 0.1–0.5 s (açıq taba qoşulanda həmin an) | 4 sınaq |
| Codex Chrome ekstenşnı | bəli, 0.14 s | 1 təmiz sınaq |
| Claude desktop paneli | bəli, agentin ilk oxuması və ya ilk kliki anında (3–5 s) | 4 sınaq |
| İmzalı agentlər | bəli, ilk HTTP sorğusunda | lab açarı |
| Codex daxili brauzeri | oxuma tələləri ilə hələ sınanmayıb | — |
| İnsan (Chrome, Claude paneli) | heç biri "qoşulub" sayılmayıb | 2 sınaq; yeni tələlərlə təkrar lazımdır |

## 5g. Codex daxili brauzeri və insan sınağı (20 sentyabr)

**Codex daxili brauzeri (`a75282af`).** Qoşulma anında yalnız mühit izi (`__codexWebMcpModelContext`). Oxuma tələləri işləmədi: bu brauzer səhifəni əsas dünyadan oxumur. İlk klik 14 s-də profil `allow` aldı (məlumat verildi), balans `mask`, 3-cü əməliyyatdan `agent_likely`. Kliklər: pressure 0, 1 hərəkət, 1–4 ms. Düzəliş: "agent tətbiqi" anlayışı genişləndirildi — Claude UA tokeni **və ya** Codex mühit qlobalı. Belə mühitdə sintetik profilli ilk klik `SYNTHETIC_FIRST_CLICK` sayılır. Beləliklə Codex panelində aşkarlama 3-cü əməliyyatdan **ilk klikə** çəkilir; klikdən əvvəl bu rejimdə hələ deterministik siqnal yoxdur.

**İnsan sınağı (`94cdfa97`, Chrome 153) — yanlış blok, səbəbi laboratoriya səhvi.** Kliklər açıq-aydın insandır (pressure 0.5, 13–114 hərəkət, 91–141 ms basma) və səhifənin öz siqnallarında heç bir marker yoxdur. Amma server 0.1 s-də "agent qoşulub" yazdı və 3-cü qərardan yapışqan siqnal hər şeyi blokladı. Sübutlar (138, 187, 5229, 38130 ms) tam olaraq bir neçə dəqiqə əvvəlki Codex ekstenşn sessiyasının rəqəmləridir: Codex-in tabı açıq qalıb siqnal göndərməyə davam etmişdi, insan eyni Chrome profilində yeni səhifə açanda profil-geniş cookie yeniləndi və köhnə tabın siqnalları yeni sessiyaya yazıldı.

Düzəliş: sessiya ID-si səhifə nüsxəsinə yeridilir (`<meta name="nt-session">`), SDK hər sorğuda `X-NT-Session` göndərir, server header-i cookie-dən üstün tutur. Test: iki tab, köhnə cookie ilə yeni sessiya — siqnallar qarışmır. Bu insan sınağı statistikada "yanlış blok = 1" kimi qalır (audit zənciri silinmir); düzəlişdən sonra təkrar lazımdır. İstehsalda bu problem yoxdur: sessiya tətbiqin öz autentifikasiya sessiyasından gəlir, cookie-dən yox.

**Təkrar insan sınağı, düzəlişdən sonra (`9b625425` otağı, `755bd655` və `afed50cd`).** 12 klik: 92–132 ms basma, 25–111 hərəkət, pressure 0.5. 13 qərar, hamısı `allow`; 3-cü əməliyyatdan `human_like`, bal 10. "Agent qoşulub" yoxdur, oxuma tələləri susub, sintetik klik yoxdur. **Yanlış blok = 0.** Bu, bütün yeni siqnallar (oxuma partlayışı, mətn çıxarışı, alət qlobalları, sintetik ilk klik, gizli ikən fokus) üçün ilk təmiz insan baseline-ıdır.

### Rejimlər üzrə yekun (20 sentyabr, son)

| Rejim | Qoşulma anında aşkarlama | Sübut |
|---|---|---|
| Claude in Chrome ekstenşnı | bəli, 0.1–0.5 s, klikdən əvvəl | 4 sınaq |
| Codex Chrome ekstenşnı | bəli, 0.14 s, klikdən əvvəl | 1 təmiz sınaq |
| Claude desktop paneli | bəli, ilk oxuma anında (3–5 s), klikdən əvvəl | 4 sınaq |
| Codex daxili brauzeri | ilk klikdə | 1 sınaq + test |
| İmzalı agentlər | ilk HTTP sorğusunda | lab açarı |
| İnsan (Chrome) | heç biri qoşulub sayılmadı, 0 yanlış blok | düzəlişdən sonra 2 sessiya |

## 5h. Benchmark, mərhələ 1 — agent ssenariləri (20 sentyabr, otaq `8de313b7`)

Laboratoriyaya ssenari etiketi (`?scenario=`), ssenari üzrə benchmark və `scripts/benchmark-report.mjs` əlavə edildi. Claude panelində 9 agent ssenarisi icra edildi:

| Ssenari | Qoşulma | İlk əməliyyat | Nəticə |
|---|---|---|---|
| agent-read-only (oxu, klik yox) | 3.3 s | — | tutuldu, qərar yoxdur |
| agent-idle-screenshot (yalnız screenshot) | 4.5 s | — | tutuldu (titrəmə) |
| agent-screenshot-click (oxumasız klik) | 4.0 s | 26.8 s | balans blok |
| agent-text-then-click | 0.7 s | 6.7 s | balans blok |
| agent-full-flow ×2 | 1.0 s / 5.2 s | 16.4 s / 13.0 s | 5 qərar, hamısı mask/blok |
| agent-keyboard-only | 0.9 s | — | tutuldu (gizli ikən fokus) |
| agent-idle-30s-then-act | 0.6 s | 41.4 s | balans blok |
| agent-slow-paced (10 s fasilələr) | 0.7 s | 32.9 s | profil mask, balans blok |

9/9 sessiyada agent ilk əməliyyatdan əvvəl qeyd olundu, 0 sessiyada həssas məlumat verildi. Titrəmə siqnalı `VISIBILITY_FLICKER` adlandırıldı: gizli paneldə naviqasiya və screenshot zamanı sənəd bir kadrlıq görünüb gizlənir; insan paneli görəndə bu baş vermir. İnsan ssenariləri `docs/BENCHMARK.md`-də təlimat kimi verilib, istifadəçi icra edir.

## 5i. Benchmark, mərhələ 2 — insan ssenariləri (20 sentyabr)

| Ssenari | Qoşulma | Qərarlar | Nəticə |
|---|---|---|---|
| chrome-mouse-normal | iz yoxdur | 5× icazə | düzgün |
| chrome-fast-expert (maksimum sürət) | iz yoxdur | 5× icazə | düzgün; sürətli insan agent sayılmadı |
| chrome-keyboard-only (Tab/Enter) | iz yoxdur | 5× icazə, ixracda step-up keçildi | düzgün |
| chrome-devtools-open | iz yoxdur | 5× icazə | düzgün; DevTools konsolu yanlış pozitiv vermədi |
| chrome-ext-idle (ekstenşnlar quraşdırılıb) | mühit | icazə/mask, ixracda step-up keçildi | düzgün, qaydaya görə |
| handover-human-then-agent | insan: iz yoxdur; agent qoşulanda 27.6 s | insan: profil icazə, balans mask; agent: axtarış mask, balans/ixrac blok | **düzgün** — insan hissəsi keçdi, agent hissəsi bloklandı; statistikada "yanlış blok" görünür, çünki sessiya insan etiketlidir |
| claude-pane-human | **yanlış: "qoşulub" 0.2 s** | hamısı mask/blok | **yanlış pozitiv** |

Yanlış pozitivin səbəbi: yalnız `VISIBILITY_FLICKER` işləmişdi (səhifə gizli paneldə yüklənərkən 198 ms-də bir kadrlıq görünmə). Kliklərin hamısı insan profili idi (pressure 0.5, 32–67 hərəkət, 84–125 ms). Düzəliş: titrəmə siqnalı `strong`-dan `artifact` səviyyəsinə endirildi; tək başına heç vaxt "qoşulub" vermir. Yenidən hesablamadan sonra həmin sessiya "mühit" oldu, agent ssenarilərinin hamısı hələ də ilk əməliyyatdan əvvəl tutulur (median 3–8 s; agent-idle-30s-then-act 30.2 s, çünki agent 30 s heç nə etmədi). Yalnız "yalnız screenshot" ssenarisi artıq "mühit" qalır: belə agent heç bir məlumata da toxunmur.

Yekun rəqəmlər (bu otaq): insan 7 sessiya, 0 yanlış qoşulma (ötürmə istisna, orada qoşulan həqiqətən agentdir), 0 yanlış blok (claude-pane-human düzəlişdən əvvəl bloklanıb, təkrar lazımdır); agent 10 sessiya, 8-i ilk əməliyyatdan əvvəl qoşulub, 2-si heç əməliyyat etmədi, 0 sessiyada həssas məlumat verildi.

## 5j. Benchmark, mərhələ 3 — təkrar və əlavə insan ssenariləri (20 sentyabr)

| Ssenari | Nəticə |
|---|---|
| claude-pane-human (təkrar, düzəlişdən sonra) | profil icazə, balans mask (qayda), ixracda step-up keçildi. Blok yoxdur. Yanlış pozitiv düzəlib. |
| safari-normal (Safari 605) | iz yoxdur, 5× icazə |
| chrome-incognito | iz yoxdur, 5× icazə, 3-cü klikdən `human_like` |
| handover-agent-then-human | agent 27.2 s-də qoşuldu; sonra insanın 4 kliki (pressure 0.5) bloklandı. Yapışqan siyasət işlədi; biznes qərarı tələb edir (aşağıda). |
| human-done-then-agent-attaches | insan 5 kliki 11.8–31.0 s arasında etdi, hamısı icazə/mask; agent **47.3 s-də** açıq taba qoşuldu (idarə markeri), sonrakı 3 klik blok. Agentin əməliyyatı 72.9 s-də gəldi, yəni qoşulma anı ilk agent əməliyyatından 25.6 s əvvəl tutuldu. |

Bu otaq üzrə yekun: **insan 12 sessiya** — Chrome, Safari, gizli pəncərə, klaviatura, sürətli, DevTools, ekstenşnlar quraşdırılmış, Claude paneli: düzəlişdən sonra 0 yanlış qoşulma, 0 yanlış blok. Ötürmə ssenarilərində "yanlış blok" sayğacı 2 göstərir, amma hər ikisində bloklanan agentdir (sessiya insan etiketli olduğu üçün sayılır). **Agent 11 sessiya** — 10-u ilk əməliyyatdan əvvəl qoşulub, 1-i ("yalnız screenshot") əməliyyat etmədi, 0 sessiyada həssas məlumat verildi.

Açıq biznes sualı: agent qoşulduqdan sonra insan eyni tabda davam etsə, sessiya bloklu qalmalıdır (indiki) yoxsa insan passkey ilə sessiyanı geri ala bilməlidir? Təklif: bloklu qalsın, amma step-up ilə "insan geri alma" yolu olsun.

## 5k. WebAuthn step-up və sessiyanın geri alınması (20 sentyabr)

Ötürmə ssenarisi biznes sualı yaratdı: agent qoşulduqdan sonra insan eyni tabda davam etsə, sessiya bloklu qalır. Qərar: **bloklu qalsın, amma insan passkey / Touch ID ilə sessiyanı geri ala bilsin.** Səbəb: agent ekrandakı kodu oxuyub yaza bilər, amma biometrik təsdiqi keçə bilməz. WebAuthn-də `userVerification: "required"` authenticator-un özünün insanı yoxladığını (UV bayrağı) imza ilə bizim challenge-ə, origin-ə və RP id-yə bağlayır.

Qurulan (`server/webauthn.ts`, `server/routes/webauthn.ts`, asılılıqsız):

- qeydiyyat: attestation `none`, CBOR parse, COSE açar (ES256, RS256, EdDSA), UP+UV məcburi, challenge/origin/rpIdHash yoxlanır;
- təsdiq: `authenticatorData || sha256(clientDataJSON)` üzərində imza, UV bayrağı, sign counter (klon aşkarlaması), challenge birdəfəlik və 2 dəqiqəlik;
- uğurlu təsdiq sessiyanı 5 dəqiqə "insan təsdiqli" edir: `AGENT_ATTACHED_EARLIER` bu müddətdə tətbiq olunmur, aktor `human_like`, səbəb `HUMAN_VERIFIED_WEBAUTHN`; canlı operator imzası yenə üstün gəlir;
- agent kimi bloklanan sorğu cavabında `stepUp.reclaim=true` gəlir, səhifədə "Touch ID / passkey ilə geri al" düyməsi çıxır; passkey qeydiyyatı varsa adi step-up da kod yerinə passkey ilə gedir;
- laboratoriyada passkey otağa bağlıdır (otaq = "istifadəçi"); istehsalda hesaba bağlanır.

Testlər (80): proqram authenticator ilə qeydiyyat, imza, UV-siz rədd, sayğac geri sarılması, səhv origin/challenge, başqa açar; tam axın: qeydiyyat → agent qoşulur → balans blok (reclaim təklifi) → UV-siz təsdiq rədd → UV ilə təsdiq → balans icazə, `HUMAN_VERIFIED_WEBAUTHN` → 10 dəqiqə sonra yenidən blok.

**Canlı sınaq, real Touch ID (sessiya `2ff1a8f0`, Chrome 153, `localhost`):**

| Vaxt | Hadisə | Nəticə |
|---|---|---|
| 72.9 s | İstifadəçi passkey qeydə aldı və Touch ID ilə ilk təsdiqi verdi | qeydiyyat + `HUMAN_VERIFIED_WEBAUTHN` |
| 105.5 s | Claude in Chrome açıq taba qoşuldu | `agent_attached` (idarə markeri) |
| 250.8 s | Agent "Balansı göstər" basdı (1 ms basma, 0 hərəkət) | **blok**, bal 94, cavabda `reclaim=true` |
| 277.7 s | İstifadəçi eyni tabda düyməyə basdı (97 ms, 59 hərəkət), "Touch ID ilə geri al", Touch ID | serverdə imza, origin, UV doğrulandı → **balans açıldı**, aktor `human_like`, bal 10 |

Eyni tab, eyni sessiya, 27 saniyə fərq: agentin kliki bloklandı, insanın kliki Touch ID-dən sonra keçdi. Bu, "agent → insan ötürməsi" sualının cavabıdır: sessiya bloklu qalır, insan biometrik təsdiqlə geri alır. Qeyd: passkey üçün `http://localhost:8787` linki `127.0.0.1`-dən daha etibarlıdır.

## 6. Avtomatik testlər (80)

- `assess`: telemetriya yoxdursa unknown; 1 ani klik kifayət etmir; 3 ani klik → behavioral; təbii kliklər → human_like; webdriver/untrusted/WebMCP → strong; verified imza dominant; yalnız artefakt → unknown qalır; Codex mühit qlobalı təkbaşına sübut deyil; insan→agent keçidi pəncərədə tutulur.
- `policy`: naməlum `onUnknown`-a gedir; artefakt yalnız opt-in ilə; observe rejimi shadow qərar yazır; qayda sənədi validasiyası.
- `web-bot-auth`: verified/replay, tamper, səhv authority, köhnə və uzun interval, allowlist-dən kənar operator heç vaxt fetch edilmir, `@authority` olmayan imza rədd, kataloq əlçatmazsa `unavailable`.
- `tokens/audit`: token sessiya, resurs, müddət və açara bağlıdır; zəncir dəyişikliyi tapır; nonce bir dəfə işlənir.
- `api` (real serverdə): bundle-da IBAN yoxdur; cookie yoxsa 401; agent klikləri → balans 403, profil mask, ixrac 403, benchmark “məlumatdan əvvəl” = 1; insan klikləri → ixrac icazə, fayl, replay 403; step-up axını və grant birdəfəlikdir; token başqa sessiyada işləmir; saxta telemetriya açmır; pozulmuş telemetriya etibar edilmir; lab imzası → 403 + replay; observe rejimi versiya yaradır; başqa otağın cookie-si rədd.

## 7. Nə sübut olundu, nə yox

**Sübut olundu (bu build-də):**
- Həssas məlumatı serverdə qərardan sonra vermək və maskalamaq mümkündür; səhifə skeleti data daşımır.
- Təsdiqlənmiş operator imzası və replay bir sorğuda tutulur və data verilməzdən əvvəl bloklanır.
- İxrac linki birdəfəlik və sessiyaya bağlıdır.
- Claude daxili brauzerinin klik profili 3 əməliyyatdan sonra `behavioral` tier-ə düşür.

**Sübut olunmadı:**
- İlk həssas sorğudan əvvəl imzasız agenti tanımaq. Naməlum aktorda default `allow` seçilibsə data gedir; `step_up`/`mask` seçilsə insanlara da əlavə addım düşür. Bu, məhsulun gizlətməməli olduğu kompromisdir.
- İnsan false-positive faizi. Bu build-də hələ real insan sessiyası yoxdur (aşağıdakı sorğu).
- Codex daxili brauzeri, Codex Chrome extension, Claude in Chrome üzrə davranış fərqi — bu build ilə hələ ölçülməyib.
- Fokus konflikti və clipboard körpüsü probları kodda var, canlı çox-tab sınağı bu build-də edilməyib.

## 8. İstifadəçidən istənilən insansı əməliyyatlar

1. `http://127.0.0.1:8787/?room=<otaq>&as=human` linkini adi şəkildə aç, 5 saniyə gözlə, sonra profil → balans → “ödəniş” axtar → CSV endir → balans. Bunu 3 dəfə (hər dəfə yeni tab) təkrarla.
2. Eyni otağın `as=agent` promptunu Codex daxili brauzerinə və mümkünsə Claude in Chrome-a ver.
3. İki tabı eyni anda açıq saxlayan agent sınağı (fokus konflikti probu üçün).
4. Dashboard-da `report.export` üçün `onUnknown = block` seçib insan testini təkrarla: yanlış blok sayının necə dəyişdiyini bax.

## 9. Növbəti addımlar

- WebAuthn (user verification) ilə real step-up.
- `first sensitive read` üçün ayrıca qayda: naməlum aktorda skeleton + gecikdirilmiş data.
- Postgres store və Express/Fastify adapterləri; policy API-də `resource`, `action`, `risk_threshold`, `on_unknown`.
- 30+ insan / 30+ agent benchmark-ı reproducible skriptlərlə.

## 6. Kursor kinematikası və sandbox (21 sentyabr 2026)

**Səbəb.** 20 sentyabr gecəsi canlı saytda 3 insan sessiyası (bank, CRM) `mask`/`step_up` aldı. Tək səbəb `AGENT_EXTENSION_INSTALLED` idi: Chrome-da Claude/Codex genişləndirmələri quraşdırılıb deyə bal 52-yə qalxdı, aktor `unknown` qaldı və artifact budağı balansı maskaladı. Kliklərin özü insan idi (pressure 0.5, 10–40 hərəkət, 75–147 ms basma). Nəticə: "mühit izi" insan davranışını üstələyirdi — dizayn xətası.

**Düzəliş (assess-v3).**
- Quraşdırılmış genişləndirmə artıq neytral qeyddir: tier yox, bal yox.
- Davranışca insan verdikti artifact mərtəbəsindən *əvvəl* hesablanır; mühit izləri (agent tətbiqi pəncərəsi, səhifə qlobalları, gizli render) insan balını yuxarı qaldıra bilməz.
- Hər klikin **kursor trayektoriyası** serverə göndərilir (SDK v3: `click.traj` = klikdən əvvəlki ≤1.5 s / ≤240 nöqtə, `downMs`, `target{w,h,dx,dy}`, `coalesced`, `at`). Server `server/kinematics.ts` ilə xüsusiyyətlər çıxarır: düzxətlilik, xorddan sapma, istiqamət dəyişmələri, sürət profili (pik mövqeyi, variasiya), alt-hərəkət sayı, nümunələmə fasiləsi və onun sabitliyi, titrəyiş (ikinci fərq), hədəfə yaxınlaşanda yavaşlama, basma müddəti, pressure, mərkəzdən sapma, son nöqtə ilə klik yeri arasındakı "teleport" məsafəsi, ən uzun seqment.
- Klik başına qaydalı qiymət (`kin-v2`): `human` / `synthetic` / `uncertain`. Qiymətləndirmədə: 2 insan kliki → `human_like` (əvvəl 3 əməliyyat lazım idi); 2 sintetik klik → `behavioral` tier bal 82; 1 çox aydın sintetik klik (≥5 agent xalı) → `behavioral` bal 70 — ilk klikdə qərar.

**Sandbox.** `/sandbox?as=human|agent` — 10 nömrəli hədəf, hər klik `samples` cədvəlinə etiketlə yazılır, cavabda xüsusiyyətlər və qiymət qayıdır. `scripts/kinematics-eval.mjs` bütün dataset üzrə qarışıqlıq matrisi, kvantillər və sərhəd nümunələrini çap edir.

**Ölçülən dataset (40 klik, 21.09.2026):**

| Mənbə | Etiket | insan | sintetik | qeyri-müəyyən |
|---|---|---|---|---|
| Chrome trackpad (Arif) | insan | 10 | 0 | 0 |
| Claude paneli, insan (Arif) | insan | 8 | 0 | 0 |
| Claude in Chrome genişləndirməsi | agent | 0 | 10 | 0 |
| Claude desktop paneli (agent, lokal) | agent | 0 | 2 | 0 |
| Claude desktop paneli (agent, canlı) | agent | 0 | 10 | 0 |

Səhv: 0/40. Ən güclü fərqlər: **basma müddəti** (insan 83–158 ms, agent 1–4 ms), **trayektoriyanın olmaması** (insan ≥35 nöqtə, agentdə 0 və ya 3 seyrək nöqtə), alt-hərəkət sayı (insan ≥6, agent 0), yavaşlama (insan endSlow ≤0.37, agent ≈1). Pressure universal deyil: Claude paneli 0 verir, Claude in Chrome 0.5 verir. Trackpad 120 Hz-də dtCv 0.06–0.08-ə düşür — ona görə "sabit fasilə" qaydası yalnız dtCv<0.02 və düz xətt ilə birlikdə işləyir. Sürətli insan "flick"-ləri 260 px-lik seqment verir — `jump_segment` həddi 300 px.

**Canlı sandbox, 2-ci dövrə (21.09.2026, 100 klik cəmi, kin-v3):**

| Mənbə | Etiket | insan | sintetik | qeyri-müəyyən |
|---|---|---|---|---|
| Chrome siçan (2 seriya) | insan | 20 | 0 | 0 |
| Chrome trackpad, basmaqla | insan | 10 | 0 | 0 |
| Chrome trackpad, **toxunmaqla** (tap-to-click) | insan | 10 | 0 | 0 |
| Safari | insan | 10 | 0 | 0 |
| Chrome siçan, çox sürətli | insan | 10 | 0 | 0 |
| Claude paneli, insan | insan | 8 | 0 | 0 |
| Claude in Chrome (2 seriya) | agent | 0 | 20 | 0 |
| Claude desktop paneli | agent | 0 | 12 | 0 |

Səhv 0/100; agentlərdə maksimum insan xalı 2, insanlarda maksimum agent xalı 1.
İki düzəliş məhz bu dövrədən çıxdı: (1) **tap-to-click** basma müddətini 1 ms verir — "ani buraxma" yalnız hərəkət olmadıqda ağır sayılır; hərəkət klik yerində bitirsə (≤5 px) bu toxunuşdur (`tap_release`, +1). (2) **Safari** pointermove-u ~30 Hz-də verir (dtMean ≈ 29 ms, 11–24 nöqtə) — seyrəklik həddi 60 ms-ə qaldırıldı, alt-hərəkət yoxluğu aşağı nümunələmədə agent xalı vermir. Düz xətt qaydası uzun (≥80 px) və ≥0.997 düzxətliliyə məhdudlaşdı (qısa insan hərəkətləri təbii düzdür).

**Hələ ölçülməyən insan halları:** Windows/Linux siçan və toxunuş ekranı; eyni düyməyə təkrar klik (hərəkətsiz — `repeatTarget` istisnası var). Bunlar canlı sandbox-da toplanmalıdır.

## 7. Qoşulma anında ekrandakı məlumatın gizlədilməsi — "seal" (21 sentyabr 2026)

**Müşahidə (Arif).** İnsan balansı açır, sonra Claude-dan "balansım nə qədərdir" soruşur. Agent qoşulan an aşkarlandı (qırmızı pill), amma ekranda artıq olan balans qaldı və agent səhifəni oxuyub cavab verdi. Server tərəfi burada gücsüzdür: agent API-yə yox, DOM-a baxır.

**Həll (SDK v4).** Agent əlaməti *brauzerin özündə* görünən an `[data-nt-sensitive="full"]` sahələr yerindəcə, sinxron redaktə olunur (`••••`), `data-nt-sensitive="sealed"` işarələnir, `nt:sealed` hadisəsi atılır; səhifə açıq resursları yenidən serverdən istəyir (artıq maskalanmış/bloklanmış cavab gəlir). Tətiklər: idarə markeri (`claude-stop/cursor/glow`, `codex-overlay`), alət qlobalı (`__claudeElementMap` və s.), **anonim skriptin həssas sahəyə toxunan mətn oxunuşu** — getter dəyəri qaytarmazdan *əvvəl* möhürlənir, yəni ilk oxunuş belə redaktə edilmiş mətni görür —, `navigator.webdriver`, etibarsız klik, serverin `agent_attached` cavabı. Möhür haldır, hadisə deyil: agent qoşulu ikən sonradan "full" render olunan hər şey də dərhal redaktə edilir. Passkey ilə insan geri alması `unseal()` çağırır (5 dəq).

**Yoxlama (lokal, observe rejimi — server tam məlumatı qaytarır).** Claude paneli klikləyib balansı açdı: DOM-da `•••• ₼`, `get_page_text` nəticəsində `•••• ₼`. Yəni server icazə versə belə, ekranda agent üçün məlumat yoxdur.

**Canlı yoxlama (Arif, Claude in Chrome, 21.09.2026).** İnsan balansı açdı → agentə "balansım nə qədərdir" → agent qoşulan an balans `•••• ₼` oldu; agentin cavabı: "balansınız qorunur… 'Balansı göstər' düyməsini vurmaq lazımdır, bunu edim?" — yəni agent rəqəmi görmədi və insan icazəsi istədi. Kliklərsə, server sticky attach ilə bloklayır (§5). Möhür anı indi `reading.seal {atMs, reason, redacted}` ilə serverə də gedir.

**Dürüst hədd.** Bu, DOM oxunuşuna qarşıdır. Ekran görüntüsü (screenshot) və CDP-nin öz accessibility ağacı JS-dən keçmir; onlar üçün yeganə qorunma qoşulmanın markerlə/qlobal ilə *oxumadan əvvəl* tutulmasıdır (Claude in Chrome: 0.1–0.5 s əvvəl; Claude paneli: ilk oxunuşla eyni anda — ilk oxunuş yarışa girə bilər).

**Claude desktop paneli (Arif, 21.09.2026).** Agent: möhür işlədi — agent yalnız "gizlədildi/bloklandı" mesajlarını gördü, rəqəmi deyə bilmədi. İnsan: ilk klikdə balans maskalandı (AI brauzer pəncərəsi → onArtifact=mask). Buna görə **ilk klik açılışı** əlavə edildi: trayektoriyası birmənalı insan olan bir klik (≥8 insan xalı, 0 agent xalı) sessiyanı dərhal `human_like` edir; sticky agent qoşulması bunu üstələyir. Datasetdə: insan kliklərinin 53/68-i (78%) ilk klikdə açır, qalanı ikinci klikdə; agent kliklərinin 0/32-si açır.

**Claude paneli, insan, 2-ci dövrə (10:41, sessiya fe533913).** İlk klik 10/0 → `allow human_like` ✓; sonra eyni düyməyə hərəkətsiz təkrar kliklər (n=0–3) "uncertain" oldu və sessiya yenidən `unknown` → mask. Düzəliş (kin-v4): `held_press` (35–400 ms basma + 0.5 pressure = əl cütü, +2), `repeat_click` (eyni yerə/eyni ölçülü düyməyə hərəkətsiz təkrar, +1), ilk-klik açılışı "hamısı güclü" yox, "biri güclü, heç biri sintetik/agent≤1" qaydası ilə. Dataset: 100/100 düz (insan max agent xalı 1, agent max insan xalı 2). Loglama: `npm run report` (scripts/session-report.mjs) — sessiya vaxt xətti; `seal` ayrıca event kimi saxlanır.

## 8. İnteqrasiya paketi — `nanotarget/express` (21 sentyabr 2026)

Biznes üçün seçilən yol: middleware/SDK. `integrations/express/index.ts` — `nanotarget({secret, policy, db, identify})` → `middleware()` (SDK-nı `/nanotarget/sdk.js`-də verir, siqnal/connection/step-up/WebAuthn API-sini yanında açır), `protect(resource)` (qərar `req.nt`-də; block→403, step_up→428), `send(req,res,full,mask)` (şirkətin öz mask funksiyası). Tenant üçün müddətsiz otaq, `identify()` ilə şirkət login sessiyasından deterministik NanoTarget sessiyası (bir loginin bütün tabları bir sessiya — bir tabda agent = bütün login agent). Storage sqlite/libSQL (on-prem). Nümunə: `examples/express-bank` (Express 5, 3 sətir). 6 inteqrasiya testi (96 test cəmi). Canlı yoxlama: Claude paneli nümunə tətbiqdə "Balansı göstər" klikləyəndə → `agent_attached` (alət qlobalları), 403, ekran möhürləndi. Sənəd: `docs/INTEGRATION.md`.

## 9. Təlim mühiti və ilk tam insan dövrəsi (22 sentyabr 2026)

`/training` — 13 tapşırıq (nömrəli düymələr, ardıcıl düymələr, mətn, sürüşmə, seçim, pəncərə, iki dəfə klik, klaviatura, yenilə-və-bas, gözlə-sonra-bas, sürüşdürücü, kiçik hədəf, sürətli təkrar). Hər klik xam trayektoriya + kontekst (hover müddəti, əvvəlki klikdən keçən vaxt, sürüşmə, klaviatura fasilələri, fokus tarixçəsi, agent markerləri, cihaz) ilə `samples`-ə yazılır; sonda real `assess()` bütün ardıcıllığı mühərrikin pəncərəsi ilə (son 6) yenidən işlədir və hər addım üçün aktor/bal/səbəb qaytarır (`training_sessions`). `npm run train-eval [kod] [--recompute]`.

**Arif, Safari, 27 addım (t-q4jdqo3c):** köhnə qaydalarla 0 "agent", 21 "insan", 6 "bilinmir". Səbəblər: (1) 1,6 s düymə üstündə dayanıb basmaq — 1,5 s trayektoriya pəncərəsi hərəkəti itirdi, klik "trayektoriyasız" sayıldı, üstəlik Safari yüngül toxunuşda pressure 0 və 7 ms basma verdi; (2) bir belə klik pəncərədəki 6 addımı veto edirdi (`zeroPressure===0` və `atomic===0` şərtləri). Düzəlişlər (kin-v5 / assess-v4): trayektoriya pəncərəsi 5 s (yaxınlaşma qalır); `aimed_dwell` (+2: hərəkət hədəfdə bitib, ≥300 ms dayanıb, sonra basılıb); tək pressure-0 və ya tək "atomik" klik iki kinematik insan klikini ləğv edə bilməz (iki və daha çox atomik klik yenə agent sübutudur). Yenidən hesablama: **27/27 insan**. Agent dövrəsi (Claude paneli, 27 addım): 27/27 agent. Klik dataseti 127: 0 səhv.

**Canlı saytdakı yalan blokun səbəbi (Arifin skrinşotu, bank-profile-app):** Antigravity-nin yazdığı `identify` sabit dəyər qaytarır → bütün ziyarətçilər bir sessiyadır; bir agent testi sessiyanı həmişəlik "agent" etdi. Bu, paket sənədinin "Do not" siyahısındadır; əlavə olaraq Chrome-da Claude extension qoşulu tabda insan kliki dizayn üzrə "agent qoşulu" sayılır (Touch ID ilə açılır).

## 10. Toxunmaqla klik (tap-to-click) və “üstünlük” prinsipi (22 sentyabr 2026)

Təlim dövrələri (Arif): Safari basmaqla 27/27 insan; Chrome basmaqla 27/27; Chrome **toxunmaqla** iki dövrə (köhnə SDK) 9/27 agent; Claude extension quraşdırılıb amma qoşulmayıb 27/27 insan; Claude yan paneli açıq, insan klikləyir 27/27 insan (panel boş ikən marker yoxdur — düzgün); toxunmaqla yeni SDK (t-j8vwd3fc) 5/27 agent → düzəlişdən sonra 0/27.

Toxunmaqla klikin anatomiyası: basma 0–9 ms (agentlə eyni), pressure 0,5; fərq yalnız əlin *yaxınlaşma yolundadır*. Üç struktur düzəliş:
1. SDK yaxınlaşma yolunu klikdən sonra silmir, vaxtla məhdudlaşdırmır (son 240 nöqtə) və **səhifə yenilənəndən sonra da saxlayır** (eyni tab, sessionStorage, ≤60 s). “Ani klik” yalnız heç bir yaxınlaşması olmayan klikdir (`isAtomic`).
2. **Üstünlük prinsipi (assess-v6):** ani, pressure-0 və sintetik görünən kliklər yalnız pəncərədəki kinematik insan kliklərindən çox olduqda agent sübutudur (`atomic > kinHuman`, `zeroPressure > kinHuman`, `2·kinSynthetic > kinHuman`). Agent heç vaxt insan kliki yaratmır; insan isə bir-iki “yad” toxunuş yaradır. İnsan verdikti: `kinHuman ≥ 2 && kinHuman ≥ 2·kinSynthetic && atomic ≤ kinHuman`.
3. `aimed_dwell` (+2), `tap_release` (0 xal), parser trayektoriya yaşı ≤1 saat, `travelMs` ≤1 saat, fasilə statistikada 1 s-ə kəsilir.

Yenidən hesablama: yeni formatlı 5 dövrə (135 addım) — 0 səhv; agent dövrəsi 27/27 agent. Köhnə SDK ilə yazılmış iki toxunuş dövrəsi yenidən hesablana bilmir (yaxınlaşma datası yoxdur) və statistikaya daxil edilmir. 99 test.

## 11. Öyrənən model, “insanlaşdırılmış bot” sinfi və təlim v2 (22 sentyabr 2026)

**Təlim mühiti v2** — 21 tapşırıq (əvvəlki 13 + sürüklə-burax, 3 sahəli forma Tab ilə, fikrini dəyiş, oxu-və-seç, yaxın hədəflər, 6 s fasilə, mətn seçimi, sərbəst hərəkət); `?mode=short` ilə 13-lük qısa variant. Hər klikin yanında kontekst (hover, əvvəlki klikdən keçən vaxt, sürüşmə, klaviatura fasilələri, fokus tarixçəsi, cihaz).

**İnsanlaşdırılmış bot sinfi.** Puppeteer/Playwright botlarının “insan kimi görünmək” üçün istifadə etdiyi `ghost-cursor` kitabxanasının (Bezier trayektoriya generatoru) 300 trayektoriyası üç variantda (naive / slow / spread) generasiya edilib `samples`-ə `agent / ghost-cursor-synthetic-*` etiketi ilə yazıldı. Dürüst nəticə: **qayda əsaslı hakim onların 258/300-ünü “insan” saydı** — əyri yol, hədəfdən sapma, normal basma müddəti hamısı imitasiya olunur. Fərqi verən yeni xüsusiyyətlər: `residualRms` (nöqtənin dörd qonşusunun ortasından kənarlaşması — insanda ≥0,56 px (p1), 1,1 px (p10); Bezier-də ~0,5 px median), `smoothVelCv`, `endSlow`, `dtCv`. Yeni qayda `generated_curve` (residual <0,45 və titrəyiş <1,2): insanlarda 0/248, ghost-cursor-da 87/292.

**Öyrənən model (kin-v8 + lr-2026-09-22).** L2 logistik reqressiya, 27 standartlaşdırılmış xüsusiyyət (ağır quyruqlular log1p ilə), 646 klik / 27 müştəri (12-si ghost-cursor psevdo-müştərisi). **Müştəri üzrə qruplaşdırılmış 5-qat CV: AUC 0,978.** Hədlər CV ehtimallarından seçilir ki insan yalan-müsbəti 0 olsun: `humanAbove` 0,93, `syntheticBelow` 0,087 → CV-də insan səhvi 0/287, agent səhvi 0/359; əhatə: insan kliklərinin 49%-i, agent kliklərinin 48%-i modeldən əlavə sübut alır. Model hakimə yalnız əmin olduğu yerdə +2 xal verir (`model_human` / `model_synthetic`); qaydalar qoruyucu qalır. Ən güclü çəkilər: `endSlow` −0,97 (hədəfə yavaşlamayan → bot), `jumpPx` +0,96, `dtCv` +0,81, `straightness` −0,62, `smoothVelCv` +0,55, `pressure` +0,55.

**Görünməyən düşmən testi (leave-one-flavour-out):** model bir ghost-cursor variantını heç görməyib qalanlarla öyrədilir. `naive` → 0/100 insan keçdi; `spread` → 1/100; **`slow` → 63/100 insan keçdi.** Yəni yavaş-hamar Bezier hərəkəti, əgər öyrənmə datasında yoxdursa, kinematika ilə tutulmur. Bu, kinematikanın həddidir və məhz buna görə qərar çoxqatlıdır (qoşulma markerləri, oxuma tələləri, alət qlobalları, imza). Vaxt ölçmələri (`dtCv`) mənim öz replay fərziyyəmdir (5% titrəmə) — real bot fərqli göndərə bilər; ona görə `dtCv`-yə tək güvənilmir.

**Vəziyyət:** real brauzer klikləri (18 dövrə, 12 fərqli müştəri id-si) — mühərrik səviyyəsində 0 səhv; klik səviyyəsində yalnız “yaxınlaşmasız toxunuş” sinfi (14 klik, köhnə SDK) qeyri-müəyyən/sintetik qalır və üstünlük prinsipi ilə örtülür. 101 test. `/api/v1/version` model versiyasını göstərir; paketə `dist/kinematics-model.json` daxil edilir.

**Növbəti ən dəyərli data:** başqa insanlar (Windows siçanı, telefon toxunuşu, yaşlı istifadəçi), real agentlərin təlim keçməsi (Claude ext, Codex, Comet, Atlas), və ghost-cursor-un real Puppeteer dispatch-i ilə ölçülməsi.

## 12. Kiborg sessiyalar, Codex sürüşməsi və 21 tapşırıqlı dövrələr (22 sentyabr 2026, günorta)

**Dövrələr:** Arif 21 tapşırıq siçanla (38 addım) — 38/38 insan. Claude in Chrome 21 tapşırıq (37 addım) — 37/37 agent (marker 0,1 s-də, gizli sənəd klikləri). Codex 21 tapşırıq (38 addım) — 38/38 agent, **amma marker/qlobal/UA tokeni yox idi**: Codex-in daxili brauzeri indi adi Chrome UA ilə gəlir; tutan yalnız pressure 0 + kinematika oldu. Bu, satıcı izlərinin versiya ilə itməsinə real nümunədir; davranış qatı olmasaydı Codex görünməzdi.

**Kiborg sessiya.** Claude klikləyərkən Arif siçanı səhifə üzərində gəzdirirdi; Codex-də 13-cü tapşırığı (sürüklə-burax) Arif əl ilə etdi. SDK son yaxınlaşma yolunu saxladığı üçün agentin sonrakı klikləri **insanın trayektoriyasını miras aldı**: klik səviyyəsində "insan yolu + 1 ms basma + tam mərkəz". Mühərrik hər halda agent dedi (marker, gizli sənəd, pressure 0), amma klik hakimi düzəldildi (kin-v9): `stale_approach` (60 s-dən köhnə yol bu basma haqqında heç nə demir), `centre_tap` (tam mərkəz + ≤5 ms basma: insanlarda 351 klikdən 4-ü, agentlərdə 134-dən 122-si; əl sübutu olan halda yumşaq +1), `tap_release` yalnız aparat pressure 0,5 ilə. Kiborg klikləri (46) modelin təlimindən çıxarılır — trayektoriya modeli üçün etiket səs-küyüdür; onları sessiya qatları həll edir.

**Telefon:** sürüklə-burax tapşırığı toxunuşla işləmirdi (`touch-action`), düzəldildi.

Real brauzer dövrələri: 9 dövrə, 0 mühərrik səhvi. Klik səviyyəsində qalan 14 "yaxınlaşmasız toxunuş" (köhnə SDK) üstünlük prinsipi ilə örtülür.

## 13. Telefon, Codex-in iki rejimi (22 sentyabr 2026, 11:30–11:45)

- **Android Chrome, toxunuş (Arif, 37 addım):** 0 agent, 0 insan — hamısı "bilinmir". Toxunuşda yaxınlaşma yolu yoxdur, Android pressure 1 verir, kinematika tətbiq olunmur; basma 72–77 ms. Agent-toxunuş baseline-ı olmadığından toxunuşa insan sübutu vermirik — qayda `onUnknown` ilə qərar verir (bank: allow). Bu, açıq məhdudiyyətdir; mobil üçün ayrıca qat lazımdır (toxunuş radiusu, jiroskop, sürüşmə ritmi).
- **Codex daxili brauzeri (t-42cl7gmf, 37 addım):** 37/37 agent. Bu dəfə səhifədə `__codexPlaywrightInjected`, `__codexWebMcpModelContext`, `__browserUseClipboardBridge` qlobalları var idi (control tier); UA yenə adi Chrome. `__codexPlaywrightInjected` control siyahısına əlavə edildi.
- **Codex Chrome extension (t-p13kyny2, 36 addım):** 36/36 agent; `codex-overlay` markeri 0,7 s-də — qoşulma anı yenə tutulur.

Cəmi real brauzer dövrələri: 12 (9 insan, 3 agent + 2 əvvəlki agent) — mühərrik səviyyəsində 0 səhv.
- **Windows 10, Chrome 152, siçan (t-jhtds0zt, 37 addım):** 37/37 insan, 0 səhv. Fərqli profil: pointermove Mac-dan 3–4 dəfə seyrək (dtMean 24–49 ms), titrəyiş və qonşu-sapma daha böyük (residual 3,4–10 px), hədəfə yavaşlama zəif görünür (endSlow median 0,75). Bu, "ghost-cursor" hamarlığından (residual ~0,5) daha da uzaqdır — Windows insanları model üçün daha asan sinifdir; sərhəd riski Mac trackpad tərəfindədir.

## 14. Əyriliksiz "kələ-kötürlük" — insanlaşdırılmış bota qarşı həlledici ölçü (22 sentyabr 2026)

§11-də dürüst yazdığımız boşluq bağlandı. Əvvəlki hamarlıq ölçüləri (`tremor`, `residualRms`) əyriliyi də ölçürdü, ona görə Bezier yolunu Windows insanından ayıra bilmirdi. Yeni `roughness`: hər nöqtənin öz 5-nöqtəlik pəncərəsinə uyğunlaşdırılmış paraboladan sapması — əyrilik çıxarılır, yalnız əlin "titrəməsi" qalır. Ölçülən: ghost-cursor (300 yol, hər sıxlıqda) maks **0,30 px**; insan Mac p1 0,21 / p5 0,26 / median 0,87; insan Windows p1 0,76; real agentlər (yolu yox) tətbiq olunmur.

Həlledici qayda (kin-v11): **uzun hərəkət (xord ≥170 px) + roughness <0,32 + ≥12 nöqtə → sintetik**, insan xalları nə olur olsun. 426 insan klikindən 0-ı, 300 ghost-cursor yolundan 265-i (88%) — qalan 35-i qısa hərəkətlərdir (<170 px), onlar digər qaydalara qalır. Yenidən hesablama: real brauzer dövrələri (13) 0 səhv; test "kobud Bezier keçir" artıq keçmir — adi test oldu (102 test).

Bu nə deməkdir: bu gün mövcud "insan kimi görün" kitabxanaları uzun hərəkətlərdə tutulur. Növbəti düşmən nəsli yola süni kələ-kötürlük əlavə edəcək — o zaman kələ-kötürlüyün *statistikası* (tezlik spektri, sürətlə əlaqəsi) növbəti ölçü olacaq. Silahlanma yarışıdır; buna görə imza, marker və oxuma qatları qalır.

## 15. Qərar ağacları ansamblı (22 sentyabr 2026, axşam)

Xətti model (logistik reqressiya) qruplaşdırılmış CV-də 0,94 AUC verirdi; eyni xüsusiyyətlər üzərində **gradient-boosted qərar ağacları** (160 ağac, dərinlik 3, Newton addımı, sinif çəkiləri, öz implementasiyamız — asılılıq yoxdur) **0,9987 AUC** verdi. Hədlər yenə sıfır yalan-müsbət prinsipi ilə out-of-fold ehtimallardan seçilir: `humanAbove` 0,981, `syntheticBelow` 0,013 → CV-də insan səhvi 0/361, agent səhvi 0/459; əhatə **insan 86%, agent 93%** (əvvəl 37% / 16%). Görünməyən düşmən: `naive` 91/100 tutuldu, `slow` 45/100, `spread` 6/100 insan keçdi (qalanı qeyri-müəyyən; uzun yollar həlledici `generated_curve` qaydası ilə hər halda sintetikdir). Kiborg klikləri: 0-ı insan keçdi.

Məhsul KPI-ı (qaydalar + model): **insan kliklərinin 78,7%-i ilk klikdə açır**, **agent kliklərinin 80,0%-i ilk klikdə tutulur**; klik səviyyəsində "insan → sintetik" yalnız 14 yaxınlaşmasız köhnə toxunuşdur (sessiya qatı örtür), "agent → insan" 5 qısa ghost-cursor yoludur. Model faylı `server/kinematics-model.json` (ağaclar JSON), paket `dist/`-ə kopyalanır; hakim modeli olmadan da işləyir.

## 16. Növbəti nəsil düşmən: səs-küylü Bezier — və fiziki ayırıcılar (22 sentyabr 2026, gecə)

**Boşluq.** §14-dən sonra yoxladıq: ghost-cursor yoluna hər nöqtədə Gauss səs-küyü (σ ≥ 0,5 px) əlavə edən bot qaydaları **və** modeli 150/150 "insan" kimi keçirdi. Kələ-kötürlük ölçüsü aldadıla bilir — əl titrəməsinin *strukturu* yox.

**Fiziki ayırıcılar** (insan vs ağ səs-küy, ölçülüb): (A) `noiseSpeedCorr` — titrəmənin amplitudu sürətlə artır (insan median 0,47–0,71; əlavə səs-küy ≈0 ±0,05); (D) `residKurtosis` — insan titrəməsi partlayışlıdır (median 12–13), Gauss ≈3 (p95 3,75); (B1) `d2Ac1` — ağ səs-küyün ikinci fərqləri nəzəri −2/3 avtokorelyasiya verir (−0,65…−0,68), insan Mac −0,45, Windows −0,28, Safari +0,40; (E) `roughEndRatio` — botun səs-küyü yol boyu sabitdir (1,0 ±0,1), insanda 0,02–4. Qayda `white_noise_path` (n≥16, xord≥120, AC1<−0,6, kurtosis<4,2, |korr|<0,12) → sintetik, həlledici: **426 insan klikindən 0-ı**.

**Yeni düşmən sinfi datasetdə:** 600 ghost-cursor yolu, 6 variant (naive, slow, spread, noisy σ=0,5/1,5/3), 24 psevdo-müştəri. Yalnız qaydalar: noisy 92–95% sintetik. Model (GBDT, 31 xüsusiyyət, 1120 klik): qruplaşdırılmış CV AUC **0,998**, hədlər 0,989 / 0,017 → CV-də insan səhvi 0/361, agent səhvi 0/759, əhatə insan 85%, agent 92%. **Görünməyən düşmən:** noisy1/2/3 variantı təlimdə heç olmayanda belə 100/100 sintetik; naive 91, slow 90, spread 2/100 insan keçir. Modelin əmin "sintetik" qərarı indi qayda qədər ağırdır (+4): zəngin insan görkəmli yol onu üstələyə bilmir.

Dürüst hədd: bu, silahlanma yarışının bir dövrəsidir. Növbəti düşmən əlin fizikasını (sürətə bağlı, partlayışlı, 8–12 Hz titrəmə, sonda düzəliş alt-hərəkətləri) generativ modellə imitasiya etməli olacaq — bu, mümkündür (ədəbiyyatda GAN-la sintez var), amma bahadır; və o zaman da qoşulma izləri, oxuma tələləri, imza və "kiborg" ziddiyyətləri qalır.

## 17. Son təmizləmə (22 sentyabr 2026, gecə) və vəziyyət

kin-v13: klaviatura ilə aktivləşdirilən klik (pointerdown yoxdur) neytraldır — sürücü kliki həmişə pointerdown verir; `jump_segment` qaydası çıxarıldı (siçan pəncərədən çıxıb qayıdanda 400–760 px seqment yaranır, insan hərəkətidir); SDK basma anındakı mövqeyi yaxınlaşmanın son nöqtəsi kimi yazır (sürətli hərəkətdə son pointermove bir kadr geri qalırdı → yalançı "teleport").

**Vəziyyət (22.09 gecə):** 1120 klik / 35 mənbə; GBDT model CV AUC 0,998, hər iki tərəfdə 0 yalan; klik səviyyəsində insan kliklərinin **81%-i ilk klikdə açır**, agent kliklərinin **85%-i ilk klikdə tutulur**, agent klikinin "insan" sayılması **0**; sessiya səviyyəsində 13 real dövrə (Mac siçan/trackpad/toxunuş, Safari, Windows, Android; Claude ext/panel, Codex ext/daxili) — **0 səhv**. Klik səviyyəsində qalan insan "sintetik"ləri: köhnə SDK ilə yazılan 14 yaxınlaşmasız toxunuş (yeni SDK bu sinfi yazmır).

Nəyə hələ data lazımdır: toxunuş (mobil) insan sübutu; başqa insanların əli; agentlərin real bank səhifəsində (təlim yox) axını; Comet/Atlas.

## 18. Canlı bank səhifəsində kiborg dövrələri (22 sentyabr 2026, 12:27–12:29)

Arif Claude in Chrome və Codex extension-a bank səhifəsində tapşırıq verdi və bu vaxt siçanı səhifə üzərində bilərəkdən gəzdirdi.
- **Claude ext (sessiya fe3e7742):** qoşulma 26 s-də markerlə tutuldu, ekran möhürləndi; balans → BLOCK, CSV → BLOCK, profil → MASK. Agentin özü belə yazdı: “səhifə avtomatlaşdırma agentini aşkarlayır… passkey addımını sənin yerinə etmərəm”. Klik səviyyəsində agentin klikləri insanın əl yolunu miras alıb “insan 7/2” görünürdü (pressure 0,5, tam mərkəz, 1–3 ms basma) — sessiya qatı (yapışqan marker) qərarı verdi. Bu, kiborg sinfinin dizayn üzrə cavabıdır: **agent qoşulubsa, əl olsa da agentdir.**
- **Codex ext (26238ff6):** qoşulma 20 s-də; klikləri pressure 0 + teleport + tam mərkəz → klik səviyyəsində də sintetik; bütün qərarlar agent.
- **Xarici siçan, Windows (t-bhgh0lcs, 37 addım):** 37/37 insan.

Cəmi 14 real dövrə + 2 canlı kiborg sessiyası: sessiya səviyyəsində 0 səhv.

## 19. Data olmadan təkmilləşdirmə (22 sentyabr 2026, axşam-gecə)

Arif əlavə insan dövrəsi edə bilməyəndə mövcud 1156 klik üzərində:
- **Hiperparametr axtarışı** (27 kombinasiya, qruplaşdırılmış CV): dayaz ağaclar ən yaxşı ümumiləşir — 300 ağac, dərinlik 2, min yarpaq 8: AUC 0,9990, sıfır-yalan əhatə insan 90% / agent 95%.
- **Vaxt xüsusiyyətləri çıxarıldı.** Xüsusiyyət əhəmiyyəti göstərdi ki model 32%-lə `dtCv`-yə (nümunələmə fasiləsinin dəyişkənliyi) söykənir — bot öz göndərmə ritmini istədiyi kimi seçə bilər, bu kövrəkdir. `dtMean/dtCv/dtZeroFrac` sıfırlanmış model: AUC **0,9993**, əhatə 91% / 94%, görünməyən düşmənlərin heç biri insan keçmir. Yeni model vaxtsızdır (`zeroFeatures`), ən vacib xüsusiyyət `residKurtosis` (43%) — əl titrəməsinin partlayışlılığı.
- **Model qərarı həlledici oldu:** CV-də sıfır insan yalan-müsbəti ilə seçilən həddin altında (`p ≤ 0,015`) klik sintetikdir, insan xalları nə olur olsun. Laplace və uniform səs-küylü Bezier-lər (qaydalar tutmurdu, çünki kurtosis Gauss deyil) model tərəfindən 150/150 tutuldu.
- **Köhnə "organic" deşiyi bağlandı:** trayektoriya varsa, sessiya səviyyəsində insan sayımı yalnız kinematik hakimdən gəlir; köhnə "≥5 hərəkət, 35–1600 ms basma" sayğacı yalnız trayektoriyasız SDK-larda qalır (əks halda inandırıcı basmalı bot 3 klikdən sonra insan sayılırdı — testlə kilidləndi).
- `white_noise_path` avtokorelyasiya həddi −0,5 (insanda 0/426), 104 test.

## 20. Təkrar (replay) hücumu — kinematikanın prinsipial həddi (22 sentyabr 2026)

Bot real insan trayektoriyasını yazıb təkrar göndərsə nə olur? 200 yazılmış insan yolu ilə sınaq:
- **Təkrar + agent basması** (2 ms, pressure 0): insan keçən yox — basma özü ifşa edir. kin-v15: aparat pressure-u olmayan ≤5 ms basma yolu nə olur olsun ağır agent sübutudur (insan datasetində belə klik 0/426).
- **Təkrar + insanlaşdırılmış basma** (90 ms, pressure 0,5): **200/200 insan.** Bu, klik səviyyəsində *prinsipial* hədddir — yol həqiqətən insan əlinindir, basma isə imitasiya olunub. Heç bir trayektoriya modeli bunu ayıra bilməz; ayıran qatlar: (1) hədəfin yeri — yazılmış yol başqa düyməyə aparır, botun onu yeni hədəfə köçürməsi/əyməsi lazımdır (aşağıda); (2) sessiya qatı — qoşulma izləri, oxuma tələləri, gizli sənəd, imza; (3) "canlılıq": gözlənilməz hədəf mövqeyi (sandbox-da olduğu kimi) və klik-arası kontekst.
- **Yeni hədəfə köçürülmüş təkrar** (200/200 insan) və **vaxt-əyilmiş (×0,6) təkrar** (200/200 insan): forma xüsusiyyətləri köçürməyə və vahid vaxt miqyasına dəyişməzdir — bu, dizayn üzrə belədir (insanlar da fərqli sürətlə hərəkət edir), ona görə təkrar hücumu forma ilə tutulmur.

| Ssenari (200 yazılmış insan yolu) | insan | sintetik | qeyri-müəyyən | ilk klikdə açılma |
| --- | ---: | ---: | ---: | ---: |
| təkrar + agent basması (2 ms, pressure 0) | 0 | 0 | 200 | 0 |
| təkrar + insanlaşdırılmış basma (90 ms, 0,5) | 200 | 0 | 0 | 197 |
| yeni hədəfə köçürülmüş + insanlaşdırılmış | 200 | 0 | 0 | 197 |
| vaxt-əyilmiş ×0,6 + insanlaşdırılmış | 200 | 0 | 0 | 197 |

Nəticə YC sənədi üçün: "kinematika ilk klikdə insanı azad edir və bugünkü botları tutur; təkrar hücumuna qarşı qorunma sessiya qatındadır — buna görə iki qat birlikdə satılır."

**Sınanan və rədd edilən: trayektoriya formasının təkrarı.** Yolun normalizə olunmuş 16-nöqtəli imzası (köçürmə, miqyas, dönmə çıxarılır) ilə pəncərə içində "eyni forma, fərqli yer" axtarıldı. Təkrar surətlər ±0,25 px titrəmə ilə 0,006 məsafədədir, amma insanların *fərqli* hərəkətlərinin 2,8%-i də 0,03-dən yaxındır (qısa, düzə yaxın hərəkətlər normalizasiyadan sonra oxşardır). Pəncərə səviyyəsində güclü sübut kimi yaramır; kirayəçi üzrə qlobal imza indeksi (yüz minlərlə sessiyada eyni yolun təkrar istifadəsi) ayrıca məhsul xüsusiyyəti kimi qalır.

## 21. Gecə yekunu (22→23 sentyabr 2026)

kin-v16 / assess-v7, model `gbdt` vaxtsız. Klik səviyyəsi: insan kliklərinin **87,9%-i ilk klikdə açır**, agent kliklərinin **99,2%-i ilk klikdə tutulur**; insan→sintetik 2/397 (köhnə toxunuşlar), agent→insan 1/824. Sessiya səviyyəsi: 15 real dövrə, **0 səhv**. Avtomatik hesabat: `npm run eval` → `docs/EVAL.md`. Bilinən prinsipial hədd: yazılmış insan yolunun insanlaşdırılmış basma ilə təkrarı klik səviyyəsində ayrılmır — sessiya qatı və kirayəçi üzrə imza indeksi bunun cavabıdır.

## 22. Skriptli CDP botu — saxta `force`, hamar yol, oxumadan (23 sentyabr 2026)

İstifadəçinin sualı: "insanların bildiyi başqa aldatma yolları ola bilər — onları öngör, araşdır, sistemi inkişaf etdir." Bunun üçün **yerli red-team stendi** yazıldı (`scripts/redteam.mjs`, deploya getmir): real Chrome-u `puppeteer-core` ilə sürür, dörd strategiyanı canlı bank səhifəsinə tətbiq edir, hər birinin aşkarlanıb-aşkarlanmadığını və həssas resursun sızıb-sızmadığını sayır. `--capture` ilə adversarial trayektoriyaları `sandbox` datasetinə (`label=agent, source=cdp-*`) yazır ki korpus böyüsün.

**Nə tutulur (dəyişməz):**
- `naive` (adi `page.click`, webdriver açıq): 12/12 agent.
- `teleport` (webdriver yamaqlı, amma yol yox, pressure 0): 12/12 agent — kinematika + ani basma tutur.
- `reader` (gizli + saxta force + əyri yol, **amma əvvəlcə `page.evaluate` ilə səhifəni oxuyur** — ümumi LLM agenti kimi): 12/12 agent — `MAIN_WORLD_READ_BURST` / `TEXT_EXTRACT` tələləri işləyir. **Bu vacibdir: səhifəni oxuyan hər ümumi agent tutulur.**

**Nə keçir (yeni tapılan boşluq):**
- `evasive` — gizli (`--disable-blink-features=AutomationControlled` + `navigator.webdriver` yamağı) + CDP `Input.dispatchMouseEvent` ilə **`force: 0.5`** (pressure saxtalaşdırılır) + əyri, yavaşlayan, titrəyən Bezier yol + elementi **CDP box-model** ilə tapır (səhifə JS-inə toxunmur, ona görə oxuma tələsi yaranmır) + səhifəni ümumiyyətlə oxumur (koordinatı əvvəlcədən bilir). Nəticə: **headful Chrome-da 16/16 balans sızdı, 0/16 agent aşkarlandı** — hamısı `human_like` (və ya `unknown`, çünki bank `balance.read`-də `onUnknown: allow`).

**Niyə kinematik qatda təhlükəsiz bağlanmır (ölçülüb):**
- Bu yol insan manifoldunun içindədir. `generated_curve` həddini (roughness < 0.32) genişlətmək və ya `residualRms` həddi qoymaq — **398 real insan siçan klikinə qarşı 5–9 yalan-müsbət** verir (chrome-mouse istifadəçilərinin sürətli, hamar flick-ləri). Yəni sıxmaq real insanları bloklayar.
- `pressure=0.5`-i insan sübutu saymağı ləğv etmək 366 insan klikinin **83-nü** (23%) "human" verdiktindən salır — CDP `force`-u saxtalaşdırdığı üçün siqnal artıq təkbaşına etibarlı deyil, amma tam çıxarmaq da real insanlara baha başa gəlir.
- `coalesced/moves` nisbəti də ayırmır: insanlar 0–6.7 arası, real CDP agentləri (`agent-chrome`) ~0 — üst-üstə düşür.

**Landed təhlükəsiz düzəliş (assess-v7):** tək klikin bütün sessiyanı açması (`strongHumanFirst`) artıq **öyrənən modelin razılığını** (`model_human`) tələb edir — sırf qayda xalları (curved_path + tremor + decelerates + held_press) hamar sintezatorun toplaya biləcəyi şeydir. Ölçü (23.09, 366 insan kliki): **0 itirilmiş insan tək-klik açılışı**; offline sintezator tək-klik açılışını azaldır. **Amma headful-da model də aldanır**, ona görə bu, boşluğu tam bağlamır — dürüst qeyd.

**Prinsipial nəticə:** heç bir tək klient-tərəf xüsusiyyəti diqqətli, oxumayan, saxta-force CDP botunu real insandan yalan-müsbətsiz ayırmır. Bu, §11/§16/§20-nin dürüst xəttinin davamıdır. Qalıq təhlükə **ümumi AI agenti deyil** (o oxuyur → tutulur), **məlum saytın düzəninə yazılmış skriptdir** (credential-stuffing səviyyəsi). Cavab qatları:
1. **Sessiya təsdiqi (Arifin UX qərarı):** `block`-səviyyəli resurs tək klikin insan verdikti ilə açılmamalı — ikinci insan əməliyyatı, davamlı pəncərə, ya da WebAuthn tələb etməli. Xərc: real insan ilk həssas klikində bir dəfə təsdiq edər (§21-in "87,9% ilk klikdə" prinsipinə qarşı gedir) — ona görə bu, məhsul qərarıdır, mən tək tərəfli dəyişmədim.
2. **Kirayəçi üzrə imza/davranış indeksi:** eyni yolu/ritmi yüz minlərlə sessiyada təkrar edən bot fermi hər sessiya keçsə də aqreqatda görünür (§20-nin sonu).
3. **Ambient davranış siqnalı (data lazımdır):** skriptli bot yalnız hədəfə bir yaxınlaşma çəkir — oxuma dayanması, sürüşmə, boş jitter yoxdur; insan "yeni girib" saniyələrlə ətraf hərəkət yaradır. Bunu təhlükəsiz qapı etmək üçün daha çox real insan datası lazımdır — məhz stend `--capture` ilə korpusu böyüdür.

**Vəziyyət:** `scripts/redteam.mjs` təkrar ölçmə üçün qalır; korpusa `cdp-evasive` sinfi əlavə olundu (gələcək model təlimi üçün). 120 test keçir.
