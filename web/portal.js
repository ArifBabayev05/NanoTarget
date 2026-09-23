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
  // ---------------------------------------------------------------- theme
  const applyTheme = (t) => { document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; $$('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t)); };
  let theme = 'system'; try { theme = localStorage.getItem('nt-theme') || 'system'; } catch {}
  applyTheme(theme);
  $$('#theme button').forEach((b) => b.addEventListener('click', () => { theme = b.dataset.themeSet; try { localStorage.setItem('nt-theme', theme); } catch {} applyTheme(theme); if (currentView() === 'activity') loadStats(); }));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (theme === 'system') { applyTheme('system'); if (currentView() === 'activity') loadStats(); } });
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  let toastT; const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); };
  // Every confirmation and every rename happens in the portal's own dialog: the browser's prompt()
  // and confirm() look like a different product and cannot be styled or typed into by a screen reader
  // in the same way. Resolves to the typed value, true, or null when the person backs out.
  function ask({ title, body = '', hint = '', label = '', value = '', ok = 'Confirm', danger = false }) {
    const el = $('#ask');
    $('#ask-title').textContent = title;
    $('#ask-body').textContent = body; $('#ask-body').hidden = !body;
    $('#ask-hint').textContent = hint; $('#ask-hint').hidden = !hint;
    $('#ask-label').hidden = !label; $('#ask-label-text').textContent = label; $('#ask-input').value = value;
    const btn = $('#ask-ok'); btn.textContent = ok; btn.classList.toggle('danger', danger);
    el.hidden = false;
    setTimeout(() => (label ? $('#ask-input') : btn).focus(), 50);
    return new Promise((resolve) => {
      const done = (v) => { el.hidden = true; btn.onclick = null; $('#ask-cancel').onclick = null; el.onclick = null; removeEventListener('keydown', key); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && label) { e.preventDefault(); accept(); } };
      const accept = () => { const v = label ? $('#ask-input').value.trim() : true; done(label && !v ? null : v); };
      btn.onclick = accept;
      $('#ask-cancel').onclick = () => done(null);
      el.onclick = (e) => { if (e.target === el) done(null); };
      addEventListener('keydown', key);
    });
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const el = $(b.dataset.copy); if (!el) return;
    try { await navigator.clipboard.writeText(el.textContent); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400); } catch { toast('Select the text and copy'); }
  });
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
    if (view === 'keys') { renderKeyTable(); if (!overview) loadOverview().then(renderKeyTable).catch(() => {}); }
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
    if (currentView() !== 'overview') return;   // keys view only needs the totals
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
  let pastedKeyId = null, showRevoked = false;
  function renderKeyTable() {
    const q = ($('#key-search').value || '').trim().toLowerCase();
    const totals = overview?.totals || [];
    const rows = (me.keys || []).filter((k) => showRevoked || !k.revoked)
      .filter((k) => (pastedKeyId ? k.id === pastedKeyId : !q || k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q)));
    const now = Date.now();
    $('#key-rows').innerHTML = rows.length ? rows.map((k) => {
      const t = totals.find((x) => x.key === k.id) || { n: 0, sessions: 0, agentSessions: 0, gated: 0 };
      const pct = t.sessions ? Math.round(t.agentSessions / t.sessions * 100) : 0;
      const expired = k.expires && k.expires < now;
      const status = k.revoked ? '<span class="mode warn">revoked</span>'
        : expired ? '<span class="mode warn">expired</span>'
        : k.events ? '<span class="mode observe">reporting</span>' : '<span class="mode">no data yet</span>';
      return `<tr data-id="${esc(k.id)}"${k.revoked ? ' class="gone"' : ''}>
        <td><span class="kname">${esc(k.name)}</span><span class="kpre">${esc(k.prefix)}…</span></td>
        <td><span class="badge env">${esc(k.env || 'production')}</span></td>
        <td>${status}</td>
        <td class="muted">${k.expires ? (expired ? 'expired ' + ago(k.expires) : day(k.expires)) : 'never'}</td>
        <td class="muted">${ago(k.lastSeen)}</td>
        <td>${k.events.toLocaleString()}</td>
        <td><div class="prog"><div class="lbl"><span class="muted">${t.agentSessions} of ${t.sessions} sessions</span><b>${pct}%</b></div><div class="track"><i style="width:${pct}%"></i></div></div></td>
        <td style="text-align:right"><button class="dots" data-menu="${esc(k.id)}" aria-label="Key actions">⋮</button></td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty-cell">${q ? 'No keys match.' : 'No keys yet — create one to start receiving decisions.'}</td></tr>`;
    const dead = (me.keys || []).filter((k) => k.revoked).length;
    $('#key-count').innerHTML = `${rows.length} key${rows.length === 1 ? '' : 's'}${pastedKeyId ? ' · matched the key you pasted' : ''}`
      + (dead ? ` · <button class="linky${showRevoked ? ' on' : ''}" id="toggle-revoked">${showRevoked ? 'hiding' : 'show'} ${dead} revoked</button>` : '');
    const t = $('#toggle-revoked');
    if (t) t.onclick = () => { showRevoked = !showRevoked; renderKeyTable(); };
  }
  // typing a name filters; pasting a whole key asks the server which key it is (the raw key is hashed there)
  let lookupT;
  $('#key-search').addEventListener('input', () => {
    const v = $('#key-search').value.trim();
    pastedKeyId = null;
    clearTimeout(lookupT);
    if (/^nt_(live|admin)_[a-f0-9]{40}$/.test(v)) {
      lookupT = setTimeout(async () => {
        try { const d = await api('/api/v1/portal/keys/lookup', { method: 'POST', body: JSON.stringify({ key: v }) }); pastedKeyId = d.id; toast(d.id ? `That key is "${keyName(d.id)}"` : 'That key does not belong to this account'); }
        catch (e) { toast(e.message); }
        renderKeyTable();
      }, 200);
    }
    renderKeyTable();
  });
  // row menu
  const menu = $('#row-menu'); let menuKey = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (b) {
      menuKey = b.dataset.menu;
      // a revoked key can only be restored to the list or removed for good; a live one has the rest
      const dead = !!(me.keys || []).find((x) => x.id === menuKey)?.revoked;
      $$('#row-menu [data-act]').forEach((x) => { x.hidden = ['delete'].includes(x.dataset.act) ? !dead : dead; });
      const r = b.getBoundingClientRect(); menu.hidden = false;
      menu.style.left = `${Math.min(innerWidth - 190, r.right - 180)}px`; menu.style.top = `${r.bottom + 6}px`;
      e.stopPropagation(); return;
    }
    if (!e.target.closest('#row-menu')) menu.hidden = true;
  });
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return; menu.hidden = true;
    const k = (me.keys || []).find((x) => x.id === menuKey); if (!k) return;
    if (act === 'activity') { keyId = k.id; location.hash = 'activity'; }
    if (act === 'setup') { setupKeyId = k.id; location.hash = 'integrate'; }
    if (act === 'copy') { try { await navigator.clipboard.writeText(k.prefix); toast('Prefix copied'); } catch {} }
    if (act === 'rename') {
      const name = await ask({ title: 'Rename key', label: 'Name', value: k.name, ok: 'Rename' }); if (!name) return;
      try { await api('/api/v1/portal/keys/rename', { method: 'POST', body: JSON.stringify({ id: k.id, name }) }); await refreshKeys(); toast('Renamed'); } catch (e) { toast(e.message); }
    }
    if (act === 'rotate') {
      const yes = await ask({
        title: `Rotate "${k.name}"?`, ok: 'Rotate', danger: true,
        body: 'A new secret is issued for this same key. Its name, environment and history stay; the old secret stops working the moment you confirm.',
        hint: 'Deploy the new secret to your servers right after — anything still holding the old one stops reporting.',
      });
      if (!yes) return;
      try {
        const d = await api('/api/v1/portal/keys/rotate', { method: 'POST', body: JSON.stringify({ id: k.id }) });
        $('#rotated-title').textContent = k.name; $('#rotated-raw').textContent = d.key; $('#rotated').hidden = false;
        await refreshKeys();
      } catch (e) { toast(e.message); }
    }
    if (act === 'revoke') {
      const yes = await ask({ title: `Revoke "${k.name}"?`, ok: 'Revoke', danger: true, body: 'Servers using this key stop reporting immediately. The decisions it already reported stay in Activity.' });
      if (!yes) return;
      try { await api('/api/v1/portal/keys/revoke', { method: 'POST', body: JSON.stringify({ id: k.id }) }); toast('Key revoked'); } catch (e) { return toast(e.message); }
      if (keyId === k.id) keyId = liveKeys()[0]?.id || null;
      await refreshKeys();
    }
    if (act === 'delete') {
      const typed = await ask({
        title: `Delete "${k.name}" for good?`, ok: 'Delete', danger: true, label: `Type the key's name to confirm`,
        body: 'The key and every decision it reported are removed. This cannot be undone.',
      });
      if (typed !== k.name) return void (typed && toast('The name did not match — nothing was deleted'));
      try { await api('/api/v1/portal/keys/delete', { method: 'POST', body: JSON.stringify({ id: k.id }) }); toast('Key deleted'); await refreshKeys(); await loadOverview().catch(() => {}); renderKeyTable(); } catch (e) { toast(e.message); }
    }
  });
  $('#rotated-done').onclick = () => { $('#rotated').hidden = true; };
  $('#rotated').addEventListener('click', (e) => { if (e.target === $('#rotated')) $('#rotated').hidden = true; });
  /** the key list changed on the server: pull it back and repaint everything that shows it */
  async function refreshKeys() { me = await api('/api/v1/portal/me'); renderKeyTable(); renderWorkspace(); }
  function openModal() { $('#modal').hidden = false; $('#modal-new').hidden = false; $('#modal-show').hidden = true; $('#key-name').value = ''; $('#modal-title').textContent = 'New API key'; setTimeout(() => $('#key-name').focus(), 50); }
  const closeModal = () => { $('#modal').hidden = true; };
  $('#key-add').onclick = openModal; $('#modal-close').onclick = closeModal;
  $('#modal-done').onclick = async () => { closeModal(); me = await api('/api/v1/portal/me'); renderWorkspace(); show(currentView()); };
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
  $('#key-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#key-create').click(); });
  let freshKey = null;                                   // the raw key stays in memory only while this page is open
  $('#key-create').onclick = async () => {
    const b = $('#key-create'); b.disabled = true;
    try {
      const d = await api('/api/v1/portal/keys', { method: 'POST', body: JSON.stringify({ name: $('#key-name').value || 'Default', env: $('#key-env').value, expiresInDays: Number($('#key-exp').value) }) });
      keyId = d.id; setupKeyId = d.id; freshKey = { id: d.id, raw: d.key };
      $('#key-raw').textContent = d.key; $('#modal-title').textContent = d.name; $('#modal-new').hidden = true; $('#modal-show').hidden = false;
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
  $('#key-setup').onclick = async () => { closeModal(); me = await api('/api/v1/portal/me'); renderWorkspace(); location.hash = 'integrate'; if (currentView() === 'integrate') renderIntegration(); };

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
    const cFg3 = cssVar('--fg3') || '#6b6b74', cBar = cssVar('--bar') || 'rgba(161,161,170,.28)', cAgent = cssVar('--accent2') || '#ffb86b', cGated = cssVar('--accent') || '#7cf0c0', cGrid = cssVar('--track') || 'rgba(255,255,255,.06)';
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily; ctx.fillStyle = cFg3; ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) { const y = padT + (H - padT - padB) * (1 - i / 3); ctx.fillText(String(Math.round(max * i / 3)), padL - 6, y + 4); ctx.strokeStyle = cGrid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke(); }
    ctx.textAlign = 'center';
    buckets.forEach((b, i) => {
      const x = padL + i * w + 2, bw = Math.max(2, w - 4), hN = (H - padT - padB) * b.n / max, hA = (H - padT - padB) * b.agent / max, hG = (H - padT - padB) * b.gated / max, base = H - padB;
      ctx.fillStyle = cBar; ctx.fillRect(x, base - hN, bw, hN);
      ctx.fillStyle = cAgent; ctx.globalAlpha = .75; ctx.fillRect(x, base - hA, bw, hA); ctx.globalAlpha = 1;
      ctx.fillStyle = cGated; ctx.fillRect(x, base - hG, Math.max(2, bw * .35), hG);
      if (buckets.length <= 31 && (buckets.length <= 12 || i % Math.ceil(buckets.length / 8) === 0)) { ctx.fillStyle = cFg3; ctx.fillText(fmtDay(b.t), x + bw / 2, H - 6); }
    });
  }
  let lastRecent = [], older = [], live = true;
  const logRow = (e) => `<div class="e"><span class="t">${fmtT(e.at)}</span><span class="s">${esc(e.session.slice(0, 8))}</span><span class="r" title="${esc(e.resource)}">${esc(e.resource)}</span><span class="chip ${esc(e.decision)}">${esc(e.decision)}</span><span class="st"><span class="chip ${esc(e.actor)}">${esc(ACTOR_WORD[e.actor] || e.actor)}</span>${e.tools.length ? ` <span class="chip">${esc(e.tools[0])}</span>` : ''}</span><span class="reasons" title="${esc(e.reasons.join(', '))}">${esc(STATE_WORD[e.state] || e.state)} · ${esc(e.reasons.slice(0, 3).join(' · '))}</span></div>`;
  function filterLog(q) {
    const s = (q || '').toLowerCase();
    // the newest page comes from stats; anything the reader asked for beyond it is appended below
    const seen = new Set(), all = [];
    for (const e of [...lastRecent, ...older]) { const k = `${e.at}|${e.session}|${e.resource}|${e.decision}`; if (!seen.has(k)) { seen.add(k); all.push(e); } }
    const rows = all.filter((e) => !s || [e.resource, e.decision, e.actor, e.state, ...e.tools, ...e.reasons].join(' ').toLowerCase().includes(s));
    $('#log').innerHTML = rows.length ? rows.map(logRow).join('') : '<div class="empty-row">No decisions yet.</div>';
    $('#log-more').parentElement.hidden = !rows.length;
  }
  $('#live-toggle').onclick = () => {
    live = !live;
    $('#live-toggle').classList.toggle('on', live);
    $('#live-toggle').textContent = live ? 'live' : 'paused';
    if (live) loadStats(); else clearTimeout(timer);
  };
  $('#log-more').onclick = async () => {
    const b = $('#log-more'); b.disabled = true; b.textContent = 'Loading…';
    try {
      const oldest = [...lastRecent, ...older].reduce((m, e) => (e.id && (!m || e.id < m) ? e.id : m), null);
      const d = await api(`/api/v1/portal/events?key=${encodeURIComponent(keyId)}&range=${range}&limit=100${oldest ? `&before=${oldest}` : ''}`);
      older = older.concat(d.events);
      filterLog($('#search').value);
      b.hidden = !d.more;
      if (!d.events.length) toast('That is the whole range');
    } catch (e) { toast(e.message); } finally { b.disabled = false; b.textContent = 'Load older'; }
  };
  // the export walks the range server-side, so it is the log the reader sees, not just the visible page
  $('#export-csv').onclick = async () => {
    if (!keyId) return;
    const btn = $('#export-csv'); btn.disabled = true; btn.textContent = 'exporting…';
    try {
      const rows = []; let before = null;
      for (let page = 0; page < 40; page++) {
        const d = await api(`/api/v1/portal/events?key=${encodeURIComponent(keyId)}&range=${range}&limit=500${before ? `&before=${before}` : ''}`);
        rows.push(...d.events);
        if (!d.more || !d.events.length) break;
        before = d.events[d.events.length - 1].id;
      }
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['time,session,resource,decision,actor,state,tools,reasons,enforcement']
        .concat(rows.map((e) => [new Date(e.at).toISOString(), e.session, e.resource, e.decision, e.actor, e.state, e.tools.join(' '), e.reasons.join(' '), e.enforcement].map(cell).join(',')))
        .join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `nanotarget-${keyName(keyId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${range}.csv`;
      a.click(); URL.revokeObjectURL(url);
      toast(`${rows.length.toLocaleString()} decision${rows.length === 1 ? '' : 's'} exported`);
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'export CSV'; }
  };
  let logScope = '';
  async function loadStats() {
    clearTimeout(timer);
    // a different key or range is a different log: drop the pages the reader had loaded for the old one
    const scope = `${keyId}|${range}`;
    if (scope !== logScope) { logScope = scope; older = []; $('#log-more').hidden = false; }
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
    if (live) timer = setTimeout(loadStats, 10000);
  }
  addEventListener('resize', () => { if (currentView() === 'activity' && !$('#stats').hidden) loadStats(); });

  // ------------------------------------------------------------------ integration + settings
  // ------------------------------------------------------------------ setup wizard
  let setupKeyId = null, fw = 'express', waitTimer = 0;
  const FRAMEWORKS = {
    express: (key) => `<span class="c">// server.js</span>\n<span class="k">import</span> { nanotarget } <span class="k">from</span> <span class="s">'nanotarget/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> nanotarget({\n  secret: process.env.NT_SECRET,\n  policy: <span class="s">'./nanotarget.policy.json'</span>,\n  apiKey: process.env.NT_API_KEY,\n  identify: (req) =&gt; req.session?.userId ?? <span class="k">null</span>,\n});\napp.use(nt.middleware());\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), (req, res) =&gt;\n  nt.send(req, res, balance, (b) =&gt; ({ ...b, amount: <span class="k">null</span> })));`,
    next: (key) => `<span class="c">// server.mjs — Next.js custom server</span>\n<span class="k">import</span> next <span class="k">from</span> <span class="s">'next'</span>;\n<span class="k">import</span> express <span class="k">from</span> <span class="s">'express'</span>;\n<span class="k">import</span> { nanotarget } <span class="k">from</span> <span class="s">'nanotarget/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> nanotarget({ secret: process.env.NT_SECRET, policy: <span class="s">'./nanotarget.policy.json'</span>, apiKey: process.env.NT_API_KEY });\n<span class="k">const</span> app = express();\napp.use(nt.middleware());                       <span class="c">// before next()</span>\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), handler);\napp.all(<span class="s">'*'</span>, (req, res) =&gt; nextHandle(req, res));`,
    fastify: (key) => `<span class="c">// server.js — Fastify uses the raw request/response</span>\n<span class="k">const</span> nt = <span class="k">await</span> nanotarget({ secret: process.env.NT_SECRET, policy: <span class="s">'./nanotarget.policy.json'</span>, apiKey: process.env.NT_API_KEY });\n\nfastify.addHook(<span class="s">'onRequest'</span>, (req, reply, done) =&gt; nt.middleware()(req.raw, reply.raw, done));\nfastify.get(<span class="s">'/api/balance'</span>, { onRequest: (req, reply, done) =&gt; nt.protect(<span class="s">'balance.read'</span>)(req.raw, reply.raw, done) },\n  (req, reply) =&gt; nt.send(req.raw, reply.raw, balance, mask));`,
    docker: (key) => `<span class="c"># docker-compose.yml</span>\nservices:\n  api:\n    environment:\n      NT_SECRET: <span class="s">\"\${NT_SECRET}\"</span>\n      NT_API_KEY: <span class="s">\"${esc(key)}\"</span>\n\n<span class="c"># or plain docker</span>\ndocker run -e NT_API_KEY=${esc(key)} -e NT_SECRET=$NT_SECRET my-api`,
  };
  const agentPrompt = (key, admin) => `https://www.npmjs.com/package/nanotarget — install this into my app.\n\nFollow the README protocol: scan the app as if you were an AI browser agent holding a customer's\nlogged-in session, show me the exposure map and what you propose to gate, ask me the nine decisions,\nthen implement the server wiring, the page tags, the policy file and every mask function, verify with\n\`npx nanotarget verify\`, and report what you left open.\n\nReport telemetry to my NanoTarget portal: set apiKey: process.env.NT_API_KEY${key ? ` (${key})` : ''}.\n${admin ? `\nYou can administer my account yourself with the management API:\n  curl -H "Authorization: Bearer ${admin}" ${location.origin}/api/v1/manage/me\nGET /api/v1/manage/keys · POST /api/v1/manage/keys {name, expiresInDays, env} · DELETE /api/v1/manage/keys/:id\nGET /api/v1/manage/overview?range=7d · GET /api/v1/manage/stats?key=:id&range=7d` : ''}`;
  function renderIntegration() {
    const keys = liveKeys();
    if (!keys.length) { $('#setup-key').innerHTML = '<option>no keys yet</option>'; }
    else {
      if (!setupKeyId || !keys.some((k) => k.id === setupKeyId)) setupKeyId = keys[0].id;
      $('#setup-key').innerHTML = keys.map((k) => `<option value="${esc(k.id)}" ${k.id === setupKeyId ? 'selected' : ''}>${esc(k.name)} · ${esc(k.prefix)}…</option>`).join('');
    }
    const k = keys.find((x) => x.id === setupKeyId);
    const shown = freshKey && freshKey.id === setupKeyId ? freshKey.raw : `${k ? k.prefix : 'nt_live_'}…`;
    $('#cmd-env').textContent = `NT_API_KEY=${shown}\nNT_SECRET=$(npx nanotarget secret)`;
    $('#cmd-code').innerHTML = (FRAMEWORKS[fw] || FRAMEWORKS.express)(shown);
    $('#int-prompt').textContent = agentPrompt(freshKey && freshKey.id === setupKeyId ? freshKey.raw : (k ? `${k.prefix}…` : ''), null);
    $$('#fw-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.fw === fw));
    // step 4 watches for the first decision from this key
    clearTimeout(waitTimer);
    const check = async () => {
      if (currentView() !== 'integrate') return;
      try { me = await api('/api/v1/portal/me'); } catch { return; }
      const cur = (me.keys || []).find((x) => x.id === setupKeyId);
      const w = $('#wait');
      if (cur && cur.events) {
        w.className = 'waiting ok'; $('#wait-text').innerHTML = `${cur.events.toLocaleString()} decision${cur.events === 1 ? '' : 's'} received — <a href="#activity" style="text-decoration:underline">open Activity</a>`;
        $$('.setup .step').forEach((st) => st.classList.add('done'));
      } else {
        w.className = 'waiting'; $('#wait-text').textContent = 'Waiting for the first decision from this key…';
        waitTimer = setTimeout(check, 5000);
      }
    };
    check();
  }
  $('#setup-key').addEventListener('change', (e) => { setupKeyId = e.target.value; renderIntegration(); });
  $$('#fw-tabs button').forEach((b) => b.addEventListener('click', () => { fw = b.dataset.fw; renderIntegration(); }));

  // ------------------------------------------------------------------ settings + management keys
  let adminKeys = [], freshAdmin = null;
  async function renderSettings() {
    $('#set-email').textContent = me.account.email; $('#set-since').textContent = day(me.account.created);
    $('#set-keys').textContent = `${liveKeys().length} active · ${(me.keys || []).length - liveKeys().length} revoked`;
    try { adminKeys = (await api('/api/v1/portal/admin-keys')).keys.filter((k) => !k.revoked); } catch { adminKeys = []; }
    $('#admin-rows').innerHTML = adminKeys.length ? adminKeys.map((k) => `<div class="admin-row"><div><b>${esc(k.name)}</b><div class="meta">${esc(k.prefix)}… · created ${day(k.created)} · ${k.calls.toLocaleString()} call${k.calls === 1 ? '' : 's'} · last used ${ago(k.lastSeen)}</div></div><button class="btn ghost" data-admin-revoke="${esc(k.id)}">Revoke</button></div>`).join('')
      : '<p class="fine" style="margin:0">No management keys yet. Create one to let an agent or a CI job manage this account.</p>';
    $$('[data-admin-revoke]').forEach((b) => b.addEventListener('click', async () => {
      const name = adminKeys.find((x) => x.id === b.dataset.adminRevoke)?.name || 'this key';
      if (!await ask({ title: `Revoke "${name}"?`, ok: 'Revoke', danger: true, body: 'Anything using this management key — an agent, a CI job — stops working immediately.' })) return;
      await api('/api/v1/portal/admin-keys/revoke', { method: 'POST', body: JSON.stringify({ id: b.dataset.adminRevoke }) });
      toast('Management key revoked'); renderSettings();
    }));
    $('#endpoints').innerHTML = [
      ['GET', '/api/v1/manage/me', 'whose account this key administers'],
      ['GET', '/api/v1/manage/keys', 'list project keys'],
      ['POST', '/api/v1/manage/keys', '{name, expiresInDays, env} → the raw key, once'],
      ['POST', '/api/v1/manage/keys/:id/rotate', 'new secret for the same key'],
      ['DELETE', '/api/v1/manage/keys/:id', 'revoke one'],
      ['GET', '/api/v1/manage/overview?range=7d', 'usage across every key'],
      ['GET', '/api/v1/manage/stats?key=:id', 'one key in depth'],
      ['GET', '/api/v1/manage/events?key=:id', 'the decision log, paged'],
    ].map(([m, p, d]) => `<div><span>${m}</span> ${esc(p)} <span style="color:var(--fg3)">— ${esc(d)}</span></div>`).join('');
  }
  $('#admin-add').onclick = () => { $('#admin-modal').hidden = false; $('#admin-new').hidden = false; $('#admin-show').hidden = true; $('#admin-name').value = ''; setTimeout(() => $('#admin-name').focus(), 50); };
  $('#admin-cancel').onclick = () => { $('#admin-modal').hidden = true; };
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('#pw-save'), msg = $('#pw-msg');
    b.disabled = true; msg.className = 'fine'; msg.textContent = '';
    try {
      await api('/api/v1/portal/account/password', { method: 'POST', body: JSON.stringify({ current: $('#pw-current').value, next: $('#pw-next').value }) });
      $('#pw-form').reset(); msg.className = 'fine ok'; msg.textContent = 'Password changed.'; toast('Password changed');
    } catch (err) { msg.className = 'fine bad'; msg.textContent = err.message; } finally { b.disabled = false; }
  });

  $('#admin-done').onclick = () => { $('#admin-modal').hidden = true; renderSettings(); };
  $('#admin-modal').addEventListener('click', (e) => { if (e.target === $('#admin-modal')) $('#admin-modal').hidden = true; });
  $('#admin-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#admin-create').click(); });
  $('#admin-create').onclick = async () => {
    const b = $('#admin-create'); b.disabled = true;
    try {
      const d = await api('/api/v1/portal/admin-keys', { method: 'POST', body: JSON.stringify({ name: $('#admin-name').value || 'Management key' }) });
      freshAdmin = d.key; $('#admin-raw').textContent = d.key; $('#admin-title').textContent = d.name; $('#admin-new').hidden = true; $('#admin-show').hidden = false;
      $('#admin-prompt-copy').onclick = async () => { try { await navigator.clipboard.writeText(agentPrompt(liveKeys()[0]?.prefix ? `${liveKeys()[0].prefix}…` : '', freshAdmin)); toast('Agent prompt copied'); } catch { toast('Could not copy'); } };
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
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
