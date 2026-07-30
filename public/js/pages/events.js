/* =============================================================
   events.js — Elenco eventi. Controllo segmentato:
   In programma (scheduled) · Live (live) · I miei (mine=1).
   Ogni card apre /event.html?id=<id>.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, toast, fmtDate } from '../core/ui.js';
import { privacyFrameClass, privacyBadge } from '../core/visibility.js';
import api from '../core/api.js';

const TABS = [
  { key: 'scheduled', label: 'In programma', params: { status: 'scheduled' }, empty: 'Nessun evento in programma.' },
  { key: 'live', label: 'Live', params: { status: 'live' }, empty: 'Nessun evento live in questo momento.' },
  { key: 'mine', label: 'I miei', params: { mine: 1 }, empty: 'Non partecipi ancora a nessun evento.' },
];

const STATUS_PILL = {
  scheduled: { cls: 'gray', label: 'In programma' },
  live: { cls: 'green', label: 'LIVE' },
  ended: { cls: 'gray', label: 'Concluso' },
};

let active = 'scheduled';
let listEl = null;
const segBtns = new Map();

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'events' });
  renderShell();
  await loadTab();
  loader.hide();
}

function renderShell() {
  const root = $('#root');
  root.innerHTML = '';

  const seg = el('div', { class: 'segmented block mb-4' });
  for (const t of TABS) {
    const b = el('button', {
      class: t.key === active ? 'active' : '',
      text: t.label,
      onClick: () => switchTab(t.key),
    });
    segBtns.set(t.key, b);
    seg.append(b);
  }

  listEl = el('div', { class: 'list' });

  root.append(
    el('div', { class: 'flex items-center justify-between gap-3 mb-4' }, [
      el('h1', { text: 'Eventi' }),
      el('a', {
        class: 'btn btn-primary btn-sm',
        href: '/event-create.html',
        html: `${svg('plus', 20)} Crea evento`,
      }),
    ]),
    seg,
    listEl,
  );
}

function switchTab(key) {
  if (key === active) return;
  active = key;
  for (const [k, b] of segBtns) b.classList.toggle('active', k === active);
  loadTab();
}

async function loadTab() {
  const tab = TABS.find((t) => t.key === active);
  listEl.innerHTML = '';
  listEl.append(el('div', { class: 'empty' }, [el('div', { class: 'text-lo', text: 'Caricamento…' })]));
  try {
    const { events = [] } = await api.get('/events', tab.params);
    listEl.innerHTML = '';
    if (!events.length) {
      listEl.append(emptyState(tab.empty));
      return;
    }
    for (const ev of events) listEl.append(eventCard(ev));
  } catch (err) {
    listEl.innerHTML = '';
    listEl.append(emptyState('Impossibile caricare gli eventi.'));
    toast.error(err.message || 'Errore di rete.');
  }
}

function emptyState(msg) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'ic', text: '📣' }),
    el('p', { text: msg }),
  ]);
}

function eventCard(ev) {
  const sp = STATUS_PILL[ev.status] || STATUS_PILL.scheduled;
  const parts = ev.max_participants > 0
    ? `${ev.participants_count} / ${ev.max_participants}`
    : `${ev.participants_count}`;

  const pills = el('div', { class: 'flex items-center gap-2 wrap', style: 'margin-top:6px' }, [
    el('span', { class: `pill ${sp.cls}`, text: sp.label }),
    ev.joined ? el('span', { class: 'pill accent', text: '✓ Iscritto' }) : null,
    privacyBadge(ev.privacy),
  ]);

  return el('a', { class: `list-item ${privacyFrameClass(ev.privacy)}`, href: `/event.html?id=${ev.id}` }, [
    el('div', { class: 'li-body' }, [
      el('div', { class: 'li-title truncate', text: ev.name }),
      el('div', { class: 'li-sub', text: `📅 ${fmtDate(ev.starts_at, { withTime: true })}` }),
      el('div', { class: 'li-sub' }, [
        `📍 ${ev.area_name || 'Ritrovo'}`,
        el('span', { class: 'text-lo', text: `  ·  👥 ${parts}` }),
      ]),
      pills,
    ]),
    el('span', { class: 'chev', html: svg('chevron', 20) }),
  ]);
}

main();
