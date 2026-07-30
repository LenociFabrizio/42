/* =============================================================
   profile.js — Pagina Profilo.
   - Profilo proprio (default): intestazione con anello livello,
     barra XP, statistiche, veicoli, distintivi, missioni, classifica.
     Con azioni: modifica profilo/avatar, cambia password, logout.
   - Profilo altrui (?id=…): sola lettura. Se privato, mostra una
     scheda minima.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { xpMeter, levelTitle, ringPercent } from '../core/gamification.js';
import { $, el, svg, loader, toast, modal, confirmDialog, fmtDistance, fmtDuration, fmtNum, qs } from '../core/ui.js';
import { VEHICLE_TYPES } from '../core/constants.js';
import api from '../core/api.js';

const DEFAULT_AVATAR = '/images/avatars/default.svg';
const TIERS = ['bronze', 'silver', 'gold', 'special'];
const tierClass = (t) => (TIERS.includes(t) ? t : 'bronze');
const vehIcon = (type) => (type === 'moto' ? '🏍️' : '🚗');
const stat = (v, k) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })]);
const empty = (ic, msg) => el('div', { class: 'empty' }, [el('div', { class: 'ic', text: ic }), el('p', { text: msg })]);

async function main() {
  const me = await guard();
  if (!me) return;
  registerPWA();
  const viewId = qs.get('id');
  const isOwn = !viewId || String(viewId) === String(me.id);
  mountShell({ active: isOwn ? 'profile' : '' });

  const root = $('#root');
  try {
    if (isOwn) await renderOwn(root);
    else await renderOther(root, viewId);
  } catch (err) {
    root.append(empty('⚠️', err.message || 'Impossibile caricare il profilo.'));
  } finally {
    loader.hide();
  }
}

/* -------------------- Profilo proprio -------------------- */
async function renderOwn(root) {
  const [meData, pub, missionsData, badgesData] = await Promise.all([
    api.get('/auth/me'),
    api.get(`/users/${auth.user.id}`),
    api.get('/gamification/missions').catch(() => ({ missions: [] })),
    api.get('/gamification/badges').catch(() => ({ badges: [] })),
  ]);
  const user = meData.user || meData;
  root.append(
    headerCard(user, true),
    statsCard(user),
    actionsCard(),
    vehiclesCard(pub.vehicles || [], true),
    badgesCard(badgesData.badges || [], true),
    missionsCard(missionsData.missions || []),
  );
  mountLeaderboard(root, user);
}

/* -------------------- Profilo altrui -------------------- */
async function renderOther(root, id) {
  const data = await api.get(`/users/${id}`);
  if (data.private) {
    const u = data.user;
    root.append(el('div', { class: 'card', style: 'text-align:center' }, [
      el('div', { class: 'avatar-ring', style: `--ring:${ringPercent(u.xp || 0)}%;width:104px;height:104px;padding:3px;margin:0 auto var(--sp-3)` }, [
        el('img', { class: 'avatar lg', src: u.avatar || DEFAULT_AVATAR, alt: u.nickname || '', style: 'width:100%;height:100%' }),
      ]),
      el('h1', { text: u.nickname || '—' }),
      el('div', { style: 'margin-top:var(--sp-2)' }, [el('span', { class: 'pill accent', text: `Liv. ${u.level || 1}` })]),
      el('p', { class: 'text-lo', style: 'margin-top:var(--sp-3)', text: '🔒 Profilo privato' }),
    ]));
    return;
  }
  const user = data.user;
  root.append(
    headerCard(user, false),
    statsCard(user),
    vehiclesCard(data.vehicles || [], false),
    badgesCard(data.badges || [], false),
  );
}

/* -------------------- Intestazione -------------------- */
function headerCard(user, isOwn) {
  const level = user.level ?? user.progress?.level ?? 1;
  const percent = user.progress ? user.progress.percent : ringPercent(user.xp || 0);
  return el('div', { class: 'card' }, [
    el('div', { class: 'flex gap-3 items-center', style: 'margin-bottom:var(--sp-3)' }, [
      el('div', { class: 'avatar-ring', style: `--ring:${percent}%;width:104px;height:104px;padding:3px`, title: `Livello ${level}` }, [
        el('img', { class: 'avatar lg', src: user.avatar || DEFAULT_AVATAR, alt: user.nickname || '', style: 'width:100%;height:100%' }),
      ]),
      el('div', { style: 'min-width:0;flex:1' }, [
        el('h1', { text: user.nickname || '—', style: 'font-size:1.6rem' }),
        el('div', { class: 'text-accent', style: 'font-weight:600', text: user.title || levelTitle(level) }),
        el('div', { class: 'flex gap-2 wrap mt-1' }, [
          el('span', { class: 'pill accent', text: `Liv. ${level}` }),
          user.streak_days ? el('span', { class: 'pill gray', text: `🔥 ${user.streak_days}` }) : null,
        ]),
      ]),
    ]),
    user.bio ? el('p', { class: 'text-mid', style: 'margin-bottom:var(--sp-3)', text: user.bio }) : null,
    xpMeter(user.xp || 0),
  ]);
}

/* -------------------- Statistiche -------------------- */
function statsCard(user) {
  return el('div', { class: 'card', style: 'margin-top:var(--sp-3)' }, [
    el('div', { class: 'stats-row' }, [
      stat(fmtDistance(user.total_distance_m), 'Km totali'),
      stat(fmtDuration(user.total_time_s), 'Tempo guida'),
      stat(fmtNum(user.routes_count), 'Percorsi'),
      stat(fmtNum(user.records_count), 'Record'),
      stat(fmtNum(user.events_count), 'Eventi'),
    ]),
  ]);
}

/* -------------------- Azioni (solo proprio) -------------------- */
function actionsCard() {
  return el('div', { class: 'card', style: 'margin-top:var(--sp-3)' }, [
    el('div', { class: 'grid grid-2' }, [
      el('button', { class: 'btn btn-outline', html: `${svg('edit', 20)} Modifica profilo`, onClick: () => openEditModal() }),
      el('button', { class: 'btn btn-outline', text: 'Cambia password', onClick: openPasswordModal }),
    ]),
    el('div', { class: 'flex gap-2 wrap', style: 'margin-top:var(--sp-3)' }, [
      el('a', { class: 'chip', href: '/settings.html', html: `${svg('settings', 18)} Impostazioni` }),
      el('a', { class: 'chip', href: '/friends.html', html: `${svg('users', 18)} Amici` }),
      el('a', { class: 'chip', href: '/clubs.html', text: '👥 Club' }),
    ]),
    el('div', { style: 'margin-top:var(--sp-3)' }, [
      el('button', { class: 'btn btn-ghost btn-block', html: `${svg('logout', 20)} Esci`, onClick: () => auth.logout() }),
    ]),
  ]);
}

function openEditModal() {
  const user = auth.user || {};
  const img = el('img', { class: 'avatar lg', src: user.avatar || DEFAULT_AVATAR, alt: '' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const pickBtn = el('button', { type: 'button', class: 'btn btn-outline btn-sm', html: `${svg('camera', 18)} Cambia foto`, onClick: () => fileInput.click() });
  const nickInput = el('input', { class: 'input', value: user.nickname || '', maxlength: '24', placeholder: 'Nickname' });
  const bioInput = el('textarea', { class: 'textarea', maxlength: '300', placeholder: 'Racconta chi sei…' });
  bioInput.value = user.bio || '';

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const { avatar } = await api.upload('/users/me/avatar', fd);
      img.src = avatar;
      auth.user = { ...(auth.user || {}), avatar };
      document.querySelectorAll('.avatar-ring img').forEach((i) => { i.src = avatar; });
      toast.success('Foto aggiornata!');
    } catch (err) {
      toast.error(err.message || 'Caricamento non riuscito.');
    }
  });

  const body = el('div', {}, [
    el('div', { class: 'field' }, [
      el('label', { text: 'Foto profilo' }),
      el('div', { class: 'flex gap-3 items-center' }, [img, pickBtn, fileInput]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Nickname' }), nickInput]),
    el('div', { class: 'field' }, [el('label', { text: 'Bio' }), bioInput]),
  ]);
  const save = el('button', { class: 'btn btn-primary', text: 'Salva' });
  const m = modal({ title: 'Modifica profilo', content: body, footer: [save] });

  save.addEventListener('click', async () => {
    const nickname = nickInput.value.trim();
    if (nickname.length < 3) { toast.error('Nickname troppo corto (min. 3 caratteri).'); return; }
    save.disabled = true; save.textContent = 'Salvataggio…';
    try {
      const { user: updated } = await api.put('/users/me', { nickname, bio: bioInput.value.trim() });
      auth.user = { ...(auth.user || {}), nickname: updated.nickname, bio: updated.bio };
      m.close();
      toast.success('Profilo aggiornato!');
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      toast.error(err.message || 'Salvataggio non riuscito.');
      save.disabled = false; save.textContent = 'Salva';
    }
  });
}

function openPasswordModal() {
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password attuale' });
  const nw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Nuova password (min. 8)' });
  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', { text: 'Password attuale' }), cur]),
    el('div', { class: 'field' }, [el('label', { text: 'Nuova password' }), nw]),
  ]);
  const save = el('button', { class: 'btn btn-primary', text: 'Aggiorna password' });
  const m = modal({ title: 'Cambia password', content: body, footer: [save] });

  save.addEventListener('click', async () => {
    if (nw.value.length < 8) { toast.error('La nuova password deve avere almeno 8 caratteri.'); return; }
    save.disabled = true; save.textContent = 'Aggiornamento…';
    try {
      await api.post('/auth/change-password', { current_password: cur.value, new_password: nw.value });
      m.close();
      toast.success('Password aggiornata!');
    } catch (err) {
      toast.error(err.message || 'Operazione non riuscita.');
      save.disabled = false; save.textContent = 'Aggiorna password';
    }
  });
}

/* -------------------- Veicoli -------------------- */
function vehiclesCard(vehicles, isOwn) {
  const listWrap = el('div', { class: 'list' });
  const head = el('div', { class: 'flex justify-between items-center', style: 'margin-bottom:var(--sp-3)' }, [
    el('h3', { class: 'card-title', style: 'margin:0', text: 'Veicoli' }),
    isOwn ? el('button', { class: 'btn btn-sm btn-outline', html: `${svg('plus', 18)} Aggiungi`, onClick: () => openVehicleModal(listWrap) }) : null,
  ]);
  renderVehicleList(listWrap, vehicles, isOwn);
  return el('div', { class: 'card', style: 'margin-top:var(--sp-3)' }, [head, listWrap]);
}

function renderVehicleList(wrap, vehicles, isOwn) {
  wrap.replaceChildren();
  if (!vehicles.length) {
    wrap.append(empty('🏍️', isOwn ? 'Nessun veicolo. Aggiungine uno!' : 'Nessun veicolo.'));
    return;
  }
  for (const v of vehicles) {
    const sub = [v.make, v.model, v.year].filter(Boolean).join(' · ');
    wrap.append(el('div', { class: 'list-item' }, [
      el('div', { style: 'font-size:1.6rem', text: vehIcon(v.type) }),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title' }, [
          v.name || vehIcon(v.type),
          v.is_primary ? el('span', { class: 'pill accent', style: 'margin-left:6px', text: 'Principale' }) : null,
        ]),
        sub ? el('div', { class: 'li-sub', text: sub }) : null,
      ]),
      isOwn ? el('button', {
        class: 'btn btn-icon btn-ghost', 'aria-label': 'Elimina veicolo', html: svg('trash', 18),
        onClick: async () => {
          const ok = await confirmDialog({ title: 'Eliminare il veicolo?', message: v.name || '', confirmText: 'Elimina', danger: true });
          if (!ok) return;
          try {
            await api.del(`/users/me/vehicles/${v.id}`);
            toast.success('Veicolo eliminato.');
            const { vehicles: vs } = await api.get('/users/me/vehicles');
            renderVehicleList(wrap, vs || [], true);
          } catch (err) {
            toast.error(err.message || 'Eliminazione non riuscita.');
          }
        },
      }) : null,
    ]));
  }
}

function openVehicleModal(listWrap) {
  const typeSel = el('select', { class: 'select' });
  for (const t of VEHICLE_TYPES) typeSel.append(el('option', { value: t.v, text: `${t.ic} ${t.l}` }));
  const nameInp = el('input', { class: 'input', maxlength: '60', placeholder: 'es. La mia Panigale' });
  const makeInp = el('input', { class: 'input', maxlength: '40', placeholder: 'Marca' });
  const modelInp = el('input', { class: 'input', maxlength: '40', placeholder: 'Modello' });
  const yearInp = el('input', { class: 'input', type: 'number', min: '1900', max: '2100', placeholder: 'Anno' });
  const primaryChk = el('input', { type: 'checkbox' });

  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', { text: 'Tipo' }), typeSel]),
    el('div', { class: 'field' }, [el('label', { text: 'Nome' }), nameInp]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Marca' }), makeInp]),
      el('div', { class: 'field' }, [el('label', { text: 'Modello' }), modelInp]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Anno' }), yearInp]),
    el('label', { class: 'checkbox' }, [primaryChk, el('span', { text: 'Imposta come veicolo principale' })]),
  ]);
  const save = el('button', { class: 'btn btn-primary', text: 'Aggiungi veicolo' });
  const m = modal({ title: 'Aggiungi veicolo', content: body, footer: [save] });

  save.addEventListener('click', async () => {
    const name = nameInp.value.trim();
    if (name.length < 2) { toast.error('Dai un nome al veicolo.'); return; }
    save.disabled = true; save.textContent = 'Aggiunta…';
    try {
      await api.post('/users/me/vehicles', {
        type: typeSel.value,
        name,
        make: makeInp.value.trim(),
        model: modelInp.value.trim(),
        year: yearInp.value ? Number(yearInp.value) : null,
        is_primary: primaryChk.checked,
      });
      m.close();
      toast.success('Veicolo aggiunto!');
      const { vehicles } = await api.get('/users/me/vehicles');
      renderVehicleList(listWrap, vehicles || [], true);
    } catch (err) {
      toast.error(err.message || 'Operazione non riuscita.');
      save.disabled = false; save.textContent = 'Aggiungi veicolo';
    }
  });
}

/* -------------------- Distintivi -------------------- */
function badgesCard(badges, isOwn) {
  const card = el('div', { class: 'card', style: 'margin-top:var(--sp-3)' }, [el('h3', { class: 'card-title', text: 'Distintivi' })]);
  if (!badges.length) {
    card.append(empty('🏅', 'Nessun distintivo.'));
    return card;
  }
  const grid = el('div', { class: 'grid grid-auto' });
  for (const b of badges) {
    const earned = isOwn ? !!b.earned : true;
    grid.append(el('div', { class: `gbadge ${tierClass(b.tier)} ${earned ? '' : 'locked'}`, title: b.description || '' }, [
      el('div', { class: 'ic', text: b.icon || '🏅' }),
      el('div', { class: 'nm', text: b.name || b.code || '' }),
    ]));
  }
  card.append(grid);
  return card;
}

/* -------------------- Missioni (solo proprio) -------------------- */
function missionsCard(missions) {
  const card = el('div', { class: 'card', style: 'margin-top:var(--sp-3)' }, [el('h3', { class: 'card-title', text: 'Missioni' })]);
  if (!missions.length) {
    card.append(empty('🎯', 'Nessuna missione attiva.'));
    return card;
  }
  const groups = [['daily', 'Giornaliere'], ['weekly', 'Settimanali'], ['achievement', 'Obiettivi']];
  for (const [period, label] of groups) {
    const items = missions.filter((m) => m.period === period);
    if (!items.length) continue;
    card.append(el('div', { class: 'section-label', style: 'margin-top:var(--sp-3)', text: label }));
    for (const m of items) card.append(missionRow(m));
  }
  return card;
}

function missionRow(m) {
  const target = m.target || 0;
  const prog = m.progress || 0;
  const pct = target > 0 ? Math.min(100, Math.round((prog / target) * 100)) : (m.completed ? 100 : 0);
  return el('div', { style: 'margin-bottom:var(--sp-3)' }, [
    el('div', { class: 'flex justify-between items-center gap-2' }, [
      el('div', { style: 'min-width:0' }, [
        el('div', { class: `li-title ${m.completed ? 'text-success' : ''}`, text: `${m.completed ? '✓ ' : ''}${m.name || ''}` }),
        m.description ? el('div', { class: 'li-sub', text: m.description }) : null,
      ]),
      el('span', { class: 'mono text-lo', style: 'font-size:.8rem;white-space:nowrap', text: `${prog}/${target}` }),
    ]),
    el('div', { class: 'meter', style: 'margin-top:6px' }, [el('span', { style: `width:${pct}%` })]),
    m.xp_reward ? el('div', { class: 'text-lo', style: 'font-size:.72rem;margin-top:4px', text: `+${m.xp_reward} XP` }) : null,
  ]);
}

/* -------------------- Classifica (top 5) -------------------- */
function mountLeaderboard(root, user) {
  const list = el('div', { class: 'list' });
  const card = el('div', { class: 'card', style: 'margin-top:var(--sp-3)' }, [
    el('div', { class: 'flex justify-between items-center', style: 'margin-bottom:var(--sp-3)' }, [
      el('h3', { class: 'card-title', style: 'margin:0', text: 'Classifica' }),
      el('a', { href: '/leaderboard.html', class: 'text-accent', style: 'font-size:.85rem', text: 'Classifica completa' }),
    ]),
    list,
  ]);
  root.append(card);

  api.get('/users/leaderboard').then(({ leaderboard }) => {
    const top = (leaderboard || []).slice(0, 5);
    if (!top.length) { list.append(el('p', { class: 'text-lo', text: 'Nessun dato disponibile.' })); return; }
    for (const r of top) {
      const isMe = String(r.id) === String(user.id);
      const rankCls = r.rank === 1 ? 'gold' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : '';
      list.append(el('a', { class: 'list-item', href: `/profile.html?id=${r.id}`, style: isMe ? 'border-color:var(--accent)' : '' }, [
        el('div', { class: `li-rank ${rankCls}`, text: String(r.rank) }),
        el('img', { class: 'avatar sm', src: r.avatar || DEFAULT_AVATAR, alt: '' }),
        el('div', { class: 'li-body' }, [
          el('div', { class: 'li-title', text: r.nickname || '' }),
          el('div', { class: 'li-sub', text: `Liv. ${r.level} · ${fmtDistance(r.total_distance_m)}` }),
        ]),
        isMe ? el('span', { class: 'pill accent', text: 'Tu' }) : null,
      ]));
    }
  }).catch(() => { list.append(el('p', { class: 'text-lo', text: 'Classifica non disponibile.' })); });
}

main();
