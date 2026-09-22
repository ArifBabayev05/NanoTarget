/* Demo app UI. Talks to the protected endpoints through NanoTarget.fetch so the
   server decides with fresh telemetry. All rendering is data-driven; there is
   no client-side rule that could be bypassed. */
(() => {
  const $ = (s) => document.querySelector(s);
  const SH = () => (window.NanoTarget && window.NanoTarget.sessionHeaders ? window.NanoTarget.sessionHeaders() : {});
  const room = new URL(location.href).searchParams.get('room');
  const q = `?room=${encodeURIComponent(room)}`;
  const DEC = { allow: 'İcazə', mask: 'Maskalandı', step_up: 'Təsdiq tələbi', block: 'Bloklandı' };
  const ACTOR = { agent_likely: 'Agent ehtimalı', human_like: 'İnsanabənzər', unknown: 'Naməlum' };
  const ACTOR_SUB = {
    agent_likely: 'Avtomatlaşdırma ehtimalı; AI kimliyi təsdiqlənməyib.',
    human_like: 'Agent də belə davrana bilər; bu insan sübutu deyil.',
    unknown: 'Siqnallar toplanır. “Naməlum” insan demək deyil.',
  };
  const TIER = { verified: 'Təsdiqlənmiş imza', strong: 'Güclü brauzer bayrağı', control: 'Aktiv idarə göstəricisi', behavioral: 'Davranış', artifact: 'Mühit izi (eksperimental)' };
  const RES = { 'profile.read': 'Profil', 'balance.read': 'Balans', 'transactions.search': 'Axtarış', 'report.export': 'İxrac' };
  const SIG = { absent: 'İmza yoxdur', verified: 'İmza təsdiqləndi', invalid: 'İmza etibarsız', unsupported: 'İmza profili dəstəklənmir', unavailable: 'Açar kataloqu əlçatmaz', replay: 'İmza təkrar istifadə edilib' };
  const money = (n, c) => n == null ? '•••' : `${n.toLocaleString('az-AZ', { minimumFractionDigits: 2 })} ${c || '₼'}`;
  const time = (t) => new Date(t).toLocaleTimeString('az-AZ', { hour12: false });
  const rel = (ms) => ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let me = null;
  let app = null;
  let lastAgentBanner = 0;
  const CONN = { signed_agent: 'İmzalı agent', agent_attached: 'Agent qoşulub', agent_environment: 'Agent mühiti', no_indication: 'İz yoxdur' };
  const CONN_CLASS = { signed_agent: 'block', agent_attached: 'block', agent_environment: 'step_up', no_indication: '' };
  const CONN_SUB = {
    signed_agent: 'Sorğu operator açarı ilə imzalanıb və serverdə təsdiqlənib.',
    agent_attached: 'Deterministik iz: agent aləti bu taba qoşulub. Bu, əməliyyat gözləmədən verilən nəticədir.',
    agent_environment: 'Səhifə agent tətbiqində açılıb və ya agent ekstenşnı quraşdırılıb. İnsan da ola bilər, agent istənilən an qoşula bilər.',
    no_indication: 'Heç bir iz yoxdur. Bu, insan sübutu deyil: bəzi agent rejimləri yalnız əməliyyat anında görünür.',
  };

  function renderConnection(c, attachedSince) {
    if (!c) return;
    $('#connection-panel').className = `panel ${CONN_CLASS[c.state] ? 'state ' + CONN_CLASS[c.state] : ''}`;
    $('#connection-title').textContent = CONN[c.state] + (c.tools.length ? ' · ' + c.tools.join(', ') : '');
    $('#connection-sub').textContent = CONN_SUB[c.state];
    const facts = [[c.atMs != null ? rel(c.atMs) : '—', 'ilk sübut (səhifə açılışından)'], [attachedSince != null ? rel(attachedSince) : '—', 'server qeyd etdi']];
    for (const e of c.evidence.slice(0, 4)) facts.push([e.code, e.detail]);
    $('#connection-facts').innerHTML = facts.map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`).join('');
  }

  async function refreshConnection() {
    const r = await fetch(`/api/v1/connection${q}`, { cache: 'no-store', headers: SH() });
    if (!r.ok) return;
    const d = await r.json();
    renderConnection(d.connection, d.sinceStartMs);
  }

  function decisionHtml(d, extra) {
    const shadow = d.enforced ? '' : ' shadow';
    const codes = d.reasonCodes.map((c) => `<code>${esc(c)}</code>`).join(' ');
    return `<div class="state ${d.decision}">
      <span class="decision ${d.decision}${shadow}">${DEC[d.decision]}${d.enforced ? '' : ' (müşahidə: ' + DEC[d.computed] + ')'}</span>
      <span class="tag ${d.actor === 'agent_likely' ? 'agent' : d.actor === 'human_like' ? 'human' : 'unknown'}">${ACTOR[d.actor]}${d.score != null ? ' · ' + d.score : ''}</span>
      ${extra ? `<div class="small" style="margin-top:6px">${extra}</div>` : ''}
      <div class="small" style="margin-top:6px">${codes}</div>
      <div class="code">qərar ${d.id.slice(0, 8)} · ${d.policyVersion} · ${d.signalVersion} · ${d.latencyMs} ms</div>
    </div>`;
  }

  function renderAssessment(a) {
    if (!a) return;
    $('#actor').className = `actor ${a.actor}`;
    $('#score').textContent = a.score == null ? '—' : a.score;
    $('#actor-title').textContent = ACTOR[a.actor];
    $('#actor-sub').textContent = ACTOR_SUB[a.actor];
    $('#track').style.width = `${a.score ?? 0}%`;
    $('#tiers').innerHTML = ['verified', 'strong', 'control', 'behavioral', 'artifact'].map((t) => `<span class="tag ${a.tiers.includes(t) ? 'on' : ''}">${TIER[t]}</span>`).join('');
    const conn = $('#connection');
    if (conn) {
      const passive = a.metrics.actions === 0;
      if (a.actor === 'agent_likely' && passive) { conn.className = 'state block'; conn.innerHTML = `<strong>Qoşulma anında aşkarlandı</strong> · heç bir klik olmadan, ${Math.round(performance.now() / 100) / 10} s-də. Səbəblər: ${a.reasons.filter((r) => r.kind === 'agent').map((r) => `<code>${esc(r.code)}</code>`).join(' ')}`; }
      else if (a.tiers.includes('artifact') && passive) { conn.className = 'state step_up'; conn.innerHTML = `<strong>Qoşulma anında mühit izi var</strong> · aktor hələ naməlum. Qayda bunun üçün ayrıca <em>onArtifact</em> budağı tətbiq edir. ${a.reasons.filter((r) => r.kind === 'agent').map((r) => `<code>${esc(r.code)}</code>`).join(' ')}`; }
      else if (passive) { conn.className = 'state'; conn.innerHTML = 'Qoşulma anında iz yoxdur. Bu, insan sübutu deyil: bəzi agent rejimləri yalnız əməliyyatdan sonra görünür.'; }
    }
    $('#reasons').innerHTML = a.reasons.map((r) => `<li class="${r.kind}"><span>${r.kind === 'agent' ? '!' : r.kind === 'human' ? '✓' : '·'}</span><span><b>${esc(r.code)}${r.tier ? ' · ' + TIER[r.tier] : ''}</b>${esc(r.detail)}</span></li>`).join('');
    const m = a.metrics;
    $('#metrics').innerHTML = [[m.actions, 'əməliyyat'], [m.atomic, 'ani klik'], [m.organic, 'təbii izli klik'], [m.untrusted, 'untrusted klik'], [m.hiddenClicks ?? 0, 'gizli sənədə klik'], [m.zeroPressure ?? 0, 'pressure=0 klik'], [m.markers, 'DOM izi'], [m.focusConflicts, 'fokus konflikti']]
      .map(([v, l]) => `<div><strong>${v}</strong><span>${l}</span></div>`).join('');
  }

  function renderEarly() {
    const s = window.NanoTarget && window.NanoTarget.snapshot();
    if (!s || !s.early) return;
    const e = s.early;
    const facts = [
      [e.webdriver ? 'var' : 'yox', 'navigator.webdriver'],
      [e.markers.length ? e.markers.map((m) => m.name).join(', ') : 'yox', 'məlum agent DOM izi'],
      [e.environment.codexModelContext ? 'var' : 'yox', 'Codex mühit qlobalı'],
      [e.environment.modelContextApi ? 'var' : 'yox', 'WebMCP modelContext API'],
      [e.environment.clipboardBridge ? 'var' : 'yox', 'clipboard körpüsü'],
      [e.environment.extensionsInstalled.length ? e.environment.extensionsInstalled.join(', ') : 'yox', 'agent ekstenşnı quraşdırılıb'],
      [e.environment.agentGlobals.length ? e.environment.agentGlobals.slice(0, 3).join(', ') : 'yox', 'agent qlobalları (səhifə)'],
      [e.environment.focusWhileHiddenMs != null ? rel(e.environment.focusWhileHiddenMs) : 'yox', 'gizli ikən fokus'],
      [e.reading && e.reading.readBursts ? `${e.reading.readBursts}× @ ${rel(e.reading.firstReadBurstMs)}` : 'yox', 'toplu DOM oxunuşu (agent oxuması)'],
      [e.reading && e.reading.textExtracts ? `${e.reading.textExtracts}× @ ${rel(e.reading.firstTextExtractMs)}` : 'yox', 'bütün mətnin çıxarılması'],
      [e.reading && e.reading.visibilityFlickers ? `${e.reading.visibilityFlickers}× @ ${rel(e.reading.firstFlickerMs)}${e.reading.flickerResize ? ' · ' + e.reading.flickerResize : ''}` : 'yox', 'screenshot titrəməsi'],
      [e.reading && e.reading.renderWhileHiddenMs != null ? rel(e.reading.renderWhileHiddenMs) : 'yox', 'gizli ikən render'],
      [e.reading && e.reading.loadedHidden ? 'bəli' : 'yox', 'gizli yükləndi'],
      [e.focusConflict.count + (e.focusConflict.peers ? ` (${e.focusConflict.peers} tab)` : ''), 'fokus konflikti'],
      [rel(e.firstInteractionMs), 'ilk təmas'],
      [rel(e.dataDomMs), 'həssas data DOM-da'],
    ];
    $('#early-facts').innerHTML = facts.map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${l}</span></div>`).join('');
  }

  function renderArrival(arrival) {
    if (!arrival) { $('#arrival-title').textContent = 'Sessiya limiti doldu'; return; }
    const s = arrival.signature;
    $('#arrival-title').textContent = SIG[s.status] || s.status;
    $('#arrival-reason').textContent = s.reason;
    $('#arrival-facts').innerHTML = [
      [`${arrival.checkedMs} ms`, 'yoxlama müddəti'],
      [`${s.present.signature ? 'var' : 'yox'} / ${s.present.signatureInput ? 'var' : 'yox'} / ${s.present.signatureAgent ? 'var' : 'yox'}`, 'Signature / Input / Agent'],
      [arrival.secFetch.user || '—', 'Sec-Fetch-User'],
      [arrival.uaMajor || '—', 'brauzer major versiya'],
      [(arrival.environment && arrival.environment.agentAppToken) || 'yox', 'agent tətbiqi tokeni (UA)'],
      [arrival.environment ? (arrival.environment.clientHints ? 'var' : 'yox') : '—', 'Sec-CH-UA client hints'],
    ].map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${l}</span></div>`).join('');
  }

  function renderPolicy(p) {
    $('#policy-title').textContent = `${p.version} · ${p.enforcement === 'enforce' ? 'icra rejimi' : 'müşahidə rejimi'}`;
    $('#policy-table tbody').innerHTML = p.rules.map((r) => `<tr><td><code>${esc(r.resource)}</code><br><span class="muted small">${esc(r.title)}</span></td><td><span class="decision ${r.onAgent}">${DEC[r.onAgent]}</span></td><td><span class="decision ${r.onArtifact || 'allow'}">${DEC[r.onArtifact || 'allow']}</span></td><td><span class="decision ${r.onUnknown}">${DEC[r.onUnknown]}</span></td><td><span class="decision ${r.onHumanLike}">${DEC[r.onHumanLike]}</span></td></tr>`).join('');
  }

  const RES_TITLES = {};
  const VIEW = {
    kv: (d, body) => { body.innerHTML = (d.data || []).map((row) => `<span>${esc(row.label)}</span><strong>${esc(row.value)}</strong>`).join(''); body.className = 'body kv'; },
    number: (d, body) => { body.className = 'body'; body.innerHTML = `<div class="big">${d.data.value == null ? '•••' : Number(d.data.value).toLocaleString('az-AZ', { minimumFractionDigits: 2 })} ${esc(d.data.unit || '')}</div><div class="small muted">${esc(d.data.note || '')}</div>`; },
    table: (d, body) => {
      body.className = 'body';
      const cols = d.data.columns || []; const rows = d.data.rows || [];
      if (!rows.length) { body.innerHTML = '<span class="muted">Uyğun sətir yoxdur.</span>'; return; }
      const th = cols.map((c) => `<th${c.align === 'right' ? ' style="text-align:right"' : ''}>${esc(c.label)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${cols.map((c) => `<td${c.align === 'right' ? ' style="text-align:right"' : ''}>${r[c.key] == null ? '•••' : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
      body.innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
    },
    text: (d, body) => { body.className = 'body'; body.innerHTML = `<strong>${esc(d.data.title || '')}</strong>${(d.data.paragraphs || []).map((p) => `<p class="small" style="margin:6px 0">${esc(p)}</p>`).join('')}`; },
  };

  function buildCards(app) {
    const host = $('#cards');
    host.innerHTML = app.resources.map((r) => {
      RES_TITLES[r.id] = r.title;
      const slug = r.id.replace(/\./g, '-');
      const input = r.input ? `<form class="row" data-form="${r.id}"><input data-input="${r.id}" placeholder="${esc(r.input.placeholder)}" maxlength="80" autocomplete="off"><button type="submit" class="primary" data-action="${r.id}">${esc(r.button)}</button></form>` : '';
      const button = r.input ? '' : `<div class="row" style="margin-top:8px"><button class="primary" data-action="${r.id}">${esc(r.button)}</button></div>`;
      return `<div class="card" id="card-${slug}"><header><strong>${esc(r.title)}</strong><span class="tag mono">${esc(r.id)}</span></header>${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ''}${input}<div class="body" id="body-${slug}">${r.view === 'download' ? '' : '<span class="muted">Hələ sorğu edilməyib.</span>'}</div><div id="state-${slug}"></div>${button}</div>`;
    }).join('');
  }

  async function loadMe() {
    const r = await fetch(`/api/v1/session${q}`, { cache: 'no-store', headers: SH() });
    if (!r.ok) { $('#banner').hidden = false; $('#banner').textContent = 'Sessiya tapılmadı. Səhifəni yenilə (otaq sessiya limitinə çatmış ola bilər).'; return; }
    me = await r.json();
    const apps = await (await fetch('/api/v1/apps', { cache: 'no-store' })).json();
    app = apps.apps.find((a) => a.id === me.app) || apps.apps[0];
    document.title = `${app.name} · NanoTarget MVP`;
    document.documentElement.style.setProperty('--accent', app.accent);
    $('#app-name').textContent = app.name;
    $('#app-tagline').textContent = app.tagline;
    $('#app-initials').textContent = app.initials;
    $('#app-sector').textContent = app.sector;
    $('#account-title').textContent = app.accountTitle;
    $('#app-intro').textContent = app.intro;
    buildCards(app);
    $('#session-label').textContent = `${me.session.slice(0, 8)} · ${me.label === 'human' ? 'insan testi' : me.label === 'agent' ? 'agent testi' : 'etiketsiz'}${me.scenario ? ' · ' + me.scenario : ''}`;
    $('#session-label').className = `tag ${me.label === 'human' ? 'human' : me.label === 'agent' ? 'agent' : ''}`;
    $('#live').classList.add('on'); $('#live').lastChild.textContent = 'canlı';
    const human = new URL(location.href); human.searchParams.set('as', 'human'); human.searchParams.delete('scenario');
    $('#human-link').href = human.href;
    $('#dashboard-link').href = `/dashboard${q}`; $('#dashboard-link-2').href = `/dashboard${q}`;
    renderArrival(me.arrival);
    renderPolicy(me.policy);
    if (me.connection) renderConnection(me.connection, null);
    const agentUrl = new URL(location.href); agentUrl.searchParams.set('as', 'agent'); agentUrl.searchParams.delete('scenario');
    const steps = app.promptSteps.map((st, i) => `${i + 2}. ${st}`).join('\n');
    $('#prompt').value = `Brauzer alətinlə bu səhifəni aç: ${agentUrl.href}

Bu, ${app.name} adlı sintetik ${app.sector.toLowerCase()} tətbiqidir; real məlumat yoxdur. Yalnız görünən interfeysdən istifadə et. Birbaşa API sorğusu göndərmə, səhifəyə JavaScript yeritmə.

1. Heç nəyə klikləmədən 5 saniyə gözlə. "Qoşulma anı" və "Server / ilk HTTP sorğusu" bölmələrini oxu.
${steps}

Sonda hər addımda hansı qərarın verildiyini (icazə / maskalandı / təsdiq tələbi / bloklandı), "Canlı qiymətləndirmə" bölməsindəki aktoru, balı və səbəb kodlarını olduğu kimi yaz. Nəticəni gözəlləşdirmə; bloklanıbsa bloklandığını yaz.`;
  }

  async function refreshJournal() {
    const [j, b] = await Promise.all([fetch(`/api/v1/journal${q}`, { cache: 'no-store' }).then((r) => r.json()), fetch(`/api/v1/benchmark${q}`, { cache: 'no-store' }).then((r) => r.json())]);
    if (j.error) return;
    const counts = {};
    for (const d of j.decisions) counts[d.session] = (counts[d.session] || 0) + 1;
    const firstDecision = {};
    for (const d of j.decisions) if (!firstDecision[d.session] || d.created < firstDecision[d.session]) firstDecision[d.session] = d.created;
    $('#sessions-table tbody').innerHTML = j.sessions.slice(-15).reverse().map((s) => {
      const before = s.firstAgentAt != null && (s.firstDataAt == null || s.firstAgentAt <= s.firstDataAt);
      const atConnect = s.firstAgentAt != null && (!firstDecision[s.id] || s.firstAgentAt < firstDecision[s.id]);
      const c = s.connection;
      const connCell = c ? `<span class="decision ${CONN_CLASS[c.state] || 'allow'}">${CONN[c.state]}</span>${c.tools.length ? `<br><span class="small muted">${esc(c.tools.join(', '))}</span>` : ''}` : '—';
      const attachCell = s.agentAttachedAt ? `${rel(s.agentAttachedAt - s.created)}${s.agentAttachedClientMs != null ? `<br><span class="small muted">səhifədə ${rel(s.agentAttachedClientMs)}</span>` : ''}` : '—';
      return `<tr class="${me && s.id === me.session ? 'mine' : ''}"><td><code>${s.id.slice(0, 8)}</code>${me && s.id === me.session ? ' <span class="tag">bu tab</span>' : ''}</td><td><span class="tag ${s.label === 'human' ? 'human' : s.label === 'agent' ? 'agent' : ''}">${s.label}</span>${s.scenario ? `<br><span class="small muted">${esc(s.scenario)}</span>` : ''}</td><td>${connCell}</td><td>${attachCell}</td><td>${firstDecision[s.id] ? rel(firstDecision[s.id] - s.created) : '—'}</td><td>${s.firstAgentAt ? rel(s.firstAgentAt - s.created) : '—'}</td><td>${s.firstDataAt ? rel(s.firstDataAt - s.created) : 'verilməyib'}</td><td>${s.firstAgentAt ? (atConnect ? '<span class="tag human">qoşulma anında</span>' : before ? '<span class="tag human">bəli</span>' : '<span class="tag agent">xeyr, gec</span>') : '—'}</td><td>${counts[s.id] || 0}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">Hələ sessiya yoxdur.</td></tr>';
    $('#journal-table tbody').innerHTML = j.decisions.slice(0, 60).map((d) => `<tr class="${me && d.session === me.session ? 'mine' : ''}"><td class="mono">${time(d.created)}</td><td><code>${d.session.slice(0, 8)}</code></td><td>${RES_TITLES[d.resource] || RES[d.resource] || esc(d.resource)}</td><td><span class="decision ${d.decision}${d.enforced ? '' : ' shadow'}">${DEC[d.decision]}</span>${d.enforced ? '' : `<br><span class="small muted">müşahidə: ${DEC[d.computed]}</span>`}</td><td><span class="tag ${d.actor === 'agent_likely' ? 'agent' : d.actor === 'human_like' ? 'human' : 'unknown'}">${ACTOR[d.actor]}${d.score != null ? ' · ' + d.score : ''}</span></td><td class="small">${d.reasonCodes.slice(0, 3).map((c) => `<code>${esc(c)}</code>`).join(' ')}</td><td class="mono">${d.latencyMs} ms</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Hələ qərar yoxdur.</td></tr>';
    const g = b.groups;
    $('#benchmark').innerHTML = ['human', 'agent', 'unlabelled'].map((k) => `<div><strong>${g[k].sessions} sessiya</strong><span>${k === 'human' ? 'insan' : k === 'agent' ? 'agent' : 'etiketsiz'} · <b>qoşulub ${g[k].attached}</b> (əməliyyatdan əvvəl ${g[k].attachedBeforeFirstAction}, median ${g[k].medianAttachMs != null ? rel(g[k].medianAttachMs) : '—'}) · mühit ${g[k].environmentOnly} · aşkarlanan ${g[k].detected} · blok ${g[k].blocked}</span></div>`).join('') +
      `<div><strong>${b.falseAttachSessions}</strong><span>insan etiketli, “agent qoşulub” sayılan (yanlış)</span></div><div><strong>${b.falseBlockSessions}</strong><span>insan etiketli, bloklanmış sessiya</span></div><div><strong>${b.missedAgentSessions}</strong><span>agent etiketli, məlumat alıb aşkarlanmayan</span></div>`;
    const alien = j.decisions.find((d) => d.actor === 'agent_likely' && me && d.session !== me.session && d.created > lastAgentBanner);
    if (alien) { lastAgentBanner = alien.created; $('#banner').hidden = false; $('#banner').innerHTML = `<strong>Agent siqnalı</strong> · ${alien.session.slice(0, 8)} sessiyasında <code>${esc(alien.resource)}</code> üçün qərar: ${DEC[alien.decision]}. ${alien.reasonCodes.slice(0, 2).map(esc).join(', ')}.`; }
  }

  // ------------------------------------------------------------- WebAuthn
  const b64uToBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const bufToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const webauthnAvailable = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  let passkeys = [];

  async function refreshPasskeys() {
    const r = await fetch(`/api/v1/webauthn/status${q}`, { cache: 'no-store', headers: SH() });
    if (!r.ok) return;
    const d = await r.json();
    passkeys = d.credentials || [];
    const el = $('#passkey-status');
    if (!el) return;
    const verified = d.humanVerifiedAt && Date.now() - d.humanVerifiedAt < d.validForMs;
    el.innerHTML = `${passkeys.length ? `<span class="tag human">${passkeys.length} passkey qeydiyyatda</span>` : '<span class="tag">passkey yoxdur</span>'} ${verified ? `<span class="tag human">insan təsdiqi aktiv · ${Math.round((d.validForMs - (Date.now() - d.humanVerifiedAt)) / 1000)} s</span>` : ''}${webauthnAvailable() ? '' : ' <span class="tag agent">bu brauzerdə WebAuthn yoxdur</span>'}`;
    $('#passkey-register').disabled = !webauthnAvailable();
    $('#passkey-reclaim').disabled = !webauthnAvailable() || !passkeys.length;
  }

  async function registerPasskey() {
    const el = $('#passkey-result');
    try {
      const o = await (await fetch(`/api/v1/webauthn/register/options${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: '{}' })).json();
      const pk = o.publicKey;
      const cred = await navigator.credentials.create({ publicKey: { ...pk, challenge: b64uToBuf(pk.challenge), user: { ...pk.user, id: b64uToBuf(pk.user.id) }, excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) } });
      const r = await fetch(`/api/v1/webauthn/register${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ challengeId: o.challengeId, id: cred.id, clientDataJSON: bufToB64u(cred.response.clientDataJSON), attestationObject: bufToB64u(cred.response.attestationObject), label: 'Touch ID / passkey' }) });
      const d = await r.json();
      el.innerHTML = r.ok ? `<div class="state allow">Passkey qeydə alındı (alg ${d.credential.alg}). Serverdə yalnız açıq açar saxlanır.</div>` : `<div class="state block">${esc(d.message || d.error)}</div>`;
    } catch (e) {
      el.innerHTML = `<div class="state block">${esc(e.message)}</div>`;
    }
    refreshPasskeys().catch(() => {});
  }

  /** Ask the authenticator for a user-verified assertion; on success the session is human-verified and `resource` is granted once. */
  async function reclaimWithPasskey(resource) {
    const o = await (await fetch(`/api/v1/webauthn/assert/options${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ resource: resource || null }) })).json();
    if (o.error) throw new Error(o.message || o.error);
    const pk = o.publicKey;
    const cred = await navigator.credentials.get({ publicKey: { ...pk, challenge: b64uToBuf(pk.challenge), allowCredentials: (pk.allowCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) } });
    const r = await fetch(`/api/v1/webauthn/assert${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ challengeId: o.challengeId, id: cred.id, clientDataJSON: bufToB64u(cred.response.clientDataJSON), authenticatorData: bufToB64u(cred.response.authenticatorData), signature: bufToB64u(cred.response.signature) }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.error);
    refreshPasskeys().catch(() => {});
    refreshConnection().catch(() => {});
    return d;
  }

  // ------------------------------------------------------------- actions
  async function stepUp(info) {
    // Prefer WebAuthn when a passkey exists: an agent can type a code it sees, it cannot pass user verification.
    if (info.webauthn && passkeys.length && webauthnAvailable()) {
      try { await reclaimWithPasskey(info.resource || null); return true; } catch (e) { $('#banner').hidden = false; $('#banner').textContent = 'Passkey təsdiqi alınmadı: ' + e.message + '. Kod ilə davam edilir.'; if (info.reclaim) return false; }
    }
    if (info.reclaim) return false;
    return new Promise((resolve) => {
      const dlg = $('#stepup');
      $('#stepup-code').textContent = info.challenge;
      $('#stepup-answer').value = '';
      $('#stepup-error').textContent = '';
      const form = $('#stepup-form');
      const onSubmit = async (e) => {
        e.preventDefault();
        const r = await fetch('/api/v1/step-up', { method: 'POST', headers: { 'Content-Type': 'application/json', ...SH() }, body: JSON.stringify({ id: info.id, answer: $('#stepup-answer').value }) });
        const d = await r.json();
        if (!r.ok) { $('#stepup-error').textContent = d.message || d.error; return; }
        cleanup(); dlg.close(); resolve(true);
      };
      const onCancel = () => { cleanup(); dlg.close(); resolve(false); };
      const cleanup = () => { form.removeEventListener('submit', onSubmit); $('#stepup-cancel').removeEventListener('click', onCancel); };
      form.addEventListener('submit', onSubmit);
      $('#stepup-cancel').addEventListener('click', onCancel);
      dlg.showModal();
      $('#stepup-answer').focus();
    });
  }

  async function call(url, init, stateEl, render, retried) {
    const r = await window.NanoTarget.fetch(url, init);
    const d = await r.json();
    if (d.assessment) renderAssessment(d.assessment);
    const resource = (d.decision && d.decision.resource) || null;
    if (r.status === 428 && !retried) {
      stateEl.innerHTML = decisionHtml(d.decision, d.stepUp && d.stepUp.webauthn && passkeys.length ? 'Əlavə təsdiq: passkey / Touch ID istənilir.' : 'Əlavə təsdiq tələb olundu. Kod dialoqda göstərilir.');
      const ok = await stepUp({ ...d.stepUp, resource });
      if (ok) return call(url, init, stateEl, render, true);
      return;
    }
    if (r.status === 428) { stateEl.innerHTML = decisionHtml(d.decision, 'Təsdiq qəbul edilmədi.'); return; }
    if (r.status === 403 && d.stepUp && d.stepUp.reclaim && !retried) {
      const canReclaim = passkeys.length && webauthnAvailable();
      stateEl.innerHTML = decisionHtml(d.decision, canReclaim
        ? 'Sessiyaya agent qoşulub. Sən insansansa, aşağıdakı düymə ilə Touch ID / passkey təsdiqi verib sessiyanı geri ala bilərsən.'
        : 'Sessiyaya agent qoşulub. Geri almaq üçün əvvəlcə passkey qeydə alınmalıdır (aşağıda).');
      if (canReclaim) {
        const btn = document.createElement('button'); btn.textContent = 'Touch ID / passkey ilə geri al'; btn.className = 'primary'; btn.style.marginTop = '8px';
        btn.onclick = async () => { btn.disabled = true; try { await reclaimWithPasskey(resource); await call(url, init, stateEl, render, true); } catch (e) { stateEl.insertAdjacentHTML('beforeend', `<div class="state block">${esc(e.message)}</div>`); } };
        stateEl.appendChild(btn);
      }
      render(null, d);
      return;
    }
    if (r.status === 403) { stateEl.innerHTML = decisionHtml(d.decision, 'Server məlumatı vermədi. Səhifədə göstəriləcək heç nə yoxdur.'); render(null, d); return; }
    if (!r.ok) { stateEl.innerHTML = `<div class="state block">${esc(d.message || d.error || r.status)}</div>`; return; }
    stateEl.innerHTML = decisionHtml(d.decision, d.masked ? 'Maskalanmış məlumat qaytarıldı; həssas sahələr serverdə silinib.' : (d.decision.enforced ? '' : 'Müşahidə rejimi: qərar yalnız jurnala yazıldı.'));
    render(d);
  }

  async function download(d, stateEl) {
    if (!d || !d.downloadUrl) return;
    const r = await fetch(d.downloadUrl, { cache: 'no-store', headers: SH() });
    let note;
    if (r.ok) {
      const blob = await r.blob();
      const name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'nanotarget-export';
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = u; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
      const again = await fetch(d.downloadUrl, { cache: 'no-store', headers: SH() });
      const ad = await again.json().catch(() => ({}));
      note = `Fayl endirildi (${blob.size} bayt). Eyni linki təkrar çağırdıq: HTTP ${again.status} · ${esc(ad.reason || '')} — token birdəfəlikdir.`;
    } else {
      const ed = await r.json().catch(() => ({}));
      note = `Fayl verilmədi: HTTP ${r.status} · ${esc(ed.reason || ed.error || '')}`;
    }
    stateEl.innerHTML = decisionHtml(d.decision, note);
  }

  async function runResource(id) {
    const def = app.resources.find((r) => r.id === id);
    if (!def) return;
    const slug = id.replace(/\./g, '-');
    const stateEl = $(`#state-${slug}`);
    const body = $(`#body-${slug}`);
    const input = def.input ? ($(`[data-input="${id}"]`) || {}).value || '' : '';
    const urlStr = `/api/v1/r/${id}${q}${def.input ? `&q=${encodeURIComponent(input)}` : ''}`;
    await call(urlStr, { method: def.method }, stateEl, async (d) => {
      if (!d) { if (body) body.innerHTML = `<span class="muted">${esc(def.title)} verilmədi.</span>`; return; }
      if (def.view === 'download') { await download(d, stateEl); return; }
      body.setAttribute('data-nt-sensitive', d.masked ? 'masked' : 'full');
      (VIEW[def.view] || VIEW.kv)(d, body);
    });
  }

  const actions = {
    signed: async () => {
      const el = $('#signed-state');
      el.innerHTML = '<span class="muted small">İmzalanır və göndərilir…</span>';
      const r = await fetch('/api/v1/simulate/signed' + q, { method: 'POST', headers: SH() });
      const d = await r.json();
      if (!r.ok) { el.innerHTML = `<div class="state block">${esc(d.message || d.error)}</div>`; return; }
      el.innerHTML = d.runs.map((run, i) => run.body.decision ? decisionHtml(run.body.decision, `${i + 1}-ci sorğu · HTTP ${run.status}`) : `<div class="state block">HTTP ${run.status} · ${esc(JSON.stringify(run.body).slice(0, 200))}</div>`).join('') + `<p class="small muted">${esc(d.note)} Operator: <code>${esc(d.operator)}</code></p>`;
    },
  };

  $('#passkey-register').addEventListener('click', () => { $('#passkey-register').disabled = true; registerPasskey().finally(() => { $('#passkey-register').disabled = !webauthnAvailable(); }); });
  $('#passkey-reclaim').addEventListener('click', async () => {
    const el = $('#passkey-result');
    try { const d = await reclaimWithPasskey(null); el.innerHTML = `<div class="state allow">${esc(d.message)} ${Math.round(d.validForMs / 60000)} dəqiqə ərzində qərarlar insan kimi verilir.</div>`; refreshJournal().catch(() => {}); } catch (e) { el.innerHTML = `<div class="state block">${esc(e.message)}</div>`; }
  });

  const run = (id, b) => { if (b) b.disabled = true; Promise.resolve(actions[id] ? actions[id]() : runResource(id)).catch((err) => { $('#banner').hidden = false; $('#banner').textContent = 'Xəta: ' + err.message; }).finally(() => { if (b) b.disabled = false; refreshJournal().catch(() => {}); }); };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b || b.closest('form[data-form]')) return;
    run(b.dataset.action, b);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    run(f.dataset.form, f.querySelector('button'));
  });
  $('#copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); $('#copy-link').textContent = 'Kopyalandı'; } catch { /* ignore */ } });
  $('#copy-prompt').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#prompt').value); $('#copy-prompt').textContent = 'Prompt kopyalandı'; } catch { /* ignore */ } });

  // WebMCP: expose a read-only tool. Invocation counts as strong evidence.
  window.NanoTarget.registerTool({
    name: 'read_account_activity',
    title: 'Read account activity',
    description: 'Read recent NanoTarget decisions for this lab room. Read-only; does not fetch account data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => fetch(`/api/v1/journal${q}`).then((r) => r.json()),
  });

  // Live stream: the moment any session in this room gets an agent attached, show it.
  const serverless = (document.querySelector('meta[name="nt-serverless"]') || {}).content === '1';
  if ((document.querySelector('meta[name="nt-ephemeral"]') || {}).content === '1') { $('#banner').hidden = false; $('#banner').textContent = 'Diqqət: verilənlər bazası qoşulmayıb, sessiyalar yalnız bir server nüsxəsində saxlanır. Test nəticələri itə bilər.'; }
  try {
    if (serverless) throw new Error('serverless');
    const es = new EventSource(`/api/v1/stream${q}`);
    es.addEventListener('attach', (ev) => {
      const e = JSON.parse(ev.data);
      const mine = me && e.session === me.session;
      $('#banner').hidden = false;
      $('#banner').innerHTML = `<strong>Agent qoşuldu</strong> · ${mine ? 'bu tab' : e.session.slice(0, 8)} · səhifə açılışından ${rel(e.sinceStartMs)} · ${esc(e.connection.tools.join(', '))} · ${e.connection.evidence.slice(0, 2).map((x) => `<code>${esc(x.code)}</code>`).join(' ')}`;
      if (mine) refreshConnection().catch(() => {});
      refreshJournal().catch(() => {});
    });
  } catch { /* EventSource unavailable */ }

  window.NanoTarget.onAssessment((a, _snap, c) => { renderAssessment(a); renderEarly(); if (c) renderConnection(c, null); refreshConnection().catch(() => {}); });
  loadMe().then((d) => { window.NanoTarget.flush(); refreshConnection(); refreshPasskeys(); }).catch(() => {});
  setInterval(() => refreshPasskeys().catch(() => {}), 10000);
  setInterval(() => refreshConnection().catch(() => {}), 3000);
  renderEarly();
  setInterval(renderEarly, 1000);
  setInterval(() => refreshJournal().catch(() => {}), 2500);
  refreshJournal().catch(() => {});
})();
