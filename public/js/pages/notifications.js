/* =============================================================
   notifications.js — Elenco notifiche.
   All'apertura marca tutto come letto (svuota la campanella), ma
   evidenzia con un bordo accento quelle non ancora lette. Ogni voce
   può essere aperta (link contestuale) o eliminata.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, loader, toast, timeAgo } from '../core/ui.js';
import api from '../core/api.js';

const TYPE_ICON = {
  friend_request: '🤝',
  friend_accepted: '✅',
  record_beaten: '🏁',
  badge: '🏅',
  level_up: '⭐',
  mission: '✅',
};

function iconFor(type) {
  if (TYPE_ICON[type]) return TYPE_ICON[type];
  if (type && type.startsWith('event')) return '📣';
  if (type && type.startsWith('club')) return '👥';
  return '🔔';
}

function linkFor(n) {
  const d = n.data || {};
  if (n.type === 'friend_request' || n.type === 'friend_accepted') return '/friends.html';
  if (d.route_id) return `/route.html?id=${d.route_id}`;
  if (d.event_id) return `/event.html?id=${d.event_id}`;
  if (d.club_id) return `/club.html?id=${d.club_id}`;
  return null;
}

const empty = () => el('div', { class: 'empty' }, [el('div', { class: 'ic', text: '🔔' }), el('p', { text: 'Nessuna notifica' })]);

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: '' });

  const root = $('#root');
  root.append(el('h1', { text: 'Notifiche', style: 'margin-bottom:var(--sp-4)' }));
  const wrap = el('div', {});
  root.append(wrap);

  try {
    const { notifications, unread } = await api.get('/notifications');
    render(wrap, notifications || []);
    // Svuota la campanella dopo aver reso la lista (l'evidenza resta visiva).
    if (unread > 0) api.post('/notifications/read-all').catch(() => { /* silenzioso */ });
  } catch (err) {
    wrap.append(el('div', { class: 'empty' }, [
      el('div', { class: 'ic', text: '⚠️' }),
      el('p', { text: err.message || 'Impossibile caricare le notifiche.' }),
    ]));
  } finally {
    loader.hide();
  }
}

function render(wrap, items) {
  wrap.replaceChildren();
  if (!items.length) { wrap.append(empty()); return; }
  const list = el('div', { class: 'list' });
  for (const n of items) list.append(row(wrap, n));
  wrap.append(list);
}

function row(wrap, n) {
  const href = linkFor(n);
  const isUnread = !n.read_at;
  const attrs = {
    class: 'list-item',
    style: `align-items:flex-start;${isUnread ? 'border-left:3px solid var(--accent)' : ''}`,
  };
  if (href) attrs.href = href;

  const del = el('button', { class: 'btn btn-icon btn-ghost', 'aria-label': 'Elimina', text: '✕' });
  const item = el(href ? 'a' : 'div', attrs, [
    el('div', { style: 'font-size:1.5rem;flex-shrink:0;line-height:1', text: iconFor(n.type) }),
    el('div', { class: 'li-body' }, [
      el('div', { class: 'li-title', text: n.title || '' }),
      n.body ? el('div', { class: 'li-sub', text: n.body }) : null,
      el('div', { class: 'text-lo', style: 'font-size:.72rem;margin-top:2px', text: timeAgo(n.created_at) }),
    ]),
    del,
  ]);

  del.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.del(`/notifications/${n.id}`);
      item.remove();
      if (!wrap.querySelector('.list-item')) render(wrap, []);
    } catch (err) {
      toast.error(err.message || 'Eliminazione non riuscita.');
    }
  });

  return item;
}

main();
