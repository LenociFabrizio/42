/**
 * notificationController.js
 * ------------------------------------------------------------
 * Centro notifiche dell'utente: elenco recente, conteggio non lette,
 * segna come letto (singole / tutte) ed eliminazione.
 * La creazione delle notifiche vive in services/notifications.js.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError, safeJson } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { unreadCount } from '../services/notifications.js';

/**
 * GET /api/notifications — ultime 60 notifiche dell'utente, dalla più
 * recente, con il payload `data` già deserializzato in oggetto e il
 * conteggio delle non lette.
 */
export const list = asyncHandler(async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, type, title, body, data, read_at, created_at
         FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 60`
    )
    .all(req.user.id);

  const notifications = rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: safeJson(n.data, {}),
    read_at: n.read_at,
    created_at: n.created_at,
  }));

  res.json({ notifications, unread: await unreadCount(req.user.id) });
});

/** GET /api/notifications/unread-count — conteggio non lette (badge campanella). */
export const getUnreadCount = asyncHandler(async (req, res) => {
  res.json({ unread: await unreadCount(req.user.id) });
});

/**
 * POST /api/notifications/read — body { ids:[int,...] }.
 * Segna come lette (solo quelle dell'utente ancora non lette).
 */
export const markRead = asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body.ids) ? req.body.ids : [];
  const ids = raw.map((id) => v.int(id, 'id', { min: 1 }));

  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE notifications SET read_at = datetime('now')
          WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`
      )
      .run(req.user.id, ...ids);
  }
  res.json({ ok: true });
});

/** POST /api/notifications/read-all — segna come lette tutte le mie non lette. */
export const markAllRead = asyncHandler(async (req, res) => {
  await db
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(req.user.id);
  res.json({ ok: true });
});

/** DELETE /api/notifications/:id — elimina una notifica dell'utente. */
export const remove = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const owned = await db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!owned) throw new HttpError(404, 'Notifica non trovata.');
  await db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  res.status(204).end();
});
