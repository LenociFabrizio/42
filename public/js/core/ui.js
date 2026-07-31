/* =============================================================
   ui.js — DOM helper, toast, modale/bottom-sheet, conferme,
   formattatori (distanza, tempo, velocità, date), escape HTML.
   ============================================================= */
import { svg } from './icons.js';

/* ---------------- DOM ---------------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/* ---------------- Loader ---------------- */
export const loader = {
  hide() {
    const l = $('#app-loader');
    if (!l) return;
    l.classList.add('hide');
    setTimeout(() => l.remove(), 500);
  },
};

/* ---------------- Toast ---------------- */
const TOAST_ICONS = { success: '✓', error: '✕', warning: '!', info: 'i' };
function toastStack() {
  let s = $('.toast-stack');
  if (!s) { s = el('div', { class: 'toast-stack' }); document.body.append(s); }
  return s;
}
export function toast(message, type = 'info', { title, duration = 3800 } = {}) {
  const stack = toastStack();
  const node = el('div', { class: `toast ${type}` }, [
    el('div', { class: 't-ic', text: TOAST_ICONS[type] || 'i' }),
    el('div', { class: 't-body' }, [
      title ? el('div', { class: 't-title', text: title }) : null,
      el('div', { class: 't-msg', text: message }),
    ]),
    el('button', { class: 't-close', html: '&times;', onClick: () => remove() }),
  ]);
  function remove() { node.classList.add('leaving'); setTimeout(() => node.remove(), 300); }
  stack.append(node);
  if (duration) setTimeout(remove, duration);
  return remove;
}
toast.success = (m, o) => toast(m, 'success', o);
toast.error = (m, o) => toast(m, 'error', o);
toast.warning = (m, o) => toast(m, 'warning', o);
toast.info = (m, o) => toast(m, 'info', o);

/* ---------------- Modal / bottom-sheet ---------------- */
/**
 * Finestra modale / bottom-sheet.
 * @param {object} o
 * @param {boolean} [o.dismissible] se false non si chiude con la X, col tocco
 *   fuori o con Esc: per le scelte obbligatorie (es. l'area di partenza).
 */
export function modal({ title = '', content = '', footer = null, center = false, dismissible = true, onClose } = {}) {
  const overlay = el('div', { class: 'modal-overlay' });
  const body = typeof content === 'string'
    ? el('div', { class: 'modal-body', html: content })
    : el('div', { class: 'modal-body' }, [content]);
  const head = el('div', { class: 'modal-head' }, [
    el('h3', { text: title }),
    dismissible
      ? el('button', { class: 'modal-close', html: '&times;', 'aria-label': 'Chiudi', onClick: () => close() })
      : null,
  ]);
  const modalEl = el('div', { class: `modal ${center ? 'center' : ''}` }, [head, body]);
  if (footer) {
    const foot = el('div', { class: 'modal-foot' });
    if (typeof footer === 'string') foot.innerHTML = footer; else foot.append(...[].concat(footer));
    modalEl.append(foot);
  }
  overlay.append(modalEl);
  if (dismissible) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('open'));

  function onKey(e) { if (dismissible && e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  function close() {
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    setTimeout(() => overlay.remove(), 300);
    onClose?.();
  }
  return { close, root: modalEl, body };
}

export function confirmDialog({ title = 'Confermi?', message = '', confirmText = 'Conferma', cancelText = 'Annulla', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const btnOk = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmText });
    const btnNo = el('button', { class: 'btn btn-outline', text: cancelText });
    const m = modal({
      title, center: true,
      content: `<p style="color:var(--text-mid)">${esc(message)}</p>`,
      footer: [btnNo, btnOk],
      onClose: () => { if (!done) resolve(false); },
    });
    btnNo.addEventListener('click', () => { done = true; m.close(); resolve(false); });
    btnOk.addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

/* ---------------- Formattatori ---------------- */
/** Distanza in metri → "12,4 km" o "850 m". */
export function fmtDistance(m) {
  if (m == null || isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
}

/** Durata in secondi → "1:23:45" o "12:05". */
export function fmtDuration(s) {
  if (s == null || isNaN(s)) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Millisecondi cronometro → "12:05.3". */
export function fmtChrono(ms) {
  if (ms == null || isNaN(ms)) return '—';
  const total = Math.round(ms / 100) / 10;
  const m = Math.floor(total / 60);
  const s = (total % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function fmtSpeed(kmh) {
  if (kmh == null || isNaN(kmh)) return '—';
  return `${Math.round(kmh)} km/h`;
}

export function fmtNum(n, dec = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export function parseDbDate(v) {
  if (v == null) return new Date(NaN);
  if (typeof v === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(v.trim());
    if (m) return new Date(`${m[1]}T${m[2]}Z`);
  }
  return new Date(v);
}
export function fmtDate(iso, { withTime = false } = {}) {
  if (!iso) return '—';
  const d = parseDbDate(iso);
  if (isNaN(d)) return '—';
  const s = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!withTime) return s;
  return `${s}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function timeAgo(iso) {
  const d = parseDbDate(iso);
  if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'ora';
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  if (s < 604800) return `${Math.floor(s / 86400)} g fa`;
  return fmtDate(iso);
}

/**
 * Durata trascorsa da un istante, in forma compatta ("da quanto è online").
 * Es. "meno di 1 min", "12 min", "1 h 05 min", "2 g 3 h".
 */
export function fmtSince(iso) {
  const d = parseDbDate(iso);
  if (isNaN(d)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'meno di 1 min';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} g ${h % 24} h`;
}

/** Iniziali per fallback avatar. */
export function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/* ---------------- Query string ---------------- */
export const qs = {
  get: (key, def = null) => new URLSearchParams(location.search).get(key) ?? def,
  set: (obj) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || v === '') p.delete(k); else p.set(k, v);
    }
    history.replaceState(null, '', `${location.pathname}?${p}`);
  },
};

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export { svg };
