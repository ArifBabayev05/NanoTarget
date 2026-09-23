/* NanoTarget portal: workspace with Overview, API Keys, Activity, Integration, Settings. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || d.error || String(r.status)), { status: r.status });
    return d;
  };
  let toastT; const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); };
  const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, (Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; };
  const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const PALETTE = ['#7cf0c0', '#8ab4ff', '#ffb86b', '#ff7b7b', '#d7a6ff', '#f2f2f3'];
  const colorOf = (i) => PALETTE[i % PALETTE.length];

  // ------------------------------------------------------------------ auth
  let mode = 'signup';
  const setMode = (m) => {
    mode = m;
    $('#auth-title').textContent = m === 'signup' ? 'Create your account' : 'Sign in';
    $('#auth-submit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    $('#switch-text').textContent = m === 'signup' ? 'Already have an account?' : 'New here?';
    $('#switch').textContent = m === 'signup' ? 'Sign in' : 'Create an account';
    $('#password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('#auth-err').textContent = '';
  };
  $('#switch').addEventListener('click', (e) => { e.preventDefault(); setMode(mode === 'signup' ? 'login' : 'signup'); });
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = $('#auth-submit'); b.disabled = true; $('#auth-err').textContent = '';
    try { await api(`/api/v1/portal/${mode}`, { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) }); await boot(); }
    catch (err) { $('#auth-err').textContent = err.message; } finally { b.disabled = false; }
  });
  $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/v1/portal/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.hash = ''; location.reload(); });

  // ------------------------------------------------------------------ state + routing
  let me = null, keyId = null, range = '7d', ovRange = '7d', timer = 0, overview = null;
  const liveKeys = () => (me?.keys || []).filter((k) => !k.revoked);
  const keyName = (id) => (me?.keys || []).find((k) => k.id === id)?.name || 'key';
  function show(view) {
    $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
    $$('.side-nav a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
    $('#search-wrap').hidden = view !== 'keys' && view !== 'activity';
    clearTimeout(timer);
    if (view === 'overview') loadOverview();
    if (view === 'keys') renderKeyTable();
    if (view === 'activity') { renderKeyChips(); loadStats(); }
    if (view === 'integrate') renderIntegration();
    if (view === 'settings') renderSettings();
  }
  const currentView = () => (location.hash.replace('#', '') || 'overview');
  addEventListener('hashchange', () => { if (me) show(currentView()); });
  $$('#range-ov button').forEach((b) => b.addEventListener('click', () => { ovRange = b.dataset.r; $$('#range-ov button').forEach((x) => x.classList.toggle('on', x === b)); loadOverview(); }));
  $$('#range button').forEach((b) => b.addEventListener('click', () => { range = b.dataset.r; $$('#range button').forEach((x) => x.classList.toggle('on', x === b)); loadStats(); }));
  $('#banner-x').onclick = () => { $('#banner').hidden = true; try { localStorage.setItem('nt-portal-banner', '1'); } catch {} };
  try { if (localStorage.getItem('nt-portal-banner')) $('#banner').hidden = true; } catch {}
  $('#search').addEventListener('input', () => { const v = currentView(); if (v === 'keys') { $('#key-search').value = $('#search').value; renderKeyTable(); } if (v === 'activity') filterLog($('#search').value); });
  addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ($('#search-wrap').hidden ? $('#key-search') : $('#search')).focus(); } });

  // ------------------------------------------------------------------ overview
  function miniBars(el, buckets, pick, cls) {
    const max = Math.max(1, ...buckets.map(pick));
    el.innerHTML = buckets.map((b) => { const v = pick(b); return `<i class="${v ? cls : 'dim'}" style="height:${Math.max(2, Math.round(v / max * 96))}px" title="${new Date(b.t).toLocaleString()} · ${v}"></i>`; }).join('');
  }
  function legend(el, rows, fmt) {
    el.innerHTML = rows.length ? rows.map((r, i) => `<li><span><i style="background:${colorOf(i)}"></i>${esc(r.name)}</span><b>${fmt(r)}</b></li>`).join('') : '<li><span class="fine">no decisions in this range</span></li>';
  }
  async function loadOverview() {
    try { overview = await api(`/api/v1/portal/overview?range=${ovRange}`); } catch (e) { toast(e.message); return; }
    const { series, totals, range: rg, now } = overview;
    const buckets = []; for (let t = Math.floor(rg.since / rg.bucketMs) * rg.bucketMs; t <= now; t += rg.bucketMs) buckets.push({ t, n: 0, agent: 0, gated: 0 });
    for (const s of series) { const b = buckets.find((x) => x.t === s.t); if (b) { b.n += s.n; b.agent += s.agent; b.gated += s.gated; } }
    const totN = totals.reduce((a, b) => a + b.n, 0), totS = totals.reduce((a, b) => a + b.sessions, 0), totA = totals.reduce((a, b) => a + b.agentSessions, 0), totG = totals.reduce((a, b) => a + b.gated, 0);
    $('#u-decisions').textContent = totN.toLocaleString(); $('#u-agent').textContent = totS ? `${Math.round(totA / totS * 100)}%` : '0%'; $('#u-gated').textContent = totG.toLocaleString();
    miniBars($('#ub-decisions'), buckets, (b) => b.n, ''); miniBars($('#ub-agent'), buckets, (b) => b.agent, 'amber'); miniBars($('#ub-gated'), buckets, (b) => b.gated, '');
    const rows = totals.map((t) => ({ ...t, name: keyName(t.key) })).sort((a, b) => b.n - a.n);
    legend($('#ul-decisions'), rows, (r) => r.n.toLocaleString());
    legend($('#ul-agent'), rows, (r) => `${r.agentSessions} / ${r.sessions}`);
    legend($('#ul-gated'), rows, (r) => r.gated.toLocaleString());
  }

  // ------------------------------------------------------------------ keys
  function renderKeyTable() {
    const q = ($('#key-search').value || '').toLowerCase();
    const totals = overview?.totals || [];
    const rows = (me.keys || []).filter((k) => !k.revoked).filter((k) => !q || k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q));
    $('#key-rows').innerHTML = rows.length ? rows.map((k) => {
      const t = totals.find((x) => x.key === k.id) || { n: 0, sessions: 0, agentSessions: 0, gated: 0 };
      const pct = t.sessions ? Math.round(t.agentSessions / t.sessions * 100) : 0;
      return `<tr data-id="${esc(k.id)}">
        <td><span class="kname">${esc(k.name)}</span><span class="kpre">${esc(k.prefix)}…</span></td>
        <td><span class="mode ${k.events ? 'observe' : ''}">${k.events ? 'reporting' : 'no data yet'}</span></td>
        <td class="muted">${day(k.created)}</td>
        <td class="muted">${ago(k.lastSeen)}</td>
        <td>${k.events.toLocaleString()}</td>
        <td><div class="prog"><div class="lbl"><span class="muted">${t.agentSessions} of ${t.sessions} sessions</span><b>${pct}%</b></div><div class="track"><i style="width:${pct}%"></i></div></div></td>
        <td style="text-align:right"><button class="dots" data-menu="${esc(k.id)}" aria-label="Key actions">⋮</button></td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-cell">${q ? 'No keys match.' : 'No keys yet — create one to start receiving decisions.'}</td></tr>`;
    $('#key-count').textContent = `${rows.length} key${rows.length === 1 ? '' : 's'}`;
  }
  $('#key-search').addEventListener('input', renderKeyTable);
  // row menu
  const menu = $('#row-menu'); let menuKey = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (b) { menuKey = b.dataset.menu; const r = b.getBoundingClientRect(); menu.hidden = false; menu.style.left = `${Math.min(innerWidth - 190, r.right - 180)}px`; menu.style.top = `${r.bottom + 6}px`; e.stopPropagation(); return; }
    if (!e.target.closest('#row-menu')) menu.hidden = true;
  });
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return; menu.hidden = true;
    const k = (me.keys || []).find((x) => x.id === menuKey); if (!k) return;
    if (act === 'activity') { keyId = k.id; location.hash = 'activity'; }
    if (act === 'copy') { try { await navigator.clipboard.writeText(k.prefix); toast('Prefix copied'); } catch {} }
    if (act === 'revoke') {
      if (!confirm(`Revoke "${k.name}"? Servers using it stop reporting immediately.`)) return;
      await api('/api/v1/portal/keys/revoke', { method: 'POST', body: JSON.stringify({ id: k.id }) }); toast('Key revoked');
      me = await api('/api/v1/portal/me'); if (keyId === k.id) keyId = liveKeys()[0]?.id || null; renderKeyTable(); renderWorkspace();
    }
  });
  function openModal() { $('#modal').hidden = false; $('#modal-new').hidden = false; $('#modal-show').hidden = true; $('#key-name').value = ''; $('#modal-title').textContent = 'New API key'; setTimeout(() => $('#key-name').focus(), 50); }
  const closeModal = () => { $('#modal').hidden = true; };
  $('#key-add').onclick = openModal; $('#modal-close').onclick = closeModal;
  $('#modal-done').onclick = async () => { closeModal(); me = await api('/api/v1/portal/me'); renderWorkspace(); show(currentView()); };
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
  $('#key-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#key-create').click(); });
  $('#key-create').onclick = async () => {
    const b = $('#key-create'); b.disabled = true;
    try {
      const d = await api('/api/v1/portal/keys', { method: 'POST', body: JSON.stringify({ name: $('#key-name').value || 'Default' }) });
      keyId = d.id; $('#key-raw').textContent = d.key; $('#modal-title').textContent = d.name; $('#modal-new').hidden = true; $('#modal-show').hidden = false;
      $('#key-copy').onclick = async () => { try { await navigator.clipboard.writeText(d.key); toast('Key copied'); } catch { toast('Select and copy the key'); } };
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  };

  // ------------------------------------------------------------------ activity (per key)
  function renderKeyChips() {
    const keys = liveKeys(); if (!keyId || !keys.some((k) => k.id === keyId)) keyId = keys[0]?.id || null;
    $('#keys').innerHTML = keys.map((k) => `<button class="key ${k.id === keyId ? 'on' : ''} ${k.lastSeen ? 'live' : ''}" data-key="${esc(k.id)}"><i class="dot"></i>${esc(k.name)}<span class="pre">${esc(k.prefix)}…</span></button>`).join('');
    $$('[data-key]').forEach((b) => b.addEventListener('click', () => { keyId = b.dataset.key; renderKeyChips(); loadStats(); }));
  }
  const fmtT = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const fmtDay = (t) => { const d = new Date(t); return range === '24h' ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getDate()}/${d.getMonth() + 1}`; };
  const STATE_WORD = { signed_agent: 'signed agent', agent_attached: 'agent attached', agent_environment: 'agent environment', no_indication: 'no indication' };
  const ACTOR_WORD = { human_like: 'human', agent_likely: 'agent', unknown: 'unknown' };
  const bars = (el, obj, order, cls) => {
    const total = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
    const keys = order.filter((k) => obj[k]).concat(Object.keys(obj).filter((k) => !order.includes(k)));
    el.innerHTML = keys.length ? keys.map((k) => `<div class="bar ${cls ? cls : esc(k)}"><span>${esc(cls === 'tool' ? k : (ACTOR_WORD[k] || k.replace('_', ' ')))}</span><span class="track"><i style="width:${Math.round(obj[k] / total * 100)}%"></i></span><span class="n">${obj[k]}</span></div>`).join('') : '<div class="fine">nothing yet</div>';
  };
  function codeSnippet(prefix) {
    const key = prefix ? `${prefix}…` : 'nt_live_…';
    return `<span class="c">// server.js</span>\n<span class="k">import</span> { nanotarget } <span class="k">from</span> <span class="s">'nanotarget/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> nanotarget({\n  secret: process.env.NT_SECRET,\n  policy: <span class="s">'./nanotarget.policy.json'</span>,\n  apiKey: process.env.NT_API_KEY,        <span class="c">// ${esc(key)} — from this portal</span>\n});\napp.use(nt.middleware());\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), (req, res) =&gt; nt.send(req, res, balance, maskBalance));`;
  }
  function drawChart(series, since, bucketMs, now) {
    const cv = $('#chart'); const dpr = Math.min(2, devicePixelRatio || 1); const W = cv.clientWidth || 600, H = 220;
    cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const buckets = []; for (let t = Math.floor(since / bucketMs) * bucketMs; t <= now; t += bucketMs) buckets.push({ t, n: 0, agent: 0, gated: 0 });
    for (const s of series) { const b = buckets.find((x) => x.t === s.t); if (b) Object.assign(b, s); }
    const max = Math.max(1, ...buckets.map((b) => b.n)); const padL = 30, padB = 22, padT = 8; const w = (W - padL - 8) / buckets.length;
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily; ctx.fillStyle = '#6b6b74'; ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) { const y = padT + (H - padT - padB) * (1 - i / 3); ctx.fillText(String(Math.round(max * i / 3)), padL - 6, y + 4); ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke(); }
    ctx.textAlign = 'center';
    buckets.forEach((b, i) => {
      const x = padL + i * w + 2, bw = Math.max(2, w - 4), hN = (H - padT - padB) * b.n / max, hA = (H - padT - padB) * b.agent / max, hG = (H - padT - padB) * b.gated / max, base = H - padB;
      ctx.fillStyle = 'rgba(161,161,170,.28)'; ctx.fillRect(x, base - hN, bw, hN);
      ctx.fillStyle = 'rgba(255,184,107,.7)'; ctx.fillRect(x, base - hA, bw, hA);
      ctx.fillStyle = 'rgba(124,240,192,.9)'; ctx.fillRect(x, base - hG, Math.max(2, bw * .35), hG);
      if (buckets.length <= 31 && (buckets.length <= 12 || i % Math.ceil(buckets.length / 8) === 0)) { ctx.fillStyle = '#6b6b74'; ctx.fillText(fmtDay(b.t), x + bw / 2, H - 6); }
    });
  }
  let lastRecent = [];
  function filterLog(q) {
    const s = (q || '').toLowerCase();
    const rows = lastRecent.filter((e) => !s || [e.resource, e.decision, e.actor, e.state, ...e.tools, ...e.reasons].join(' ').toLowerCase().includes(s));
    $('#log').innerHTML = rows.length ? rows.map((e) => `<div class="e"><span class="t">${fmtT(e.at)}</span><span class="s">${esc(e.session.slice(0, 8))}</span><span class="r" title="${esc(e.resource)}">${esc(e.resource)}</span><span class="chip ${esc(e.decision)}">${esc(e.decision)}</span><span class="st"><span class="chip ${esc(e.actor)}">${esc(ACTOR_WORD[e.actor] || e.actor)}</span>${e.tools.length ? ` <span class="chip">${esc(e.tools[0])}</span>` : ''}</span><span class="reasons" title="${esc(e.reasons.join(', '))}">${esc(STATE_WORD[e.state] || e.state)} · ${esc(e.reasons.slice(0, 3).join(' · '))}</span></div>`).join('') : '<div class="empty-row">No decisions yet.</div>';
  }
  async function loadStats() {
    clearTimeout(timer);
    if (!keyId) { $('#empty').hidden = false; $('#stats').hidden = true; $('#empty h2').textContent = 'Create your first API key'; $('#empty p').textContent = 'Each key is one project. Put it into your server as apiKey and every decision shows up here.'; $('#snippet').innerHTML = codeSnippet(''); $('#curl-hint').textContent = 'npx nanotarget verify http://localhost:3000 /api/balance'; return; }
    let d; try { d = await api(`/api/v1/portal/stats?key=${encodeURIComponent(keyId)}&range=${range}`); } catch (e) { toast(e.message); return; }
    const total = Object.values(d.decisions).reduce((a, b) => a + b, 0);
    const k = (me.keys || []).find((z) => z.id === keyId) || {};
    if (!total && !k.events) {
      $('#snippet').innerHTML = codeSnippet(k.prefix); $('#curl-hint').textContent = 'npx nanotarget verify http://localhost:3000 /api/balance';
      $('#empty h2').textContent = 'Waiting for the first decision'; $('#empty p').textContent = 'Put this key into your server and make one request to a protected endpoint. The panel updates on its own.';
      $('#empty').hidden = false; $('#stats').hidden = true;
    } else {
      $('#empty').hidden = true; $('#stats').hidden = false;
      const pct = d.sessions.total ? Math.round(d.sessions.agent / d.sessions.total * 100) : 0;
      $('#pct').textContent = `${pct}%`; $('#sessions').textContent = d.sessions.total; $('#agent-sessions').textContent = d.sessions.agent; $('#decisions').textContent = total;
      $('#gated').textContent = (d.decisions.mask || 0) + (d.decisions.block || 0) + (d.decisions.step_up || 0);
      bars($('#bars-decisions'), d.decisions, ['allow', 'mask', 'step_up', 'block']);
      bars($('#bars-actors'), d.actors, ['human_like', 'agent_likely', 'unknown']);
      bars($('#bars-tools'), Object.fromEntries(d.tools.map((t) => [t.tool, t.sessions])), [], 'tool');
      const byRes = {}; for (const r of d.resources) { (byRes[r.resource] ||= {})[r.decision] = r.n; }
      $('#resources').innerHTML = Object.entries(byRes).slice(0, 12).map(([r, dec]) => `<div class="row"><span class="r" title="${esc(r)}">${esc(r)}</span><span class="chips">${Object.entries(dec).map(([dd, n]) => `<span class="chip ${esc(dd)}">${esc(dd)} ${n}</span>`).join('')}</span></div>`).join('') || '<div class="fine">nothing yet</div>';
      drawChart(d.series, d.range.since, d.range.bucketMs, d.now);
      lastRecent = d.recent; filterLog($('#search').value);
    }
    timer = setTimeout(loadStats, 10000);
  }
  addEventListener('resize', () => { if (currentView() === 'activity' && !$('#stats').hidden) loadStats(); });

  // ------------------------------------------------------------------ integration + settings
  function renderIntegration() { $('#int-code').innerHTML = codeSnippet(liveKeys()[0]?.prefix || ''); }
  function renderSettings() { $('#set-email').textContent = me.account.email; $('#set-since').textContent = day(me.account.created); $('#set-keys').textContent = `${liveKeys().length} active · ${(me.keys || []).length - liveKeys().length} revoked`; }
  function renderWorkspace() {
    const email = me.account.email; $('#who').textContent = email; $('#av').textContent = email[0].toUpperCase();
    $('#ws-name').textContent = email.split('@')[1] ? `${email.split('@')[1].split('.')[0]} workspace` : 'Workspace'; $('#ws-sub').textContent = `${liveKeys().length} key${liveKeys().length === 1 ? '' : 's'} · ${email}`;
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { me = await api('/api/v1/portal/me'); } catch { me = null; }
    if (!me) { $('#auth').hidden = false; $('#shell').hidden = true; $('#me-chip').hidden = true; $('#search-wrap').hidden = true; return; }
    $('#auth').hidden = true; $('#shell').hidden = false; $('#me-chip').hidden = false;
    renderWorkspace();
    if (!location.hash) location.hash = liveKeys().length ? 'overview' : 'keys';
    show(currentView());
  }
  boot();
})();
