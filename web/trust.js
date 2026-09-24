// SPDX-License-Identifier: BUSL-1.1
/* Trust page: the same three-way theme switch the docs use. */
(() => {
  const $$ = (s) => [...document.querySelectorAll(s)];
  const apply = (t) => { document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; $$('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t)); };
  let theme = 'system'; try { theme = localStorage.getItem('nt-theme') || 'system'; } catch { /* private mode */ }
  apply(theme);
  $$('#theme button').forEach((b) => b.addEventListener('click', () => { theme = b.dataset.themeSet; try { localStorage.setItem('nt-theme', theme); } catch { /* ignore */ } apply(theme); }));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => theme === 'system' && apply('system'));
})();
