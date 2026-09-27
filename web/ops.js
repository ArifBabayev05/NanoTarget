// SPDX-License-Identifier: BUSL-1.1
// The operators' view of onehuman.ai. Every value from the database goes through esc() before it reaches the page.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (v) => Number(v ?? 0).toLocaleString('en-US');
  const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const ago = (t) => { if (!t) return '—'; const s = (Date.now() - t) / 1000; return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const dur = (a, b) => { if (!a || !b) return '—'; const s = (b - a) / 1000; return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`; };
  const range = () => $('#range').value;
  const api = async (path, params = {}) => {
    const q = new URLSearchParams({ range: range(), ...params });
    const r = await fetch(`/api/v1/ops/${path}?${q}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  const list = (items, empty = 'nothing yet') => items.length ? `<ul class="list">${items.map((x) => `<li><span>${esc(x.key)}</span><em>${num(x.n)}</em></li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;
  const kpi = (v, label) => `<div class="kpi"><b>${num(v)}</b><span>${esc(label)}</span></div>`;
  const decisionPill = (d) => `<span class="pill ${d === 'allow' ? 'ok' : d === 'block' ? 'bad' : 'agent'}">${esc(d)}</span>`;
  const table = (head, rows) => `<div class="tbl-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">nothing yet</td></tr>`}</tbody></table></div>`;

  // ------------------------------------------------------------------ overview
  async function overview() {
    const o = await api('overview');
    const max = Math.max(1, ...o.series.map((d) => d.devices));
    const demoTests = o.demo.decisions.reduce((a, x) => a + x.n, 0);
    $('#tab-overview').innerHTML = `
      <h2>Visitors</h2>
      <div class="kpis">${kpi(o.visitors.devices, 'devices (people, roughly)')}${kpi(o.visitors.mobile, 'of them on a phone')}${kpi(o.visitors.views, 'page views')}${kpi(o.visitors.bots, 'bots / crawlers (not counted)')}</div>
      <div class="card" style="margin-top:12px"><h3>Devices per day</h3><div class="bars">${o.series.map((d) => `<i style="height:${(d.devices / max) * 100}%" data-t="${esc(new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))}: ${d.devices} devices, ${d.views} views"></i>`).join('')}</div></div>
      <h2>What they tested (demo)</h2>
      <div class="kpis">${kpi(o.demo.devices, 'devices that opened a demo')}${kpi(o.demo.sessions, 'demo sessions')}${kpi(o.demo.agentSessions, 'sessions where an AI agent was seen')}${kpi(o.demo.passkey, 'sessions taken back with a passkey')}${kpi(demoTests, 'protected requests decided')}</div>
      <div class="grid" style="margin-top:12px">
        <div class="card"><h3>Decisions</h3>${list(o.demo.decisions)}</div>
        <div class="card"><h3>Who the engine saw</h3>${list(o.demo.actors)}</div>
        <div class="card"><h3>Agent tools detected (sessions)</h3>${list(o.demo.tools, 'no agent tool seen yet')}</div>
        <div class="card"><h3>Demo apps</h3>${list(o.demo.apps)}</div>
      </div>
      <h2>Portal &amp; integrations</h2>
      <div class="kpis">${kpi(o.portal.accounts, `accounts (${o.portal.newAccounts} new in range)`)}${kpi(o.portal.keys, 'active API keys')}${kpi(o.portal.liveKeys, 'keys that reported in range')}${kpi(o.portal.integrationsSeen, 'servers that fetched their rules')}${kpi(o.portal.events, 'decisions reported by customer servers')}${kpi(o.portal.agentSessions, 'customer sessions with an agent')}${kpi(o.portal.assistCalls, 'AI assistant calls')}</div>
      <div class="grid" style="margin-top:12px">
        <div class="card"><h3>"This decision was wrong / right" marks</h3>${list(o.portal.feedback, 'no marks yet')}</div>
        <div class="card"><h3>Labelled lab clicks (label → verdict)</h3>${list(o.lab.samples, 'no labelled clicks in range')}</div>
      </div>
      <h2>Where from</h2>
      <div class="grid">
        <div class="card"><h3>Pages</h3><ul class="list">${o.pages.map((p) => `<li><span class="mono">${esc(p.key)}</span><em>${num(p.n)} · ${num(p.devices)} dev</em></li>`).join('') || '<li class="muted">nothing yet</li>'}</ul></div>
        <div class="card"><h3>Countries</h3>${list(o.countries)}</div>
        <div class="card"><h3>Browsers</h3>${list(o.browsers)}</div>
        <div class="card"><h3>Operating systems</h3>${list(o.os)}</div>
        <div class="card"><h3>Referrers</h3>${list(o.referrers, 'direct only')}</div>
      </div>
      <p class="note">A device is a keyed hash of IP address + browser: the same person on another network counts again. Bots and crawlers are left out of every count.</p>`;
  }

  // ------------------------------------------------------------------ devices
  async function devices() {
    const { devices: d } = await api('devices');
    $('#tab-devices').innerHTML = `<h2>${num(d.length)} devices</h2>` + table(
      ['Last seen', 'First seen', 'Browser', 'Where', 'Views', 'Actions', 'Demo sessions', 'Agent seen', 'Decisions', 'Portal account', 'Pages'],
      d.map((x) => `<tr class="click" data-device="${esc(x.device)}"><td>${esc(ago(x.last))}</td><td>${esc(when(x.first))}</td><td>${esc(x.browser)} · ${esc(x.os)}${x.mobile ? ' · 📱' : ''}</td>
        <td>${esc([x.city, x.country].filter(Boolean).join(', ') || '—')}</td><td>${num(x.views)}</td><td>${num(x.actions)}</td><td>${num(x.sessions)}</td>
        <td>${x.agentSessions ? `<span class="pill agent">${num(x.agentSessions)}</span>` : '—'}</td><td>${num(x.decisions)}</td><td>${esc(x.accounts.join(', ') || '—')}</td>
        <td class="wrap mono">${esc(x.paths.join('  '))}</td></tr>`));
    for (const tr of document.querySelectorAll('#tab-devices tr[data-device]')) tr.addEventListener('click', () => deviceDetail(tr.dataset.device));
  }

  async function deviceDetail(device) {
    const [{ sessions }, { rows }] = await Promise.all([api('demo', { device, range: 'all' }), api('log', { device })]);
    open(`<h2>Device <code>${esc(device)}</code></h2>
      <h2>Demo sessions</h2>${sessionTable(sessions)}
      <h2>Log</h2>${logTable(rows)}`);
  }

  // ------------------------------------------------------------------ demo
  const sessionRow = (x) => {
    const decs = {};
    for (const d of x.decisions) decs[d.d] = (decs[d.d] ?? 0) + 1;
    const agent = x.attachedAt || x.firstAgentAt;
    return `<tr class="click" data-session="${esc(x.id)}"><td>${esc(when(x.created))}</td><td>${esc(x.app)}</td><td>${esc(x.client ?? '—')}</td><td>${esc(dur(x.created, x.lastSeen))}</td>
      <td>${agent ? `<span class="pill agent">agent · ${esc(dur(x.created, agent))} in</span>` : '<span class="pill">no agent</span>'}</td>
      <td>${x.tools.map((t) => `<span class="pill agent">${esc(t)}</span>`).join('') || '—'}</td>
      <td>${Object.entries(decs).map(([k, v]) => `${decisionPill(k)}×${v}`).join(' ') || '—'}</td>
      <td>${x.passkeyAt ? '<span class="pill ok">passkey</span>' : '—'}</td><td>${num(x.events)}</td><td>${esc(x.label)}</td></tr>`;
  };
  const sessionTable = (s) => table(['Started', 'App', 'Device', 'Length', 'Agent', 'Tools seen', 'Decisions', 'Reclaimed', 'Events', 'Label'], s.map(sessionRow));
  const bindSessions = (root) => { for (const tr of root.querySelectorAll('tr[data-session]')) tr.addEventListener('click', () => sessionDetail(tr.dataset.session)); };

  async function demo() {
    const { sessions } = await api('demo');
    const agents = sessions.filter((x) => x.attachedAt || x.firstAgentAt).length;
    $('#tab-demo').innerHTML = `<h2>${num(sessions.length)} demo sessions · ${num(agents)} with an AI agent</h2>${sessionTable(sessions)}
      <p class="note">Click a row for the full timeline: what the page sent, when the agent appeared, every decision and why.</p>`;
    bindSessions($('#tab-demo'));
  }

  async function sessionDetail(id) {
    const r = await fetch(`/api/v1/ops/session?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!r.ok) return;
    const { session: s, events, decisions } = await r.json();
    open(`<h2>Session <code>${esc(s.id)}</code> · ${esc(s.app)}</h2>
      <p>${esc(when(s.created))} → ${esc(when(s.lastSeen))} · device <code>${esc(s.device ?? '—')}</code> · agent first seen ${esc(s.firstAgentAt ? dur(s.created, s.firstAgentAt) + ' in' : 'never')} · attached ${esc(s.attachedAt ? dur(s.created, s.attachedAt) + ' in' : 'never')} · passkey ${esc(s.passkeyAt ? when(s.passkeyAt) : 'no')}</p>
      <h2>Decisions (${decisions.length})</h2>
      ${table(['#', 'At', 'Resource', 'Decision', 'Actor', 'Score', 'Tools', 'Reasons'], decisions.map((d) => { const b = d.body ?? {}; return `<tr><td>${d.seq}</td><td>${esc(when(d.at))}</td><td class="mono">${esc(b.resource)}</td><td>${decisionPill(b.decision)}</td><td>${esc(b.actor)}</td><td>${esc(b.score ?? '—')}</td><td>${esc((b.tools ?? []).join(', ') || '—')}</td><td class="wrap mono">${esc((b.reasonCodes ?? []).join(' '))}</td></tr>`; }))}
      <h2>Events (${events.length})</h2>
      ${events.map((e) => `<details><summary>${esc(when(e.at))} · <b>${esc(e.kind)}</b></summary><pre>${esc(JSON.stringify(e.payload, null, 2))}</pre></details>`).join('') || '<p class="muted">none</p>'}`);
  }

  // ------------------------------------------------------------------ portal
  async function portal() {
    const p = await api('portal');
    $('#tab-portal').innerHTML = `
      <h2>${num(p.accounts.length)} accounts</h2>
      ${table(['E-mail', 'Signed up', 'API keys', 'Admin keys', 'Last server report', 'Last visit', 'Assistant calls'], p.accounts.map((a) => `<tr><td>${esc(a.email)}</td><td>${esc(when(a.created))}</td><td>${num(a.keys)}</td><td>${num(a.adminKeys)}</td><td>${esc(ago(a.lastSeen))}</td><td>${esc(ago(a.lastVisit))}</td><td>${num(a.assist)}</td></tr>`))}
      <h2>Integrations (API keys)</h2>
      ${table(['Account', 'Key', 'Env', 'Created', 'Last report', 'Decisions (all)', 'In range', 'Agent sessions', 'Mode', 'Rules', 'Endpoints', 'State'], p.keys.map((k) => `<tr><td>${esc(k.email)}</td><td>${esc(k.name)} <code>${esc(k.prefix)}…</code></td><td>${esc(k.env)}</td><td>${esc(when(k.created))}</td>
        <td>${k.lastSeen ? `<span class="pill ok">${esc(ago(k.lastSeen))}</span>` : '<span class="pill">never connected</span>'}</td><td>${num(k.events)}</td><td>${num(k.eventsInRange)}</td><td>${k.agentSessions ? `<span class="pill agent">${num(k.agentSessions)}</span>` : '0'}</td>
        <td>${esc(k.modes ?? '—')}</td><td>${k.policy ? `v${num(k.policy.n)}${k.policy.seenVersion ? ` · server on ${esc(k.policy.seenVersion)} (${esc(k.policy.seenSource)}, ${esc(ago(k.policy.seenAt))})` : ''}` : '—'}</td><td>${num(k.resources)}</td><td>${k.revoked ? '<span class="pill bad">revoked</span>' : 'active'}</td></tr>`))}
      <h2>Decisions marked by customers</h2>
      ${table(['Marked', 'Account', 'Key', 'Resource', 'Decision', 'Actor', 'Verdict', 'Note'], p.feedback.map((f) => `<tr><td>${esc(when(f.feedbackAt))}</td><td>${esc(f.email)}</td><td>${esc(f.key)}</td><td class="mono">${esc(f.resource)}</td><td>${decisionPill(f.decision)}</td><td>${esc(f.actor)}</td><td>${f.verdict === 'wrong' ? '<span class="pill bad">wrong</span>' : `<span class="pill ok">${esc(f.verdict)}</span>`}</td><td class="wrap">${esc(f.note ?? '')}</td></tr>`))}`;
  }

  // ------------------------------------------------------------------ log
  const logTable = (rows) => table(['Time', 'Device', 'Account', 'Request', 'Status', 'ms', 'Browser', 'Where', 'From'], rows.map((r) => `<tr><td>${esc(when(r.at))}</td><td><code>${esc(r.device)}</code></td><td>${esc(r.account ?? '—')}</td>
    <td class="mono">${esc(r.method)} ${esc(r.path)}</td><td>${r.status >= 400 ? `<span class="pill bad">${r.status}</span>` : r.status}</td><td>${num(r.ms)}</td><td>${esc(r.browser)} · ${esc(r.os)}${r.bot ? ' · bot' : ''}</td>
    <td>${esc([r.city, r.country].filter(Boolean).join(', ') || '—')}</td><td>${esc(r.referrer ?? '')}</td></tr>`));
  let logRows = [];
  async function log(more = false) {
    const before = more && logRows.length ? { before: String(logRows[logRows.length - 1].id) } : {};
    const { rows } = await api('log', { ...before, bots: $('#bots')?.checked ? '1' : '0' });
    logRows = more ? logRows.concat(rows) : rows;
    const bots = $('#bots')?.checked ?? false;
    $('#tab-log').innerHTML = `<h2>Every page and every call that changed something</h2>
      <label class="muted"><input type="checkbox" id="bots" ${bots ? 'checked' : ''}> include bots</label>
      ${logTable(logRows)}${rows.length === 200 ? '<button class="more" id="log-more">Older</button>' : ''}`;
    $('#bots').addEventListener('change', () => log(false));
    $('#log-more')?.addEventListener('click', () => log(true));
  }

  // ------------------------------------------------------------------ shell
  const dlg = $('#detail');
  function open(html) {
    $('#detail-body').innerHTML = html;
    bindSessions($('#detail-body'));
    if (!dlg.open) dlg.showModal();
  }
  const views = { overview, devices, demo, portal, log };
  let current = 'overview';
  async function show(tab) {
    current = tab;
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const k of Object.keys(views)) $(`#tab-${k}`).hidden = k !== tab;
    try { await views[tab](); } catch (e) { $(`#tab-${tab}`).innerHTML = `<p class="muted">Could not load: ${esc(e.message)}</p>`; }
  }
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => show(b.dataset.tab));
  $('#range').addEventListener('change', () => show(current));
  $('#refresh').addEventListener('click', () => show(current));
  show('overview');
})();
