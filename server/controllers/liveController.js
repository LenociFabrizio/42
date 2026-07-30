/**
 * liveController.js
 * ------------------------------------------------------------
 * Live Map (multiplayer): consenso alla condivisione, aggiornamento
 * posizione, stop e ricerca degli utenti live nelle vicinanze.
 *
 * PRIVACY: la visibilità di ogni utente sulla mappa dipende dalle SUE
 * impostazioni (user_settings.location_visibility). Nessuna posizione
 * viene esposta senza consenso esplicito (live_enabled = 1).
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { LIVE_MAP_MIN_LEVEL } from '../utils/constants.js';

/**
 * PUT /api/live/settings — attiva/disattiva la condivisione live.
 * NESSUN livello minimo per attivare: la condivisione con gli AMICI è sempre
 * disponibile (con consenso esplicito). Il livello minimo conta solo per
 * essere visibili agli SCONOSCIUTI (visibilità 'public'), vedi `nearby`.
 * Disattivando, la posizione più recente viene cancellata.
 */
export const setLive = asyncHandler(async (req, res) => {
  const enabled = v.bool(req.body.live_enabled);

  if (enabled) {
    await db
      .prepare("UPDATE users SET live_enabled = 1, updated_at = datetime('now') WHERE id = ?")
      .run(req.user.id);
  } else {
    await db
      .prepare(
        `UPDATE users SET live_enabled = 0, last_lat = NULL, last_lng = NULL,
                last_speed = NULL, last_heading = NULL, last_seen = NULL,
                updated_at = datetime('now')
           WHERE id = ?`
      )
      .run(req.user.id);
  }

  res.json({ live_enabled: enabled });
});

/**
 * POST /api/live/position — aggiorna la posizione live corrente.
 * Ammesso solo se la condivisione è attiva (live_enabled = 1).
 */
export const updatePosition = asyncHandler(async (req, res) => {
  if (!req.user.live_enabled) throw new HttpError(403, 'Condivisione posizione disattivata.');

  const lat = v.latitude(req.body.lat);
  const lng = v.longitude(req.body.lng);
  const speed = v.num(req.body.speed, 'Velocità', { min: 0, max: 500, def: null });
  const heading = v.num(req.body.heading, 'Direzione', { min: 0, max: 360, def: null });

  await db
    .prepare(
      `UPDATE users SET last_lat = ?, last_lng = ?, last_speed = ?, last_heading = ?,
              last_seen = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
    )
    .run(lat, lng, speed, heading, req.user.id);

  res.json({ ok: true });
});

/** POST /api/live/stop — disattiva la condivisione e cancella la posizione. */
export const stop = asyncHandler(async (req, res) => {
  await db
    .prepare(
      `UPDATE users SET live_enabled = 0, last_lat = NULL, last_lng = NULL,
              last_speed = NULL, last_heading = NULL, last_seen = NULL,
              updated_at = datetime('now')
         WHERE id = ?`
    )
    .run(req.user.id);
  res.json({ ok: true });
});

/**
 * GET /api/live/nearby — utenti live visibili al richiedente.
 * "recent" = last_seen negli ultimi 5 minuti. Solo utenti con live_enabled = 1,
 * escluso me stesso. Regole di visibilità (con consenso già garantito da
 * live_enabled):
 *   - AMICO (amicizia accettata): visibile SEMPRE, senza livello minimo,
 *     purché la sua visibilità non sia 'private'.
 *   - SCONOSCIUTO (non amico): visibile SOLO se la sua visibilità è 'public'
 *     E il suo livello è >= LIVE_MAP_MIN_LEVEL.
 * Filtro opzionale bbox = "minLng,minLat,maxLng,maxLat".
 */
export const nearby = asyncHandler(async (req, res) => {
  const where = [
    'u.live_enabled = 1',
    "u.last_seen >= datetime('now', '-5 minutes')",
    'u.id != ?',
  ];
  const args = [req.user.id];

  // Filtro viewport opzionale.
  if (req.query.bbox) {
    const parts = String(req.query.bbox).split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = parts;
      where.push('u.last_lat >= ? AND u.last_lat <= ? AND u.last_lng >= ? AND u.last_lng <= ?');
      args.push(minLat, maxLat, minLng, maxLng);
    }
  }

  // Sottoquery amicizia accettata tra il target (u) e me.
  const FRIEND = `EXISTS (
    SELECT 1 FROM friendships f
     WHERE f.status = 'accepted'
       AND ((f.requester_id = u.id AND f.addressee_id = ?)
         OR (f.requester_id = ? AND f.addressee_id = u.id))
  )`;

  where.push(
    `(
       (
         COALESCE(us.location_visibility, 'friends') IN ('friends', 'public')
         AND ${FRIEND}
       )
       OR (
         COALESCE(us.location_visibility, 'friends') = 'public'
         AND u.level >= ?
         AND NOT ${FRIEND}
       )
     )`
  );
  // Ordine dei parametri: friend(amico) x2, poi livello, poi friend(sconosciuto) x2.
  args.push(req.user.id, req.user.id, LIVE_MAP_MIN_LEVEL, req.user.id, req.user.id);

  const rows = await db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, u.level,
              u.last_lat, u.last_lng, u.last_speed, u.last_heading, u.last_seen
         FROM users u
         LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY u.last_seen DESC`
    )
    .all(...args);

  res.json({ users: rows });
});
