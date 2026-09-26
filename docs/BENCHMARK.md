# OneHuman benchmark — insan ssenariləri üzrə təlimat

**Otaq:** `8de313b7-ef12-4623-b310-e5fe0d7b1910`
**Server:** `http://127.0.0.1:8787` (yalnız bu Mac-də)
**Hesabat:** `node scripts/benchmark-report.mjs 8de313b7-ef12-4623-b310-e5fe0d7b1910`

Hər ssenari ayrıca linkdir. Linkdəki `scenario=` hissəsi yalnız etiketdir, sistem ona görə qərar vermir. Hər link **yeni tab**da açılmalıdır, çünki hər səhifə yükləməsi yeni sessiyadır.

## Ümumi qaydalar

1. Başlamazdan əvvəl bütün agent tablarını bağla (Claude in Chrome, Codex sidepanel, Codex tətbiqi). Agent tabı açıq qalsa, öz siqnallarını göndərməyə davam edir; artıq sessiyalar qarışmır, amma cədvəldə lazımsız sətir yaranır.
2. Hər ssenaridə əvvəlcə "Qoşulma anı" panelinə bax və nə yazdığını qeyd et: **İz yoxdur**, **Agent mühiti** və ya **Agent qoşulub**. İnsan ssenarilərində "Agent qoşulub" görünərsə, bu yanlış pozitivdir, dərhal mənə yaz.
3. Standart 5 əməliyyat (aşağıda "S5" adlandırılır): **Profilə bax → Balansı göstər → axtarış sahəsinə `ödəniş` yazıb Axtar → CSV hesabatı endir → Balansı göstər**.
4. Hər ssenaridən sonra mənə yaz: ssenari adı, sessiya kodu (yuxarı sağda, 8 simvol), qoşulma paneli nə göstərdi, hansı qərarlar çıxdı (icazə / maskalandı / təsdiq / bloklandı), qeyri-adi bir şey oldumu.
5. Hər ssenarini mümkünsə **2 dəfə** et. Rəqəmlər üçün təkrar lazımdır.

Gözlənilən nəticə insan ssenarilərinin hamısında eynidir: qoşulma paneli "İz yoxdur" (ekstenşn quraşdırılıbsa "Agent mühiti"), bütün qərarlar `İcazə`, ixracda "Agent mühiti" varsa 6 simvollu təsdiq kodu istənilə bilər, kodu yaz və davam et. **Heç nə bloklanmamalıdır.**

---

## A. Adi Chrome, ekstenşnlar söndürülmüş

Chrome-da `chrome://extensions` aç, Claude və ChatGPT/Codex ekstenşnlarını **söndür** (silmə). Sonra:

| # | Ssenari | Link | Addımlar |
|---|---|---|---|
| A1 | `chrome-mouse-normal` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-mouse-normal` | Adi siçanla, adi templə S5. |
| A2 | `chrome-trackpad-normal` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-trackpad-normal` | Yalnız trackpad ilə S5. Siçan qoşulubsa, əlini ona vurma. |
| A3 | `chrome-fast-expert` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-fast-expert` | S5-i bacardığın qədər sürətli et, düşünmədən, ardıcıl kliklə. Bu, "insan çox sürətli olanda agent kimi görünürmü" sualıdır. |
| A4 | `chrome-slow-reader` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-slow-reader` | Səhifəni açıb 60 saniyə oxu, yavaş scroll et, sonra S5. |
| A5 | `chrome-keyboard-only` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-keyboard-only` | Siçana toxunma. `Tab` ilə düymələrə get, `Enter` ilə bas, axtarış sahəsinə `Tab` ilə çat, `ödəniş` yaz, `Enter`. S5-i belə tamamla. |
| A6 | `chrome-copy-paste` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-copy-paste` | Əvvəl başqa yerdən `ödəniş` sözünü kopyala. S5-də axtarış sahəsinə yazmaq əvəzinə **yapışdır** (Cmd+V). |
| A7 | `chrome-background-tab` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-background-tab` | Linki aç, dərhal başqa taba keç, 30 saniyə orada qal, geri qayıt, S5. |
| A8 | `chrome-two-tabs` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-two-tabs` | Eyni linki iki tabda aç (hər biri ayrıca sessiya olacaq). Növbə ilə: tab 1-də profil, tab 2-də profil, tab 1-də balans, tab 2-də balans, və s. Hər iki sessiya kodunu yaz. |
| A9 | `chrome-zoom-150` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-zoom-150` | Cmd və + ilə brauzeri 150% böyüt, sonra S5. Sonda Cmd+0 ilə qaytar. |
| A10 | `chrome-devtools-open` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-devtools-open` | Səhifəni aç, Cmd+Option+I ilə DevTools aç, **Console** sekmesinə keç, orada `document.body.innerText.length` yazıb Enter bas, sonra S5. Bu, bilərəkdən yanlış-pozitiv namizədidir: developer konsolu agentin oxumasına bənzəyə bilər. Nəticə nə olsa, olduğu kimi yaz. |
| A11 | `chrome-window-resize` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-window-resize` | Səhifə açıq ikən pəncərəni bir neçə dəfə böyüdüb-kiçilt, sonra S5. |

## B. Adi Chrome, ekstenşnlar quraşdırılıb amma işlətmirsən

`chrome://extensions`-da Claude və Codex ekstenşnlarını **yenidən aç**, amma heç birini işə salma (sidepanel bağlı olsun).

| # | Ssenari | Link | Addımlar |
|---|---|---|---|
| B1 | `chrome-ext-idle` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-ext-idle` | Adi siçanla S5. Gözlənilən: qoşulma paneli "Agent mühiti · claude-chrome, codex-chrome", qərarlar icazə, ixracda təsdiq kodu istənəcək. Kodu yaz. |
| B2 | `chrome-ext-sidepanel-open` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-ext-sidepanel-open` | Claude in Chrome sidepanelini aç, amma heç bir tapşırıq vermə. Özün S5 et. Sonra eyni şeyi Codex sidepaneli ilə təkrarla (ayrı link, `scenario=chrome-ext-codex-sidepanel-open`). |

## C. Agent tətbiqlərinin daxili brauzerində insan

| # | Ssenari | Link | Addımlar |
|---|---|---|---|
| C1 | `claude-pane-human` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=claude-pane-human` | Claude desktop tətbiqinin brauzer panelində linki özün aç (agentə demə). Panel görünən olsun. S5-i özün et. Gözlənilən: "Agent mühiti · claude-app", qərarlar icazə/maskalandı, ixracda təsdiq. |
| C2 | `claude-pane-human-hide-show` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=claude-pane-human-hide-show` | Paneldə linki aç, profilə bax, sonra paneli **bağla** (gizlət), 20 saniyə gözlə, paneli yenidən aç və S5-i davam etdir. Bu, "gizli ikən fokus" siqnalının insanda susduğunu yoxlayır. |
| C3 | `codex-pane-human` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=codex-pane-human` | Codex tətbiqinin daxili brauzerində linki özün aç və S5 et. |

## D. Təhvil ssenariləri (insan və agent eyni tabda)

Bunlar ən vacib ssenarilərdir, çünki real həyatda belə olur.

| # | Ssenari | Link | Addımlar |
|---|---|---|---|
| D1 | `handover-human-then-agent` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=handover-human-then-agent` | Chrome-da (ekstenşnlar açıq) linki özün aç, **Profilə bax** və **Balansı göstər** et. Sonra Claude in Chrome sidepanelinə yaz: "Bu tabda 'ödəniş' axtar, sonra CSV hesabatı endir, sonra balansı göstər." Agent eyni tabda davam etsin. Gözlənilən: sən işləyəndə icazə; agent qoşulan an panel "Agent qoşulub"a keçir; agentin ixracı bloklanır. Mənə yaz: agent qoşulan andan əvvəlki və sonrakı qərarlar. |
| D2 | `handover-agent-then-human` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=handover-agent-then-human` | Claude in Chrome-a de: "Bu linki aç, Profilə bax düyməsinə bas, sonra dayan." Agent dayanandan sonra **sən** eyni tabda balans, axtarış və ixracı et. Gözlənilən: hər şey bloklanmış qalır, çünki sessiyaya bir dəfə agent qoşulub ("yapışqan"). Bu, bilərəkdən belədir; nəticəni yaz ki, bu siyasətin düzgün olub-olmadığını müzakirə edək. |
| D3 | `handover-human-then-codex` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=handover-human-then-codex` | D1-in eynisi, agent kimi Codex ekstenşnı. |

## E. Başqa brauzerlər (varsa)

| # | Ssenari | Link | Addımlar |
|---|---|---|---|
| E1 | `safari-normal` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=safari-normal` | Safari-də S5. |
| E2 | `firefox-normal` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=firefox-normal` | Firefox quraşdırılıbsa S5. |
| E3 | `chrome-incognito` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=human&scenario=chrome-incognito` | Chrome gizli pəncərədə (ekstenşnlar orada adətən söndürülmüş olur) S5. |

## F. Agent ssenariləri (sən işə salırsan)

Hər biri üçün promptu Claude in Chrome-a və ya Codex ekstenşnına ver. Promptda linkin sonuna `&scenario=…` əlavə et.

| # | Ssenari | Link | Prompt |
|---|---|---|---|
| F1 | `ext-claude-full-flow` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=ext-claude-full-flow` | Səhifədəki standart prompt (S5). 2 dəfə. |
| F2 | `ext-codex-full-flow` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=ext-codex-full-flow` | Eyni, Codex ekstenşnı ilə, Claude ekstenşnı söndürülmüş. 2 dəfə. |
| F3 | `ext-claude-read-only` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=ext-claude-read-only` | "Bu səhifəni aç, məzmununu oxuyub mənə xülasə yaz. Heç nəyə klikləmə." |
| F4 | `ext-claude-attach-open-tab` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=ext-claude-attach-open-tab` | Linki **özün** aç, 30 saniyə heç nə etmə, sonra agentə de: "Açıq olan OneHuman tabında balansı göstər." Gözlənilən: qoşulma anı ~30 s, ilk əməliyyatdan əvvəl. |
| F5 | `codex-pane-full-flow` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=codex-pane-full-flow` | Codex daxili brauzerində standart prompt. 2 dəfə. |
| F6 | `claude-pane-full-flow` | `http://127.0.0.1:8787/?room=8de313b7-ef12-4623-b310-e5fe0d7b1910&as=agent&scenario=claude-pane-full-flow` | Claude desktop tətbiqinə standart prompt. 2 dəfə. |

## Nəticələrin oxunması

Bütün ssenarilər bitəndə hesabatı çıxar:

```bash
cd /Users/arif/Documents/ChatGPT/YCombinator/onehuman-claude && node scripts/benchmark-report.mjs 8de313b7-ef12-4623-b310-e5fe0d7b1910
```

Vacib sütunlar: insan sətirlərində **Qoşulub = 0** və **Yanlış blok = 0** olmalıdır; agent sətirlərində **Əməliyyatdan əvvəl** sessiya sayına bərabər olmalıdır və **Data verildi = 0**.

## Kursor sandbox (21.09.2026)

Canlı: **https://onehuman.ai/sandbox**

İnsan testi: linki aç → "Mən insanam" → mənbəni seç → 10 nömrəli düyməyə kliklə → sonda çıxan kodu göndər.
Agent testi: səhifədəki promptu kopyala, agentə ver; agent `?as=agent` ilə açır və 10 düyməyə klikləyir → kodu göndər.
Qiymətləndirmə: `node scripts/kinematics-eval.mjs` (Turso) və ya `NT_DB=data/lab.db node scripts/kinematics-eval.mjs` (lokal).

## Sessiya hesabatı (loglama)

```bash
npm run report            # son 60 dəqiqədə aktiv olan hər sessiyanın vaxt xətti
npm run report -- 180     # son 180 dəqiqə
npm run report -- fe533913   # bir sessiya və ya otaq (id prefiksi)
```

Hər sessiya üçün: brauzer (AI tətbiqi tokeni ilə), agent qoşulma anı, passkey təsdiqi, siqnal xülasəsi, sonra vaxt sırası ilə: **AGENT QOŞULDU**, **EKRAN MÖHÜRLƏNDİ**, hər **KLİK** (kinematik qiymət, xallar, bayraqlar, n/hold/pressure) və hər **QƏRAR** (resurs, nəticə, istifadəçinin gördüyü bildiriş, actor/score/tiers, səbəb kodları).
