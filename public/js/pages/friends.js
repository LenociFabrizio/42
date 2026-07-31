/* =============================================================
   friends.js — Social: elenco amici e gestione richieste.
   Due schede (segmented): Amici | Richieste. Riga in alto per
   aggiungere un amico tramite nickname.
   Nota: GET /friends restituisce l'ID UTENTE (non l'ID amicizia),
   quindi la rimozione è disponibile solo dove abbiamo un ID amicizia
   (richieste in uscita → "Annulla").
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, toast, timeAgo, fmtSince, fmtDate, qs } from '../core/ui.js';
import api from '../core/api.js';

const DEFAULT_AVATAR = '/images/avatars/default.svg';
// La presenza cambia da sola: la lista si riaggiorna da sé, altrimenti un amico
// che ha appena chiuso l'app resterebbe "Online" finché non si ricarica la
// pagina (ed è esattamente quello che sembrava un bug del calcolo online).
const REFRESH_MS = 30000;
let tab = qs.get('tab') || 'amici';
let root, contentEl;
let refreshTimer = null;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: '' });
  root = $('#root');
  renderShell();
  loader.hide();

  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshPresence, REFRESH_MS);
  // Al ritorno in primo piano ci si rimette in pari subito: i timer in secondo
  // piano vengono congelati dal sistema.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPresence(); });
}

/** Riaggiorna in silenzio la lista amici (solo sulla scheda "Amici"). */
function refreshPresence() {
  if (document.hidden || tab !== 'amici' || !contentEl) return;
  loadFriends({ silent: true });
}

function renderShell() {
  root.innerHTML = '';

  const input = el('input', { class: 'input', type: 'text', placeholder: 'Nickname da aggiungere…', autocomplete: 'off' });
  const addBtn = el('button', { class: 'btn btn-primary', html: `${svg('plus', 20)} Aggiungi` });
  addBtn.addEventListener('click', () => addFriend(input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFriend(input); } });
  const addRow = el('div', { class: 'flex gap-2 mb-4' }, [el('div', { class: 'grow' }, [input]), addBtn]);

  const seg = el('div', { class: 'segmented block mb-4' }, [
    tabBtn('amici', 'Amici'),
    tabBtn('richieste', 'Richieste'),
  ]);
  contentEl = el('div', { id: 'tab-content' });
  root.append(el('h1', { class: 'mb-3', text: 'Amici' }), addRow, seg, contentEl);
  renderTab();
}

function tabBtn(key, label) {
  return el('button', {
    class: tab === key ? 'active' : '',
    text: label,
    onClick: () => { if (tab !== key) { tab = key; qs.set({ tab: key }); renderShell(); } },
  });
}

function renderTab() {
  contentEl.innerHTML = '';
  if (tab === 'amici') loadFriends();
  else loadRequests();
}

async function addFriend(input) {
  const nickname = input.value.trim();
  if (!nickname) { toast.error('Inserisci un nickname.'); return; }
  try {
    await api.post('/friends/request', { nickname });
    toast.success('Richiesta inviata.');
    input.value = '';
    if (tab === 'richieste') loadRequests();
  } catch (err) {
    if (err.status === 404) toast.error('Utente non trovato.');
    else if (err.status === 409) toast.error('Siete già amici o hai una richiesta in sospeso.');
    else toast.error(err.message || 'Operazione non riuscita.');
  }
}

/* -------------------- Amici -------------------- */
/** @param {{silent?:boolean}} opts silent = aggiornamento periodico, senza spinner */
async function loadFriends({ silent = false } = {}) {
  if (!silent) {
    contentEl.innerHTML = '';
    contentEl.append(el('p', { class: 'text-lo text-center', text: 'Caricamento…' }));
  }
  try {
    const { friends } = await api.get('/friends');
    if (tab !== 'amici') return; // scheda cambiata mentre arrivava la risposta
    contentEl.innerHTML = '';
    if (!friends || !friends.length) { contentEl.append(emptyState('🤝', 'Nessun amico', 'Aggiungi qualcuno con il suo nickname.')); return; }
    const list = el('div', { class: 'list' });
    for (const f of friends) list.append(friendRow(f));
    contentEl.append(list);
  } catch (err) {
    if (silent) return; // rete assente: si tiene quello che c'è già a schermo
    contentEl.innerHTML = '';
    contentEl.append(emptyState('⚠️', 'Errore', err.message || 'Impossibile caricare gli amici.'));
  }
}

function friendRow(f) {
  // Offline: mostriamo da quanto tempo lo è (con la data esatta nel tooltip).
  const last = f.last_active || f.last_seen;
  const status = f.online
    ? el('span', { class: 'pill green', text: '• Online', title: 'Sta usando l\'app in questo momento' })
    : el('span', {
      class: 'li-sub',
      style: 'white-space:nowrap; text-align:right',
      text: last ? `Offline da ${fmtSince(last)}` : 'Offline',
      title: last ? `Ultima attività: ${fmtDate(last, { withTime: true })}` : 'Mai visto online',
    });
  // Riga = link al profilo (usa l'ID UTENTE). Nessuna rimozione qui:
  // GET /friends non fornisce l'ID amicizia richiesto da DELETE /friends/:id.
  return el('a', { class: 'list-item', href: `/profile.html?id=${f.id}` }, [
    avatarImg(f.avatar, f.nickname),
    el('div', { class: 'li-body' }, [
      el('div', { class: 'li-title truncate', text: f.nickname }),
      el('div', { class: 'li-sub', text: `Liv. ${f.level || 1}` }),
    ]),
    status,
    el('span', { class: 'chev', html: svg('chevron', 20) }),
  ]);
}

/* -------------------- Richieste -------------------- */
async function loadRequests() {
  contentEl.innerHTML = '';
  contentEl.append(el('p', { class: 'text-lo text-center', text: 'Caricamento…' }));
  try {
    const { incoming = [], outgoing = [] } = await api.get('/friends/requests');
    contentEl.innerHTML = '';
    contentEl.append(incomingSection(incoming));
    contentEl.append(outgoingSection(outgoing));
  } catch (err) {
    contentEl.innerHTML = '';
    contentEl.append(emptyState('⚠️', 'Errore', err.message || 'Impossibile caricare le richieste.'));
  }
}

function incomingSection(incoming) {
  if (!incoming.length) return section('In arrivo', emptyState('📭', 'Nessuna richiesta', ''));
  const list = el('div', { class: 'list' });
  for (const r of incoming) {
    // r.id = ID amicizia (friendshipId) → usato per accept/decline.
    const accept = el('button', { class: 'btn btn-primary btn-sm', html: svg('check', 18), 'aria-label': 'Accetta' });
    const decline = el('button', { class: 'btn btn-outline btn-sm', html: svg('x', 18), 'aria-label': 'Rifiuta' });
    accept.addEventListener('click', () => reqAction(r.id, 'accept'));
    decline.addEventListener('click', () => reqAction(r.id, 'decline'));
    list.append(el('div', { class: 'list-item' }, [
      avatarImg(r.from.avatar, r.from.nickname),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: r.from.nickname }),
        el('div', { class: 'li-sub', text: `Liv. ${r.from.level || 1} · ${timeAgo(r.created_at)}` }),
      ]),
      el('div', { class: 'flex gap-2' }, [accept, decline]),
    ]));
  }
  return section('In arrivo', list);
}

function outgoingSection(outgoing) {
  if (!outgoing.length) return section('Inviate', emptyState('📤', 'Nessuna richiesta inviata', ''));
  const list = el('div', { class: 'list' });
  for (const r of outgoing) {
    // r.id = ID amicizia (friendshipId) → usato per DELETE (annulla).
    const cancel = el('button', { class: 'btn btn-outline btn-sm', text: 'Annulla' });
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await api.del(`/friends/${r.id}`); toast.success('Richiesta annullata.'); loadRequests(); }
      catch (err) { toast.error(err.message || 'Operazione non riuscita.'); cancel.disabled = false; }
    });
    list.append(el('div', { class: 'list-item' }, [
      avatarImg(r.to.avatar, r.to.nickname),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: r.to.nickname }),
        el('div', { class: 'li-sub', text: 'Richiesta inviata' }),
      ]),
      cancel,
    ]));
  }
  return section('Inviate', list);
}

async function reqAction(friendshipId, action) {
  try {
    await api.post(`/friends/${friendshipId}/${action}`);
    toast.success(action === 'accept' ? 'Richiesta accettata.' : 'Richiesta rifiutata.');
    loadRequests();
  } catch (err) { toast.error(err.message || 'Operazione non riuscita.'); }
}

/* -------------------- Helper -------------------- */
function section(title, node) {
  return el('section', { class: 'mb-4' }, [el('div', { class: 'section-label', text: title }), node]);
}
function avatarImg(src, alt) {
  return el('img', { class: 'avatar', src: src || DEFAULT_AVATAR, alt: alt || '', loading: 'lazy' });
}
function emptyState(ic, title, sub) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'ic', text: ic }),
    el('div', { class: 'li-title', text: title }),
    sub ? el('div', { class: 'text-lo mt-1', text: sub }) : null,
  ]);
}

main();
