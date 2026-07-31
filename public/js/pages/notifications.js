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
import { $, el, svg, loader, toast, timeAgo, confirmDialog } from '../core/ui.js';
import { notifIcon } from '../core/constants.js';
import api from '../core/api.js';

function linkFor(n) {
  const d = n.data || {};
  if (n.type === 'friend_request' || n.type === 'friend_accepted') return '/friends.html';
  if (d.route_id) return `/route.html?id=${d.route_id}`;
  if (d.event_id) return `/event.html?id=${d.event_id}`;
  if (d.club_id) return `/club.html?id=${d.club_id}`;
  return null;
}

const empty = () => el('div', { class: 'empty' }, [el('div', { class: 'ic', html: svg('bell', 46) }), el('p', { text: 'Nessuna notifica' })]);

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: '' });

  const root = $('#root');
  const clearBtn = el('button', {
    class: 'btn btn-outline btn-sm',
    html: `${svg('trash', 18)}<span>Pulisci tutto</span>`,
    onClick: () => clearAll(wrap, clearBtn),
  });
  root.append(el('div', { class: 'flex justify-between items-center gap-2', style: 'margin-bottom:var(--sp-4)' }, [
    el('h1', { text: 'Notifiche', style: 'margin:0' }),
    clearBtn,
  ]));
  const wrap = el('div', {});
  root.append(wrap);

  try {
    const { notifications, unread } = await api.get('/notifications');
    render(wrap, notifications || []);
    clearBtn.disabled = !(notifications || []).length;
    // Svuota la campanella dopo aver reso la lista (l'evidenza resta visiva).
    if (unread > 0) api.post('/notifications/read-all').catch(() => { /* silenzioso */ });
  } catch (err) {
    wrap.append(el('div', { class: 'empty' }, [
      el('div', { class: 'ic', html: svg('alert', 46) }),
      el('p', { text: err.message || 'Impossibile caricare le notifiche.' }),
    ]));
  } finally {
    loader.hide();
  }
}

/** Svuota il centro notifiche (con conferma: l'operazione è irreversibile). */
async function clearAll(wrap, btn) {
  const ok = await confirmDialog({
    title: 'Eliminare tutte le notifiche?',
    message: 'Il centro notifiche verrà svuotato. L\'operazione non è reversibile.',
    confirmText: 'Elimina tutto',
    danger: true,
  });
  if (!ok) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Pulizia…';
  try {
    const { deleted } = await api.del('/notifications');
    render(wrap, []);
    toast.success(deleted ? `${deleted} notifiche eliminate.` : 'Nessuna notifica da eliminare.');
  } catch (err) {
    toast.error(err.message || 'Eliminazione non riuscita.');
    btn.disabled = false;
    btn.innerHTML = original;
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

  const del = el('button', { class: 'btn btn-icon btn-ghost', 'aria-label': 'Elimina', html: svg('x', 18) });
  const item = el(href ? 'a' : 'div', attrs, [
    el('div', { style: 'flex-shrink:0;line-height:1', html: svg(notifIcon(n.type), 24) }),
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
