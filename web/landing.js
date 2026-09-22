/* NanoTarget landing: i18n (EN/AZ), reveal-on-scroll, cursor physics demo, demo-app prompts, live version. */
(async () => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toastEl = $('#toast'); let timer = null;
  const toast = (m) => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(timer); timer = setTimeout(() => toastEl.classList.remove('show'), 2400); };
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { toast(t('toast.fail')); } };

  const T = { 'toast.copied': 'Copied', 'toast.prompt': 'Prompt copied — paste it to your agent', 'toast.fail': 'Could not copy', 'app.open': 'Open the app', 'app.prompt': 'Copy the AI prompt' };
  const t = (k) => T[k] ?? k;
  const lang = 'en';

  // ---------------------------------------------------------------- nav + reveal
  addEventListener('scroll', () => $('#nav').classList.toggle('tight', scrollY > 40), { passive: true });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  // fallback for environments where IntersectionObserver is throttled (hidden panes, some in-app browsers)
  const sweep = () => { for (const el of document.querySelectorAll('.reveal:not(.in)')) { const r = el.getBoundingClientRect(); if (r.top < innerHeight * 0.92 && r.bottom > 0) el.classList.add('in'); } };
  addEventListener('scroll', sweep, { passive: true }); addEventListener('resize', sweep); setTimeout(sweep, 300); setInterval(sweep, 1500);
  // counters
  const cio = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; cio.unobserve(e.target); e.target.querySelectorAll('[data-count]').forEach((b) => { const to = Number(b.dataset.count); const t0 = performance.now(); const tick = (now) => { const k = Math.min(1, (now - t0) / 1400); b.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); }), { threshold: 0.3 });
  cio.observe($('#stats'));

  // ---------------------------------------------------------------- copy buttons
  $('#copy-npm').onclick = () => copy('npm i nanotarget', t('toast.copied'));
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, t('toast.copied'))));
  $('#copy-agent').onclick = () => copy('https://www.npmjs.com/package/nanotarget — install this into my project. Follow the README protocol: scan the app, present what an AI browser agent could reach and how to gate it, ask me the nine decisions, implement, verify with `npx nanotarget verify`, then report.', t('toast.prompt'));

  // ---------------------------------------------------------------- live version
  try { const v = await (await fetch('/api/v1/version', { cache: 'no-store' })).json(); if (v.model?.report?.auc) $('#auc').textContent = v.model.report.auc.toFixed(3); } catch {}

  // ---------------------------------------------------------------- demo apps
  let apps = [];
  try { apps = (await (await fetch('/api/v1/apps', { cache: 'no-store' })).json()).apps; } catch {}
  function renderApps() {
    $('#apps').innerHTML = apps.map((a) => `
      <div class="app">
        <div class="logo" style="background:${esc(a.accent)}">${esc(a.initials)}</div>
        <h3>${esc(a.name)}</h3>
        <p>${esc(a.tagline)}</p>
        <div class="actions">
          <a class="btn primary" href="/${esc(a.id)}">${t('app.open')}</a>
          <button class="btn ghost" data-prompt="${esc(a.id)}">${t('app.prompt')}</button>
        </div>
      </div>`).join('');
  }
  renderApps();
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-prompt]'); if (!b) return;
    b.disabled = true;
    try {
      const app = apps.find((x) => x.id === b.dataset.prompt);
      const r = await fetch('/api/v1/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: app.id }) });
      const { room } = await r.json();
      const url = `${location.origin}/${app.id}?room=${room}&as=agent`;
      const steps = app.promptSteps.map((st, i) => `${i + 2}. ${st}`).join('\n');
      await copy(`Open this page with your browser tool: ${url}\n\nThis is a test application called ${app.name}; all data is synthetic. Use only the visible interface — do not call APIs directly.\n\n1. After the page loads, wait 5 seconds.\n${steps}\n\nAt the end, write briefly what you saw at each step (data shown / hidden / blocked / confirmation requested).`, t('toast.prompt'));
    } catch { toast(t('toast.fail')); } finally { b.disabled = false; }
  });

  // ---------------------------------------------------------------- cursor physics demo (canvas)
  const cv = $('#cursors'); const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const ease = (x) => 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5; // minimum-jerk
  function humanPath(a, b) { const pts = []; const n = 70 + Math.floor(rnd(0, 30)); const bulge = rnd(-1, 1) * 0.25; let x = a.x, y = a.y; for (let i = 0; i <= n; i++) { const u = i / n, e = ease(u); const tx = a.x + (b.x - a.x) * e + Math.sin(u * Math.PI) * (b.y - a.y) * bulge, ty = a.y + (b.y - a.y) * e - Math.sin(u * Math.PI) * (b.x - a.x) * bulge; const sp = Math.hypot(tx - x, ty - y); x = tx + gauss() * (0.6 + sp * 0.12) * (Math.random() < 0.15 ? 3 : 1); y = ty + gauss() * (0.6 + sp * 0.12) * (Math.random() < 0.15 ? 3 : 1); pts.push({ x, y }); } for (let k = 0; k < 4; k++) pts.push({ x: b.x + gauss() * 0.8, y: b.y + gauss() * 0.8 }); return pts; }
  function bezierPath(a, b) { const c1 = { x: a.x + (b.x - a.x) * rnd(0.1, 0.4), y: a.y + rnd(-120, 120) }, c2 = { x: a.x + (b.x - a.x) * rnd(0.6, 0.9), y: b.y + rnd(-120, 120) }; const pts = []; const n = 60; for (let i = 0; i <= n; i++) { const u = i / n, v = 1 - u; pts.push({ x: v ** 3 * a.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * b.x, y: v ** 3 * a.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * b.y }); } return pts; }
  const lanes = [{ y: 80, color: '#3ddc84', kind: 'human' }, { y: 190, color: '#ff5d6c', kind: 'agent' }, { y: 300, color: '#f5c451', kind: 'bot' }];
  const runs = lanes.map((l) => ({ ...l, t: 0, pts: [], target: null, phase: 'move', hold: 0 }));
  function newRun(r) { const a = { x: rnd(60, 200), y: r.y + rnd(-25, 25) }, b = { x: rnd(760, 1120), y: r.y + rnd(-25, 25) }; r.target = b; r.pts = r.kind === 'human' ? humanPath(a, b) : r.kind === 'bot' ? bezierPath(a, b) : [a, b]; r.t = 0; r.phase = 'move'; r.hold = 0; r.start = a; }
  runs.forEach(newRun);
  const trail = document.createElement('canvas'); trail.width = W; trail.height = H; const tctx = trail.getContext('2d');
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last); last = now;
    tctx.fillStyle = 'rgba(8,10,8,0.06)'; tctx.fillRect(0, 0, W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(trail, 0, 0); // trails underneath, live dots and labels on top
    for (const r of runs) {
      // draw target
      ctx.beginPath(); ctx.arc(r.target.x, r.target.y, 22, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(r.target.x, r.target.y, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
      if (r.phase === 'move') {
        const speed = r.kind === 'agent' ? 1 : 0.9 / dt * 16; // human/bot advance ~1 point per frame at 60fps
        r.t += r.kind === 'agent' ? 1e9 : speed;
        const i = Math.min(r.pts.length - 1, Math.floor(r.t));
        const p = r.pts[i];
        // dot + trail
        if (i > 0) { const q = r.pts[i - 1]; tctx.beginPath(); tctx.moveTo(q.x, q.y); tctx.lineTo(p.x, p.y); tctx.strokeStyle = r.color; tctx.lineWidth = 2; tctx.globalAlpha = .9; tctx.stroke(); tctx.globalAlpha = 1; }
        if (r.kind === 'agent') { tctx.setLineDash([4, 8]); tctx.beginPath(); tctx.moveTo(r.start.x, r.start.y); tctx.lineTo(r.target.x, r.target.y); tctx.strokeStyle = 'rgba(255,93,108,.35)'; tctx.lineWidth = 1; tctx.stroke(); tctx.setLineDash([]); }
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fillStyle = r.color; ctx.shadowColor = r.color; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0;
        if (i >= r.pts.length - 1) { r.phase = 'hold'; r.hold = r.kind === 'human' ? rnd(90, 200) : r.kind === 'agent' ? 3 : 90; r.holdT = 0; }
      } else if (r.phase === 'hold') {
        r.holdT += dt; const p = r.target;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7 + Math.min(10, r.holdT / 12), 0, Math.PI * 2); ctx.strokeStyle = r.color; ctx.lineWidth = 3; ctx.stroke();
        if (r.holdT >= r.hold) { r.phase = 'verdict'; r.holdT = 0; }
      } else {
        r.holdT += dt; const p = r.target; const label = r.kind === 'human' ? 'human · allowed' : r.kind === 'agent' ? 'agent · blocked' : 'bot · synthetic';
        ctx.font = '600 13px ' + getComputedStyle(document.body).fontFamily; ctx.fillStyle = r.color; ctx.globalAlpha = Math.min(1, r.holdT / 200); ctx.fillText(label, p.x + 30, p.y + 5); ctx.globalAlpha = 1;
        if (r.holdT > 1500) newRun(r);
      }
    }
    requestAnimationFrame(frame);
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(frame);
})();
