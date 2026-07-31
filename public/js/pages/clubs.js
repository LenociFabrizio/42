/* =============================================================
   clubs.js — Social: esplora i Club, classifica globale e creazione.
   Tre schede (segmented): Esplora | Classifica | Crea.
   È la voce in fondo a destra della bottom nav → active: 'clubs'.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, toast, fmtDistance, fmtNum, debounce, qs } from '../core/ui.js';
import { clubLogo } from '../core/club-logo.js';
import api from '../core/api.js';

const SORTS = [
  { v: 'xp', l: 'XP' },
  { v: 'distance', l: 'Distanza' },
  { v: 'members', l: 'Membri' },
];

let tab = qs.get('tab') || 'esplora';
let sort = 'xp';
let query = '';
let root;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'clubs' });
  root = $('#root');
  renderShell();
  loader.hide();
}

/* Intestazione + controllo segmentato + area contenuto scheda. */
function renderShell() {
  root.innerHTML = '';
  const seg = el('div', { class: 'segmented block mb-4' }, [
    tabBtn('esplora', 'Esplora'),
    tabBtn('classifica', 'Classifica'),
    tabBtn('crea', 'Crea'),
  ]);
  const content = el('div', { id: 'tab-content' });
  root.append(el('h1', { class: 'mb-3', text: 'Club' }), seg, content);
  renderTab(content);
}

function tabBtn(key, label) {
  return el('button', {
    class: tab === key ? 'active' : '',
    text: label,
    onClick: () => { if (tab !== key) { tab = key; qs.set({ tab: key }); renderShell(); } },
  });
}

function renderTab(c) {
  c.innerHTML = '';
  if (tab === 'esplora') renderEsplora(c);
  else if (tab === 'classifica') renderClassifica(c);
  else renderCrea(c);
}

/* -------------------- Esplora -------------------- */
function renderEsplora(c) {
  const input = el('input', { class: 'input', type: 'search', placeholder: 'Cerca club…', value: query });
  input.addEventListener('input', debounce(() => { query = input.value.trim(); loadClubs(grid); }, 350));

  const chips = SORTS.map((s) => el('button', { class: `chip ${sort === s.v ? 'active' : ''}`, text: s.l }));
  chips.forEach((ch, i) => ch.addEventListener('click', () => {
    sort = SORTS[i].v;
    chips.forEach((x, j) => x.classList.toggle('active', SORTS[j].v === sort));
    loadClubs(grid);
  }));

  const grid = el('div', { class: 'grid grid-auto' });
  c.append(
    el('div', { class: 'mb-3' }, [input]),
    el('div', { class: 'chip-scroll mb-3' }, chips),
    grid,
  );
  loadClubs(grid);
}

async function loadClubs(grid) {
  grid.innerHTML = '';
  grid.append(span('Caricamento…'));
  try {
    const { clubs } = await api.get('/clubs', { q: query || undefined, sort });
    grid.innerHTML = '';
    if (!clubs || !clubs.length) {
      grid.append(spanFull(emptyState('🏛️', 'Nessun club', 'Prova a cambiare ricerca o creane uno nuovo.')));
      return;
    }
    for (const cl of clubs) grid.append(clubCard(cl));
  } catch (err) {
    grid.innerHTML = '';
    grid.append(spanFull(emptyState('⚠️', 'Errore', err.message || 'Impossibile caricare i club.')));
  }
}

function clubCard(cl) {
  // L'immagine del club sta al centro della fascia, tonda come una foto
  // profilo: un club si riconosce dalla sua, non da un'emoji uguale per tutti.
  const cover = el('div', { class: 'cover club-cover' }, [clubLogo(cl, { size: 78 })]);
  if (cl.is_member) {
    cover.append(el('div', { class: 'badges' }, [el('span', { class: 'pill green', text: 'Membro' })]));
  }
  const body = el('div', { class: 'body' }, [
    el('h3', { class: 'truncate', text: cl.name }),
    el('div', { class: 'li-sub mt-1', text: `${fmtNum(cl.members_count || 0)} membri · Liv. ${cl.level || 1}` }),
    el('div', { class: 'text-accent mono mt-1', style: 'font-size:.85rem;font-weight:600', text: fmtDistance(cl.total_distance_m || 0) }),
  ]);
  return el('a', { class: 'tile', href: `/club.html?id=${cl.id}` }, [cover, body]);
}

/* -------------------- Classifica -------------------- */
async function renderClassifica(c) {
  c.append(span('Caricamento…'));
  try {
    const { leaderboard } = await api.get('/clubs/leaderboard');
    c.innerHTML = '';
    if (!leaderboard || !leaderboard.length) { c.append(emptyState('🏆', 'Classifica vuota', 'Nessun club in classifica.')); return; }
    const list = el('div', { class: 'list' });
    for (const cl of leaderboard) list.append(lbRow(cl));
    c.append(list);
  } catch (err) {
    c.innerHTML = '';
    c.append(emptyState('⚠️', 'Errore', err.message || 'Impossibile caricare la classifica.'));
  }
}

function lbRow(cl) {
  return el('a', { class: 'list-item', href: `/club.html?id=${cl.id}` }, [
    el('div', { class: `li-rank ${rankClass(cl.rank)}`, text: `${cl.rank}` }),
    clubLogo(cl, { size: 38 }),
    el('div', { class: 'li-body' }, [
      el('div', { class: 'li-title truncate', text: cl.name }),
      el('div', { class: 'li-sub', text: `${fmtNum(cl.xp || 0)} XP · ${fmtDistance(cl.total_distance_m || 0)}` }),
    ]),
    el('span', { class: 'chev', html: svg('chevron', 20) }),
  ]);
}

/* -------------------- Crea -------------------- */
function renderCrea(c) {
  const form = el('form', { class: 'card', novalidate: 'novalidate' }, [
    el('div', { class: 'field' }, [
      el('label', { text: 'Nome del club' }),
      el('input', { class: 'input', id: 'c-name', maxlength: '40', placeholder: 'es. Curve & Caffè' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Descrizione' }),
      el('textarea', { class: 'textarea', id: 'c-desc', maxlength: '500', placeholder: 'Racconta di cosa parla il club…' }),
    ]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'Privacy' }),
        el('select', { class: 'select', id: 'c-priv' }, [
          el('option', { value: 'public', text: 'Pubblico' }),
          el('option', { value: 'private', text: 'Privato' }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Max membri' }),
        el('input', { class: 'input', id: 'c-max', type: 'number', min: '0', value: '0' }),
      ]),
    ]),
    el('p', { class: 'text-lo mb-4', style: 'font-size:.82rem;margin-top:-8px', text: '0 = illimitato' }),
    el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit', text: 'Crea club' }),
  ]);
  c.append(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#c-name', form).value.trim();
    if (name.length < 3) { toast.error('Il nome deve avere almeno 3 caratteri.'); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true; btn.textContent = 'Creazione…';
    try {
      const { club } = await api.post('/clubs', {
        name,
        description: $('#c-desc', form).value.trim(),
        privacy: $('#c-priv', form).value,
        max_members: Number($('#c-max', form).value) || 0,
      });
      toast.success('Club creato! 🎉');
      setTimeout(() => (location.href = `/club.html?id=${club.id}`), 500);
    } catch (err) {
      if (err.status === 409) toast.error('Esiste già un club con questo nome.');
      else toast.error(err.message || 'Creazione non riuscita.');
      btn.disabled = false; btn.textContent = 'Crea club';
    }
  });
}

/* -------------------- Helper -------------------- */
function rankClass(rank) {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
}
function span(text) { return el('p', { class: 'text-lo text-center', text, style: 'grid-column:1/-1' }); }
function spanFull(node) { node.style.gridColumn = '1/-1'; return node; }
function emptyState(ic, title, sub) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'ic', text: ic }),
    el('div', { class: 'li-title', text: title }),
    sub ? el('div', { class: 'text-lo mt-1', text: sub }) : null,
  ]);
}

main();
