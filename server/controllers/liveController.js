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
import { LIVE_MAP_MIN_LEVEL, LIVE_STALE_SECONDS } from '../utils/constants.js';

// Finestra di "presenza live" da usare dentro le query SQL.
const STALE = `-${LIVE_STALE_SECONDS} seconds`;

/**
 * Spegne la condivisione e CANCELLA la posizione: non basta nasconderla, chi
 * smette non deve lasciare tracce sulla mappa degli altri. Unico punto di
 * verità per i due modi di smettere (PUT /settings e POST /stop): due copie
 * della stessa UPDATE finirebbero per divergere, e la differenza sarebbe
 * proprio un puntino fantasma rimasto acceso.
 */
function clearLive(userId) {
  return db
    .prepare(
      `UPDATE users SET live_enabled = 0, last_lat = NULL, last_lng = NULL,
              last_speed = NULL, last_heading = NULL, last_seen = NULL,
              live_since = NULL, live_vehicle_id = NULL,
              updated_at = datetime('now')
         WHERE id = ?`
    )
    .run(userId);
}

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
    // live_since = inizio della sessione online (mostrato agli altri come
    // "online da…"). Non lo azzeriamo se la condivisione era già attiva.
    await db
      .prepare(
        `UPDATE users SET live_enabled = 1,
                live_since = COALESCE(CASE WHEN live_enabled = 1 THEN live_since END, datetime('now')),
                updated_at = datetime('now')
           WHERE id = ?`
      )
      .run(req.user.id);
  } else {
    await clearLive(req.user.id);
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

  // Veicolo in uso (opzionale): mostrato agli altri nel popup della live map.
  // Deve appartenere a chi lo dichiara.
  let vehicleId = null;
  if (req.body.vehicle_id != null && req.body.vehicle_id !== '') {
    vehicleId = v.int(req.body.vehicle_id, 'Veicolo', { min: 1 });
    const owned = await db
      .prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?')
      .get(vehicleId, req.user.id);
    if (!owned) throw new HttpError(404, 'Veicolo non trovato.');
  }

  // live_since: se la sessione precedente è scaduta (nessun battito entro la
  // finestra di `nearby`), questa è una NUOVA sessione online.
  await db
    .prepare(
      `UPDATE users SET last_lat = ?, last_lng = ?, last_speed = ?, last_heading = ?,
              live_vehicle_id = COALESCE(?, live_vehicle_id),
              live_since = CASE
                WHEN live_since IS NULL OR last_seen IS NULL
                  OR last_seen < datetime('now', ?)
                THEN datetime('now') ELSE live_since END,
              last_seen = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
    )
    .run(lat, lng, speed, heading, vehicleId, STALE, req.user.id);

  res.json({ ok: true });
});

/**
 * POST /api/live/vehicle — dichiara il veicolo che si sta guidando.
 * È l'informazione mostrata agli altri nel popup della live map.
 */
export const setVehicle = asyncHandler(async (req, res) => {
  const vehicleId = v.int(req.body.vehicle_id, 'Veicolo', { min: 1 });
  const owned = await db
    .prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?')
    .get(vehicleId, req.user.id);
  if (!owned) throw new HttpError(404, 'Veicolo non trovato.');

  await db
    .prepare("UPDATE users SET live_vehicle_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(vehicleId, req.user.id);
  res.json({ live_vehicle_id: vehicleId });
});

/** POST /api/live/stop — disattiva la condivisione e cancella la posizione. */
export const stop = asyncHandler(async (req, res) => {
  await clearLive(req.user.id);
  res.json({ ok: true });
});

/**
 * GET /api/live/nearby — utenti live visibili al richiedente.
 * "recent" = last_seen entro LIVE_STALE_SECONDS. Solo utenti con
 * live_enabled = 1, escluso me stesso. Regole di visibilità (con consenso già
 * garantito da live_enabled):
 *   - RECIPROCITÀ: chi non condivide non vede. La mappa dei vivi è uno scambio,
 *     non un servizio a senso unico: spegnendo la condivisione si sparisce dagli
 *     altri E gli altri spariscono da noi, subito e da entrambe le parti.
 *     Chi non condivide riceve solo `friends_live`: quanti amici sono in strada,
 *     senza una singola coordinata. È l'invito ad accendere, non una posizione.
 *   - AMICO (amicizia accettata): visibile SEMPRE, senza livello minimo e
 *     SENZA filtro di viewport, purché la sua visibilità non sia 'private'.
 *   - SCONOSCIUTO (non amico): visibile SOLO se la sua visibilità è 'public',
 *     il suo livello è >= LIVE_MAP_MIN_LEVEL ed è dentro la vista richiesta.
 *
 * Il bbox ("minLng,minLat,maxLng,maxLat") serve a non scaricare mezza Italia di
 * sconosciuti: applicarlo anche agli amici era un errore, perché due amici
 * lontani non si vedevano mai e dalla mappa non si capiva il perché.
 * Ogni riga porta `is_friend`, così il client sa chi può inquadrare.
 */
export const nearby = asyncHandler(async (req, res) => {
  const me = req.user.id;

  // Sottoquery amicizia accettata tra il target (u) e me.
  const FRIEND = `EXISTS (
    SELECT 1 FROM friendships f
     WHERE f.status = 'accepted'
       AND ((f.requester_id = u.id AND f.addressee_id = ?)
         OR (f.requester_id = ? AND f.addressee_id = u.id))
  )`;

  // Condivisione spenta: nessuna posizione, solo il numero di amici in strada.
  // È lo stesso consenso che regge la lista amici (chi è online), non una
  // coordinata: serve a sapere che conviene accendere.
  if (!req.user.live_enabled) {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM users u
           LEFT JOIN user_settings us ON us.user_id = u.id
          WHERE u.live_enabled = 1
            AND u.last_seen >= datetime('now', ?)
            AND u.last_lat IS NOT NULL AND u.last_lng IS NOT NULL
            AND u.id != ?
            AND COALESCE(us.location_visibility, 'friends') IN ('friends', 'public')
            AND ${FRIEND}`
      )
      .get(STALE, me, me, me);
    return res.json({ users: [], friends_live: row?.n || 0, sharing: false });
  }

  // Filtro viewport opzionale (solo sconosciuti).
  let bboxSql = '1 = 1';
  const bboxArgs = [];
  if (req.query.bbox) {
    const parts = String(req.query.bbox).split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = parts;
      bboxSql = 'u.last_lat >= ? AND u.last_lat <= ? AND u.last_lng >= ? AND u.last_lng <= ?';
      bboxArgs.push(minLat, maxLat, minLng, maxLng);
    }
  }

  // Veicolo mostrato: quello dichiarato in guida (live_vehicle_id) oppure,
  // in mancanza, il veicolo principale del profilo.
  const sql = `SELECT u.id, u.nickname, u.avatar, u.level,
              u.last_lat, u.last_lng, u.last_speed, u.last_heading, u.last_seen,
              u.live_since,
              ${FRIEND} AS is_friend,
              COALESCE(dv.type, pv.type)   AS vehicle_type,
              COALESCE(dv.name, pv.name)   AS vehicle_name,
              COALESCE(dv.make, pv.make)   AS vehicle_make,
              COALESCE(dv.model, pv.model) AS vehicle_model
         FROM users u
         LEFT JOIN user_settings us ON us.user_id = u.id
         LEFT JOIN vehicles dv ON dv.id = u.live_vehicle_id AND dv.user_id = u.id
         LEFT JOIN vehicles pv ON pv.id = (
                SELECT id FROM vehicles WHERE user_id = u.id
                 ORDER BY is_primary DESC, id LIMIT 1
              )
        WHERE u.live_enabled = 1
          AND u.last_seen >= datetime('now', ?)
          AND u.last_lat IS NOT NULL AND u.last_lng IS NOT NULL
          AND u.id != ?
          AND (
                (
                  COALESCE(us.location_visibility, 'friends') IN ('friends', 'public')
                  AND ${FRIEND}
                )
                OR (
                  COALESCE(us.location_visibility, 'friends') = 'public'
                  AND u.level >= ?
                  AND NOT ${FRIEND}
                  AND (${bboxSql})
                )
              )
        ORDER BY is_friend DESC, u.last_seen DESC`;

  // I segnaposto seguono l'ordine del testo SQL: is_friend (2), finestra live (1),
  // u.id != ? (1), amico (2), livello minimo (1), sconosciuto (2), bbox (0 o 4).
  const args = [me, me, STALE, me, me, me, LIVE_MAP_MIN_LEVEL, me, me, ...bboxArgs];

  const rows = await db.prepare(sql).all(...args);

  res.json({
    users: rows,
    friends_live: rows.filter((r) => r.is_friend).length,
    sharing: true,
  });
});
