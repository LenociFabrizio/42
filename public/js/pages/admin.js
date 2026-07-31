/* =============================================================
   admin.js — Pannello di controllo dello sviluppatore.

   Quattro schede: Panoramica (i numeri e la tendenza), Utenti, Contenuti,
   Segnalazioni. Tutto in sola lettura: serve a capire come va l'app, non a
   metterci le mani.

   Il permesso lo decide il server (requireAdmin su /api/admin/*). Qui il
   controllo sul ruolo serve solo a non mostrare una pagina di errori a chi
   arriva per sbaglio.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { $, el, svg, loader, toast, fmtDistance, fmtNum, timeAgo, debounce, qs } from '../core/ui.js';
import api from '../core/api.js';

const TABS = [
  { key: 'panoramica', label: 'Panoramica' },
  { key: 'utenti', label: 'Utenti' },
  { key: 'contenuti', label: 'Contenuti' },
  { key: 'segnalazioni', label: 'Segnalazioni' },
];

let tab = qs.get('tab') || 'panoramica';
let root;
let userQuery = '';

async function main() {
  const user = await guard();
  if (!user) return;
  mountShell({ active: '' });
  root = $('#root');
  loader.hide();

  if (user.role !== 'admin') {
    root.append(el('div', { class: 'empty' }, [
      el('div', { class: 'ic', html: svg('lock', 46) }),
      el('div', { class: 'li-title', text: 'Area riservata' }),
      el('div', { class: 'text-lo mt-1', text: 'Questo pannello è visibile solo agli amministratori dell\'app.' }),
      el('a', { class: 'btn btn-outline mt-3', href: '/index.html', text: 'Torna alla mappa' }),
    ]));
    return;
  }
  renderShell();
}

function renderShell() {
  root.innerHTML = '';
  const seg = el('div', { class: 'segmented block mb-4' }, TABS.map((t) => el('button', {
    class: tab === t.key ? 'active' : '',
    text: t.label,
    onClick: () => { if (tab !== t.key) { tab = t.key; qs.set({ tab: t.key }); renderShell(); } },
  })));
  const content = el('div', { id: 'tab-content' });
  root.append(
    el('div', { class: 'flex items-center justify-between gap-2 mb-3' }, [
      el('h1', { text: 'Pannello' }),
      el('span', { class: 'pill accent', text: 'admin' }),
    ]),
    seg,
    content,
  );
  if (tab === 'panoramica') loadOverview(content);
  else if (tab === 'utenti') loadUsers(content);
  else if (tab === 'contenuti') loadContent(content);
  else loadFeedback(content);
}

const wait = (c) => { c.innerHTML = ''; c.append(el('p', { class: 'text-lo text-center', text: 'Caricamento…' })); };
const fail = (c, err) => {
  c.innerHTML = '';
  c.append(el('div', { class: 'empty' }, [
    el('div', { class: 'ic', html: svg('alert', 40) }),
    el('div', { class: 'li-title', text: 'Non caricato' }),
    el('div', { class: 'text-lo mt-1', text: err?.message || 'Riprova tra poco.' }),
  ]));
};
const stat = (v, k) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })]);
const card = (title, body) => el('div', { class: 'card mt-3' }, [
  el('h2', { class: 'mb-3', style: 'font-size:1.05rem', text: title }),
  ...[].concat(body),
]);

/* -------------------- Panoramica -------------------- */
async function loadOverview(c) {
  wait(c);
  try {
    const d = await api.get('/admin/overview');
    c.innerHTML = '';

    c.append(card('Utenti', [
      el('div', { class: 'stats-row' }, [
        stat(fmtNum(d.users.total), 'Totali'),
        stat(fmtNum(d.users.active_24h), 'Attivi 24h'),
        stat(fmtNum(d.users.active_7d), 'Attivi 7g'),
        stat(fmtNum(d.users.new_7d), 'Nuovi 7g'),
        stat(fmtNum(d.users.new_30d), 'Nuovi 30g'),
        stat(fmtNum(d.users.sharing_now), 'In strada ora'),
      ]),
      el('div', { class: 'text-lo mt-2', style: 'font-size:.78rem', text: `"Attivi" = hanno usato l'app (non solo registrati). "In strada ora" = stanno condividendo la posizione in questo momento. Con l'area scelta: ${fmtNum(d.users.with_area)} su ${fmtNum(d.users.total)}.` }),
    ]));

    c.append(card('Iscrizioni degli ultimi 14 giorni', signupChart(d.signups || [])));

    c.append(card('Contenuti', [
      el('div', { class: 'stats-row' }, [
        stat(fmtNum(d.content.routes), 'Percorsi'),
        stat(fmtNum(d.content.routes_7d), 'Percorsi 7g'),
        stat(fmtNum(d.content.completions), 'Tentativi'),
        stat(fmtNum(d.content.events), 'Eventi'),
        stat(fmtNum(d.content.events_upcoming), 'In arrivo'),
        stat(fmtNum(d.content.clubs), 'Club'),
        stat(fmtNum(d.content.pois), 'POI'),
        stat(fmtNum(d.content.vehicles), 'Veicoli'),
        stat(fmtNum(d.content.friendships), 'Amicizie'),
      ]),
      el('div', { class: 'stats-row mt-3' }, [
        stat(fmtDistance(d.distance.created_m), 'Km tracciati'),
        stat(fmtDistance(d.distance.driven_m), 'Km percorsi'),
        stat(`${fmtNum(d.explored.avg, 1)}`, 'Aree a testa'),
        stat(fmtNum(d.explored.max), 'Record aree'),
      ]),
    ]));

    c.append(card('Aree di partenza', areaBars(d.areas || [])));

    const fb = d.feedback || {};
    c.append(card('Segnalazioni', [
      el('div', { class: 'stats-row' }, [
        stat(fmtNum(fb.total), 'Totali'),
        stat(fmtNum(fb.last_7d), 'Ultimi 7g'),
      ]),
      el('button', {
        class: 'btn btn-outline btn-block mt-3',
        text: 'Leggi le segnalazioni',
        onClick: () => { tab = 'segnalazioni'; qs.set({ tab }); renderShell(); },
      }),
    ]));
  } catch (err) { fail(c, err); }
}

/** Barre delle iscrizioni: div con altezza proporzionale, nessuna libreria. */
function signupChart(rows) {
  if (!rows.length) return el('p', { class: 'text-lo', text: 'Ancora nessuna iscrizione in questo periodo.' });
  // Giorni mancanti = zero: un buco nel grafico direbbe una cosa falsa.
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, label: `${d.getDate()}`, n: byDay.get(key) || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  return el('div', { class: 'adm-chart' }, days.map((d) => el('div', { class: 'adm-bar-wrap', title: `${d.key}: ${d.n}` }, [
    el('div', { class: 'adm-bar', style: `height:${Math.round((d.n / max) * 100)}%` }, [
      d.n ? el('span', { class: 'adm-bar-n', text: String(d.n) }) : null,
    ]),
    el('span', { class: 'adm-bar-day', text: d.label }),
  ])));
}

/** Distribuzione per area: barra orizzontale in proporzione al massimo. */
function areaBars(rows) {
  if (!rows.length) return el('p', { class: 'text-lo', text: 'Nessuna area scelta finora.' });
  const max = Math.max(...rows.map((r) => r.n));
  return el('div', { class: 'adm-rows' }, rows.map((r) => el('div', { class: 'adm-row' }, [
    el('span', { class: 'adm-row-k', text: r.region }),
    el('span', { class: 'adm-row-bar' }, [el('i', { style: `width:${Math.round((r.n / max) * 100)}%` })]),
    el('span', { class: 'adm-row-v', text: fmtNum(r.n) }),
  ])));
}

/* -------------------- Utenti -------------------- */
async function loadUsers(c) {
  c.innerHTML = '';
  const search = el('input', { class: 'input mb-3', type: 'search', placeholder: 'Cerca per nickname o email…', value: userQuery });
  const list = el('div', {});
  c.append(search, list);
  search.addEventListener('input', debounce(() => { userQuery = search.value.trim(); fetchUsers(list); }, 350));
  fetchUsers(list);
}

async function fetchUsers(list) {
  wait(list);
  try {
    const { users } = await api.get('/admin/users', { q: userQuery || undefined, limit: 100 });
    list.innerHTML = '';
    list.append(el('div', { class: 'text-lo mb-2', style: 'font-size:.8rem', text: `${users.length} account${userQuery ? ' trovati' : ' più recenti'}` }));
    const rows = el('div', { class: 'list' });
    for (const u of users) rows.append(userRow(u));
    list.append(rows);
  } catch (err) { fail(list, err); }
}

function userRow(u) {
  const tags = [
    u.role === 'admin' ? el('span', { class: 'pill accent', text: 'admin' }) : null,
    u.via_google ? el('span', { class: 'pill gray', text: 'Google' }) : null,
    u.live_enabled ? el('span', { class: 'pill green', text: 'live' }) : null,
  ].filter(Boolean);
  return el('div', { class: 'list-item' }, [
    el('div', { class: 'li-body' }, [
      el('div', { class: 'flex gap-2 items-center wrap' }, [
        el('span', { class: 'li-title', text: u.nickname }),
        ...tags,
      ]),
      el('div', { class: 'li-sub', text: u.email || '—' }),
      el('div', { class: 'li-sub', text: `Liv. ${u.level} · ${fmtNum(u.xp)} XP · ${u.areas} aree · ${fmtNum(u.routes_count)} percorsi · ${fmtDistance(u.total_distance_m)}` }),
      el('div', { class: 'text-lo', style: 'font-size:.74rem', text: `${u.region || 'area non scelta'} · iscritto ${timeAgo(u.created_at)} · ${u.last_active ? `attivo ${timeAgo(u.last_active)}` : 'mai attivo'}` }),
    ]),
  ]);
}

/* -------------------- Contenuti -------------------- */
async function loadContent(c) {
  wait(c);
  try {
    const d = await api.get('/admin/content', { limit: 20 });
    c.innerHTML = '';

    c.append(card('Ultimi percorsi', listOf(d.routes, (r) => ({
      title: r.name,
      sub: `${r.creator} · ${fmtDistance(r.distance_m)} · ${r.category} · ${r.region || 'fuori area'}`,
      meta: `${fmtNum(r.completions_count)} tentativi · ${r.privacy} · ${timeAgo(r.created_at)}`,
      href: `/route.html?id=${r.id}`,
    }))));

    c.append(card('Ultimi eventi', listOf(d.events, (e) => ({
      title: e.name,
      sub: `${e.creator} · ${e.area_name || '—'} · ${e.region || 'fuori area'}`,
      meta: `${fmtNum(e.participants)} iscritti · ${e.privacy} · creato ${timeAgo(e.created_at)}`,
      href: `/event.html?id=${e.id}`,
    }))));

    c.append(card('Ultimi club', listOf(d.clubs, (cl) => ({
      title: cl.name,
      sub: `${cl.creator} · ${fmtNum(cl.members_count)} membri · Liv. ${cl.level}`,
      meta: `${cl.has_photo ? 'con immagine' : 'senza immagine'} · ${cl.privacy} · ${timeAgo(cl.created_at)}`,
      href: `/club.html?id=${cl.id}`,
    }))));
  } catch (err) { fail(c, err); }
}

function listOf(rows, map) {
  if (!rows || !rows.length) return el('p', { class: 'text-lo', text: 'Ancora niente.' });
  const list = el('div', { class: 'list' });
  for (const r of rows) {
    const o = map(r);
    list.append(el('a', { class: 'list-item', href: o.href }, [
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: o.title }),
        el('div', { class: 'li-sub', text: o.sub }),
        el('div', { class: 'text-lo', style: 'font-size:.74rem', text: o.meta }),
      ]),
      el('span', { class: 'chev', html: svg('chevron', 20) }),
    ]));
  }
  return list;
}

/* -------------------- Segnalazioni -------------------- */
async function loadFeedback(c) {
  wait(c);
  try {
    const { reports } = await api.get('/admin/feedback', { limit: 100 });
    c.innerHTML = '';
    if (!reports.length) {
      c.append(el('div', { class: 'empty' }, [
        el('div', { class: 'ic', html: svg('alert', 40) }),
        el('div', { class: 'li-title', text: 'Nessuna segnalazione' }),
        el('div', { class: 'text-lo mt-1', text: 'Quando qualcuno segnala un problema da Impostazioni, compare qui.' }),
      ]));
      return;
    }
    c.append(el('div', { class: 'text-lo mb-2', style: 'font-size:.8rem', text: `${reports.length} segnalazioni, dalla più recente` }));
    for (const r of reports) c.append(reportCard(r));
  } catch (err) { fail(c, err); }
}

function reportCard(r) {
  const who = r.nickname || 'anonimo';
  return el('div', { class: 'card mt-2' }, [
    el('div', { class: 'flex items-center justify-between gap-2 mb-2' }, [
      el('span', { class: 'li-title', text: `#${r.id} · ${who}` }),
      el('span', { class: r.emailed ? 'pill green' : 'pill gray', text: r.emailed ? 'inviata' : 'solo a database' }),
    ]),
    el('p', { style: 'white-space:pre-wrap', text: r.message }),
    el('div', { class: 'text-lo mt-2', style: 'font-size:.74rem', text: [
      r.contact_email || r.email || null,
      r.page ? `da ${r.page}` : null,
      r.app_version ? `v${r.app_version}` : null,
      timeAgo(r.created_at),
    ].filter(Boolean).join(' · ') }),
    r.user_agent ? el('div', { class: 'text-dim', style: 'font-size:.7rem;margin-top:4px', text: r.user_agent }) : null,
  ]);
}

main();
