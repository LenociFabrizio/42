/**
 * services/notifications.js
 * ------------------------------------------------------------
 * Creazione notifiche persistenti. Il client le recupera via polling
 * intelligente (vedi routes/notifications). Rispetta le preferenze utente
 * per categoria quando applicabile.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';

// Mappa tipo notifica → colonna preferenza in user_settings (null = sempre inviata).
const PREF_COLUMN = {
  friend_request: 'notify_friends',
  friend_accepted: 'notify_friends',
  event_invite: 'notify_events',
  event_reminder: 'notify_events',
  event_join: 'notify_events',
  record_beaten: 'notify_records',
  club_invite: 'notify_clubs',
  club_request: 'notify_clubs',
  club_accepted: 'notify_clubs',
};

/**
 * Crea una notifica per un utente.
 * @param {number} userId destinatario
 * @param {string} type   tipo (vedi PREF_COLUMN + 'badge','level_up',...)
 * @param {string} title
 * @param {string} body
 * @param {object} data   payload JSON (ids, link)
 */
export async function notify(userId, type, title, body = '', data = {}) {
  if (!userId) return;

  // Rispetta la preferenza dell'utente, se questo tipo ne ha una.
  const prefCol = PREF_COLUMN[type];
  if (prefCol) {
    const s = await db.prepare(`SELECT ${prefCol} AS pref FROM user_settings WHERE user_id = ?`).get(userId);
    if (s && Number(s.pref) === 0) return; // disattivata
  }

  await db
    .prepare('INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, title, body, JSON.stringify(data || {}));
}

/** Conteggio notifiche non lette (per il badge campanella). */
export async function unreadCount(userId) {
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId);
  return r?.n || 0;
}
