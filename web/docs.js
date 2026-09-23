/* Docs: theme, search, active-section tracking, copy buttons, portal-aware header. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1600); };

  // theme
  const applyTheme = (t) => { document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; $$('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t)); };
  let theme = 'system'; try { theme = localStorage.getItem('nt-theme') || 'system'; } catch {}
  applyTheme(theme);
  $$('#theme button').forEach((b) => b.addEventListener('click', () => { theme = b.dataset.themeSet; try { localStorage.setItem('nt-theme', theme); } catch {} applyTheme(theme); }));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => theme === 'system' && applyTheme('system'));

  // the header knows whether you are signed in
  (async () => {
    try { const r = await fetch('/api/v1/portal/me', { credentials: 'same-origin', cache: 'no-store' }); if (!r.ok) return; const d = await r.json();
      if (d?.account?.email) { $('#portal-link').textContent = 'Open portal →'; $('#portal-link').title = d.account.email; } } catch {}
  })();

  // copy buttons on every code block
  $$('.code').forEach((pre) => {
    const b = document.createElement('button'); b.className = 'copy'; b.textContent = 'Copy';
    b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.textContent.replace(/^Copy/, '')); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400); } catch { toast('Select the text and copy'); } });
    pre.appendChild(b);
  });

  // on-this-page, built from the sections' own headings
  const sections = $$('section[id]');
  $('#toc-links').innerHTML = sections.map((s) => `<a href="#${s.id}">${(s.querySelector('h1,h2') || {}).textContent || s.id}</a>`).join('');
  const tocLinks = $$('#toc-links a'), sideLinks = $$('.side-group a');
  const mark = (id) => { [...tocLinks, ...sideLinks].forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${id}`)); };
  const activate = () => {
    const y = scrollY + 120;
    let cur = sections[0];
    for (const s of sections) { if (!s.hidden && s.offsetTop <= y) cur = s; }
    if (cur) mark(cur.id);
  };
  addEventListener('scroll', activate, { passive: true });
  addEventListener('hashchange', () => setTimeout(activate, 700));
  activate();

  // search: filter sections, highlight hits
  const search = $('#search');
  const clear = () => { sections.forEach((s) => { s.hidden = false; s.classList.remove('hit'); }); };
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (q.length < 2) return clear();
    let first = null;
    sections.forEach((s) => { const hit = s.textContent.toLowerCase().includes(q); s.hidden = !hit; s.classList.toggle('hit', hit); if (hit && !first) first = s; });
    if (first) first.scrollIntoView({ block: 'start' });
  });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea/i.test((e.target && e.target.tagName) || '')) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; clear(); search.blur(); }
  });
  $$('.side-group a, #toc-links a').forEach((a) => a.addEventListener('click', () => { if (search.value) { search.value = ''; clear(); } }));
})();
