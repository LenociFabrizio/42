/* =============================================================
   shell.js — Struttura comune: top bar (logo, impostazioni, amici,
   campanella, avatar) e bottom nav "a pollice" con pulsante CREA
   centrale. Gestisce il badge notifiche e gli avvisi "amico online"
   (stesso polling leggero) e il foglio di creazione.
   ============================================================= */
import { el, svg, modal } from './ui.js';
import { auth } from './auth.js';
import { ringPercent } from './gamification.js';
import { initConsent } from './consent.js';
import { initPresence, checkFriendsOnline } from './presence.js';
import { stampVersion } from './version.js';
import api from './api.js';

const NAV = [
  { key: 'map', label: 'Mappa', href: '/index.html', icon: 'map' },
  { key: 'routes', label: 'Percorsi', href: '/routes.html', icon: 'route' },
  { key: 'crea', label: 'Crea', crea: true, icon: 'plus' },
  { key: 'events', label: 'Eventi', href: '/events.html', icon: 'calendar' },
  // Il profilo è già raggiungibile dall'avatar in alto a destra: qui, in fondo
  // a destra, mettiamo i Club.
  { key: 'clubs', label: 'Club', href: '/clubs.html', icon: 'building' },
];

/** Foglio di creazione (Percorso / Evento). */
export function openCreateSheet() {
  const grid = el('div', { class: 'choice' }, [
    el('button', { onClick: () => (location.href = '/record.html') }, [
      el('div', { class: 'ci', html: svg('play', 32) }),
      el('strong', { text: 'Registra percorso' }),
      el('span', { class: 'text-lo', style: 'font-size:.8rem', text: 'Traccia col GPS mentre guidi' }),
    ]),
    el('button', { onClick: () => (location.href = '/route-create.html') }, [
      el('div', { class: 'ci', html: svg('pin', 32) }),
      el('strong', { text: 'Disegna percorso' }),
      el('span', { class: 'text-lo', style: 'font-size:.8rem', text: 'Posiziona partenza e arrivo sulla mappa' }),
    ]),
    el('button', { style: 'grid-column:1/-1', onClick: () => (location.href = '/event-create.html') }, [
      el('div', { class: 'ci', html: svg('calendar', 32) }),
      el('strong', { text: 'Crea evento' }),
      el('span', { class: 'text-lo', style: 'font-size:.8rem', text: 'Organizza un raduno live' }),
    ]),
  ]);
  modal({ title: 'Cosa vuoi creare?', content: grid });
}

/** Costruisce la top bar. */
function buildTopbar() {
  const u = auth.user;
  const avatar = el('img', { src: u?.avatar || '/images/avatars/default.svg', alt: u?.nickname || '' });
  const ring = el('a', { href: '/profile.html', class: 'avatar-ring', style: `--ring:${u ? ringPercent(u.xp || 0) : 0}%` }, [avatar]);

  const bellDot = el('span', { class: 'dot hidden', text: '0' });
  const bell = el('a', { href: '/notifications.html', class: 'btn-icon btn-ghost bell', 'aria-label': 'Notifiche', html: svg('bell', 24) });
  bell.append(bellDot);

  // Impostazioni e Amici: stessa forma del pulsante notifiche, subito accanto.
  const gear = el('a', { href: '/settings.html', class: 'btn-icon btn-ghost', 'aria-label': 'Impostazioni', html: svg('settings', 24) });
  const friends = el('a', { href: '/friends.html', class: 'btn-icon btn-ghost', 'aria-label': 'Amici', html: svg('users', 24) });

  const bar = el('header', { class: 'topbar' }, [
    el('a', { href: '/index.html', class: 'brand' }, [
      el('span', { class: 'brand-logo', html: `4 <span class="amp">&amp;</span><span class="sep">|</span> 2` }),
      el('span', { class: 'beta-tag', text: 'Beta' }),
    ]),
    el('div', { class: 'topbar-actions' }, [gear, friends, bell, ring]),
  ]);
  return { bar, bellDot };
}

/** Costruisce la bottom nav. */
function buildBottomNav(active) {
  const nav = el('nav', { class: 'bottomnav', 'aria-label': 'Navigazione' });
  for (const item of NAV) {
    if (item.crea) {
      const fab = el('button', { class: 'crea-fab', 'aria-label': 'Crea', html: svg('plus', 30), onClick: openCreateSheet });
      const wrap = el('div', { class: 'navitem nav-crea' }, [
        fab,
        el('span', { text: 'Crea' }),
      ]);
      nav.append(wrap);
    } else {
      const a = el('a', {
        class: `navitem ${active === item.key ? 'active' : ''}`,
        href: item.href,
        html: `${svg(item.icon, 24)}<span>${item.label}</span>`,
      });
      nav.append(a);
    }
  }
  return nav;
}

let _pollTimer = null;
async function pollUnread(bellDot) {
  if (!auth.isLogged()) return;
  try {
    const { unread } = await api.get('/notifications/unread-count');
    if (unread > 0) { bellDot.textContent = unread > 99 ? '99+' : unread; bellDot.classList.remove('hidden'); }
    else bellDot.classList.add('hidden');
  } catch { /* silenzioso */ }
}

/**
 * Monta la shell nella pagina.
 * @param {{active?:string, hideNav?:boolean}} opts
 */
export function mountShell({ active = '', hideNav = false } = {}) {
  const { bar, bellDot } = buildTopbar();
  document.body.prepend(bar);
  if (!hideNav) document.body.append(buildBottomNav(active));

  // Banner informativo privacy/cookie (una volta) + numero di versione.
  initConsent();
  stampVersion();

  // Polling notifiche (leggero): all'avvio e ogni 30s, e al ritorno in
  // foreground. Nello stesso giro controlliamo gli amici appena entrati online.
  pollUnread(bellDot);
  initPresence();
  clearInterval(_pollTimer);
  _pollTimer = setInterval(() => { pollUnread(bellDot); checkFriendsOnline(); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    pollUnread(bellDot);
    checkFriendsOnline();
  });
}

export default mountShell;
