/* Product-style demo apps (bank / CRM / insurance). User-facing only: no scores,
   no reason codes. Every sensitive card is fetched through NanoTarget.fetch and the
   server decides what comes back. */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n, unit) => { if (n == null) return '••••'; const u = unit || 'USD'; const sym = u === 'USD' || u === '$' ? '$' : u + ' '; return `${sym}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const room = new URL(location.href).searchParams.get('room');
  const q = `?room=${encodeURIComponent(room)}`;
  const appId = (document.querySelector('meta[name="nt-app"]') || {}).content || 'bank';
  const SH = () => (window.NanoTarget && window.NanoTarget.sessionHeaders ? window.NanoTarget.sessionHeaders() : {});
  let app = null;
  let me = null;
  let passkeys = [];
  let toastTimer = null;

  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); };

  // ------------------------------------------------------------ guard pill
  function renderGuard(c) {
    const g = $('#guard');
    if (!c) return;
    const humanOk = me && me.humanVerified;
    if (c.state === 'agent_attached' || c.state === 'signed_agent') { g.className = 'guard agent'; g.lastElementChild.textContent = 'AI agent detected · sensitive data protected'; }
    else if (humanOk) { g.className = 'guard human'; g.lastElementChild.textContent = 'Verified human session'; }
    else if (c.state === 'agent_environment' && c.evidence.some((e) => e.code === 'AGENT_APP_BROWSER' || e.code === 'CODEX_MODEL_CONTEXT')) { g.className = 'guard env'; g.lastElementChild.textContent = 'AI browser window · verification may be required'; }
    else { g.className = 'guard'; g.lastElementChild.textContent = 'Session protected'; }
  }
  async function refreshGuard() {
    try {
      const r = await fetch(`/api/v1/connection${q}`, { cache: 'no-store', headers: SH() });
      if (r.ok) renderGuard((await r.json()).connection);
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ WebAuthn
  const b64uToBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const bufToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const webauthnAvailable = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  async function refreshPasskeys() {
    try { const r = await fetch(`/api/v1/webauthn/status${q}`, { cache: 'no-store', headers: SH() }); if (r.ok) { const d = await r.json(); passkeys = d.credentials || []; if (me) me.humanVerified = !!(d.humanVerifiedAt && Date.now() - d.humanVerifiedAt < d.validForMs); } } catch { /* ignore */ }
  }
  async function registerPasskey() {
    const o = await (await fetch(`/api/v1/webauthn/register/options${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: '{}' })).json();
    const pk = o.publicKey;
    const cred = await navigator.credentials.create({ publicKey: { ...pk, challenge: b64uToBuf(pk.challenge), user: { ...pk.user, id: b64uToBuf(pk.user.id) }, excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) } });
    const r = await fetch(`/api/v1/webauthn/register${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ challengeId: o.challengeId, id: cred.id, clientDataJSON: bufToB64u(cred.response.clientDataJSON), attestationObject: bufToB64u(cred.response.attestationObject), label: 'Touch ID / passkey' }) });
    if (!r.ok) throw new Error((await r.json()).message || 'Registration failed');
    await refreshPasskeys();
  }
  async function verifyWithPasskey(resource) {
    const o = await (await fetch(`/api/v1/webauthn/assert/options${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ resource: resource || null }) })).json();
    if (o.error) throw new Error(o.message || o.error);
    const pk = o.publicKey;
    const cred = await navigator.credentials.get({ publicKey: { ...pk, challenge: b64uToBuf(pk.challenge), allowCredentials: (pk.allowCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) } });
    const r = await fetch(`/api/v1/webauthn/assert${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ challengeId: o.challengeId, id: cred.id, clientDataJSON: bufToB64u(cred.response.clientDataJSON), authenticatorData: bufToB64u(cred.response.authenticatorData), signature: bufToB64u(cred.response.signature) }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.error);
    await refreshPasskeys(); refreshGuard();
    return d;
  }

  // ------------------------------------------------------------ step-up dialog
  function stepUpDialog(info, resource) {
    return new Promise((resolve) => {
      const dlg = $('#stepup'); const form = $('#stepup-form');
      const usePasskey = passkeys.length && webauthnAvailable();
      $('#stepup-text').textContent = usePasskey ? 'This action needs confirmation with Touch ID / a passkey.' : 'This action needs additional confirmation. Enter the code.';
      $('#stepup-code-wrap').style.display = usePasskey ? 'none' : '';
      $('#stepup-code').textContent = info.challenge || '';
      $('#stepup-answer').value = ''; $('#stepup-error').textContent = '';
      $('#stepup-ok').textContent = usePasskey ? 'Confirm with Touch ID' : 'Confirm';
      const done = (v) => { form.removeEventListener('submit', onSubmit); $('#stepup-cancel').removeEventListener('click', onCancel); dlg.close(); resolve(v); };
      const onSubmit = async (e) => {
        e.preventDefault();
        try {
          if (usePasskey) { await verifyWithPasskey(resource); done(true); return; }
          const r = await fetch('/api/v1/step-up', { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ id: info.id, answer: $('#stepup-answer').value }) });
          const d = await r.json();
          if (!r.ok) { $('#stepup-error').textContent = d.message || 'The code does not match'; return; }
          done(true);
        } catch (err) { $('#stepup-error').textContent = err.message; }
      };
      const onCancel = () => done(false);
      form.addEventListener('submit', onSubmit); $('#stepup-cancel').addEventListener('click', onCancel);
      dlg.showModal(); if (!usePasskey) $('#stepup-answer').focus();
    });
  }

  // ------------------------------------------------------------ protected call
  /** returns {ok, data, masked, decision} or {ok:false, blocked:true, reclaim} */
  async function load(resource, extraQuery, method, retried) {
    const r = await window.NanoTarget.fetch(`/api/v1/r/${resource}${q}${extraQuery || ''}`, { method: method || 'GET' });
    const d = await r.json();
    if (r.status === 428 && !retried) {
      const ok = await stepUpDialog(d.stepUp || {}, resource);
      if (ok) return load(resource, extraQuery, method, true);
      return { ok: false, cancelled: true };
    }
    if (r.status === 403) { refreshGuard(); return { ok: false, blocked: true, reclaim: !!(d.stepUp && d.stepUp.reclaim), decision: d.decision }; }
    if (!r.ok) return { ok: false, error: d.message || d.error || String(r.status) };
    refreshGuard();
    return { ok: true, data: d.data, masked: !!d.masked, downloadUrl: d.downloadUrl, decision: d.decision };
  }

  function noticeFor(res, body, resource, retry) {
    body.querySelectorAll('.notice').forEach((n) => n.remove());
    if (res.ok && res.masked) { body.insertAdjacentHTML('beforeend', `<div class="notice mask"><span class="ico">●</span><div>Some details are hidden: this session shows signs of automation. Verify you are a person to see everything.</div></div>`); }
    if (res.blocked) {
      const can = res.reclaim && passkeys.length && webauthnAvailable();
      body.insertAdjacentHTML('beforeend', `<div class="notice block"><span class="ico">■</span><div><strong>This information is protected.</strong> An AI agent is operating this session; the action was blocked.${can ? '' : passkeys.length ? '' : ' If this is you, register a passkey first (bottom right).'}<div class="actions">${can ? `<button class="primary" data-reclaim="${esc(resource)}">I\'m a person — confirm with Touch ID</button>` : ''}</div></div></div>`);
      const b = body.querySelector('[data-reclaim]');
      if (b) b.onclick = async () => { b.disabled = true; try { const v = await verifyWithPasskey(resource); if (window.NanoTarget) window.NanoTarget.unseal(v.reclaim); toast('Verified'); await retry(); } catch (e) { toast(e.message); b.disabled = false; } };
    }
    if (res.error) body.insertAdjacentHTML('beforeend', `<div class="notice block"><span class="ico">!</span><div>${esc(res.error)}</div></div>`);
    if (res.cancelled) body.insertAdjacentHTML('beforeend', `<div class="notice info"><span class="ico">i</span><div>Confirmation cancelled.</div></div>`);
  }

  async function download(res, body) {
    if (!res.downloadUrl) { body.insertAdjacentHTML('beforeend', `<div class="notice mask"><span class="ico">●</span><div>Export is not available in this session.</div></div>`); return; }
    const r = await fetch(res.downloadUrl, { cache: 'no-store', headers: SH() });
    if (!r.ok) { body.insertAdjacentHTML('beforeend', `<div class="notice block"><span class="ico">■</span><div>The file was not delivered.</div></div>`); return; }
    const blob = await r.blob();
    const name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'export';
    const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
    toast(`${name} downloaded`);
  }

  // ------------------------------------------------------------ renderers
  const kvHtml = (rows) => `<div class="kv">${rows.map((r) => `<span>${esc(r.label)}</span><strong>${esc(r.value)}</strong>`).join('')}</div>`;
  const tableHtml = (t, opts = {}) => {
    const cols = t.columns || []; const rows = t.rows || [];
    if (!rows.length) return '<div class="empty">No results.</div>';
    return `<table><thead><tr>${cols.map((c) => `<th${c.align === 'right' ? ' style="text-align:right"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr${opts.clickable ? ` class="clickable" data-row="${i}"` : ''}>${cols.map((c) => `<td${c.align === 'right' ? ' style="text-align:right"' : ''}>${cell(r[c.key], c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  const cell = (v, c) => {
    if (v == null) return '<span class="chip">••••</span>';
    if (c.key === 'status') return `<span class="chip ${/Paid|Closed/.test(v) ? 'ok' : /Declined/.test(v) ? 'bad' : 'warn'}">${esc(v)}</span>`;
    if (c.key === 'stage') return `<span class="chip ${v === 'Closed won' ? 'ok' : ''}">${esc(v)}</span>`;
    if (c.key === 'amount' || c.key === 'value') return typeof v === 'number' ? money(v) : esc(v);
    return esc(v);
  };

  // ------------------------------------------------------------ layouts
  const NAV = {
    bank: [['○', 'Overview'], ['▭', 'Cards'], ['⇄', 'Transfers'], ['≡', 'Payments'], ['▤', 'Statements'], ['⚙', 'Settings']],
    crm: [['○', 'Dashboard'], ['◔', 'Customers'], ['↗', 'Pipeline'], ['✉', 'Campaigns'], ['▤', 'Reports'], ['⚙', 'Settings']],
    insurance: [['○', 'Overview'], ['◇', 'My policies'], ['≡', 'Claims'], ['✚', 'Medical'], ['▤', 'Documents'], ['⚙', 'Settings']],
  };

  function section(id, title, sub, extra) {
    return `<div class="card ${extra || 'c12'}" id="sec-${id}"><div class="head"><div><h3>${esc(title)}</h3>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div><div class="actions" id="act-${id}"></div></div><div id="body-${id}"></div></div>`;
  }

  function bankLayout() {
    $('#page-title').textContent = 'Welcome back';
    $('#page-sub').textContent = 'Current account · USD';
    $('#content').innerHTML = `
      <div class="card hero-card c8"><h3>Current account</h3><p class="sub">•••• 2048</p><div class="amount" id="bank-amount">$ ••••</div><small id="bank-note">Balance hidden</small><div class="actions" style="margin-top:16px"><button data-res="balance.read">Show balance</button><button data-res="report.export">Download statement (CSV)</button></div><div id="body-balance"></div></div>
      <div class="card c4"><h3>Quick actions</h3><p class="sub">Most used</p><div class="quick"><button disabled><span class="ico">⇄</span>Transfer</button><button disabled><span class="ico">▭</span>Top up</button><button disabled><span class="ico">≡</span>Bills</button><button disabled><span class="ico">＋</span>More</button></div></div>
      ${section('tx', 'Recent transactions', 'Search or show all')}
      ${section('profile', 'Personal details', 'Name, contact, IBAN', 'c6')}
      <div class="card c6"><h3>Cards</h3><p class="sub">Active card</p><div class="pay-card">NANO BANK<br><br>•••• •••• •••• 2048<br><small style="opacity:.7">09/29 · VISA</small></div></div>`;
    $('#act-tx').innerHTML = `<input id="tx-q" placeholder="e.g. rent" style="width:180px"><button class="primary" data-res="transactions.search">Search</button>`;
    $('#act-profile').innerHTML = `<button data-res="profile.read">Show</button>`;
    $('#body-tx').innerHTML = '<div class="empty">Search to see transactions.</div>';
    $('#body-profile').innerHTML = '<div class="empty">Details hidden.</div>';
  }
  function crmLayout() {
    $('#page-title').textContent = 'Sales dashboard';
    $('#page-sub').textContent = 'This month · whole team';
    $('#content').innerHTML = `
      <div class="card c4"><h3>Pipeline</h3><p class="sub">Open deals</p><div class="kpi" id="kpi-pipeline">••••</div><div class="kpi-sub" id="kpi-pipeline-sub">&nbsp;</div><div class="actions" style="margin-top:12px"><button data-res="pipeline.read">Show</button></div><div id="body-pipeline"></div></div>
      <div class="card c4"><h3>Customers</h3><p class="sub">Contacts in the database</p><div class="kpi" id="kpi-customers">••</div><div class="kpi-sub">active customers</div></div>
      <div class="card c4"><h3>Contact base</h3><p class="sub">Export every contact</p><div class="actions" style="margin-top:12px"><button class="primary" data-res="contacts.export">Export CSV</button></div><div id="body-export"></div></div>
      ${section('customers', 'Customer list', 'Click a row to open the record')}
      ${section('customer', 'Top customer', 'Full contact record', 'c12')}`;
    $('#act-customers').innerHTML = `<button class="primary" data-res="customers.list">Load list</button>`;
    $('#act-customer').innerHTML = `<button data-res="customer.read">Open record</button>`;
    $('#body-customers').innerHTML = '<div class="empty">List not loaded.</div>';
    $('#body-customer').innerHTML = '<div class="empty">Record closed.</div>';
  }
  function insuranceLayout() {
    $('#page-title').textContent = 'Policyholder portal';
    $('#page-sub').textContent = 'Active policy · health insurance';
    $('#content').innerHTML = `
      <div class="card hero-card c8"><h3>My policy</h3><p class="sub">Active · renews 1 Mar 2027</p><div class="amount" style="font-size:28px">Health Plus</div><small>Policy number and personal details are protected</small><div class="actions" style="margin-top:16px"><button data-res="policyholder.read">Personal details</button><button data-res="policy.download">Download policy</button></div><div id="body-policyholder"></div></div>
      <div class="card c4"><h3>Medical report</h3><p class="sub">Latest visit</p><div id="body-medical"><div class="empty">Report closed.</div></div><div class="actions" style="margin-top:12px"><button class="primary" data-res="medical.read">Open report</button></div></div>
      ${section('claims', 'Claims', 'Last 6 months')}`;
    $('#act-claims').innerHTML = `<button class="primary" data-res="claims.list">Show claims</button>`;
    $('#body-claims').innerHTML = '<div class="empty">Claims not loaded.</div>';
  }

  const BODY_OF = { 'balance.read': 'body-balance', 'report.export': 'body-balance', 'transactions.search': 'body-tx', 'profile.read': 'body-profile', 'pipeline.read': 'body-pipeline', 'customers.list': 'body-customers', 'customer.read': 'body-customer', 'contacts.export': 'body-export', 'policyholder.read': 'body-policyholder', 'policy.download': 'body-policyholder', 'medical.read': 'body-medical', 'claims.list': 'body-claims' };

  async function run(resource, button) {
    const def = app.resources.find((r) => r.id === resource);
    if (!def) return;
    const body = document.getElementById(BODY_OF[resource]) || $('#content');
    if (button) button.disabled = true;
    const extra = def.input ? `&q=${encodeURIComponent(($('#tx-q') || {}).value || '')}` : '';
    try {
      const res = await load(resource, extra, def.method);
      const retry = () => run(resource, button);
      if (res.ok) {
        if (def.view === 'download') { body.querySelectorAll('.notice').forEach((n) => n.remove()); await download(res, body); if (res.masked) noticeFor(res, body, resource, retry); return; }
        render(resource, def, res, body);
      } else {
        // blocked / error: show product notice, keep placeholders
        if (resource === 'balance.read' && res.blocked) { $('#bank-amount').textContent = '$ ••••'; $('#bank-note').textContent = 'Balance protected'; }
        if (resource === 'pipeline.read' && res.blocked) { $('#kpi-pipeline').textContent = '••••'; }
      }
      noticeFor(res, body, resource, retry);
    } catch (e) {
      toast(e.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  /** elements outside the card body that show protected values (hero amount, KPIs) */
  const mark = (sels, masked) => sels.forEach((sel) => { const el = $(sel); if (el) el.setAttribute('data-nt-sensitive', masked ? 'masked' : 'full'); });
  const shown = new Set(); // resources currently rendered with data

  function render(resource, def, res, body) {
    body.setAttribute('data-nt-sensitive', res.masked ? 'masked' : 'full');
    if (!res.masked) shown.add(resource);
    const d = res.data;
    switch (resource) {
      case 'balance.read': $('#bank-amount').textContent = money(d.value, d.unit); $('#bank-note').textContent = d.note || ''; body.innerHTML = ''; mark(['#bank-amount', '#bank-note'], res.masked); return;
      case 'pipeline.read': $('#kpi-pipeline').textContent = money(d.value, d.unit).replace(/\.00$/, ''); $('#kpi-pipeline-sub').textContent = d.note || ''; body.innerHTML = ''; mark(['#kpi-pipeline', '#kpi-pipeline-sub'], res.masked); return;
      case 'customers.list': body.innerHTML = tableHtml(d, { clickable: true }); $('#kpi-customers').textContent = String((d.rows || []).length); mark(['#kpi-customers'], res.masked); body.querySelectorAll('tr.clickable').forEach((tr) => { tr.onclick = () => { const row = d.rows[Number(tr.dataset.row)]; openDrawer(`<h3>${esc(row.name)}</h3><p class="sub">${esc(row.company)}</p>${kvHtml([{ label: 'Phone', value: row.phone }, { label: 'Email', value: row.email || '••••' }, { label: 'Address', value: row.address || '••••' }, { label: 'Stage', value: row.stage }, { label: 'Value', value: money(row.value) }, { label: 'Notes', value: row.notes || '••••' }])}${res.masked ? '<div class="notice mask"><span class="ico">●</span><div>Contact details hidden.</div></div>' : ''}`); }; }); return;
      case 'medical.read': body.innerHTML = `<strong>${esc(d.title)}</strong>${(d.paragraphs || []).map((p) => `<p style="margin:6px 0">${esc(p)}</p>`).join('')}`; return;
      default:
        if (def.view === 'kv') body.innerHTML = kvHtml(d);
        else if (def.view === 'table') body.innerHTML = tableHtml(d);
        else if (def.view === 'number') body.innerHTML = `<div class="kpi">${money(d.value, d.unit)}</div><div class="kpi-sub">${esc(d.note || '')}</div>`;
        else if (def.view === 'text') body.innerHTML = `<strong>${esc(d.title)}</strong>${(d.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}`;
    }
  }

  function openDrawer(html) { $('#drawer-body').innerHTML = html; $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); }
  function closeAll() { $('#drawer').classList.remove('open'); $('#sheet').classList.remove('open'); $('#scrim').classList.remove('open'); $('#fab').classList.remove('hidden'); }
  function openSheet() { $('#sheet').classList.add('open'); $('#scrim').classList.add('open'); $('#fab').classList.add('hidden'); }
  $('#drawer-close').onclick = closeAll; $('#scrim').onclick = closeAll; $('#sheet-close').onclick = closeAll;
  $('#fab').onclick = openSheet;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); if ((e.key === 'a' || e.key === 'A') && !/input|textarea/i.test((e.target && e.target.tagName) || '')) openSheet(); });

  document.addEventListener('click', (e) => { const b = e.target.closest('button[data-res]'); if (b) run(b.dataset.res, b); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'tx-q') { e.preventDefault(); run('transactions.search', null); } });

  // ------------------------------------------------------------ boot
  async function boot() {
    const [meR, appsR] = await Promise.all([fetch(`/api/v1/session${q}`, { cache: 'no-store', headers: SH() }), fetch('/api/v1/apps', { cache: 'no-store' })]);
    if (!meR.ok) { $('#content').innerHTML = '<div class="card c12"><h3>Session not found</h3><p class="sub">Reload the page.</p></div>'; return; }
    me = await meR.json();
    app = (await appsR.json()).apps.find((a) => a.id === (me.app || appId));
    document.title = app.name;
    document.documentElement.style.setProperty('--accent', app.accent);
    document.documentElement.style.setProperty('--accent-soft', app.accent + '22');
    $('#logo').textContent = app.initials; $('#brand-name').textContent = app.name;
    $('#user-av').textContent = 'AB'; $('#user-name').textContent = me.label === 'agent' ? 'Agent test' : 'Customer'; $('#user-sub').textContent = app.accountTitle;
    $('#nav').innerHTML = NAV[app.id].map(([i, t], k) => `<a href="#" class="${k === 0 ? 'active' : ''}"><span class="ico">${i}</span>${esc(t)}</a>`).join('');
    ({ bank: bankLayout, crm: crmLayout, insurance: insuranceLayout })[app.id]();
    const human = new URL(location.href); human.searchParams.set('as', 'human'); human.searchParams.delete('scenario');
    const agent = new URL(location.href); agent.searchParams.set('as', 'agent'); agent.searchParams.delete('scenario');
    $('#human-link').href = human.href;
    const steps = app.promptSteps.map((st, i) => `${i + 2}. ${st}`).join('\n');
    $('#prompt-steps').innerHTML = [`Open <span style="font-family:var(--mono);font-size:12px">${esc(agent.host + agent.pathname)}</span> with the browser tool and wait 5 s`, ...app.promptSteps].map((st, i) => `<li><b>${String(i + 1).padStart(2, '0')}</b><span>${i ? esc(st) : st}</span></li>`).join('');
    $('#prompt').value = `Open this page with your browser tool: ${agent.href}

This is a test application called ${app.name}; all data is synthetic. Use only the visible interface — do not call APIs directly.

1. After the page loads, wait 5 seconds.
${steps}

At the end, write briefly what you saw at each step (data shown / hidden / blocked / confirmation requested).`;
    if (me.connection) renderGuard(me.connection);
    await refreshPasskeys();
    // passkey registration entry point lives in the AI sheet footer for humans
    const row = $('#sheet .row');
    const pk = document.createElement('button'); pk.className = 'ghost'; pk.textContent = passkeys.length ? 'Passkey registered ✓' : 'Register passkey (Touch ID)'; pk.disabled = !webauthnAvailable();
    pk.onclick = async () => { pk.disabled = true; try { await registerPasskey(); pk.textContent = 'Passkey registered ✓'; toast('Passkey registered'); } catch (e) { toast(e.message); pk.disabled = false; } };
    row.appendChild(pk);
    if (window.NanoTarget) { window.NanoTarget.flush(); window.NanoTarget.onAssessment((_a, _s, c) => { if (c) renderGuard(c); }); }
    setInterval(refreshGuard, 3000);
    // The SDK sealed on-screen data because an agent attached: show it, then re-fetch what was open so the
    // server's masked/blocked variant replaces the placeholders.
    document.addEventListener('nt:sealed', (e) => {
      const g = $('#guard'); g.className = 'guard agent'; g.lastElementChild.textContent = 'AI agent detected · data hidden';
      if (e.detail && e.detail.first) toast('An AI agent attached — sensitive data on screen was hidden');
      if (app.id === 'bank' && $('#bank-amount')) { $('#bank-amount').textContent = '$ ••••'; $('#bank-note').textContent = 'Balance protected'; }
      // re-fetch once, on the first seal: the server now answers masked/blocked (in observe mode the data
      // comes back full and is simply redacted again in place)
      if (e.detail && e.detail.first) { const again = [...shown]; shown.clear(); setTimeout(() => { for (const r of again) run(r, null); }, 400); }
    });
  }
  $('#copy-prompt').onclick = async () => { try { await navigator.clipboard.writeText($('#prompt').value); toast('Prompt copied'); } catch { toast('Could not copy — select the text'); } };
  $('#copy-link').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { /* ignore */ } };
  boot().catch((e) => { $('#content').innerHTML = `<div class="card c12"><h3>Error</h3><p class="sub">${esc(e.message)}</p></div>`; });
})();
