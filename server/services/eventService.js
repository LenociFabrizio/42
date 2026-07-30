/**
 * services/eventService.js
 * ------------------------------------------------------------
 * Logica di dominio degli EVENTI live (raduni geolocalizzati).
 *
 * Un evento ha un'area di raduno (centro + raggio): l'iscrizione (RSVP) è
 * libera, ma la PRESENZA è verificata via GPS (check-in) solo per chi si
 * trova davvero entro il raggio. Lo stato dell'evento è DERIVATO dall'orario
 * (vedi deriveStatus): la colonna `status` sul DB serve solo per 'cancelled'.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { HttpError } from '../utils/helpers.js';
import { XP } from '../utils/constants.js';
import { haversine } from '../utils/geo.js';
import { awardXp, bumpMissions, checkBadges } from './gamification.js';
import { recomputeUserStats } from './stats.js';
import { notify } from './notifications.js';

/**
 * Stato DERIVATO di un evento a partire dall'orario corrente.
 *  - 'cancelled' se annullato (unico stato realmente persistito che vince).
 *  - 'scheduled' prima dell'inizio.
 *  - 'live' nella finestra [starts_at, starts_at + durata].
 *  - 'ended' dopo la fine.
 * (Non usa Date.now a livello di modulo: la valutazione avviene alla chiamata.)
 * @param {object} event  riga della tabella events
 * @returns {'scheduled'|'live'|'ended'|'cancelled'}
 */
export function deriveStatus(event) {
  if (event.status === 'cancelled') return 'cancelled';
  const start = new Date(event.starts_at).getTime();
  const end = start + (Number(event.duration_min) || 0) * 60000;
  const now = Date.now();
  if (now < start) return 'scheduled';
  if (now <= end) return 'live';
  return 'ended';
}

/** Numero di partecipanti "attivi" (iscritti o presenti; esclude chi ha abbandonato). */
export async function participantsCount(eventId) {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM event_participants WHERE event_id = ? AND status != 'left'")
    .get(eventId);
  return r?.n || 0;
}

/**
 * Crea un evento con lo stato iniziale 'scheduled' e assegna l'XP al creatore.
 * @param {number} userId  creatore
 * @param {object} input   campi già validati dal controller
 * @returns {object} l'evento creato
 */
export async function createEvent(userId, input) {
  const info = await db
    .prepare(
      `INSERT INTO events
         (creator_id, name, description, photo, starts_at, duration_min, max_participants,
          route_id, area_lat, area_lng, area_name, radius_m, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`
    )
    .run(
      userId,
      input.name,
      input.description,
      input.photo || null,
      input.starts_at,
      input.duration_min,
      input.max_participants,
      input.route_id || null,
      input.area_lat,
      input.area_lng,
      input.area_name || '',
      input.radius_m
    );
  const eventId = info.lastInsertRowid;

  await awardXp(userId, XP.CREATE_EVENT, 'event_created', 'event', eventId);
  await checkBadges(userId);

  return db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
}

/**
 * Iscrizione (RSVP) a un evento. Idempotente: iscriversi di nuovo non duplica.
 * Rifiuta gli eventi conclusi/annullati e rispetta la capienza massima.
 * @param {object} event  riga events
 * @param {object} user   req.user (serve id + nickname)
 * @returns {{participation:object, joined:true}}
 */
export async function joinEvent(event, user) {
  const status = deriveStatus(event);
  if (status === 'ended' || status === 'cancelled') {
    throw new HttpError(409, 'Evento concluso o annullato: non è più possibile iscriversi.');
  }

  const existing = await db
    .prepare('SELECT status FROM event_participants WHERE event_id = ? AND user_id = ?')
    .get(event.id, user.id);
  const wasActive = !!existing && existing.status !== 'left';

  // Capienza: blocca solo chi si iscrive ex-novo (non chi è già dentro).
  if (event.max_participants > 0 && !wasActive) {
    const count = await participantsCount(event.id);
    if (count >= event.max_participants) throw new HttpError(409, 'Evento al completo.');
  }

  const result = await db
    .prepare("INSERT OR IGNORE INTO event_participants (event_id, user_id, status) VALUES (?, ?, 'joined')")
    .run(event.id, user.id);
  const newlyJoined = result.changes > 0;

  // Re-iscrizione dopo un abbandono: riporta lo stato a 'joined'.
  if (!newlyJoined && existing && existing.status === 'left') {
    await db
      .prepare("UPDATE event_participants SET status = 'joined' WHERE event_id = ? AND user_id = ?")
      .run(event.id, user.id);
    await recomputeUserStats(user.id);
  }

  if (newlyJoined) {
    // Avvisa il creatore (a meno che non sia lui stesso a iscriversi).
    if (event.creator_id !== user.id) {
      await notify(
        event.creator_id,
        'event_join',
        `${user.nickname} parteciperà a ${event.name}`,
        '',
        { event_id: event.id, user_id: user.id }
      );
    }
    await awardXp(user.id, XP.JOIN_EVENT, 'event_join', 'event', event.id);
    await recomputeUserStats(user.id);
  }

  const participation = await db
    .prepare('SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?')
    .get(event.id, user.id);
  return { participation, joined: true };
}

/**
 * Check-in verificato via GPS: valido solo se l'utente è entro il raggio
 * dell'area di raduno. Se non era iscritto, viene iscritto d'ufficio.
 * Al primo check-in assegna XP, avanza le missioni e ricalcola le statistiche.
 * @param {object} event  riga events
 * @param {object} user   req.user
 * @param {number} lat
 * @param {number} lng
 * @returns {{checked_in:true, distance_m:number}}
 */
export async function checkinEvent(event, user, lat, lng) {
  const distance = haversine(lat, lng, event.area_lat, event.area_lng);
  if (distance > event.radius_m) {
    throw new HttpError(
      403,
      `Sei troppo lontano dal punto di ritrovo (${Math.round(distance)} m). Avvicinati per fare il check-in.`
    );
  }

  const existing = await db
    .prepare('SELECT status FROM event_participants WHERE event_id = ? AND user_id = ?')
    .get(event.id, user.id);
  const alreadyCheckedIn = !!existing && existing.status === 'checked_in';

  // Assicura la presenza di una riga di partecipazione (auto-iscrizione).
  if (!existing) {
    await db
      .prepare("INSERT OR IGNORE INTO event_participants (event_id, user_id, status) VALUES (?, ?, 'joined')")
      .run(event.id, user.id);
  }

  if (!alreadyCheckedIn) {
    await db
      .prepare(
        `UPDATE event_participants
            SET status = 'checked_in', checked_in_at = datetime('now'),
                last_lat = ?, last_lng = ?, last_seen = datetime('now')
          WHERE event_id = ? AND user_id = ?`
      )
      .run(lat, lng, event.id, user.id);

    await awardXp(user.id, XP.EVENT_CHECKIN, 'event_checkin', 'event', event.id);
    await bumpMissions(user.id, 'events', 1);
    await recomputeUserStats(user.id);
    await checkBadges(user.id);
  } else {
    // Già presente: aggiorna solo la posizione live.
    await db
      .prepare(
        "UPDATE event_participants SET last_lat = ?, last_lng = ?, last_seen = datetime('now') WHERE event_id = ? AND user_id = ?"
      )
      .run(lat, lng, event.id, user.id);
  }

  return { checked_in: true, distance_m: Math.round(distance) };
}

/**
 * Abbandona un evento: imposta lo stato 'left' e ricalcola le statistiche
 * (l'evento non conta più tra quelli a cui l'utente partecipa).
 * @param {number} eventId
 * @param {number} userId
 * @returns {{ok:true}}
 */
export async function leaveEvent(eventId, userId) {
  await db
    .prepare("UPDATE event_participants SET status = 'left' WHERE event_id = ? AND user_id = ?")
    .run(eventId, userId);
  await recomputeUserStats(userId);
  return { ok: true };
}
