# NanoTarget — qiymətləndirmə hesabatı (avtomatik)

Yaradılma: 2026-09-22T08:56:41.898Z · assess assess-v7 · kinematics kin-v16 · model gbdt-2026-09-22

## 1. Dataset

| Etiket | Mənbə | Klik | Müştəri id |
| --- | --- | ---: | ---: |
| agent | agent-app-browser | 29 | 2 |
| agent | agent-chrome | 122 | 8 |
| agent | agent-chrome-cyborg | 67 | 2 |
| agent | claude-desktop-pane | 10 | 1 |
| agent | ghost-cursor-synthetic-naive | 100 | 2 |
| agent | ghost-cursor-synthetic-noisy1 | 100 | 2 |
| agent | ghost-cursor-synthetic-noisy2 | 100 | 2 |
| agent | ghost-cursor-synthetic-noisy3 | 100 | 2 |
| agent | ghost-cursor-synthetic-slow | 100 | 2 |
| agent | ghost-cursor-synthetic-spread | 100 | 2 |
| human | chrome-mouse | 182 | 8 |
| human | chrome-mouse-fast | 10 | 1 |
| human | chrome-trackpad | 82 | 4 |
| human | chrome-trackpad-tap | 10 | 1 |
| human | claude-pane-human | 8 | 1 |
| human | codex-run-human-assist | 1 | 1 |
| human | safari | 37 | 2 |
| human | touch | 59 | 2 |
| human | windows-mouse | 74 | 2 |
| **cəmi** | | **1291** | **38** |

## 2. Model (qruplaşdırılmış 5-qat CV, müştəri üzrə)

- Tip: gbdt; xüsusiyyətlər: 32; sıfırlanan (vaxt): dtMean, dtCv, dtZeroFrac
- AUC: **0.9993** (logistik 0.9793, ağaclar 0.9993)
- Hədlər: insan ≥ 0.974, sintetik ≤ 0.015 → CV-də insan yalan-müsbəti 0, agent yalan-mənfisi 0
- Öyrənmə dataseti: 1156 klik / 36 müştəri

Ən vacib xüsusiyyətlər: residKurtosis 42.7%, pauseBeforeDownMs 11.9%, pathLen 9.0%, centreOffset 8.5%, endSlow 7.6%, jumpPx 4.9%, durationMs 4.7%, dirChanges 2.8%

## 3. Klik səviyyəsi (qaydalar + model, istehsal konfiqurasiyası)

| Mənbə | Klik | insan | sintetik | qeyri-müəyyən | ilk klikdə açılma |
| --- | ---: | ---: | ---: | ---: | ---: |
| agent / agent-app-browser | 29 | 0 | 29 | 0 | – |
| agent / agent-chrome | 120 | 0 | 118 | 2 | – |
| agent / agent-chrome-cyborg | 65 | 1 | 64 | 0 | – |
| agent / claude-desktop-pane | 10 | 0 | 10 | 0 | – |
| agent / ghost-cursor-synthetic-naive | 100 | 1 | 98 | 1 | – |
| agent / ghost-cursor-synthetic-noisy1 | 100 | 0 | 100 | 0 | – |
| agent / ghost-cursor-synthetic-noisy2 | 100 | 0 | 100 | 0 | – |
| agent / ghost-cursor-synthetic-noisy3 | 100 | 0 | 100 | 0 | – |
| agent / ghost-cursor-synthetic-slow | 100 | 0 | 99 | 1 | – |
| agent / ghost-cursor-synthetic-spread | 100 | 0 | 99 | 1 | – |
| human / chrome-mouse | 179 | 161 | 2 | 16 | 84.4% |
| human / chrome-mouse-fast | 10 | 10 | 0 | 0 | 100.0% |
| human / chrome-trackpad | 80 | 74 | 0 | 6 | 90.0% |
| human / chrome-trackpad-tap | 10 | 10 | 0 | 0 | 100.0% |
| human / claude-pane-human | 8 | 8 | 0 | 0 | 100.0% |
| human / codex-run-human-assist | 1 | 1 | 0 | 0 | 100.0% |
| human / safari | 37 | 30 | 0 | 7 | 67.6% |
| human / windows-mouse | 72 | 72 | 0 | 0 | 100.0% |

- İnsan klikləri: 397; **sintetik sayılan: 2** (0.5%); ilk klikdə açılan: 87.9%
- Agent klikləri (real + generasiya): 824; **insan sayılan: 2** (0.2%); sintetik: 99.2%

## 4. Sessiya səviyyəsi — təlim dövrələri (mühərrik təkrarı, son 6 klik pəncərəsi)

| Kod | Etiket | Mənbə | Addım | agent | insan | bilinmir | Səhv |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| t-q4jdqo3c | human | safari | 27 | 0 | 27 | 0 | 0 |
| t-yushey5a | human | chrome-mouse | 90 | 9 | 81 | 0 | 9 (köhnə SDK, sayılmır) |
| t-yushey5a | human | chrome-mouse | 90 | 9 | 81 | 0 | 9 (köhnə SDK, sayılmır) |
| t-yushey5a | human | chrome-mouse | 90 | 9 | 81 | 0 | 9 (köhnə SDK, sayılmır) |
| t-wjyt7lem | human | chrome-mouse | 25 | 0 | 25 | 0 | 0 |
| t-j8vwd3fc | human | chrome-mouse | 27 | 0 | 27 | 0 | 0 |
| t-k281f1wr | human | chrome-mouse | 27 | 0 | 27 | 0 | 0 |
| t-d5z49od3 | human | chrome-mouse | 27 | 0 | 27 | 0 | 0 |
| t-2yl22gmc | agent | agent-app-browser | 27 | 27 | 0 | 0 | 0 |
| t-jjyvlh68 | human | chrome-mouse | 38 | 0 | 38 | 0 | 0 |
| t-jjyvlh68 | human | chrome-mouse | 38 | 0 | 38 | 0 | 0 |
| t-jk47zfxi | agent | agent-chrome | 37 | 37 | 0 | 0 | 0 |
| t-s4p6dg64 | agent | agent-chrome | 38 | 38 | 0 | 0 | 0 |
| t-fclbpan9 | human | touch | 37 | 0 | 0 | 37 | 0 |
| t-42cl7gmf | agent | agent-chrome | 37 | 37 | 0 | 0 | 0 |
| t-p13kyny2 | agent | agent-chrome | 36 | 36 | 0 | 0 | 0 |
| t-jhtds0zt | human | windows-mouse | 37 | 0 | 37 | 0 | 0 |
| t-bhgh0lcs | human | windows-mouse | 37 | 0 | 37 | 0 | 0 |

Sayılan dövrələr: 15, mühərrik səhvi: **0**.

## 5. Düşmən sinifləri (generasiya)

| Variant | n | sintetik | insan |
| --- | ---: | ---: | ---: |
| ghost-cursor-synthetic-naive | 100 | 98 | 1 |
| ghost-cursor-synthetic-noisy1 | 100 | 100 | 0 |
| ghost-cursor-synthetic-noisy2 | 100 | 100 | 0 |
| ghost-cursor-synthetic-noisy3 | 100 | 100 | 0 |
| ghost-cursor-synthetic-slow | 100 | 99 | 0 |
| ghost-cursor-synthetic-spread | 100 | 99 | 0 |

Qeyd: generasiya olunmuş trayektoriyalar real brauzer hadisələri deyil; onlar "insan kimi görünmək" kitabxanalarının çıxışını təqlid edir və yalnız kinematik hakimi sınayır.
