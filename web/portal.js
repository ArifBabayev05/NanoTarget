/* NanoTarget portal: accounts, API keys, and what the middleware reported for each key. */
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
    try {
      await api(`/api/v1/portal/${mode}`, { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
      await boot();
    } catch (err) { $('#auth-err').textContent = err.message; } finally { b.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/v1/portal/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); });

  // ------------------------------------------------------------------ keys
  let me = null, keyId = null, range = '7d', timer = 0;
  function renderKeys() {
    const keys = (me.keys || []).filter((k) => !k.revoked);
    $('#keys').innerHTML = keys.map((k) => `<button class="key ${k.id === keyId ? 'on' : ''} ${k.lastSeen ? 'live' : ''}" data-key="${esc(k.id)}" title="${k.events} events${k.lastSeen ? ' · last ' + new Date(k.lastSeen).toLocaleString() : ' · nothing received yet'}"><i class="dot"></i>${esc(k.name)}<span class="pre">${esc(k.prefix)}…</span><span class="x" data-revoke="${esc(k.id)}" title="Revoke">✕</span></button>`).join('')
      + `<button class="key add" id="key-add">+ New key</button>`;
    $('#key-add').onclick = openModal;
    $$('[data-key]').forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('[data-revoke]')) return; keyId = b.dataset.key; renderKeys(); load(); }));
    $$('[data-revoke]').forEach((x) => x.addEventListener('click', async (e) => {
      e.stopPropagation(); const id = x.dataset.revoke; const k = keys.find((z) => z.id === id);
      if (!confirm(`Revoke "${k.name}"? Servers using it stop reporting immediately.`)) return;
      await api('/api/v1/portal/keys/revoke', { method: 'POST', body: JSON.stringify({ id }) }); toast('Key revoked');
      me = await api('/api/v1/portal/me'); if (keyId === id) keyId = (me.keys.find((z) => !z.revoked) || {}).id || null; renderKeys(); load();
    }));
  }
  function openModal() { $('#modal').hidden = false; $('#modal-new').hidden = false; $('#modal-show').hidden = true; $('#key-name').value = ''; $('#modal-title').textContent = 'New API key'; setTimeout(() => $('#key-name').focus(), 50); }
  const closeModal = () => { $('#modal').hidden = true; };
  $('#modal-close').onclick = closeModal; $('#modal-done').onclick = async () => { closeModal(); me = await api('/api/v1/portal/me'); renderKeys(); load(); };
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

  // ------------------------------------------------------------------ stats
  $$('#range button').forEach((b) => b.addEventListener('click', () => { range = b.dataset.r; $$('#range button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  const fmtT = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const fmtDay = (t) => { const d = new Date(t); return range === '24h' ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getDate()}/${d.getMonth() + 1}`; };
  const STATE_WORD = { signed_agent: 'signed agent', agent_attached: 'agent attached', agent_environment: 'agent environment', no_indication: 'no indication' };
  const ACTOR_WORD = { human_like: 'human', agent_likely: 'agent', unknown: 'unknown' };
  const bars = (el, obj, order, cls) => {
    const total = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
    const keys = order.filter((k) => obj[k]).concat(Object.keys(obj).filter((k) => !order.includes(k)));
    el.innerHTML = keys.length ? keys.map((k) => `<div class="bar ${cls ? cls : esc(k)}"><span>${esc(cls === 'tool' ? k : (ACTOR_WORD[k] || k.replace('_', ' ')))}</span><span class="track"><i style="width:${Math.round(obj[k] / total * 100)}%"></i></span><span class="n">${obj[k]}</span></div>`).join('') : '<div class="fine">nothing yet</div>';
  };
  function snippet(prefix) {
    const key = prefix ? `${prefix}…` : 'nt_live_…';
    $('#snippet').innerHTML = `<span class="c">// server.js</span>\n<span class="k">import</span> { nanotarget } <span class="k">from</span> <span class="s">'nanotarget/express'</span>;\n\n<span class="k">const</span> nt = <span class="k">await</span> nanotarget({\n  secret: process.env.NT_SECRET,\n  policy: <span class="s">'./nanotarget.policy.json'</span>,\n  apiKey: process.env.NT_API_KEY,        <span class="c">// ${esc(key)} — from this portal</span>\n});\napp.use(nt.middleware());\napp.get(<span class="s">'/api/balance'</span>, nt.protect(<span class="s">'balance.read'</span>), (req, res) =&gt; nt.send(req, res, balance, maskBalance));`;
    $('#curl-hint').textContent = `npx nanotarget verify http://localhost:3000 /api/balance`;
  }
  function drawChart(series, since, bucketMs, now) {
    const cv = $('#chart'); const dpr = Math.min(2, devicePixelRatio || 1); const W = cv.clientWidth, H = 220;
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
  async function load() {
    clearTimeout(timer);
    if (!keyId) { $('#empty').hidden = true; $('#stats').hidden = true; return; }
    let d; try { d = await api(`/api/v1/portal/stats?key=${encodeURIComponent(keyId)}&range=${range}`); } catch (e) { toast(e.message); return; }
    const total = Object.values(d.decisions).reduce((a, b) => a + b, 0);
    const k = (me.keys || []).find((z) => z.id === keyId) || {};
    if (!total && !k.events) { snippet(k.prefix); $('#empty').hidden = false; $('#stats').hidden = true; }
    else {
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
      $('#log').innerHTML = d.recent.length ? d.recent.map((e) => `<div class="e"><span class="t">${fmtT(e.at)}</span><span class="s">${esc(e.session.slice(0, 8))}</span><span class="r" title="${esc(e.resource)}">${esc(e.resource)}</span><span class="chip ${esc(e.decision)}">${esc(e.decision)}</span><span class="st"><span class="chip ${esc(e.actor)}">${esc(ACTOR_WORD[e.actor] || e.actor)}</span>${e.tools.length ? ` <span class="chip">${esc(e.tools[0])}</span>` : ''}</span><span class="reasons" title="${esc(e.reasons.join(', '))}">${esc(STATE_WORD[e.state] || e.state)} · ${esc(e.reasons.slice(0, 3).join(' · '))}</span></div>`).join('') : '<div class="empty-row">No decisions yet.</div>';
    }
    timer = setTimeout(load, 10000);
  }
  addEventListener('resize', () => { if (!$('#stats').hidden) load(); });

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { me = await api('/api/v1/portal/me'); } catch { me = null; }
    if (!me) { $('#auth').hidden = false; $('#dash').hidden = true; $('#top-right').hidden = true; return; }
    $('#auth').hidden = true; $('#dash').hidden = false; $('#top-right').hidden = false; $('#who').textContent = me.account.email;
    const live = (me.keys || []).filter((k) => !k.revoked);
    if (!keyId) keyId = (live[0] || {}).id || null;
    renderKeys();
    if (!live.length) { $('#empty').hidden = false; $('#stats').hidden = true; snippet(''); $('#empty h2').textContent = 'Create your first API key'; $('#empty p').textContent = 'Each key is one project. Put it into your server as apiKey and every decision shows up here.'; }
    else load();
  }
  boot();
})();
