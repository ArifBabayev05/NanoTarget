// SPDX-License-Identifier: BUSL-1.1
/* Applies the saved theme before first paint, so light mode never flashes dark (and vice versa). */
try {
  var t = localStorage.getItem('nt-theme') || 'system';
  document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
} catch (e) { /* private mode: the page script sets it after load */ }
