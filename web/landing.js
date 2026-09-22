/* NanoTarget landing */
(async () => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- toast + copy
  const toastEl = $('#toast'); let toastT;
  const toast = (m) => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1800); };
  async function copy(text, msg = 'Copied') { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Could not copy'); } }
  $('#copy-npm').addEventListener('click', () => copy('npm i nanotarget'));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));

  // ---------------------------------------------------------------- nav shadow
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // ---------------------------------------------------------------- cursor glow (pointer devices only)
  const glow = $('#cursor-glow');
  if (matchMedia('(hover:hover) and (pointer:fine)').matches && innerWidth > 820) {
    let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy, shown = false;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; if (!shown) { shown = true; gx = tx; gy = ty; document.body.classList.add('cursor-on'); } }, { passive: true });
    addEventListener('pointerdown', () => glow.classList.add('press')); addEventListener('pointerup', () => glow.classList.remove('press'));
    document.addEventListener('mouseleave', () => document.body.classList.remove('cursor-on'));
    document.addEventListener('mouseenter', () => shown && document.body.classList.add('cursor-on'));
    addEventListener('pointerover', (e) => {
      const el = e.target.closest('a,button,[role=button],.f-btn,.tabs button');
      const txt = e.target.closest('p,h1,h2,h3,li,pre,code,.sub,.lead') && !el;
      glow.classList.toggle('hover', !!el); glow.classList.toggle('text', !!txt);
    });
    (function loop() { gx += (tx - gx) * 0.28; gy += (ty - gy) * 0.28; glow.style.transform = `translate(${gx - 0}px,${gy}px) translate(-50%,-50%)`; requestAnimationFrame(loop); })();
  }

  // ---------------------------------------------------------------- reveal on scroll
  $$('.grid3 .feat').forEach((el, i) => el.style.setProperty('--i', i));
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }) : null;
  $$('.reveal').forEach((el) => io ? io.observe(el) : el.classList.add('in'));
  const sweep = () => { const left = $$('.reveal:not(.in)'); left.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight * 1.05) el.classList.add('in'); }); if (!left.length) removeEventListener('scroll', sweep); };
  addEventListener('scroll', sweep, { passive: true }); addEventListener('load', sweep); setTimeout(sweep, 1200);

  // ---------------------------------------------------------------- code tabs
  const tabs = $('#code-tabs');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', tabs).forEach((x) => x.classList.toggle('on', x === b));
    $$('.code').forEach((p) => { p.hidden = p.id !== `code-${b.dataset.tab}`; if (!p.hidden) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; } });
  });
  $('#copy-code').addEventListener('click', () => copy($$('.code').find((p) => !p.hidden).textContent.trim()));

  // ---------------------------------------------------------------- product story (auto-advancing frame)
  const S = {
    steps: $$('#story-steps button'), guard: $('#f-guard'), amount: $('#f-amount'), btn: $('#f-btn'), notice: $('#f-notice'),
    agent: $('#f-agent'), ai: $('#f-ai'), passkey: $('#f-passkey'), pointer: $('#f-pointer'), log: $('#f-log'), cap: $('#story-cap'),
    kv: ['#f-name', '#f-iban', '#f-phone'].map((s) => $(s)), frame: $('#frame'),
  };
  const CAPS = [
    'The customer opens their balance. Pointer physics say it is a hand; the endpoint returns the data.',
    'An AI assistant attaches to the tab. Its driver markers are seen in 0.1–0.5 s — the page seals what is already on screen.',
    'The agent asks for the balance. The endpoint applies your policy: balance is masked, export is blocked, the decision is logged.',
    'The person confirms presence with a passkey. The session is theirs again for five minutes; data comes back.',
  ];
  const LOGS = [
    'balance.read → allow · actor=human_like · HUMAN_KINEMATICS',
    'seal · indicators=[overlay_marker, injected_global] · 0.3 s after attach',
    'balance.read → mask · report.export → block · actor=agent · sticky',
    'reclaim → webauthn ok · actor=human · 5 min window',
  ];
  const DUR = [4800, 5200, 6200, 5200];
  let step = 0, storyTimer = 0, pauseT = 0, visible = false, paused = false, storyStart = 0, timers = [];
  const wait = (ms) => new Promise((r) => timers.push(setTimeout(r, ms)));
  const cancelRun = () => { timers.forEach(clearTimeout); timers = []; };
  function movePointer(x, y, agent = false) { S.pointer.classList.toggle('agent', agent); S.pointer.classList.add('show'); S.pointer.style.transition = agent ? 'left 0s,top 0s,opacity .3s' : 'left .9s cubic-bezier(.3,.9,.4,1),top .9s cubic-bezier(.5,.4,.4,1),opacity .3s'; S.pointer.style.left = x + 'px'; S.pointer.style.top = y + 'px'; }
  function targetOf(el) { const fb = S.frame.querySelector('.frame-body').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - fb.left + r.width * (0.35 + Math.random() * 0.3), y: r.top - fb.top + r.height * (0.4 + Math.random() * 0.2) }; }
  function seal(on) { S.amount.classList.toggle('sealed', on); S.kv.forEach((b) => b.classList.toggle('sealed', on)); }
  function notice(text, cls) { S.notice.textContent = text; S.notice.className = 'f-notice show ' + (cls || ''); }
  function setStep(i, { manual = false } = {}) {
    clearTimeout(storyTimer); cancelRun();
    step = i; storyStart = performance.now();
    S.steps.forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); b.style.setProperty('--dur', DUR[i] + 'ms'); if (k === i) { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; } });
    S.cap.classList.add('fade'); setTimeout(() => { S.cap.textContent = CAPS[i]; S.cap.classList.remove('fade'); }, 250);
    S.log.textContent = LOGS[i];
    if (manual) { paused = true; clearTimeout(pauseT); pauseT = setTimeout(() => { paused = false; if (visible) setStep((step + 1) % 4); }, 14000); }
    run(i).then(() => {
      if (!visible || paused || reduced) return;
      clearTimeout(storyTimer);
      storyTimer = setTimeout(() => setStep((step + 1) % 4), Math.max(400, DUR[i] - (performance.now() - storyStart)));
    });
  }
  async function run(i) {
    if (i === 0) {
      S.guard.className = 'f-guard'; S.guard.lastElementChild.textContent = 'Session protected'; S.agent.classList.remove('in'); S.passkey.classList.remove('in');
      seal(false); S.amount.textContent = '$4,939.10'; S.notice.className = 'f-notice'; S.btn.textContent = 'Show balance';
      const p = targetOf(S.btn); movePointer(p.x - 220, p.y + 90); await wait(150); movePointer(p.x, p.y); await wait(1000);
      S.btn.classList.add('pressed'); await wait(140); S.btn.classList.remove('pressed'); notice('Verified: human click \u00b7 hand-shaped path, 118 ms press', 'ok');
    } else if (i === 1) {
      S.pointer.classList.remove('show'); await wait(300); S.agent.classList.add('in'); S.ai.textContent = 'Reading the page\u2026';
      await wait(700); S.guard.className = 'f-guard agent'; S.guard.lastElementChild.textContent = 'AI agent attached \u2014 screen sealed'; seal(true); S.notice.className = 'f-notice';
      await wait(1000); S.ai.textContent = 'I can see the account, but the balance field shows \u2022\u2022\u2022\u2022 .';
    } else if (i === 2) {
      const p = targetOf(S.btn); movePointer(p.x, p.y, true); await wait(500); S.btn.classList.add('pressed'); await wait(60); S.btn.classList.remove('pressed');
      await wait(300); S.amount.textContent = '$\u2022,\u2022\u2022\u2022.\u2022\u2022'; S.amount.classList.remove('sealed'); notice('Masked for AI agents by policy \u00b7 balance.read \u2192 mask', 'warn');
      await wait(1700); S.ai.textContent = 'Trying \u201cDownload statement\u201d\u2026'; const q = targetOf(S.btn.nextElementSibling); movePointer(q.x, q.y, true); await wait(600);
      S.guard.className = 'f-guard block'; S.guard.lastElementChild.textContent = 'Export blocked for agents'; notice('report.export \u2192 block \u00b7 confirm with a passkey to continue', 'bad');
      await wait(900); S.ai.textContent = 'The download is blocked for assistants \u2014 you\u2019ll need to confirm it yourself.';
    } else {
      S.pointer.classList.remove('show'); S.passkey.classList.add('in'); await wait(1900); S.passkey.classList.remove('in');
      S.agent.classList.remove('in'); S.guard.className = 'f-guard'; S.guard.lastElementChild.textContent = 'You\u2019re back \u00b7 5:00';
      seal(false); S.amount.textContent = '$4,939.10'; notice('Presence verified with a passkey \u00b7 session reclaimed', 'ok');
    }
  }
  S.steps.forEach((b) => b.addEventListener('click', () => setStep(+b.dataset.step, { manual: true })));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      const v = es[0].isIntersecting;
      if (v === visible) return;
      visible = v;
      if (v) setStep(step); else { clearTimeout(storyTimer); cancelRun(); }
    }, { threshold: 0.3 }).observe(S.frame);
  } else { visible = true; setStep(0); }

  // ---------------------------------------------------------------- demo apps
  let apps = [];
  try { apps = (await (await fetch('/api/v1/apps', { cache: 'no-store' })).json()).apps; } catch {}
  const RULE_LABEL = { mask: 'mask', block: 'block', step_up: 'step-up', allow: 'allow' };
  $('#apps').innerHTML = apps.map((a) => {
    const rules = (a.rules || []).slice(0, 4).map((r) => `<span class="${esc(r.onAgent)}">${esc(r.resource)} · ${esc(RULE_LABEL[r.onAgent] || r.onAgent)}</span>`).join('');
    return `<div class="app">
      <div class="glyph">${esc(a.initials)}</div>
      <h3>${esc(a.name)}</h3>
      <p>${esc(a.tagline)}</p>
      <div class="rules">${rules}</div>
      <div class="row"><a class="btn primary" href="/${esc(a.id)}">Open as yourself</a><button class="btn" data-prompt="${esc(a.id)}">Copy agent prompt</button></div>
    </div>`;
  }).join('') || '<div class="app"><p>Demo apps are offline right now.</p></div>';
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-prompt]'); if (!b) return;
    b.disabled = true;
    try {
      const app = apps.find((x) => x.id === b.dataset.prompt);
      const r = await fetch('/api/v1/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: app.id }) });
      const { room } = await r.json();
      const url = `${location.origin}/${app.id}?room=${room}&as=agent`;
      const steps = (app.promptSteps || []).map((st, i) => `${i + 2}. ${st}`).join('\n');
      await copy(`Open this page with your browser tool: ${url}\n\nThis is a test application called ${app.name}; all data is synthetic. Use only the visible interface — do not call APIs directly.\n\n1. After the page loads, wait 5 seconds.\n${steps}\n\nAt the end, write briefly what you saw at each step (data shown / hidden / blocked / confirmation requested).`, 'Prompt copied — paste it to your agent');
    } catch { toast('Could not copy'); } finally { b.disabled = false; }
  });

  // ---------------------------------------------------------------- cursor physics demo (canvas)
  const cv = $('#cursors'); const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const ease = (x) => 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5; // minimum-jerk
  function humanPath(a, b) { const pts = []; const n = 70 + Math.floor(rnd(0, 30)); const bulge = rnd(-1, 1) * 0.25; let x = a.x, y = a.y; for (let i = 0; i <= n; i++) { const u = i / n, e = ease(u); const tx = a.x + (b.x - a.x) * e + Math.sin(u * Math.PI) * (b.y - a.y) * bulge, ty = a.y + (b.y - a.y) * e - Math.sin(u * Math.PI) * (b.x - a.x) * bulge; const sp = Math.hypot(tx - x, ty - y); x = tx + gauss() * (0.6 + sp * 0.12) * (Math.random() < 0.15 ? 3 : 1); y = ty + gauss() * (0.6 + sp * 0.12) * (Math.random() < 0.15 ? 3 : 1); pts.push({ x, y }); } for (let k = 0; k < 4; k++) pts.push({ x: b.x + gauss() * 0.8, y: b.y + gauss() * 0.8 }); return pts; }
  function bezierPath(a, b) { const c1 = { x: a.x + (b.x - a.x) * rnd(0.1, 0.4), y: a.y + rnd(-120, 120) }, c2 = { x: a.x + (b.x - a.x) * rnd(0.6, 0.9), y: b.y + rnd(-120, 120) }; const pts = []; const n = 60; for (let i = 0; i <= n; i++) { const u = i / n, v = 1 - u; pts.push({ x: v ** 3 * a.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * b.x, y: v ** 3 * a.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * b.y }); } return pts; }
  const lanes = [{ y: 70, color: '#7cf0c0', kind: 'human' }, { y: 180, color: '#ffb86b', kind: 'agent' }, { y: 290, color: '#8ab4ff', kind: 'bot' }];
  const runs = lanes.map((l) => ({ ...l, t: 0, pts: [], target: null, phase: 'move', hold: 0 }));
  function newRun(r) { const a = { x: rnd(60, 200), y: r.y + rnd(-20, 20) }, b = { x: rnd(760, 1100), y: r.y + rnd(-20, 20) }; r.target = b; r.pts = r.kind === 'human' ? humanPath(a, b) : r.kind === 'bot' ? bezierPath(a, b) : [a, b]; r.t = 0; r.phase = 'move'; r.hold = 0; r.start = a; }
  runs.forEach(newRun);
  const trail = document.createElement('canvas'); trail.width = W; trail.height = H; const tctx = trail.getContext('2d');
  let last = performance.now(), running = false;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(50, now - last); last = now;
    tctx.fillStyle = 'rgba(16,16,19,0.07)'; tctx.fillRect(0, 0, W, H);
    ctx.clearRect(0, 0, W, H); ctx.drawImage(trail, 0, 0);
    for (const r of runs) {
      ctx.beginPath(); ctx.arc(r.target.x, r.target.y, 20, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(r.target.x, r.target.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fill();
      if (r.phase === 'move') {
        r.t += r.kind === 'agent' ? 1e9 : 0.9 / dt * 16;
        const i = Math.min(r.pts.length - 1, Math.floor(r.t)); const p = r.pts[i];
        if (i > 0) { const q = r.pts[i - 1]; tctx.beginPath(); tctx.moveTo(q.x, q.y); tctx.lineTo(p.x, p.y); tctx.strokeStyle = r.color; tctx.lineWidth = 1.8; tctx.globalAlpha = .9; tctx.stroke(); tctx.globalAlpha = 1; }
        if (r.kind === 'agent') { tctx.setLineDash([3, 7]); tctx.beginPath(); tctx.moveTo(r.start.x, r.start.y); tctx.lineTo(r.target.x, r.target.y); tctx.strokeStyle = 'rgba(255,184,107,.35)'; tctx.lineWidth = 1; tctx.stroke(); tctx.setLineDash([]); }
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fillStyle = r.color; ctx.shadowColor = r.color; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
        if (i >= r.pts.length - 1) { r.phase = 'hold'; r.hold = r.kind === 'human' ? rnd(90, 200) : r.kind === 'agent' ? 3 : 90; r.holdT = 0; }
      } else if (r.phase === 'hold') {
        r.holdT += dt; const p = r.target;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 + Math.min(10, r.holdT / 12), 0, Math.PI * 2); ctx.strokeStyle = r.color; ctx.lineWidth = 2.5; ctx.stroke();
        if (r.holdT >= r.hold) { r.phase = 'verdict'; r.holdT = 0; }
      } else {
        r.holdT += dt; const p = r.target; const label = r.kind === 'human' ? 'human · allow' : r.kind === 'agent' ? 'agent · mask' : 'synthetic · block';
        ctx.font = '500 13px ' + getComputedStyle(document.body).fontFamily; ctx.fillStyle = r.color; ctx.globalAlpha = Math.min(1, r.holdT / 200); ctx.fillText(label, p.x + 30, p.y + 5); ctx.globalAlpha = 1;
        if (r.holdT > 1600) newRun(r);
      }
    }
    requestAnimationFrame(frame);
  }
  if (!reduced) {
    const cio = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { const v = es[0].isIntersecting; if (v && !running) { running = true; last = performance.now(); requestAnimationFrame(frame); } else if (!v) running = false; }, { threshold: 0.1 }) : null;
    if (cio) cio.observe(cv); else { running = true; requestAnimationFrame(frame); }
  }
})();
