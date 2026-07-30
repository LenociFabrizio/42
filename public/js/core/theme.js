/* =============================================================
   theme.js — Applica il tema salvato (dark di default). Nessuno
   script inline (CSP): importato come modulo in cima ad ogni pagina.
   ============================================================= */
const KEY = '4e2_theme';

export function applyTheme(theme) {
  const t = theme || localStorage.getItem(KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  return t;
}
export function setTheme(theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// Applica subito all'import.
applyTheme();
