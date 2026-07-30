/* =============================================================
   version.js — Mostra il numero di versione dell'app (public/version.json).
   Lo stampa nella targhetta Beta (top bar) e nei footer legali.
   ============================================================= */
import { el } from './ui.js';

let cached = null;
export async function getVersion() {
  if (cached !== null) return cached;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    cached = (await res.json()).version || '';
  } catch { cached = ''; }
  return cached;
}

/** Inserisce la versione dove utile (targhetta Beta, footer legali, [data-version]). */
export async function stampVersion() {
  const v = await getVersion();
  if (!v) return;
  document.querySelectorAll('.beta-tag').forEach((b) => { b.textContent = `Beta v${v}`; });
  document.querySelectorAll('.legal-footer').forEach((f) => {
    if (!f.querySelector('.ver')) f.append(el('span', { class: 'ver', text: `v${v}` }));
  });
  document.querySelectorAll('[data-version]').forEach((n) => { n.textContent = `v${v}`; });
}

export default stampVersion;
