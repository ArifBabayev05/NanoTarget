# Rəqabət mənzərəsi (21 sentyabr 2026, veb-araşdırma)

Qısa nəticə: **bizimlə eyni işi edən — daxil olmuş müştəri sessiyasında agent qoşulan anı tutub, endpoint səviyyəsində allow/mask/step-up/block qərarı verən, insanın Touch ID ilə geri ala bildiyi, on-prem qurulan, AI agentin 15 dəqiqədə inteqrasiya etdiyi** — bir məhsul tapılmadı. Amma bazar boş deyil: üç güclü qonşu kateqoriya var və ikisi sürətlə bizə yaxınlaşır.

## 1. Bot idarəetmə / cyberfraud platformaları (ən yaxın rəqib)
| Şirkət | Nə edir | Bizə nisbətən |
|---|---|---|
| **HUMAN Security — AgenticTrust** | Atlas, Comet, Claude ext, ChatGPT Agent trafikini sessiya səviyyəsində tanıyır; "oxu / qeydiyyat / login / hesab dəyişikliyi / checkout" üçün icazə qaydaları. Aylıq "State of Agentic Traffic" hesabatı: may 2026-da agent trafikinin 47% Comet, 20% Atlas, ~19% Claude ext; maliyyə sektorunda agent trafiki bir ayda +124%. | Ən yaxın rəqib. Böyük enterprise, şəbəkə/edge inteqrasiyası, onların bulud infrastrukturu. Bizim fərq: endpoint-daxili qərar + ekran möhürü + insan geri alması + on-prem + AI-agent quraşdırması. Onların üstünlüyü: miqyas, brend, data. |
| **Fingerprint — Authorized AI Agent Detection** (fev 2026) | OpenAI, AWS AgentCore, Browserbase, Manus, Anchor agentlərini cihaz/brauzer/şəbəkə siqnalları ilə tanıyır; "icazəli avtomatlaşdırma" konsepti. | Tanıma qatı var, siyasət/qərar qatı zəif; imzalı/uzaq agentlərə fokus, lokal Claude ext/panel kimi "cyborg" sessiyalara az. |
| **Cloudflare — Web Bot Auth / Verified AI Agent** | IETF/W3C standartı (may 2026 final): agent HTTP sorğusunu imzalayır, edge doğrulayır. AWS WAF, Akamai, Vercel, Shopify dəstəkləyir; Visa TAP / Mastercard Agent Pay əsası. | Yalnız *imzalayan* agentlər üçün (ChatGPT Agent, Bedrock). Claude in Chrome, Codex, Atlas-ın lokal rejimləri imzalamır — bizim yerimiz məhz bu boşluqdur. Biz Web Bot Auth-u doğrulayırıq (verified tier), yəni tamamlayıcıyıq. |
| **cside** | Bir JS snippet; 250+ siqnal, 0–100 risk balı, "allow 0–30 / step-up 31–70 / block 71–100" tövsiyəsi; Atlas/Comet tanıyır. Fintech, iGaming, marketplace. | Skorlama + tövsiyə, tətbiqi müştəriyə buraxır; sessiya-daxili "qoşulma anı", ekran möhürü, insan geri alması yoxdur. Qeyd: Arifin Antigravity ilə qurduğu test tətbiqində `@cside.dev/next` də var idi — yəni AI agentlər onu default kimi seçir. |
| **CHEQ — "Cyborg Session"** (fev 2026) | Claude Chrome ext-in quraşdırılma / aktiv idarə / DOM izlərini tədqiqat kimi nəşr etdi; marketinq atribusiyası üçün "Agent Intent". | Eyni siqnal ailəsini müstəqil təsdiqlədi (bizim üçün validasiya). Məhsul reklam/lead keyfiyyəti üçündür, bank qərarı üçün deyil. |
| DataDome, Akamai, Kasada, Arkose | Klassik bot idarəetmə; "agentic" mesajı əlavə edirlər. | Girişdə bloklama məntiqi; daxil olmuş sessiya içindəki insan↔agent keçidi onların modeli deyil. |

## 2. Enterprise brauzer təhlükəsizliyi (işçi tərəfi, bizim müştəri tərəfimiz deyil)
LayerX ("agentic identity detection"), Push Security, SquareX (Zscaler aldı), Keep Aware, Seraphic, Palo Alto. Hamısı **şirkətin öz işçilərinin** brauzerinə genişləndirmə qoyur və AI istifadə siyasətini tətbiq edir. Bizim müştəri isə *xarici müştərisini* qorumaq istəyən bank/CRM-dir — onların brauzerinə heç nə qoya bilmir; ona görə server + səhifə SDK-sı lazımdır. Kateqoriya fərqli, amma investor sualında qarışdırılacaq — cavab hazır olmalıdır.

## 3. Davranış biometrikası (BioCatch, Darwinium, Sardine, Feedzai)
Siçan/klaviatura ritmi ilə fırıldaqçı tanıma — bizim kinematika ilə eyni ailə, amma hədəf "başqa insan / uzaqdan idarə", "AI agent" deyil. Onlar "agent" siqnalını mövcud risk skoruna xüsusiyyət kimi əlavə edəcək. Bizim üçün həm rəqib, həm inteqrasiya kanalı (fraud sisteminə webhook).

## Bizim mövqe (bir cümlə)
Bot idarəetmə botu *qapıda* saxlayır; enterprise brauzer *işçini* idarə edir; biz *daxil olmuş müştərinin* sessiyasında agenti qoşulan an tutub *hər endpoint üçün* nə göstəriləcəyini idarə edirik — və bunu bank öz serverində, AI agentin özünün qurduğu 3 sətirlik middleware ilə edir.

## Risklər
- HUMAN/Fingerprint eyni istiqamətə pul xərcləyir; 12 ayda "sessiya-daxili agent" onların bir xüsusiyyəti ola bilər. Cavab: sürət, on-prem, developer-first, ölçülmüş kinematika dataseti.
- Web Bot Auth geniş yayılsa, imzalı agentlər "yaxşı agent" olur — bizim mask/step-up qatı yenə lazımdır (kim olduğunu bilmək ≠ nəyi görə bilər).
- Brauzer istehsalçıları agent üçün rəsmi API/başlıq verə bilər (Chrome "agent mode" bayrağı) — bu, aşkarlamanı asanlaşdırar, siyasət qatının dəyərini artırar.

Mənbələr: HUMAN State of Agentic Traffic (aprel/may 2026), TechRadar xülasəsi, Fingerprint elanı (fintech.global, 04.02.2026), Cloudflare "signed agents" bloqu və Verified bots sənədi, CHEQ "Cyborg Session" (18.02.2026), cside AI agent detection guide, LayerX "11 best agentic browser security platforms 2026", Lyrie "Browser Authentication Myth" (27.04.2026).
