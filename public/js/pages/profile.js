/* =============================================================
   profile.js — Pagina Profilo.
   - Profilo proprio: intestazione con anello livello, barra XP,
     statistiche, azioni (modifica/password/nav/logout), veicoli,
     distintivi, missioni, classifica.
   - Profilo altrui (?id=…): sola lettura + azione "Aggiungi amico".
   Icone: set SVG a tema (niente emoji).
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { xpMeter, levelTitle, ringPercent } from '../core/gamification.js';
import { $, el, svg, loader, toast, modal, confirmDialog, fmtDistance, fmtDuration, fmtNum, qs } from '../core/ui.js';
import { VEHICLE_TYPES, vehIcon, badgeIcon } from '../core/constants.js';
import api from '../core/api.js';

const DEFAULT_AVATAR = '/images/avatars/default.svg';
const TIERS = ['bronze', 'silver', 'gold', 'special'];
const tierClass = (t) => (TIERS.includes(t) ? t : 'bronze');
const stat = (v, k) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })]);
const empty = (iconName, msg) => el('div', { class: 'empty' }, [el('div', { class: 'ic', html: svg(iconName, 46) }), el('p', { text: msg })]);

/**
 * Card richiudibile: intestazione cliccabile + contenuto espandibile.
 * Usa <details>, così apertura/chiusura funzionano anche senza JS.
 * @param {object} o
 * @param {string} o.title      titolo della sezione
 * @param {string} [o.icon]     icona SVG accanto al titolo
 * @param {string} [o.count]    contatore mostrato nell'intestazione (es. "3/12")
 * @param {boolean} [o.open]    se partire già espansa
 * @param {Node|Node[]} o.body  contenuto
 */
function collapsibleCard({ title, icon = null, count = null, open = false, body }) {
  const summary = el('summary', {}, [
    icon ? el('span', { class: 'flex', html: svg(icon, 20) }) : null,
    el('span', { text: title }),
    count != null ? el('span', { class: 'cl-count', text: String(count) }) : null,
    el('span', { class: 'cl-chev', html: svg('chevron', 20) }),
  ]);
  const details = el('details', { class: 'card collapse', style: 'margin-top:var(--sp-3)' }, [
    summary,
    el('div', { class: 'cl-body' }, [].concat(body)),
  ]);
  if (open) details.open = true;
  return details;
}

async function main() {
  const me = await guard();
  if (!me) return;
  registerPWA();
  const viewId = qs.get('id');
  const isOwn = !viewId || String(viewId) === String(me.id);
  mountShell({ active: '' });

  const root = $('#root');
  try {
    if (isOwn) await renderOwn(root);
    else await renderOther(root, viewId);
  } catch (err) {
    root.append(empty('alert', err.message || 'Impossibile caricare il profilo.'));
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
      el('p', { class: 'text-lo flex items-center justify-center gap-2', style: 'margin-top:var(--sp-3)', html: `${svg('lock', 16)} Profilo privato` }),
    ]));
    const fa = await friendActionCard(id);
    if (fa) root.append(fa);
    return;
  }
  const user = data.user;
  root.append(headerCard(user, false));
  const fa = await friendActionCard(id);
  if (fa) root.append(fa);
  root.append(
    statsCard(user),
    vehiclesCard(data.vehicles || [], false),
    badgesCard(data.badges || [], false),
  );
}

/* -------------------- Azione amicizia (profilo altrui) -------------------- */
async function friendActionCard(targetId) {
  let fr, rq;
  try {
    [fr, rq] = await Promise.all([api.get('/friends'), api.get('/friends/requests')]);
  } catch {
    return null;
  }
  const isFriend = (fr.friends || []).some((f) => String(f.id) === String(targetId));
  const out = (rq.outgoing || []).find((r) => String(r.to?.id) === String(targetId));
  const inc = (rq.incoming || []).find((r) => String(r.from?.id) === String(targetId));
  const card = el('div', { class: 'card', style: 'margin-top:var(--sp-3)' });

  if (isFriend) {
    card.append(el('span', { class: 'pill green', html: `${svg('check', 14)} Siete amici` }));
    return card;
  }
  if (out) {
    card.append(el('button', { class: 'btn btn-outline btn-block', disabled: true, html: `${svg('clock', 18)} Richiesta inviata` }));
    return card;
  }
  if (inc) {
    const btn = el('button', { class: 'btn btn-primary btn-block', html: `${svg('check', 18)} Accetta richiesta` });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api.post(`/friends/${inc.id}/accept`); toast.success('Ora siete amici!'); setTimeout(() => location.reload(), 500); }
      catch (e) { toast.error(e.message || 'Operazione non riuscita.'); btn.disabled = false; }
    });
    card.append(btn);
    return card;
  }
  const btn = el('button', { class: 'btn btn-primary btn-block', html: `${svg('users', 18)} Aggiungi amico` });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.innerHTML = 'Invio…';
    try {
      await api.post('/friends/request', { user_id: Number(targetId) });
      btn.className = 'btn btn-outline btn-block'; btn.disabled = true;
      btn.innerHTML = `${svg('clock', 18)} Richiesta inviata`;
      toast.success('Richiesta di amicizia inviata!');
    } catch (e) {
      toast.error(e.message || 'Operazione non riuscita.');
      btn.disabled = false; btn.innerHTML = `${svg('users', 18)} Aggiungi amico`;
    }
  });
  card.append(btn);
  return card;
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
          user.streak_days ? el('span', { class: 'pill gray', html: `${svg('fire', 14)} ${user.streak_days}` }) : null,
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
    // .btn-pair: celle che possono restringersi, così l'etichetta lunga non
    // sborda dal bottone e i due pulsanti restano allineati.
    el('div', { class: 'btn-pair' }, [
      el('button', { class: 'btn btn-outline', html: `${svg('edit', 20)}<span>Modifica profilo</span>`, onClick: () => openEditModal() }),
      el('button', { class: 'btn btn-outline', html: `${svg('key', 20)}<span>Password</span>`, onClick: openPasswordModal }),
    ]),
    el('div', { class: 'profile-nav', style: 'margin-top:var(--sp-3)' }, [
      el('a', { class: 'btn btn-outline', href: '/settings.html', html: `${svg('settings', 22)}<span>Impostazioni</span>` }),
      el('a', { class: 'btn btn-outline', href: '/friends.html', html: `${svg('users', 22)}<span>Amici</span>` }),
      el('a', { class: 'btn btn-outline', href: '/clubs.html', html: `${svg('building', 22)}<span>Club</span>` }),
    ]),
    el('div', { style: 'margin-top:var(--sp-3)' }, [
      el('button', { class: 'btn btn-logout btn-block', html: `${svg('logout', 20)} Esci`, onClick: () => auth.logout() }),
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
  // Chi si è registrato con Google non ha una password: la IMPOSTA (nessuna
  // password attuale da confermare).
  const hasPassword = auth.user?.has_password !== false;
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password attuale' });
  const nw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Nuova password (min. 8)' });
  const body = el('div', {}, [
    hasPassword
      ? el('div', { class: 'field' }, [el('label', { text: 'Password attuale' }), cur])
      : el('p', { class: 'text-lo', style: 'font-size:.85rem;margin-bottom:var(--sp-3)', text: 'Accedi con Google: imposta una password per poter entrare anche con email e password.' }),
    el('div', { class: 'field' }, [el('label', { text: hasPassword ? 'Nuova password' : 'Password' }), nw]),
  ]);
  const label = hasPassword ? 'Aggiorna password' : 'Imposta password';
  const save = el('button', { class: 'btn btn-primary', text: label });
  const m = modal({ title: hasPassword ? 'Cambia password' : 'Imposta password', content: body, footer: [save] });

  save.addEventListener('click', async () => {
    if (nw.value.length < 8) { toast.error('La password deve avere almeno 8 caratteri.'); return; }
    save.disabled = true; save.textContent = 'Aggiornamento…';
    try {
      const res = await api.post('/auth/change-password', { current_password: cur.value, new_password: nw.value });
      auth.user = { ...(auth.user || {}), has_password: true };
      m.close();
      toast.success(res?.message || 'Password aggiornata!');
    } catch (err) {
      toast.error(err.message || 'Operazione non riuscita.');
      save.disabled = false; save.textContent = label;
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
    wrap.append(empty('bike', isOwn ? 'Nessun veicolo. Aggiungine uno!' : 'Nessun veicolo.'));
    return;
  }
  for (const v of vehicles) {
    const sub = [v.make, v.model, v.year].filter(Boolean).join(' · ');
    wrap.append(el('div', { class: 'list-item' }, [
      el('div', { class: 'text-mid', html: svg(vehIcon(v.type), 26) }),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title' }, [
          v.name || (v.type === 'car' ? 'Auto' : 'Moto'),
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
  for (const t of VEHICLE_TYPES) typeSel.append(el('option', { value: t.v, text: t.l }));
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
/** Sezione distintivi: griglia a righe (più per riga) e richiudibile. */
function badgesCard(badges, isOwn) {
  if (!badges.length) {
    return collapsibleCard({ title: 'Distintivi', icon: 'award', body: empty('award', 'Nessun distintivo.') });
  }
  const earnedOf = (b) => (isOwn ? !!b.earned : true);
  const grid = el('div', { class: 'badge-grid' });
  for (const b of badges) {
    grid.append(el('div', { class: `gbadge ${tierClass(b.tier)} ${earnedOf(b) ? '' : 'locked'}`, title: b.description || b.name || '' }, [
      el('div', { class: 'ic', html: svg(badgeIcon(b.code), 30) }),
      el('div', { class: 'nm', text: b.name || b.code || '' }),
    ]));
  }
  const got = badges.filter(earnedOf).length;
  return collapsibleCard({
    title: 'Distintivi', icon: 'award',
    count: isOwn ? `${got}/${badges.length}` : String(badges.length),
    body: grid,
  });
}

/* -------------------- Missioni (solo proprio) -------------------- */
/** Sezione missioni: richiudibile, con contatore delle completate. */
function missionsCard(missions) {
  if (!missions.length) {
    return collapsibleCard({ title: 'Missioni', icon: 'target', body: empty('target', 'Nessuna missione attiva.') });
  }
  const body = el('div');
  const groups = [['daily', 'Giornaliere'], ['weekly', 'Settimanali'], ['achievement', 'Obiettivi']];
  let first = true;
  for (const [period, label] of groups) {
    const items = missions.filter((m) => m.period === period);
    if (!items.length) continue;
    body.append(el('div', { class: 'section-label', style: first ? '' : 'margin-top:var(--sp-4)', text: label }));
    first = false;
    for (const m of items) body.append(missionRow(m));
  }
  const done = missions.filter((m) => m.completed).length;
  return collapsibleCard({
    title: 'Missioni', icon: 'target',
    count: `${done}/${missions.length}`,
    body,
  });
}

function missionRow(m) {
  const target = m.target || 0;
  const prog = m.progress || 0;
  const pct = target > 0 ? Math.min(100, Math.round((prog / target) * 100)) : (m.completed ? 100 : 0);
  return el('div', { style: 'margin-bottom:var(--sp-3)' }, [
    el('div', { class: 'flex justify-between items-center gap-2' }, [
      el('div', { style: 'min-width:0' }, [
        el('div', { class: `li-title ${m.completed ? 'text-success' : ''} flex items-center gap-2`, html: `${m.completed ? svg('check', 16) : ''}<span>${(m.name || '').replace(/</g, '&lt;')}</span>` }),
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
