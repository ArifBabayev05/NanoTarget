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

  $$('.g.fp svg path').forEach((pth, k) => pth.style.setProperty('--k', k));   // fingerprint ridges draw on in order

  // ---------------------------------------------------------------- hero: spotlight, aurora, rotating verb
  const hero = $('#hero');
  if (hero && matchMedia('(hover:hover) and (pointer:fine)').matches) {
    hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); hero.style.setProperty('--sx', `${e.clientX - r.left}px`); hero.style.setProperty('--sy', `${e.clientY - r.top}px`); }, { passive: true });
  }
  // A slow field of noise behind the hero, drawn by a fragment shader: two tints (mint for the hand, amber for
  // the agent) drifting through the dark, brightening a little around the pointer. Falls back to the CSS glow.
  (function aurora() {
    const cv = $('#aurora'); if (!cv || reduced) return;
    const gl = cv.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) return;
    const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const FS = `precision mediump float;uniform vec2 R;uniform float T;uniform vec2 M;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
      void main(){vec2 uv=gl_FragCoord.xy/R;vec2 q=uv*vec2(R.x/R.y,1.);
        float t=T*.045;
        float f1=fbm(q*1.6+vec2(t,-t*.6));float f2=fbm(q*2.2-vec2(t*.8,t*.4)+f1*.9);
        float band=smoothstep(.35,.85,f2)*smoothstep(1.,.35,uv.y);
        vec3 mint=vec3(.486,.941,.753),amber=vec3(1.,.72,.42);
        vec3 col=mint*band*.16+amber*smoothstep(.6,.95,f1)*smoothstep(1.,.5,uv.y)*.05;
        float d=distance(uv*vec2(R.x/R.y,1.),M*vec2(R.x/R.y,1.));col+=mint*.05*exp(-d*d*9.)*band*3.;
        float a=clamp(band*.9+.06,0.,1.)*smoothstep(0.,.25,uv.y);gl_FragColor=vec4(col,a*.9);}`;
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS); if (!vs || !fs) return;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'R'), uT = gl.getUniformLocation(prog, 'T'), uM = gl.getUniformLocation(prog, 'M');
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    let mx = .5, my = .65, tx = .5, ty = .65, live = true, t0 = performance.now();
    const size = () => { const dpr = Math.min(1.25, devicePixelRatio || 1) * 0.6; const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); } };
    addEventListener('resize', size, { passive: true }); size();
    hero.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width; ty = 1 - (e.clientY - r.top) / r.height; }, { passive: true });
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { live = es[0].isIntersecting; if (live) requestAnimationFrame(frame); }, { threshold: 0 }) : null;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && live) requestAnimationFrame(frame); });
    function frame(now) {
      if (!live || document.visibilityState !== 'visible') return;
      size(); mx += (tx - mx) * .06; my += (ty - my) * .06;
      gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uT, (now - t0) / 1000); gl.uniform2f(uM, mx, my);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); requestAnimationFrame(frame);
    }
    if (io) io.observe(cv); else requestAnimationFrame(frame);
  })();
  // "Decide what they can see." — the verb cycles through what the policy actually governs
  (function rotator() {
    const rot = $('#rot'); if (!rot) return;
    const words = $$('span', rot); let i = 0;
    const fit = (w) => { rot.style.width = `${w.offsetWidth}px`; };          // the line follows the current word, so the period stays put
    fit(words[0]); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit(words[i]));
    addEventListener('resize', () => fit(words[i]), { passive: true });
    if (reduced) return;
    setInterval(() => {
      const cur = words[i], next = words[(i + 1) % words.length];
      cur.classList.remove('on'); cur.classList.add('out'); setTimeout(() => cur.classList.remove('out'), 600);
      next.classList.add('on'); i = (i + 1) % words.length; fit(next);
    }, 2600);
  })();

  // ---------------------------------------------------------------- cursor, scroll line, parallax, marquee, tickers, text reveal
  if (matchMedia('(hover:hover) and (pointer:fine)').matches && innerWidth > 820 && !reduced) {
    const cur = $('#cur'), dot = cur.querySelector('.dot'), ring = cur.querySelector('.ring');
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, shown = false;
    addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; if (!shown) { shown = true; rx = x; ry = y; document.body.classList.add('has-cur'); } }, { passive: true });
    addEventListener('pointerdown', () => cur.classList.add('press')); addEventListener('pointerup', () => cur.classList.remove('press'));
    document.addEventListener('mouseleave', () => document.body.classList.remove('has-cur')); document.addEventListener('mouseenter', () => shown && document.body.classList.add('has-cur'));
    addEventListener('pointerover', (e) => { const t = e.target; const el = t.closest && t.closest('a,button,[role=button],.f-btn,.tabs button,.story-steps button'); const txt = !el && t.closest && t.closest('p,h1,h2,h3,li,.sub,.lead'); cur.classList.toggle('hover', !!el); cur.classList.toggle('text', !!txt); });
    (function loop() { rx += (x - rx) * .18; ry += (y - ry) * .18; dot.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`; ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`; requestAnimationFrame(loop); })();
  }
  if (!CSS.supports || !CSS.supports('animation-timeline: scroll()')) {
    const line = $('#scroll-line'); const upd = () => { const h = document.documentElement; line.style.transform = `scaleX(${h.scrollHeight > h.clientHeight ? scrollY / (h.scrollHeight - h.clientHeight) : 0})`; };
    addEventListener('scroll', upd, { passive: true }); upd();
  }
  if (!reduced) { const au = $('#aurora'); addEventListener('scroll', () => { if (au) au.style.transform = `translateX(-50%) translateY(${Math.min(200, scrollY * .22)}px)`; }, { passive: true }); }
  (function marquee() { const row = $('#marquee-row'); if (!row) return; row.innerHTML += row.innerHTML; })();
  (function tickers() {
    const els = $$('[data-tick]'); if (!els.length) return;
    const run = (el) => { const to = parseFloat(el.dataset.tick), dec = +el.dataset.dec || 0, t0 = performance.now(), dur = 1400; const step = (now) => { const u = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - u, 3); el.textContent = (to * e).toFixed(dec); if (u < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); };
    if (!('IntersectionObserver' in window) || reduced) { els.forEach((el) => { el.textContent = parseFloat(el.dataset.tick).toFixed(+el.dataset.dec || 0); }); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: .4 }); els.forEach((el) => io.observe(el));
  })();
  (function textReveal() {
    $$('.tr').forEach((h) => {
      const parts = []; h.childNodes.forEach((n) => { if (n.nodeType === 3) n.textContent.split(/(\s+)/).forEach((w) => parts.push(w)); else parts.push(n.outerHTML); });
      let i = 0; h.innerHTML = parts.map((w) => (/^\s+$/.test(w) || !w ? w : /^</.test(w) ? w : `<span class="tw" style="--i:${i++}">${w}</span>`)).join('');
    });
    if (!('IntersectionObserver' in window) || reduced) { $$('.tr').forEach((h) => h.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .3 }); $$('.tr').forEach((h) => io.observe(h));
    setTimeout(() => $$('.tr:not(.in)').forEach((h) => { if (h.getBoundingClientRect().top < innerHeight) h.classList.add('in'); }), 1500);
  })();

  // ---------------------------------------------------------------- reveal on scroll
  $$('.grid3 .feat').forEach((el, i) => el.style.setProperty('--i', i));
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }) : null;
  $$('.reveal').forEach((el) => io ? io.observe(el) : el.classList.add('in'));
  const sweep = () => { const left = $$('.reveal:not(.in)'); left.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight * 1.05) el.classList.add('in'); }); if (!left.length) removeEventListener('scroll', sweep); };
  addEventListener('scroll', sweep, { passive: true }); addEventListener('load', sweep); setTimeout(sweep, 1200);

  // ---------------------------------------------------------------- feature spotlight + frame tilt
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    $$('.feat').forEach((f) => f.addEventListener('pointermove', (e) => { const r = f.getBoundingClientRect(); f.style.setProperty('--mx', `${e.clientX - r.left}px`); f.style.setProperty('--my', `${e.clientY - r.top}px`); }, { passive: true }));
    const tilt = $('#tilt'), bez = tilt && tilt.querySelector('.bezel');
    if (bez) {
      tilt.addEventListener('pointermove', (e) => { if (!bez.classList.contains('in')) return; const r = tilt.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; bez.style.transform = `rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`; }, { passive: true });
      tilt.addEventListener('pointerleave', () => { bez.style.transform = ''; });
    }
  }

  // ---------------------------------------------------------------- code tabs
  const tabs = $('#code-tabs');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', tabs).forEach((x) => x.classList.toggle('on', x === b));
    $$('.code').forEach((p) => { p.hidden = p.id !== `code-${b.dataset.tab}`; if (!p.hidden) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; } });
  });
  $('#copy-code').addEventListener('click', () => copy($$('.code').find((p) => !p.hidden).textContent.trim()));

  // ---------------------------------------------------------------- product story: scroll-driven tutorial
  // Four steps on the left; the framed session on the right plays the matching state. Scrolling is
  // the timeline — nothing auto-advances — so the reader controls the pace and can go back.
  const S = {
    steps: $$('#story-steps .ss'), guard: $('#f-guard'), amount: $('#f-amount'), btn: $('#f-btn'), notice: $('#f-notice'),
    agent: $('#f-agent'), ai: $('#f-ai'), passkey: $('#f-passkey'), pointer: $('#f-pointer'), log: $('#f-log'),
    kv: ['#f-name', '#f-iban', '#f-phone'].map((s) => $(s)), frame: $('#frame'), body: $('#frame .frame-body'),
  };
  const LOGS = [
    'balance.read → allow · actor=human_like · HUMAN_KINEMATICS',
    'seal · indicators=[overlay_marker, injected_global] · 0.3 s after attach',
    'balance.read → mask · report.export → block · actor=agent · sticky',
    'reclaim → webauthn ok · actor=human · 5 min window',
  ];
  let step = -1, timers = [];
  const wait = (ms) => new Promise((r) => timers.push(setTimeout(r, ms)));
  const cancelRun = () => { timers.forEach(clearTimeout); timers = []; };
  // the pointer's path is drawn on a canvas over the frame: a curve for the hand, a dashed straight jump for the driver
  const ftrail = document.createElement('canvas'); ftrail.className = 'f-trail'; S.body.appendChild(ftrail);
  const fctx = ftrail.getContext('2d');
  function trailSize() { const r = S.body.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); if (ftrail.width !== Math.round(r.width * d)) { ftrail.width = Math.round(r.width * d); ftrail.height = Math.round(r.height * d); } fctx.setTransform(d, 0, 0, d, 0, 0); }
  function clearTrail() { trailSize(); fctx.clearRect(0, 0, ftrail.width, ftrail.height); }
  function drawHandPath(a, b, ms) {
    trailSize(); const pts = []; const n = 48;
    for (let i = 0; i <= n; i++) { const u = i / n, e = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5; pts.push({ x: a.x + (b.x - a.x) * e + Math.sin(u * Math.PI) * 26, y: a.y + (b.y - a.y) * e - Math.sin(u * Math.PI) * 18 + (Math.random() - .5) * 1.6 }); }
    const t0 = performance.now(); let k = 1;
    const tick = () => { const u = Math.min(1, (performance.now() - t0) / ms); const upto = Math.max(1, Math.round(u * n)); fctx.lineCap = 'round'; for (; k <= upto; k++) { fctx.strokeStyle = 'rgba(124,240,192,.8)'; fctx.lineWidth = 2; fctx.beginPath(); fctx.moveTo(pts[k - 1].x, pts[k - 1].y); fctx.lineTo(pts[k].x, pts[k].y); fctx.stroke(); } if (u < 1 && step === 0) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function drawJump(a, b) {
    trailSize(); fctx.setLineDash([4, 6]); fctx.strokeStyle = 'rgba(255,184,107,.75)'; fctx.lineWidth = 1.5; fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(b.x, b.y); fctx.stroke(); fctx.setLineDash([]);
    fctx.fillStyle = 'rgba(255,184,107,.9)'; fctx.beginPath(); fctx.arc(b.x, b.y, 3, 0, Math.PI * 2); fctx.fill();
  }
  function movePointer(x, y, agent = false) { S.pointer.classList.toggle('agent', agent); S.pointer.classList.add('show'); S.pointer.style.transition = agent ? 'left 0s,top 0s,opacity .3s' : 'left .9s cubic-bezier(.3,.9,.4,1),top .9s cubic-bezier(.5,.4,.4,1),opacity .3s'; S.pointer.style.left = x + 'px'; S.pointer.style.top = y + 'px'; }
  function targetOf(el) { const fb = S.body.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - fb.left + r.width * (0.35 + Math.random() * 0.3), y: r.top - fb.top + r.height * (0.4 + Math.random() * 0.2) }; }
  function seal(on) { S.amount.classList.toggle('sealed', on); S.kv.forEach((b) => b.classList.toggle('sealed', on)); }
  function notice(text, cls) { S.notice.textContent = text; S.notice.className = 'f-notice show ' + (cls || ''); }
  let logTimer = 0;
  function typeLog(text) {
    clearInterval(logTimer); if (reduced) { S.log.textContent = text; return; }
    let k = 0; S.log.textContent = '';
    logTimer = setInterval(() => { k = Math.min(text.length, k + 2); S.log.textContent = text.slice(0, k); if (k >= text.length) clearInterval(logTimer); }, 14);
  }
  function aiSay(text, thinkMs = 700) { S.ai.classList.add('typing'); S.ai.textContent = ''; return wait(thinkMs).then(() => { S.ai.classList.remove('typing'); S.ai.textContent = text; }); }
  function setStep(i) {
    if (i === step) return;
    cancelRun(); step = i;
    S.steps.forEach((el, k) => el.classList.toggle('on', k === i));
    typeLog(LOGS[i]);
    window.NTMorph && window.NTMorph.setState(i === 1 || i === 2 ? 1 : 0);
    run(i);
  }
  async function run(i) {
    clearTrail();
    if (i === 0) {
      S.guard.className = 'f-guard'; S.guard.lastElementChild.textContent = 'Session protected'; S.agent.classList.remove('in'); S.passkey.classList.remove('in');
      seal(false); S.amount.textContent = '$4,939.10'; S.notice.className = 'f-notice'; S.btn.textContent = 'Show balance';
      const p = targetOf(S.btn), a = { x: p.x - 220, y: p.y + 90 }; movePointer(a.x, a.y); await wait(150); movePointer(p.x, p.y); drawHandPath(a, p, 900); await wait(1000);
      S.btn.classList.add('pressed'); await wait(140); S.btn.classList.remove('pressed'); notice('Verified: human click · hand-shaped path, 118 ms press', 'ok');
    } else if (i === 1) {
      S.pointer.classList.remove('show'); S.passkey.classList.remove('in'); seal(false); S.amount.textContent = '$4,939.10'; S.notice.className = 'f-notice';
      await wait(300); S.agent.classList.add('in'); S.ai.classList.add('typing'); S.ai.textContent = '';
      await wait(700); S.guard.className = 'f-guard agent'; S.guard.lastElementChild.textContent = 'AI agent attached — screen sealed'; seal(true);
      await wait(400); await aiSay('I can see the account, but the balance field shows •••• .', 600);
    } else if (i === 2) {
      S.agent.classList.add('in'); S.guard.className = 'f-guard agent'; S.guard.lastElementChild.textContent = 'AI agent attached — screen sealed'; S.passkey.classList.remove('in');
      const p = targetOf(S.btn), a = { x: 30, y: 24 }; movePointer(p.x, p.y, true); drawJump(a, p); await wait(500); S.btn.classList.add('pressed'); await wait(60); S.btn.classList.remove('pressed');
      await wait(300); S.amount.textContent = '$•,•••.••'; S.amount.classList.remove('sealed'); notice('Masked for AI agents by policy · balance.read → mask', 'warn');
      await wait(1400); await aiSay('Trying “Download statement”…', 500); const q = targetOf(S.btn.nextElementSibling); movePointer(q.x, q.y, true); drawJump(p, q); await wait(600);
      S.guard.className = 'f-guard block'; S.guard.lastElementChild.textContent = 'Export blocked for agents'; notice('report.export → block · confirm with a passkey to continue', 'bad');
      await wait(500); await aiSay('The download is blocked for assistants — you’ll need to confirm it yourself.', 600);
    } else {
      S.pointer.classList.remove('show'); S.agent.classList.remove('in'); S.passkey.classList.add('in'); await wait(1800); S.passkey.classList.remove('in');
      S.guard.className = 'f-guard'; S.guard.lastElementChild.textContent = 'You’re back · 5:00';
      seal(false); S.amount.textContent = '$4,939.10'; notice('Presence verified with a passkey · session reclaimed', 'ok');
    }
  }
  if ('IntersectionObserver' in window && innerWidth > 980) {
    const sio = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) setStep(+e.target.dataset.step); }); }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    S.steps.forEach((el) => sio.observe(el));
    setTimeout(() => { if (step < 0) setStep(0); }, 800);
  } else {
    // narrow screens: the steps are cards; tap one to play it, otherwise play through slowly
    S.steps.forEach((el) => el.addEventListener('click', () => setStep(+el.dataset.step)));
    if ('IntersectionObserver' in window) { const fio = new IntersectionObserver((es) => { if (es[0].isIntersecting) { setStep(0); fio.disconnect(); } }, { threshold: .3 }); fio.observe(S.frame); } else setStep(0);
  }

  // ---------------------------------------------------------------- 3D point cloud (WebGL): a fingerprint that becomes a lattice when the agent is in
  (function morph() {
    const cv = $('#morph'); if (!cv || reduced) return;
    const gl = cv.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' }); if (!gl) return;
    const N = 2744; // 14³ — the lattice; the fingerprint uses the same count so every point has a home in both shapes
    const A = new Float32Array(N * 3), B = new Float32Array(N * 3);
    // A: a fingerprint in 3D — nine oval ridges, staggered breaks, a gentle dome in z
    let i = 0;
    const perRing = Math.floor(N / 9);
    for (let k = 0; k < 9; k++) {
      const rx = 0.08 + 0.1 * k, ry = 0.1 + 0.115 * k, open = k >= 5;
      for (let j = 0; j < perRing; j++) {
        const u = j / perRing, a0 = open ? (-200 + 220 * u) : (-180 + 360 * u), a = a0 * Math.PI / 180;
        const gap = Math.sin(a * 3 + k * 1.7) > 0.93;                            // ridge breaks
        const r = gap ? 0 : 1;
        A[i * 3] = rx * Math.cos(a) * r; A[i * 3 + 1] = ry * Math.sin(a) * r * 0.9; A[i * 3 + 2] = (0.25 - (rx * rx + ry * ry) * 0.18) * r; i++;
      }
    }
    for (; i < N; i++) { A[i * 3] = 0; A[i * 3 + 1] = 0; A[i * 3 + 2] = 0.26; }
    // B: a cubic lattice — the shape of a program
    i = 0; for (let x = 0; x < 14; x++) for (let y = 0; y < 14; y++) for (let z = 0; z < 14; z++) { B[i * 3] = (x / 13 - .5) * 1.2; B[i * 3 + 1] = (y / 13 - .5) * 1.2; B[i * 3 + 2] = (z / 13 - .5) * 1.2; i++; }
    const VS = `attribute vec3 a;attribute vec3 b;uniform float m;uniform float t;uniform vec2 R;uniform float dpr;varying float vz;varying float vm;
      void main(){float mm=smoothstep(0.,1.,m);vec3 p=mix(a,b,mm);
        float cy=cos(t*.25),sy=sin(t*.25);p=vec3(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
        float cx=cos(.35),sx=sin(.35);p=vec3(p.x,p.y*cx-p.z*sx,p.y*sx+p.z*cx);
        float d=2.6+p.z;vec2 s=p.xy/d*vec2(R.y/R.x,1.)*2.4;gl_Position=vec4(s,0.,1.);
        gl_PointSize=(3.6-p.z*1.6)*dpr*(1.-mm*.2);vz=p.z;vm=mm;}`;
    const FS = `precision mediump float;varying float vz;varying float vm;
      void main(){vec2 c=gl_PointCoord-.5;float d=dot(c,c);if(d>.25)discard;float e=smoothstep(.25,.05,d);
        vec3 mint=vec3(.486,.941,.753),amber=vec3(1.,.72,.42);vec3 col=mix(mint,amber,vm);
        float depth=clamp(.6+vz*.7,.35,1.);gl_FragColor=vec4(col*depth*e,e*depth);}`;
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS); if (!vs || !fs) return;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = (data, name) => { const bo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); };
    buf(A, 'a'); buf(B, 'b');
    const uM = gl.getUniformLocation(prog, 'm'), uT = gl.getUniformLocation(prog, 't'), uR = gl.getUniformLocation(prog, 'R'), uD = gl.getUniformLocation(prog, 'dpr');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let target = 0, m = 0, live = false, t0 = performance.now();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => { const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); } };
    addEventListener('resize', size, { passive: true });
    function frame(now) {
      if (!live || document.visibilityState !== 'visible') return;
      size(); m += (target - m) * .045;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uM, m); gl.uniform1f(uT, (now - t0) / 1000); gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uD, dpr);
      gl.drawArrays(gl.POINTS, 0, N); requestAnimationFrame(frame);
    }
    window.NTMorph = { setState: (v) => { target = v; } };
    const mio = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { live = es[0].isIntersecting; if (live) requestAnimationFrame(frame); }, { threshold: 0 }) : null;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && live) requestAnimationFrame(frame); });
    if (mio) mio.observe(cv); else { live = true; requestAnimationFrame(frame); }
  })();

  // ---------------------------------------------------------------- demo apps
  let apps = [];
  try { apps = (await (await fetch('/api/v1/apps', { cache: 'no-store' })).json()).apps; } catch {}
  const RULE_LABEL = { mask: 'mask', block: 'block', step_up: 'step-up', allow: 'allow' };
  $('#apps').innerHTML = apps.map((a) => {
    const rules = (a.rules || []).slice(0, 4).map((r) => `<span class="${esc(r.onAgent)}">${esc(r.resource)} · ${esc(RULE_LABEL[r.onAgent] || r.onAgent)}</span>`).join('');
    return `<div class="app reveal">
      <div class="glyph">${esc(a.initials)}</div>
      <h3>${esc(a.name)}</h3>
      <p>${esc(a.tagline)}</p>
      <div class="rules">${rules}</div>
      <div class="row"><a class="btn primary" href="/${esc(a.id)}">Open as yourself</a><button class="btn" data-prompt="${esc(a.id)}">Copy agent prompt</button></div>
    </div>`;
  }).join('') || '<div class="app"><p>Demo apps are offline right now.</p></div>';
  $$('.apps .app.reveal').forEach((el, i) => { el.style.transitionDelay = `${i * 70}ms`; if (io) io.observe(el); else el.classList.add('in'); });
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
