/* =============================================================
   club.js — Dettaglio Club: intestazione, azioni di membership,
   richieste di ingresso, elenco membri (con gestione per il creatore)
   e classifica interna. Ricarica i dati dopo ogni azione.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, toast, modal, confirmDialog, fmtDistance, fmtNum, timeAgo, qs } from '../core/ui.js';
import { clubLogo, setClubLogo } from '../core/club-logo.js';
import { pickSquareImage } from '../core/avatar-crop.js';
import api from '../core/api.js';

const DEFAULT_AVATAR = '/images/avatars/default.svg';
const clubId = qs.get('id');
let root;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'clubs' });
  root = $('#root');
  if (!clubId) {
    loader.hide();
    root.append(emptyState('⚠️', 'Club non trovato', 'Manca l\'identificativo del club.'));
    return;
  }
  await load();
  loader.hide();
}

async function load() {
  root.innerHTML = '';
  root.append(el('p', { class: 'text-lo text-center', text: 'Caricamento…' }));
  try {
    const [detail, lb] = await Promise.all([
      api.get(`/clubs/${clubId}`),
      api.get(`/clubs/${clubId}/leaderboard`).catch(() => ({ leaderboard: [] })),
    ]);
    render(detail, lb.leaderboard || []);
  } catch (err) {
    root.innerHTML = '';
    if (err.status === 404) root.append(emptyState('🏛️', 'Club non trovato', 'Il club non esiste o è stato eliminato.'));
    else root.append(emptyState('⚠️', 'Errore', err.message || 'Impossibile caricare il club.'));
  }
}

function render(detail, leaderboard) {
  const { club, members = [], is_member: isMember, my_role: myRole, pending_requests: pending = [] } = detail;
  const myId = auth.user?.id;
  root.innerHTML = '';
  root.append(header(club, myRole));
  root.append(actions(club, isMember, myRole));
  if ((myRole === 'creator' || myRole === 'moderator') && pending.length) root.append(requestsSection(pending));
  root.append(membersSection(members, myRole, myId, club));
  root.append(leaderboardSection(leaderboard));
}

/* -------------------- Intestazione --------------------
 * Stessa forma della scheda profilo: immagine tonda, nome, pastiglie, numeri.
 * Al posto della fascia 16:9 con l'emoji del tempio, che era identica per tutti
 * i club e non si poteva cambiare (mancava del tutto il caricamento).
 */
function header(club, myRole) {
  const canEdit = myRole === 'creator' || myRole === 'moderator';
  const logo = clubLogo(club, { size: 96, editable: canEdit });
  if (canEdit) logo.addEventListener('click', () => changePhoto(logo, club));

  const privacy = club.privacy === 'private'
    ? el('span', { class: 'pill gray', text: 'Privato' })
    : el('span', { class: 'pill accent', text: 'Pubblico' });

  return el('div', { class: 'card mb-4' }, [
    el('div', { class: 'flex gap-3 items-center' }, [
      logo,
      el('div', { style: 'min-width:0;flex:1' }, [
        el('h1', { class: 'truncate', text: club.name, style: 'font-size:1.5rem' }),
        el('div', { class: 'flex gap-2 wrap mt-1' }, [privacy]),
        canEdit ? el('div', { class: 'text-lo mt-1', style: 'font-size:.76rem', text: 'Tocca l\'immagine per cambiarla' }) : null,
      ]),
    ]),
    club.description ? el('p', { class: 'text-mid mt-3', text: club.description }) : null,
    // Niente livello né XP del club: i punti sono una cosa di chi guida, non del
    // gruppo. Un club si misura con i membri e con i chilometri che macinano.
    el('div', { class: 'stats-row mt-3' }, [
      stat(fmtNum(club.members_count || 0), 'Membri'),
      stat(fmtDistance(club.total_distance_m || 0), 'Distanza'),
    ]),
  ]);
}

/** Scegli → inquadra → carica l'immagine del club (creatore e moderatori). */
async function changePhoto(logo, club) {
  const blob = await pickSquareImage();
  if (!blob) return; // annullato, o file non adatto (l'avviso l'ha già dato)
  const fd = new FormData();
  fd.append('image', blob, 'club.jpg');
  try {
    const { photo } = await api.upload(`/clubs/${clubId}/photo`, fd);
    club.photo = photo;
    setClubLogo(logo, photo);
    toast.success('Immagine del club aggiornata!');
  } catch (err) {
    toast.error(err.message || 'Caricamento non riuscito.');
  }
}
const stat = (v, k) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })]);

/* -------------------- Azioni membership -------------------- */
function actions(club, isMember, myRole) {
  const wrap = el('div', { class: 'mb-4' });

  if (myRole === 'creator') {
    const del = el('button', { class: 'btn btn-danger btn-block', html: `${svg('trash', 20)} Elimina club` });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Eliminare il club?', message: 'Questa azione è irreversibile.', confirmText: 'Elimina', danger: true });
      if (!ok) return;
      try { await api.del(`/clubs/${clubId}`); toast.success('Club eliminato.'); setTimeout(() => (location.href = '/clubs.html'), 500); }
      catch (err) { toast.error(err.message || 'Eliminazione non riuscita.'); }
    });
    wrap.append(del);
  } else if (isMember) {
    const leave = el('button', { class: 'btn btn-outline btn-block', html: `${svg('logout', 20)} Esci dal club` });
    leave.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Uscire dal club?', message: 'Potrai rientrare in seguito.', confirmText: 'Esci' });
      if (!ok) return;
      try { await api.post(`/clubs/${clubId}/leave`); toast.success('Hai lasciato il club.'); load(); }
      catch (err) { toast.error(err.message || 'Operazione non riuscita.'); }
    });
    wrap.append(leave);
  } else {
    const join = el('button', { class: 'btn btn-primary btn-block', html: `${svg('plus', 20)} Unisciti` });
    join.addEventListener('click', async () => {
      join.disabled = true;
      try {
        const res = await api.post(`/clubs/${clubId}/join`);
        if (res && res.requested) { toast.success('Richiesta inviata.'); join.textContent = 'Richiesta inviata'; }
        else { toast.success('Benvenuto nel club!'); load(); }
      } catch (err) {
        toast.error(err.message || 'Non puoi unirti a questo club.');
        join.disabled = false;
      }
    });
    wrap.append(join);
  }
  return wrap;
}

/* -------------------- Richieste di ingresso -------------------- */
function requestsSection(pending) {
  const list = el('div', { class: 'list' });
  for (const r of pending) {
    const accept = el('button', { class: 'btn btn-primary btn-sm', html: svg('check', 18), 'aria-label': 'Accetta' });
    const decline = el('button', { class: 'btn btn-outline btn-sm', html: svg('x', 18), 'aria-label': 'Rifiuta' });
    accept.addEventListener('click', () => reqAction(r.user_id, 'accept'));
    decline.addEventListener('click', () => reqAction(r.user_id, 'decline'));
    list.append(el('div', { class: 'list-item' }, [
      avatarImg(r.avatar, r.nickname),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: r.nickname }),
        el('div', { class: 'li-sub', text: timeAgo(r.created_at) }),
      ]),
      el('div', { class: 'flex gap-2' }, [accept, decline]),
    ]));
  }
  return section('Richieste di ingresso', list);
}

async function reqAction(userId, action) {
  try {
    await api.post(`/clubs/${clubId}/requests/${userId}/${action}`);
    toast.success(action === 'accept' ? 'Richiesta accettata.' : 'Richiesta rifiutata.');
    load();
  } catch (err) { toast.error(err.message || 'Operazione non riuscita.'); }
}

/* -------------------- Membri -------------------- */
function membersSection(members, myRole, myId, club) {
  const list = el('div', { class: 'list' });
  if (!members.length) list.append(emptyState('👥', 'Nessun membro', ''));
  for (const m of members) {
    const right = el('div', { class: 'flex items-center gap-2' });
    if (m.role === 'creator') right.append(el('span', { class: 'pill accent', text: 'Creatore' }));
    else if (m.role === 'moderator') right.append(el('span', { class: 'pill gray', text: 'Admin' }));

    if (myRole === 'creator' && m.role !== 'creator' && m.user_id !== myId) {
      const menuBtn = el('button', { class: 'btn btn-ghost btn-icon btn-sm', html: svg('settings', 18), 'aria-label': 'Gestisci membro' });
      menuBtn.addEventListener('click', () => openMemberMenu(m));
      right.append(menuBtn);
    }
    right.append(el('span', { class: 'chev', html: svg('chevron', 20) }));

    list.append(el('div', { class: 'list-item' }, [
      el('a', { class: 'flex items-center gap-3 grow', style: 'min-width:0;color:inherit', href: `/profile.html?id=${m.user_id}` }, [
        avatarImg(m.avatar, m.nickname),
        el('div', { class: 'li-body' }, [
          el('div', { class: 'li-title truncate', text: m.nickname }),
          el('div', { class: 'li-sub', text: `Liv. ${m.level || 1}` }),
        ]),
      ]),
      right,
    ]));
  }
  return section(`Membri (${fmtNum(club.members_count || members.length)})`, list);
}

function openMemberMenu(m) {
  const buttons = [];
  if (m.role === 'moderator') buttons.push(actionBtn('Rimuovi Admin', 'btn-outline', () => setRole(m.user_id, 'member')));
  else buttons.push(actionBtn('Rendi Admin', 'btn-primary', () => setRole(m.user_id, 'moderator')));

  buttons.push(actionBtn('Espelli dal club', 'btn-danger', async () => {
    const ok = await confirmDialog({ title: 'Espellere il membro?', message: `${m.nickname} sarà rimosso dal club.`, confirmText: 'Espelli', danger: true });
    if (!ok) return;
    try { await api.del(`/clubs/${clubId}/members/${m.user_id}`); mRef.close(); toast.success('Membro rimosso.'); load(); }
    catch (err) { toast.error(err.message || 'Operazione non riuscita.'); }
  }));

  const mRef = modal({ title: m.nickname, content: el('div', { class: 'flex flex-col gap-2' }, buttons) });

  async function setRole(userId, role) {
    try { await api.post(`/clubs/${clubId}/members/${userId}/role`, { role }); mRef.close(); toast.success('Ruolo aggiornato.'); load(); }
    catch (err) { toast.error(err.message || 'Operazione non riuscita.'); }
  }
}
function actionBtn(label, cls, onClick) {
  return el('button', { class: `btn ${cls} btn-block`, text: label, onClick });
}

/* -------------------- Classifica membri -------------------- */
function leaderboardSection(leaderboard) {
  if (!leaderboard.length) return section('Classifica membri', emptyState('🏁', 'Nessun dato', 'Ancora nessuna distanza registrata.'));
  const list = el('div', { class: 'list' });
  for (const u of leaderboard) {
    list.append(el('a', { class: 'list-item', href: `/profile.html?id=${u.user_id}` }, [
      el('div', { class: `li-rank ${rankClass(u.rank)}`, text: `${u.rank}` }),
      avatarImg(u.avatar, u.nickname),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: u.nickname }),
        el('div', { class: 'li-sub', text: `${fmtDistance(u.total_distance_m || 0)} · ${fmtNum(u.records_count || 0)} record` }),
      ]),
    ]));
  }
  return section('Classifica membri', list);
}

/* -------------------- Helper -------------------- */
function section(title, node) {
  return el('section', { class: 'mb-4' }, [el('div', { class: 'section-label', text: title }), node]);
}
function avatarImg(src, alt) {
  return el('img', { class: 'avatar', src: src || DEFAULT_AVATAR, alt: alt || '', loading: 'lazy' });
}
function rankClass(rank) {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
}
function emptyState(ic, title, sub) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'ic', text: ic }),
    el('div', { class: 'li-title', text: title }),
    sub ? el('div', { class: 'text-lo mt-1', text: sub }) : null,
  ]);
}

main();
