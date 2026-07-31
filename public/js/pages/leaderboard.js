/* =============================================================
   leaderboard.js — Classifiche globali: piloti (per XP) e club (per km).
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, fmtDistance, esc } from '../core/ui.js';
import api from '../core/api.js';

const rankClass = (r) => (r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : '');

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: '' });

  const root = $('#root');
  root.append(
    el('h1', { class: 'mb-3', text: 'Classifiche' }),
    el('div', { class: 'segmented block mb-4' }, [
      el('button', { class: 'active', text: 'Piloti', onClick: () => show('riders') }),
      el('button', { text: 'Club', onClick: () => show('clubs') }),
    ]),
    el('div', { id: 'lb' })
  );
  loader.hide();
  show('riders');
}

async function show(kind) {
  document.querySelectorAll('.segmented button').forEach((b, i) =>
    b.classList.toggle('active', (kind === 'riders' && i === 0) || (kind === 'clubs' && i === 1))
  );
  const box = $('#lb');
  box.innerHTML = '<div class="spinner sm" style="margin:32px auto"></div>';
  try {
    if (kind === 'riders') await renderRiders(box);
    else await renderClubs(box);
  } catch {
    box.innerHTML = '<div class="empty">Impossibile caricare la classifica.</div>';
  }
}

async function renderRiders(box) {
  const { leaderboard } = await api.get('/users/leaderboard', { limit: 100 });
  box.innerHTML = '';
  const list = el('div', { class: 'list' });
  for (const u of leaderboard) {
    const me = u.id === auth.user?.id;
    list.append(el('a', { class: 'list-item', href: `/profile.html?id=${u.id}`, style: me ? 'border-color:var(--accent)' : '' }, [
      el('div', { class: `li-rank ${rankClass(u.rank)}`, text: u.rank }),
      el('img', { class: 'avatar sm', src: u.avatar || '/images/avatars/default.svg', alt: '' }),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title', html: `${esc(u.nickname)} ${me ? '<span class="pill accent">Tu</span>' : ''}` }),
        el('div', { class: 'li-sub', text: `Liv. ${u.level} · ${u.title || ''} · ${fmtDistance(u.total_distance_m)}` }),
      ]),
      el('div', { class: 'num text-accent', text: `${u.xp} XP` }),
    ]));
  }
  box.append(leaderboard.length ? list : el('div', { class: 'empty', text: 'Nessun pilota in classifica.' }));
}

async function renderClubs(box) {
  const { leaderboard } = await api.get('/clubs/leaderboard');
  box.innerHTML = '';
  const list = el('div', { class: 'list' });
  for (const c of leaderboard) {
    list.append(el('a', { class: 'list-item', href: `/club.html?id=${c.id}` }, [
      el('div', { class: `li-rank ${rankClass(c.rank)}`, text: c.rank }),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title', text: c.name }),
        el('div', { class: 'li-sub', text: `${c.members_count} membri` }),
      ]),
      // Il club non ha punti: in classifica vanno i chilometri dei suoi membri.
      el('div', { class: 'num text-accent', text: fmtDistance(c.total_distance_m || 0) }),
    ]));
  }
  box.append(leaderboard.length ? list : el('div', { class: 'empty', text: 'Nessun club in classifica.' }));
}

main();
