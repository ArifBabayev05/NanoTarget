// SPDX-License-Identifier: BUSL-1.1
/* OneHuman portal: workspace with Overview, API Keys, Activity, Integration, Settings. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || d.error || String(r.status)), { status: r.status, data: d });
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
  function ask({ title, body = '', hint = '', label = '', value = '', ok = 'Confirm', danger = false, password = false, list = null }) {
    const el = $('#ask');
    $('#ask-title').textContent = title;
    $('#ask-body').textContent = body; $('#ask-body').hidden = !body;
    $('#ask-hint').textContent = hint; $('#ask-hint').hidden = !hint;
    $('#ask-label').hidden = !label; $('#ask-label-text').textContent = label; $('#ask-input').value = value;
    $('#ask-input').type = password ? 'password' : 'text'; $('#ask-input').maxLength = password ? 200 : 80; $('#ask-input').autocomplete = password ? 'current-password' : 'off';
    $('#ask-list').innerHTML = (list || []).map((x) => `<li>${esc(x)}</li>`).join(''); $('#ask-list').hidden = !(list && list.length);
    const btn = $('#ask-ok'); btn.textContent = ok; btn.classList.toggle('danger', danger);
    el.hidden = false;
    setTimeout(() => (label ? $('#ask-input') : btn).focus(), 50);
    return new Promise((resolve) => {
      const done = (v) => { el.hidden = true; $('#ask-input').value = ''; btn.onclick = null; $('#ask-cancel').onclick = null; el.onclick = null; removeEventListener('keydown', key); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && label) { e.preventDefault(); accept(); } };
      const accept = () => { const v = label ? (password ? $('#ask-input').value : $('#ask-input').value.trim()) : true; done(label && !v ? null : v); };
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
    if (view === 'weekly') renderWeekly();
    if (view === 'policy') renderPolicy();
  }
  const currentView = () => (location.hash.replace('#', '') || 'overview');
  addEventListener('hashchange', () => { if (me) show(currentView()); });
  $$('#range-ov button').forEach((b) => b.addEventListener('click', () => { ovRange = b.dataset.r; $('#usage-title').textContent = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' }[ovRange]; $$('#range-ov button').forEach((x) => x.classList.toggle('on', x === b)); loadOverview(); }));
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
      $$('#row-menu [data-act]').forEach((x) => { x.hidden = x.dataset.act === 'activity' ? false : x.dataset.act === 'delete' ? !dead : dead; });
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
    // open on the key that is actually reporting (most recent event), not on whichever was created first
    const chosenDead = (me?.keys || []).find((k) => k.id === keyId && k.revoked);
    const keys = chosenDead ? [...liveKeys(), chosenDead] : liveKeys(); if (!keyId || !keys.some((k) => k.id === keyId)) keyId = [...keys].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) || b.created - a.created)[0]?.id || null;
    $('#keys').innerHTML = keys.map((k) => `<button class="key ${k.id === keyId ? 'on' : ''} ${k.lastSeen ? 'live' : ''}" data-key="${esc(k.id)}"><i class="dot"></i>${esc(k.name)}<span class="pre">${esc(k.prefix)}…</span></button>`).join('');
    $$('[data-key]').forEach((b) => b.addEventListener('click', () => { keyId = b.dataset.key; renderKeyChips(); loadStats(); }));
  }
  const fmtT = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const fmtDay = (t) => { const d = new Date(t); return range === '24h' ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getDate()}/${d.getMonth() + 1}`; };
  const STATE_WORD = { signed_agent: 'signed agent', agent_attached: 'agent attached', agent_environment: 'agent environment', no_indication: 'no indication' };
  const ACTOR_WORD = { human_like: 'a person', agent_likely: 'an AI agent', unknown: 'could not tell', allow: 'let through', mask: 'details hidden', block: 'turned away', step_up: 'asked for a passkey' };
  const bars = (el, obj, order, cls) => {
    const total = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
    const keys = order.filter((k) => obj[k]).concat(Object.keys(obj).filter((k) => !order.includes(k)));
    el.innerHTML = keys.length ? keys.map((k) => `<div class="bar ${cls ? cls : esc(k)}"><span>${esc(cls === 'tool' ? k : (ACTOR_WORD[k] || k.replace('_', ' ')))}</span><span class="track"><i style="width:${Math.round(obj[k] / total * 100)}%"></i></span><span class="n">${obj[k]}</span></div>`).join('') : '<div class="fine">nothing yet</div>';
  };
  function codeSnippet(prefix) {
    const key = prefix ? `${prefix}…` : 'nt_live_…';
    return `<span class="c">// server.js</span>\n<span class="k">import</span> { onehuman } <span class="k">from</span> <span class="s">'onehuman/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> onehuman({\n  secret: process.env.ONEHUMAN_SECRET,\n  policy: <span class="s">'./onehuman.policy.json'</span>,\n  apiKey: process.env.ONEHUMAN_API_KEY,        <span class="c">// ${esc(key)} — from this portal</span>\n});\napp.use(nt.middleware());\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), (req, res) =&gt; nt.send(req, res, balance, maskBalance));`;
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
  // A decision the portal verified at ingest carries a seal; clicking it downloads that session's proofs.
  const seal = (e) => e.signed === true
    ? `<button class="seal ok" data-proof-session="${esc(e.session)}" title="Signed and verified — download this session's proofs">✓</button>`
    : e.signed === false ? '<span class="seal bad" title="A proof came with this decision but did not verify">!</span>' : '<span class="seal none" title="Unsigned (reported by an older middleware)">·</span>';
  // The customer grades a decision in place. This is the only ground truth the product gets from the field.
  const grade = (e) => `<span class="grade" data-grade-id="${e.id}"><button class="${e.feedback === 'correct' ? 'on' : ''}" data-v="correct" title="This decision was right">✓</button><button class="${e.feedback === 'wrong' ? 'on bad' : ''}" data-v="wrong" title="This was wrong — a person stopped, or an agent let through">✗</button></span>`;
  const logRow = (e) => `<div class="e${e.feedback === 'wrong' ? ' wrong' : ''}"><span class="t">${seal(e)}${fmtT(e.at)}</span><span class="s">${esc(e.session.slice(0, 8))}</span><span class="r" title="${esc(e.resource)}">${esc(e.resource)}</span><span class="chip ${esc(e.decision)}">${esc(e.decision)}</span><span class="st"><span class="chip ${esc(e.actor)}">${esc(ACTOR_WORD[e.actor] || e.actor)}</span>${e.tools.length ? ` <span class="chip">${esc(e.tools[0])}</span>` : ''}</span><span class="reasons" title="${esc(e.reasons.join(', '))}">${esc(STATE_WORD[e.state] || e.state)} · ${esc(e.reasons.slice(0, 3).join(' · '))}</span>${grade(e)}</div>`;
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
  // Proof bundles are built server-side from the proofs that verified at ingest; the file is self-contained.
  async function downloadProofs(session) {
    if (!keyId) return;
    const q = `key=${encodeURIComponent(keyId)}&range=${session ? '30d' : range}${session ? `&session=${encodeURIComponent(session)}` : ''}`;
    try {
      const r = await fetch(`/api/v1/portal/proofs?${q}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || String(r.status));
      const blob = await r.blob();
      const n = JSON.parse(await blob.text()).decisions ?? 0;
      if (!n) { toast(session ? 'No signed decisions for this session' : 'No signed decisions in this range yet'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `onehuman-proofs-${keyName(keyId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}${session ? '-' + session.slice(0, 8) : '-' + range}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`${n.toLocaleString()} signed decision${n === 1 ? '' : 's'} exported`);
    } catch (e) { toast(e.message); }
  }
  $('#export-proofs').onclick = () => downloadProofs(null);
  $('#log').addEventListener('click', (e) => { const b = e.target.closest('[data-proof-session]'); if (b) downloadProofs(b.dataset.proofSession); });
  $('#log').addEventListener('click', async (e) => {
    const b = e.target.closest('.grade button'); if (!b) return;
    const id = Number(b.parentElement.dataset.gradeId), v = b.dataset.v;
    const row = [...lastRecent, ...older].find((x) => x.id === id); if (!row) return;
    const verdict = row.feedback === v ? null : v;                       // clicking the same thumb again clears it
    try {
      await api('/api/v1/portal/feedback', { method: 'POST', body: JSON.stringify({ key: keyId, id, verdict }) });
      row.feedback = verdict; filterLog($('#search').value);
      toast(verdict === 'wrong' ? 'Marked wrong — thank you, this trains the model' : verdict === 'correct' ? 'Marked correct' : 'Grade cleared');
      loadStats();
    } catch (err) { toast(err.message); }
  });

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
      a.href = url; a.download = `onehuman-${keyName(keyId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${range}.csv`;
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
    if (!keyId) { $('#empty').hidden = false; $('#stats').hidden = true; $('#empty h2').textContent = 'Create your first API key'; $('#empty p').textContent = 'Each key is one project. Put it into your server as apiKey and every decision shows up here.'; $('#snippet').innerHTML = codeSnippet(''); $('#curl-hint').textContent = 'npx onehuman verify http://localhost:3000 /api/balance'; return; }
    let d; try { d = await api(`/api/v1/portal/stats?key=${encodeURIComponent(keyId)}&range=${range}`); } catch (e) { toast(e.message); return; }
    const total = Object.values(d.decisions).reduce((a, b) => a + b, 0);
    const k = (me.keys || []).find((z) => z.id === keyId) || {};
    if (!total && !k.events) {
      $('#snippet').innerHTML = codeSnippet(k.prefix); $('#curl-hint').textContent = 'npx onehuman verify http://localhost:3000 /api/balance';
      $('#empty h2').textContent = 'Waiting for your app to connect'; $('#empty p').textContent = 'Once your developer adds this key to your app, the first visit shows up here by itself.';
      $('#empty').hidden = false; $('#stats').hidden = true;
    } else {
      $('#empty').hidden = true; $('#stats').hidden = false;
      const pct = d.sessions.total ? Math.round(d.sessions.agent / d.sessions.total * 100) : 0;
      $('#pct').textContent = `${pct}%`; $('#sessions').textContent = d.sessions.total; $('#agent-sessions').textContent = d.sessions.agent; $('#decisions').textContent = total;
      $('#gated').textContent = (d.decisions.mask || 0) + (d.decisions.block || 0) + (d.decisions.step_up || 0);
      const fb = d.feedback || { reviewed: 0, falseStops: 0, gated: 0 };
      $('#false-stops').textContent = fb.reviewed ? `${fb.falseStops}` : '–';
      $('#false-stops').title = fb.reviewed ? `${fb.reviewed} decision${fb.reviewed === 1 ? '' : 's'} graded · ${fb.falseStops} false stop${fb.falseStops === 1 ? '' : 's'} of ${fb.gated} gated · ${fb.misses} agent${fb.misses === 1 ? '' : 's'} let through` : 'Grade decisions in the log to see this';
      bars($('#bars-decisions'), d.decisions, ['allow', 'mask', 'step_up', 'block']);
      bars($('#bars-actors'), d.actors, ['human_like', 'agent_likely', 'unknown']);
      bars($('#bars-tools'), Object.fromEntries(d.tools.map((t) => [t.tool, t.sessions])), [], 'tool');
      const byRes = {}; for (const r of d.resources) { (byRes[r.resource] ||= {})[r.decision] = r.n; }
      $('#resources').innerHTML = Object.entries(byRes).slice(0, 12).map(([r, dec]) => `<div class="row"><span class="r" title="${esc(r)}">${esc(r)}</span><span class="chips">${Object.entries(dec).map(([dd, n]) => `<span class="chip ${esc(dd)}">${esc(dd)} ${n}</span>`).join('')}</span></div>`).join('') || '<div class="fine">nothing yet</div>';
      drawChart(d.series, d.range.since, d.range.bucketMs, d.now);
      lastRecent = d.recent; filterLog($('#search').value);
      loadPeople(keyId, range);
    }
    if (live) timer = setTimeout(loadStats, 10000);
  }
  addEventListener('resize', () => { if (currentView() === 'activity' && !$('#stats').hidden) loadStats(); });

  // the people strip: people blocked (should stay 0), people asked to confirm, agents gated
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  async function loadPeople(key, r) {
    let h; try { h = await api(`/api/v1/portal/health?key=${encodeURIComponent(key)}&range=${r}`); } catch { return; }
    if (key !== keyId) return;
    const p = h.people;
    $('#people-stopped').textContent = fmt(p.stopped);
    $('#people-label').textContent = p.stopped === 1 ? 'person blocked' : 'people blocked';
    $('#people').classList.toggle('warn', p.stopped > 0);
    $('#people-stopped').title = p.stopped ? `${p.engineStopped} judged human but still gated by the policy · ${p.gradedWrong} gated decisions you marked wrong. Open the log and filter by human_like.` : 'No decision the engine called human was blocked or masked, and you marked no gated decision wrong.';
    $('#people-sessions').textContent = fmt(p.sessions);
    $('#people-asked').textContent = fmt(p.askedToConfirm);
    $('#people-agents').textContent = fmt(h.agents.gated);
  }

  // integration check: four lights from what the key reported, plus the self-test command
  let healthTimer = 0;
  async function loadChecks() {
    clearTimeout(healthTimer);
    if (currentView() !== 'integrate' || !setupKeyId) { $('#checks').innerHTML = '<div class="fine">Create a key first.</div>'; return; }
    const key = setupKeyId;
    let h; try { h = await api(`/api/v1/portal/health?key=${encodeURIComponent(key)}&range=7d`); } catch { return; }
    if (key !== setupKeyId) return;
    $('#checks').innerHTML = h.checks.map((c) => `<div class="check ${esc(c.status)}"><i class="dot" aria-label="${esc(c.status)}"></i><div><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></div></div>`).join('');
    const allOk = h.checks.every((c) => c.status === 'ok');
    $('#health-sub').textContent = allOk ? 'everything works' : 'from what this key reported in the last 7 days';
    healthTimer = setTimeout(loadChecks, h.events ? 20000 : 5000);
  }
  const selftest = () => {
    const base = ($('#st-base').value.trim() || 'https://app.yourcompany.com').replace(/\s+/g, '');
    const path = ($('#st-path').value.trim() || '/api/balance').replace(/\s+/g, '');
    $('#cmd-selftest').textContent = `npx onehuman verify ${base} ${path.startsWith('/') ? path : '/' + path}`;
    try { localStorage.setItem('nt-selftest', JSON.stringify({ base: $('#st-base').value, path: $('#st-path').value })); } catch {}
  };
  try { const saved = JSON.parse(localStorage.getItem('nt-selftest') || 'null'); if (saved) { $('#st-base').value = saved.base || ''; $('#st-path').value = saved.path || ''; } } catch {}
  $('#st-base').addEventListener('input', selftest); $('#st-path').addEventListener('input', selftest); selftest();

  // ------------------------------------------------------------------ integration + settings
  // ------------------------------------------------------------------ setup wizard
  let setupKeyId = null, fw = 'express', waitTimer = 0;
  const FRAMEWORKS = {
    express: (key) => `<span class="c">// server.js</span>\n<span class="k">import</span> { onehuman } <span class="k">from</span> <span class="s">'onehuman/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> onehuman({\n  secret: process.env.ONEHUMAN_SECRET,\n  policy: <span class="s">'./onehuman.policy.json'</span>,\n  apiKey: process.env.ONEHUMAN_API_KEY,\n  identify: (req) =&gt; req.session?.userId ?? <span class="k">null</span>,\n});\napp.use(nt.middleware());\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), (req, res) =&gt;\n  nt.send(req, res, balance, (b) =&gt; ({ ...b, amount: <span class="k">null</span> })));`,
    next: (key) => `<span class="c">// server.mjs — Next.js custom server</span>\n<span class="k">import</span> next <span class="k">from</span> <span class="s">'next'</span>;\n<span class="k">import</span> express <span class="k">from</span> <span class="s">'express'</span>;\n<span class="k">import</span> { onehuman } <span class="k">from</span> <span class="s">'onehuman/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> onehuman({ secret: process.env.ONEHUMAN_SECRET, policy: <span class="s">'./onehuman.policy.json'</span>, apiKey: process.env.ONEHUMAN_API_KEY });\n<span class="k">const</span> app = express();\napp.use(nt.middleware());                       <span class="c">// before next()</span>\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), handler);\napp.all(<span class="s">'*'</span>, (req, res) =&gt; nextHandle(req, res));`,
    fastify: (key) => `<span class="c">// server.js — Fastify uses the raw request/response</span>\n<span class="k">const</span> nt = <span class="k">await</span> onehuman({ secret: process.env.ONEHUMAN_SECRET, policy: <span class="s">'./onehuman.policy.json'</span>, apiKey: process.env.ONEHUMAN_API_KEY });\n\nfastify.addHook(<span class="s">'onRequest'</span>, (req, reply, done) =&gt; nt.middleware()(req.raw, reply.raw, done));\nfastify.get(<span class="s">'/api/balance'</span>, { onRequest: (req, reply, done) =&gt; nt.protect(<span class="s">'balance.read'</span>)(req.raw, reply.raw, done) },\n  (req, reply) =&gt; nt.send(req.raw, reply.raw, balance, mask));`,
    docker: (key) => `<span class="c"># docker-compose.yml</span>\nservices:\n  api:\n    environment:\n      ONEHUMAN_SECRET: <span class="s">\"\${ONEHUMAN_SECRET}\"</span>\n      ONEHUMAN_API_KEY: <span class="s">\"${esc(key)}\"</span>\n\n<span class="c"># or plain docker</span>\ndocker run -e ONEHUMAN_API_KEY=${esc(key)} -e ONEHUMAN_SECRET=$ONEHUMAN_SECRET my-api`,
  };
  const agentPrompt = (key, admin) => `https://www.npmjs.com/package/onehuman — install this into my app.\n\n\`npm i onehuman\` is the only install (its engine dependency comes with it). Follow the README protocol: scan the app as if you were an AI browser agent holding a customer's\nlogged-in session, show me the exposure map and what you propose to gate, ask me the nine decisions,\nthen implement the server wiring, the page tags, the policy file and every mask function, verify with\n\`npx onehuman verify\`, and report what you left open.\n\nReport telemetry to my OneHuman portal: set apiKey: process.env.ONEHUMAN_API_KEY${key ? ` (${key})` : ''}.\n${admin ? `\nYou can administer my account yourself with the management API:\n  curl -H "Authorization: Bearer ${admin}" ${location.origin}/api/v1/manage/me\nGET /api/v1/manage/keys · POST /api/v1/manage/keys {name, expiresInDays, env} · DELETE /api/v1/manage/keys/:id\nGET /api/v1/manage/overview?range=7d · GET /api/v1/manage/stats?key=:id&range=7d\nGET /api/v1/manage/policy?key=:id · POST /api/v1/manage/policy {key, policy}  (the key's policy lives in the portal; your server reads it from there)` : ''}`;
  function renderIntegration() {
    const keys = liveKeys();
    if (!keys.length) { $('#setup-key').innerHTML = '<option>no keys yet</option>'; }
    else {
      if (!setupKeyId || !keys.some((k) => k.id === setupKeyId)) setupKeyId = [...keys].sort((a, b) => b.created - a.created)[0].id;   // the key you just made
      $('#setup-key').innerHTML = keys.map((k) => `<option value="${esc(k.id)}" ${k.id === setupKeyId ? 'selected' : ''}>${esc(k.name)} · ${esc(k.prefix)}…</option>`).join('');
    }
    const k = keys.find((x) => x.id === setupKeyId);
    const shown = freshKey && freshKey.id === setupKeyId ? freshKey.raw : `${k ? k.prefix : 'nt_live_'}…`;
    $('#cmd-env').textContent = `ONEHUMAN_API_KEY=${shown}\nNT_SECRET=$(npx onehuman secret)`;
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
    loadChecks();
  }
  $('#setup-key').addEventListener('change', (e) => { setupKeyId = e.target.value; renderIntegration(); });
  $$('#fw-tabs button').forEach((b) => b.addEventListener('click', () => { fw = b.dataset.fw; renderIntegration(); }));

  // ------------------------------------------------------------------ weekly report
  const TOOL_NAMES = { 'claude-chrome': 'Claude in Chrome', 'codex-chrome': 'Codex, Chrome extension', 'claude-app': 'Claude app browser', 'codex-app': 'Codex app browser', 'claude-tools': 'Claude agent tools', 'browser-panel': 'Browser side panel agent', 'cdp-reader': 'Automation script', 'unknown-tool': 'Unknown agent tool', operator: 'Signed agent' };
  const toolName = (t) => TOOL_NAMES[t] || t;
  let weeklyKey = null;
  const keySelect = (sel, cur) => { const keys = liveKeys(); if (!keys.length) { sel.innerHTML = '<option>no keys yet</option>'; return null; } const id = cur && keys.some((k) => k.id === cur) ? cur : (keyId && keys.some((k) => k.id === keyId) ? keyId : keys[0].id); sel.innerHTML = keys.map((k) => `<option value="${esc(k.id)}" ${k.id === id ? 'selected' : ''}>${esc(k.name)} · ${esc(k.prefix)}…</option>`).join(''); return id; };
  const delta = (a, b, unit = '') => { if (!b && !a) return ''; if (!b) return '<em>new this week</em>'; const d = a - b; return `<em>${d === 0 ? 'same as' : d > 0 ? `+${fmt(d)}${unit} vs` : `${fmt(d)}${unit} vs`} last week</em>`; };
  async function renderWeekly() {
    weeklyKey = keySelect($('#weekly-key'), weeklyKey);
    if (!weeklyKey) { $('#weekly-body').innerHTML = '<div class="card"><p class="fine" style="margin:0">Create an API key and connect your server first.</p></div>'; return; }
    const key = weeklyKey;
    let w; try { w = await api(`/api/v1/portal/weekly?key=${encodeURIComponent(key)}`); } catch (e) { toast(e.message); return; }
    if (key !== weeklyKey) return;
    const c = w.week, p = w.previous;
    const pct = (x) => (x.sessions ? Math.round((x.agentSessions / x.sessions) * 100) : 0);
    const period = `${day(w.from)} to ${day(w.now)}`;
    const newSet = new Set(w.newAgents);
    const agents = c.tools.length ? `<div class="wk-chips">${c.tools.map((t) => `<span class="${newSet.has(t.tool) ? 'new' : ''}" title="${esc(t.tool)}">${esc(toolName(t.tool))} · ${fmt(t.sessions)} session${t.sessions === 1 ? '' : 's'}${newSet.has(t.tool) ? ' · new' : ''}</span>`).join('')}</div>` : '<p class="fine" style="margin:0">No named agent product was seen this week.</p>';
    const gone = w.goneAgents.length ? `<p class="fine">Not seen this week, seen last week: ${w.goneAgents.map((t) => esc(toolName(t))).join(', ')}.</p>` : '';
    const res = c.agentResources.length ? `<div class="res">${c.agentResources.map((r) => `<div class="row"><span class="r">${esc(r.resource)}</span><span class="chips"><span class="chip">${fmt(r.n)} attempt${r.n === 1 ? '' : 's'}</span><span class="chip block">${fmt(r.gated)} stopped</span></span></div>`).join('')}</div>` : '<p class="fine" style="margin:0">Agents did not reach any protected resource this week.</p>';
    const news = w.news.length ? `<div class="wk-news">${w.news.map((n) => `<article><h4>${esc(n.agent)}<small>${esc(n.date)}</small></h4><p>${esc(n.change)}</p><p>${esc(n.impact)}</p>${n.action ? `<p class="do">What to do: ${esc(n.action)}</p>` : ''}</article>`).join('')}</div>` : '<p class="fine" style="margin:0">No changes in the agents this month.</p>';
    const summary = !c.decisions ? 'No decisions were reported this week.'
      : `${fmt(c.sessions)} signed-in session${c.sessions === 1 ? '' : 's'}; ${pct(c)}% had an AI agent in them. ${c.agentGated ? `Agents were stopped or given masked data ${fmt(c.agentGated)} time${c.agentGated === 1 ? '' : 's'}.` : 'No agent was stopped.'} ${c.peopleStopped ? `${fmt(c.peopleStopped)} decision${c.peopleStopped === 1 ? '' : 's'} stopped a person: review them in Activity.` : 'No person was blocked.'}${w.newAgents.length ? ` New on your site: ${w.newAgents.map(toolName).join(', ')}.` : ''}`;
    $('#weekly-body').innerHTML = `
      <div class="card"><div class="card-head"><h3>${esc(keyName(key))} · ${esc(period)}</h3></div><p style="margin:0;line-height:1.6">${esc(summary)}</p></div>
      <div class="wk-kpis">
        <div class="wk-kpi"><b>${fmt(c.sessions)}</b><span>signed-in sessions</span>${delta(c.sessions, p.sessions)}</div>
        <div class="wk-kpi"><b>${pct(c)}%</b><span>had an AI agent in them</span>${p.sessions ? `<em>${pct(p)}% last week</em>` : ''}</div>
        <div class="wk-kpi"><b>${fmt(c.agentGated)}</b><span>times an agent was stopped or got masked data</span>${delta(c.agentGated, p.agentGated)}</div>
        <div class="wk-kpi good"><b>${fmt(c.peopleStopped)}</b><span>people blocked</span></div>
        <div class="wk-kpi"><b>${fmt(c.stepUps)}</b><span>passkey confirmations asked</span>${delta(c.stepUps, p.stepUps)}</div>
        <div class="wk-kpi"><b>${fmt(c.signed)}</b><span>decisions signed, ready for an auditor</span></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="card-head"><h3>Agents seen on your site</h3><span class="sub">new ones marked</span></div>${agents}${gone}</div>
        <div class="card"><div class="card-head"><h3>What agents reached for</h3></div>${res}</div>
      </div>
      <div class="card"><div class="card-head"><h3>What changed in the agents</h3><span class="sub">last 4 weeks · the same for every customer</span></div>${news}</div>`;
  }
  $('#weekly-key').addEventListener('change', (e) => { weeklyKey = e.target.value; renderWeekly(); });
  $('#weekly-print').onclick = () => { document.body.classList.add('print-weekly'); addEventListener('afterprint', () => document.body.classList.remove('print-weekly'), { once: true }); print(); };

  // ------------------------------------------------------------------ policy builder
  const PRESETS = {
    open: { label: 'Open to everyone', m: ['allow', 'allow', 'allow', 'allow'], what: 'AI agents and people see everything. For pages with nothing sensitive.' },
    mask: { label: 'AI agents see it with details hidden', m: ['mask', 'mask', 'allow', 'allow'], what: 'An AI agent gets the page, but sensitive details (amounts, numbers, names) are hidden. People see everything.' },
    block: { label: 'Refuse AI agents', m: ['block', 'mask', 'allow', 'allow'], what: 'An AI agent is turned away. A browser that has AI tools installed sees it with details hidden. People see everything.' },
    guard: { label: 'Refuse AI agents, passkey when unsure', m: ['block', 'step_up', 'step_up', 'allow'], what: 'An AI agent is turned away. When we cannot tell who it is, the person confirms with a passkey (fingerprint or face) and carries on. Good for downloads and exports.' },
    passkey: { label: 'Everyone confirms with a passkey', m: ['block', 'step_up', 'step_up', 'step_up'], what: 'Every person confirms with a passkey; AI agents are turned away. Only for the few most critical actions: payouts, changing contact details, bulk export.' },
    custom: { label: 'Custom', m: null, what: '' },
  };
  const RES_RE = /^[a-z][a-z0-9_.]{1,60}$/;
  const MODE_WORDS = { allow: 'sees everything', mask: 'sees it with details hidden', step_up: 'confirms with a passkey', block: 'is turned away' };
  const describeModes = (m) => `An AI agent ${MODE_WORDS[m[0]]}. A browser with AI tools ${MODE_WORDS[m[1]]}. When we cannot tell, the visitor ${MODE_WORDS[m[2]]}. A real person ${MODE_WORDS[m[3]]}.`;
  const presetOf = (r) => Object.entries(PRESETS).find(([, p]) => p.m && p.m.join() === [r.onAgent, r.onArtifact, r.onUnknown, r.onHumanLike].join())?.[0] || 'custom';
  const titleOf = (res) => res.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const guessPreset = (res) => /export|download|payout|transfer|delete|withdraw|contacts/.test(res) ? 'guard' : /balance|medical|pipeline/.test(res) ? 'block' : 'mask';
  let pol = null, policyKey = null, pv = null, savedCanon = '';
  const addedHere = new Set();
  const ORIGIN = { install: 'your app, when it first connected', server: "your developers' code", agent: 'an AI coding assistant', portal: 'here, in the portal' };
  const STATUS_WORD = { pending: 'waiting', rejected: 'declined', superseded: 'replaced by a newer change', settings: 'setting' };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const canon = (d) => JSON.stringify([d.enforcement, [...d.rules].map((r) => [r.resource, r.title || '', r.onAgent, r.onArtifact ?? 'allow', r.onUnknown, r.onHumanLike, [...(r.actOn || [])].sort().join(), r.minScore ?? 65]).sort()]);
  const fromDoc = (o) => ({ enforcement: o.enforcement === 'enforce' ? 'enforce' : 'observe', rules: o.rules.slice(0, 50).map((r) => { const x = { resource: String(r.resource || ''), title: String(r.title || ''), onAgent: r.onAgent, onArtifact: r.onArtifact ?? 'allow', onUnknown: r.onUnknown, onHumanLike: r.onHumanLike }; return { resource: x.resource, title: x.title, preset: presetOf(x), modes: [x.onAgent, x.onArtifact, x.onUnknown, x.onHumanLike], actOn: Array.isArray(r.actOn) ? r.actOn : undefined, minScore: typeof r.minScore === 'number' ? r.minScore : undefined }; }) });
  /** POST that may answer 403 {error:'confirm'}: ask for the password, showing what is risky, and send again. */
  async function withPassword(path, body) {
    const send = (extra) => api(path, { method: 'POST', body: JSON.stringify({ ...body, ...extra }) });
    try { return await send({}); } catch (e) {
      if (e.status !== 403 || e.data?.error !== 'confirm') throw e;
      for (;;) {
        const pw = await ask({ title: 'Please confirm this change', body: e.data.weakening?.length ? 'This change lowers protection or affects real people:' : e.message, list: e.data.weakening, label: 'Your password', password: true, ok: 'Confirm', danger: true, hint: 'We ask so that one careless edit, or someone using your open laptop, cannot switch protection off.' });
        if (!pw) return null;
        try { return await send({ password: pw }); } catch (e2) { if (e2.status !== 401) throw e2; toast('That password is not right'); }
      }
    }
  }
  async function renderPolicy(reload = false) {
    policyKey = keySelect($('#policy-key'), policyKey);
    pv = null;
    if (policyKey) { try { pv = await api(`/api/v1/portal/policy?key=${encodeURIComponent(policyKey)}`); } catch (e) { toast(e.message); } }
    if (!pol || reload) {
      addedHere.clear();
      if (pv?.policy) {
        pol = fromDoc(pv.policy); savedCanon = canon(policyDoc().doc);
        $('#policy-src').textContent = `version ${pv.n}`;
      } else {
        let seen = [...(pv?.declared || [])];
        if (policyKey) { try { const d = await api(`/api/v1/portal/stats?key=${encodeURIComponent(policyKey)}&range=30d`); seen = [...new Set([...seen, ...d.resources.map((r) => r.resource)])].filter((r) => RES_RE.test(r)); } catch {} }
        const list = seen.length ? seen : ['profile.read', 'balance.read', 'report.export'];
        pol = { enforcement: 'observe', rules: list.slice(0, 50).map((r) => ({ resource: r, title: titleOf(r), preset: guessPreset(r) })) };
        savedCanon = '';
        $('#policy-src').textContent = seen.length ? `a suggestion based on ${plural(seen.length, 'part')} of your app we have seen` : 'an example to start from';
      }
    }
    drawStatus(); drawPending(); drawAssist(); drawUnruled(); drawSettings(); drawHistory(); drawPolicy();
  }
  function drawStatus() {
    const el = $('#pol-status');
    if (!policyKey) { el.innerHTML = '<i class="dot"></i><div><h3>No app connected yet</h3><p>Create an API key in API Keys and give it to your developer. Each app has its own rules.</p></div>'; return; }
    if (!pv?.policy) { el.innerHTML = '<i class="dot"></i><div><h3>No rules yet</h3><p>They appear here by themselves the first time your app connects: the rules your developer wrote become the first version, nothing to approve. Or set them up below and save.</p></div>'; return; }
    const p = pv.policy, latest = `portal-v${pv.n}`, sv = pv.server;
    let dot = 'ok', line;
    if (!sv) { dot = 'warn'; line = 'Your app has not connected yet. It picks up the rules when it starts, then checks every minute.'; }
    else if (sv.source === 'cache') { dot = 'warn'; line = 'Your app could not reach OneHuman, so it is using the last rules it saved. It is still protected, and catches up by itself.'; }
    else if (sv.source === 'file' || sv.source === 'none') { dot = 'warn'; line = 'Your app is still using the rules from its own code, not these. It switches over on its next check, within a minute.'; }
    else if (sv.version !== latest) { dot = 'warn'; line = 'Your app has not picked up your latest change yet. It will within a minute.'; }
    else line = 'Your app is using these rules.';
    if (sv) line += ` <span class="fine">Last check ${ago(sv.at)}.</span>`;
    const head = p.enforcement === 'enforce' ? `Protection is on · ${plural(p.rules.length, 'part')} of your app covered` : `Just watching · ${plural(p.rules.length, 'part')} of your app, nothing is blocked yet`;
    el.innerHTML = `<i class="dot ${dot}"></i><div><h3>${head}</h3><p>${line}</p><p class="fine">Version ${pv.n} · changed ${ago(pv.updated)}.${pv.pending.length ? ` <b>${plural(pv.pending.length, 'change')} waiting for your OK below.</b>` : ''}</p></div>`;
  }
  const changeList = (summary, careful) => `<ul>${summary.map((x) => `<li class="${careful.includes(x) || careful.some((w) => w.startsWith(x)) ? 'weak' : ''}">${esc(x)}</li>`).join('')}</ul>`;
  function drawPending() {
    const list = pv?.pending || [];
    $('#pol-pending-card').hidden = !list.length;
    $('#pol-pending').innerHTML = list.map((c) => `<div class="pol-item" data-id="${c.id}">
      <p class="meta">From ${esc(ORIGIN[c.origin] || c.origin)} · ${ago(c.at)}${c.weakening.length ? '<span class="weak-tag">needs a careful look</span>' : ''}</p>
      ${changeList(c.summary, c.weakening)}
      <div class="row"><button class="btn primary" data-decide="1">Accept</button><button class="btn ghost" data-decide="0">Decline</button></div></div>`).join('');
  }
  $('#pol-pending').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-decide]'); if (!b) return;
    const id = +b.closest('[data-id]').dataset.id, approve = b.dataset.decide === '1';
    b.disabled = true;
    try {
      const r = await withPassword('/api/v1/portal/policy/decide', { key: policyKey, id, approve });
      if (r) toast(r.status === 'applied' ? 'Accepted. Your app uses it within a minute.' : 'Declined. Nothing changed.');
      await renderPolicy(true);
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  // the assistant: plain words in, a reviewed change out
  let asResult = null;
  function drawAssist() {
    $('#pol-assist-card').hidden = !(pv?.assistant && pv?.policy);
  }
  async function runAssist(message) {
    if (!message) return;
    const { errs, doc } = policyDoc();
    if (errs.length) return toast(errs[0]);
    const go = $('#as-go'); go.disabled = true; go.textContent = 'Thinking…';
    $('#as-out').hidden = true;
    try {
      asResult = await api('/api/v1/portal/policy/assist', { method: 'POST', body: JSON.stringify({ key: policyKey, message, draft: doc }) });
      const a = asResult;
      $('#as-out').innerHTML = `<p class="reply">${esc(a.reply)}</p>
        ${a.proposed ? changeList(a.changes, a.careful) + `<div class="row"><button class="btn primary" id="as-apply">Put this into my rules</button><button class="btn ghost" id="as-drop">No thanks</button>${a.careful.length ? '<span class="fine">Red lines lower protection or affect real people: saving asks for your password.</span>' : ''}</div>` : ''}
        ${a.refused.length ? `<p class="refused">Left out: ${a.refused.map(esc).join('; ')}</p>` : ''}
        ${a.needsCode ? `<p class="fine" style="margin:10px 0 6px">${esc(a.needsCode.why || 'This needs a new rule, and new rules are added in the app\'s code.')} Give this to your developer, or paste it into the AI coding assistant they use:</p><div class="copyable"><pre class="code" id="as-code">${esc(a.needsCode.prompt)}</pre><button class="copy" data-copy="#as-code">Copy</button></div>` : ''}`;
      $('#as-out').hidden = false;
    } catch (e) { toast(e.message); }
    go.disabled = false; go.textContent = 'Suggest';
  }
  $('#as-go').onclick = () => runAssist($('#as-msg').value.trim());
  $('#as-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAssist($('#as-msg').value.trim()); } });
  $('#as-eg').addEventListener('click', (e) => { const b = e.target.closest('.chip-btn'); if (!b) return; $('#as-msg').value = b.textContent; runAssist(b.textContent); });
  $('#as-out').addEventListener('click', (e) => {
    if (e.target.id === 'as-drop') { $('#as-out').hidden = true; asResult = null; return; }
    if (e.target.id !== 'as-apply' || !asResult?.proposed) return;
    pol = fromDoc(asResult.proposed); drawPolicy(); drawUnruled();
    $('#as-out').hidden = true; $('#as-msg').value = ''; asResult = null;
    toast('Done. Look it over, then Save changes.');
    $('#pol-save').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function drawUnruled() {
    const list = (pv?.unruled || []).filter((u) => !addedHere.has(u.resource) && !pol?.rules.some((r) => r.resource === u.resource));
    $('#pol-unruled-card').hidden = !list.length;
    $('#pol-unruled').innerHTML = list.map((u) => `<div class="pol-un" data-res="${esc(u.resource)}">
      <div><b>${esc(titleOf(u.resource))}</b> <code>${esc(u.resource)}</code><span class="fine">${u.from.includes('code') ? 'in your app\'s code' : 'seen in traffic'} · ${ago(u.lastSeen)}</span></div>
      <select>${Object.entries(PRESETS).filter(([k]) => k !== 'custom').map(([k, p]) => `<option value="${k}" ${k === guessPreset(u.resource) ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
      <button class="btn">Add</button></div>`).join('');
  }
  $('#pol-unruled').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const row = b.closest('[data-res]'), res = row.dataset.res;
    pol.rules.push({ resource: res, title: titleOf(res), preset: row.querySelector('select').value });
    addedHere.add(res); drawUnruled(); drawPolicy();
    toast('Added. Save changes to apply it.');
  });
  function drawSettings() {
    const st = pv?.settings || { requireApproval: false, confirmWeakening: true };
    const none = !pv?.policy;
    $('#pol-req').checked = st.requireApproval; $('#pol-weak').checked = st.confirmWeakening;
    $('#pol-req').disabled = $('#pol-weak').disabled = none;
    $('#pol-req-hint').textContent = none ? 'Available once your app has connected.' : st.requireApproval
      ? 'On: their changes wait under “Waiting for your OK”. Until you accept, your app keeps the current rules.'
      : 'Off (default): their changes go live by themselves. You can see every one in History below.';
    $('#pol-weak-hint').textContent = st.confirmWeakening
      ? 'On (recommended): a change that lets AI agents see or do more, or that makes real people confirm or be refused, waits for your OK and your password — even when the switch above is off.'
      : 'Off: risky changes go through like any other. Turning this back on needs no password.';
  }
  const saveSetting = async (patch) => {
    try {
      const r = await withPassword('/api/v1/portal/policy/settings', { key: policyKey, ...patch });
      if (r) toast('Saved');
    } catch (err) { toast(err.message); }
    await renderPolicy();
  };
  $('#pol-req').addEventListener('change', (e) => saveSetting({ requireApproval: e.target.checked }));
  $('#pol-weak').addEventListener('change', (e) => saveSetting({ confirmWeakening: e.target.checked }));
  function drawHistory() {
    const list = pv?.history || [];
    $('#pol-history').innerHTML = list.length ? list.map((c) => {
      const label = c.status === 'applied' && c.toN ? `version ${c.toN}` : STATUS_WORD[c.status] || c.status;
      const who = c.status === 'applied' && c.decidedBy ? `${c.actor} · accepted by ${c.decidedBy}` : c.status === 'rejected' && c.decidedBy ? `${c.actor} · declined by ${c.decidedBy}` : c.actor;
      return `<div class="pol-hist"><span class="when" title="${esc(new Date(c.at).toLocaleString())}">${ago(c.at)}</span>
        <div><span class="chip ${esc(c.status)}">${esc(label)}</span> <span class="who">from ${esc(ORIGIN[c.origin] || c.origin)} · ${esc(who)}</span>${changeList(c.summary, c.weakening)}</div></div>`;
    }).join('') : '<p class="fine" style="margin:0">Nothing yet. Every change will be listed here: who made it, when, and what it changed.</p>';
  }
  function drawPolicy() {
    $('#pol-rows').innerHTML = pol.rules.map((r, i) => `<div class="pol-row" data-i="${i}">
      <label>What it is<input data-f="title" value="${esc(r.title)}" maxlength="80" placeholder="Monthly report download"></label>
      <label>Name in code<input data-f="resource" value="${esc(r.resource)}" placeholder="report.export" spellcheck="false"></label>
      <label>When an AI agent comes<select data-f="preset">${Object.entries(PRESETS).filter(([k]) => k !== 'custom' || r.preset === 'custom').map(([k, p]) => `<option value="${k}" ${k === r.preset ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      <button class="rm" data-rm="${i}" title="Remove" aria-label="Remove">✕</button>
      <p class="what">${esc(r.preset === 'custom' ? describeModes(r.modes) : PRESETS[r.preset].what)}</p></div>`).join('') || '<p class="fine">No rules yet. Add a part of your app, using the name your developer gave it.</p>';
    $$('#pol-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === pol.enforcement));
    $('#pol-mode-hint').textContent = pol.enforcement === 'observe' ? 'Start here. Everything is recorded in Activity, nobody is blocked. Turn protection on when the numbers look right.' : 'The rules apply. AI agents get what each rule allows them; real people are never blocked by a rule that lets them in.';
    writePolicy();
  }
  function policyDoc() {
    const errs = [];
    const seen = new Set();
    const rules = pol.rules.map((r) => {
      if (!RES_RE.test(r.resource)) errs.push(`"${r.resource || '(empty)'}" cannot be used as a name in code: use lowercase letters, digits, dots and underscores, starting with a letter (ask your developer for the exact name).`);
      else if (seen.has(r.resource)) errs.push(`"${r.resource}" is listed twice.`);
      seen.add(r.resource);
      const m = r.preset === 'custom' ? r.modes : PRESETS[r.preset].m;
      return { resource: r.resource, title: (r.title || titleOf(r.resource)).slice(0, 80), onAgent: m[0], onArtifact: m[1], onUnknown: m[2], onHumanLike: m[3], actOn: r.actOn || ['verified', 'strong', 'control', 'behavioral'], minScore: r.minScore ?? 65 };
    });
    if (!rules.length) errs.push('Add at least one part of your app.');
    return { errs, doc: { version: pv?.policy ? pv.policy.version : `policy-${new Date().toISOString().slice(0, 10)}`, enforcement: pol.enforcement, rules } };
  }
  function writePolicy() {
    const { errs, doc } = policyDoc();
    const dirty = canon(doc) !== savedCanon;
    $('#pol-err').textContent = errs.join(' ');
    $('#pol-json').textContent = JSON.stringify(doc, null, 2);
    $('#pol-download').disabled = !!errs.length;
    $('#pol-save').disabled = !!errs.length || !policyKey || !dirty;
    $('#pol-save-msg').textContent = !policyKey ? 'Create an API key first.' : !pv?.policy ? 'Not saved yet.' : dirty ? 'You have changes that are not saved yet.' : 'Everything is saved.';
  }
  $('#pol-rows').addEventListener('input', (e) => { const row = e.target.closest('.pol-row'); if (!row || !e.target.dataset.f) return; const r = pol.rules[+row.dataset.i]; if (e.target.dataset.f === 'preset') { r.preset = e.target.value; drawPolicy(); return; } r[e.target.dataset.f] = e.target.dataset.f === 'resource' ? e.target.value.trim() : e.target.value; writePolicy(); });
  $('#pol-rows').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; pol.rules.splice(+b.dataset.rm, 1); drawPolicy(); drawUnruled(); });
  $('#pol-add').onclick = () => { pol.rules.push({ resource: '', title: '', preset: 'guard' }); drawPolicy(); const inputs = $$('#pol-rows input[data-f="title"]'); inputs[inputs.length - 1]?.focus(); };
  $$('#pol-mode button').forEach((b) => b.addEventListener('click', () => { pol.enforcement = b.dataset.mode; drawPolicy(); }));
  $('#pol-import-toggle').onclick = () => { $('#pol-import').hidden = !$('#pol-import').hidden; };
  $('#pol-import-go').onclick = () => {
    try {
      const o = JSON.parse($('#pol-import-text').value);
      if (!o || !Array.isArray(o.rules) || !o.rules.length) throw new Error('No "rules" list in that file.');
      pol = fromDoc(o);
      $('#policy-src').textContent = 'loaded from the file you pasted, not saved yet';
      $('#pol-import-msg').textContent = `Loaded ${plural(pol.rules.length, 'rule')}.`;
      drawPolicy(); drawUnruled();
    } catch (e) { $('#pol-import-msg').textContent = e.message.startsWith('No') ? e.message : 'That is not valid JSON.'; }
  };
  $('#pol-save').onclick = async () => {
    const { errs, doc } = policyDoc(); if (errs.length) return toast(errs[0]);
    $('#pol-save').disabled = true;
    try {
      const r = await withPassword('/api/v1/portal/policy', { key: policyKey, policy: doc });
      if (r) toast(r.status === 'unchanged' ? 'Nothing changed' : 'Saved. Your app uses it within a minute.');
      if (r) await renderPolicy(true); else writePolicy();
    } catch (e) { toast(e.message); writePolicy(); }
  };
  $('#policy-key').addEventListener('change', (e) => { policyKey = e.target.value; pol = null; $('#as-out').hidden = true; renderPolicy(); });
  $('#pol-download').onclick = () => { const { errs, doc } = policyDoc(); if (errs.length) return toast(errs[0]); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' })); a.download = 'onehuman.policy.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

  // ------------------------------------------------------------------ auditor report (print → PDF)
  $('#audit-report').onclick = async () => {
    if (!keyId) return;
    const win = open('', '_blank');   // opened inside the click so it is not treated as a pop-up
    if (!win) return toast('Allow pop-ups for this page to open the report');
    win.document.write('<p style="font:14px system-ui;padding:24px">Checking every signature…</p>');
    try {
      const r = await fetch(`/api/v1/portal/proofs?key=${encodeURIComponent(keyId)}&range=${range}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || String(r.status));
      const bundle = await r.json();
      if (!bundle.proofs?.length) { win.close(); return toast('No signed decisions in this range yet'); }
      const results = [];
      for (let i = 0; i < bundle.proofs.length; i += 1000) {
        const v = await api('/api/v1/proof/verify', { method: 'POST', body: JSON.stringify({ keys: bundle.keys, proofs: bundle.proofs.slice(i, i + 1000) }) });
        results.push(...v.results);
      }
      win.document.open(); win.document.write(auditHtml(bundle, results)); win.document.close();
      setTimeout(() => win.print(), 400);
    } catch (e) { win.close(); toast(e.message); }
  };
  function auditHtml(bundle, results) {
    const ok = results.filter((x) => x.valid);
    const count = (f) => ok.reduce((m, x) => ((m[x[f]] = (m[x[f]] || 0) + 1), m), {});
    const list = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${fmt(n)}`).join(' · ') || '–';
    const kids = [...new Set(bundle.keys.map((k) => k.kid))];
    const rows = results.map((x, i) => x.valid ? `<tr><td>${esc(x.at.replace('T', ' ').slice(0, 19))}</td><td>${esc(x.resource)}</td><td>${esc(x.verdict)}</td><td>${esc(x.actor)}</td><td>${x.delivered ? 'yes' : 'no'}</td><td class="m">${esc(x.decision)}</td><td>${x.seq ?? ''}</td><td>✓</td></tr>` : `<tr class="bad"><td colspan="7">Proof ${i + 1}: ${esc(x.reason)}</td><td>✗</td></tr>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Decision proof report · ${esc(keyName(keyId))}</title><style>
      body{font:12px/1.5 -apple-system,system-ui,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}
      .meta{color:#555}.box{border:1px solid #ccc;border-radius:8px;padding:10px 14px;margin:12px 0}.big{font-size:22px;font-weight:600}
      table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e5e5e5;vertical-align:top}th{color:#555;font-weight:500}
      td.m,code{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;word-break:break-all}tr.bad td{color:#b00}@media print{body{margin:12mm}}</style></head><body>
      <h1>Decision proof report</h1>
      <div class="meta">Project: ${esc(keyName(keyId))} · Range: ${esc(bundle.range)} · Generated ${esc(new Date().toISOString().replace('T', ' ').slice(0, 19))} UTC</div>
      <div class="box"><div class="big">${fmt(ok.length)} of ${fmt(results.length)} decisions verified</div>
      Every decision below was signed on the company's own server when it was made, with an Ed25519 key only that server holds. Changing any field afterwards breaks the signature.<br>
      Decisions: ${list(count('verdict'))}<br>Acting party: ${list(count('actor'))}<br>Signing key id: <code>${kids.map(esc).join(', ')}</code></div>
      <h2>How to check this report yourself</h2>
      <ol><li>Ask the company for the proof file of this range (the JSON export next to this report in their OneHuman portal).</li>
      <li>Get their public key from their own website, not from the file: <code>https://&lt;their-site&gt;/onehuman/proof-keys</code>.</li>
      <li>Run <code>npx onehuman verify-proof proofs.json --keys https://&lt;their-site&gt;/onehuman/proof-keys</code>. It needs no account and sends nothing anywhere. Any standard JOSE library works too.</li></ol>
      <p class="meta">Actor values: human_like = acted like a person · agent_likely = an AI agent · unknown = could not tell (the policy decides, often a passkey). Delivered = whether the data was actually returned.</p>
      <h2>Signed decisions</h2>
      <table><thead><tr><th>Time (UTC)</th><th>Resource</th><th>Decision</th><th>Actor</th><th>Delivered</th><th>Decision id</th><th>Log #</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
  }

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
      ['GET', '/api/v1/manage/proofs?key=:id', 'signed decision proofs — the auditor file'],
      ['POST', '/api/v1/manage/feedback', '{key, id, verdict} grade a decision'],
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
