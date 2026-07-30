/**
 * eventController.js
 * ------------------------------------------------------------
 * Eventi live geolocalizzati: lista/ricerca (bbox), dettaglio, CRUD,
 * iscrizione (RSVP), check-in verificato via GPS, posizione live e
 * abbandono. Lo stato è DERIVATO dall'orario (vedi eventService.deriveStatus).
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import {
  deriveStatus,
  createEvent,
  joinEvent,
  checkinEvent,
  leaveEvent,
} from '../services/eventService.js';

// Stati DERIVATI filtrabili in lista (esclude 'cancelled', che non è "vivo").
const LIST_STATUSES = ['scheduled', 'live', 'ended'];
// Tetto di righe lette dal DB prima del filtro sullo stato derivato.
const FETCH_CAP = 500;

/**
 * GET /api/events — lista/ricerca eventi.
 * Query: status (scheduled|live|ended), mine (1), bbox ("minLng,minLat,maxLng,maxLat").
 * Default (senza status): eventi imminenti + in corso, ordinati per inizio ASC.
 */
export const list = asyncHandler(async (req, res) => {
  const where = [];
  const args = [];

  // "mine": eventi creati dall'utente o a cui partecipa (richiede login).
  const mine = req.query.mine === '1' || req.query.mine === 1 || req.query.mine === 'true';
  if (mine) {
    if (!req.user) return res.json({ events: [] });
    where.push(
      "(e.creator_id = ? OR EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = e.id AND ep.user_id = ? AND ep.status != 'left'))"
    );
    args.push(req.user.id, req.user.id);
  }

  // Filtro mappa: il punto di raduno (area_lat/area_lng) dentro il riquadro.
  if (req.query.bbox) {
    const parts = String(req.query.bbox).split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = parts;
      where.push('e.area_lng >= ? AND e.area_lng <= ? AND e.area_lat >= ? AND e.area_lat <= ?');
      args.push(minLng, maxLng, minLat, maxLat);
    }
  }

  // Stato richiesto (derivato): validato contro l'insieme consentito.
  const wantStatus = req.query.status ? v.oneOf(req.query.status, LIST_STATUSES, 'Stato') : null;
  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 200, def: 60 });

  // Colonna "joined" calcolata solo se autenticato (arg posizionato PRIMA del WHERE).
  const selArgs = [];
  let joinedSel = '';
  if (req.user) {
    joinedSel =
      ", (SELECT COUNT(*) FROM event_participants ep2 WHERE ep2.event_id = e.id AND ep2.user_id = ? AND ep2.status != 'left') AS joined_n";
    selArgs.push(req.user.id);
  }

  const sql = `SELECT e.*, u.nickname AS creator_nickname, u.avatar AS creator_avatar,
      (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id AND ep.status != 'left') AS participants_count
      ${joinedSel}
    FROM events e
    JOIN users u ON u.id = e.creator_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.starts_at ASC
    LIMIT ${FETCH_CAP}`;
  const rows = await db.prepare(sql).all(...selArgs, ...args);

  const events = [];
  for (const r of rows) {
    const status = deriveStatus(r);
    // Con status esplicito: match esatto. Senza: solo imminenti + in corso.
    if (wantStatus ? status !== wantStatus : status !== 'scheduled' && status !== 'live') continue;
    events.push({
      id: r.id,
      name: r.name,
      description: r.description,
      photo: r.photo,
      starts_at: r.starts_at,
      duration_min: r.duration_min,
      max_participants: r.max_participants,
      route_id: r.route_id,
      area_lat: r.area_lat,
      area_lng: r.area_lng,
      area_name: r.area_name,
      radius_m: r.radius_m,
      status,
      creator: { id: r.creator_id, nickname: r.creator_nickname, avatar: r.creator_avatar },
      participants_count: r.participants_count || 0,
      joined: req.user ? !!r.joined_n : false,
    });
    if (events.length >= limit) break;
  }

  res.json({ events });
});

/** GET /api/events/:id — dettaglio completo con partecipanti e mia partecipazione. */
export const getOne = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) throw new HttpError(404, 'Evento non trovato.');

  const creator = await db
    .prepare('SELECT id, nickname, avatar, level FROM users WHERE id = ?')
    .get(event.creator_id);

  // Percorso associato (proiezione breve), se presente.
  let route = null;
  if (event.route_id) {
    route = (await db.prepare('SELECT id, name, distance_m FROM routes WHERE id = ?').get(event.route_id)) || null;
  }

  const participants = await db
    .prepare(
      `SELECT ep.user_id, u.nickname, u.avatar, u.level, ep.status, ep.checked_in_at,
              ep.last_lat, ep.last_lng, ep.last_seen
         FROM event_participants ep
         JOIN users u ON u.id = ep.user_id
        WHERE ep.event_id = ? AND ep.status != 'left'
        ORDER BY ep.joined_at ASC`
    )
    .all(id);

  let myParticipation = null;
  if (req.user) {
    myParticipation =
      (await db.prepare('SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?').get(id, req.user.id)) ||
      null;
  }

  res.json({
    event,
    creator,
    route,
    participants,
    my_participation: myParticipation,
    status: deriveStatus(event),
  });
});

/** POST /api/events — crea un evento (richiede login). */
export const create = asyncHandler(async (req, res) => {
  const input = {
    name: v.str(req.body.name, 'Nome', { max: 80 }),
    description: v.optStr(req.body.description, 'Descrizione', { max: 2000 }),
    photo: req.body.photo ? v.optStr(req.body.photo, 'Foto', { max: 500 }) : null,
    starts_at: v.isoDate(req.body.starts_at, 'Data di inizio'),
    duration_min: v.int(req.body.duration_min, 'Durata', { min: 1, max: 1440, def: 120 }),
    max_participants: v.int(req.body.max_participants, 'Partecipanti max', { min: 0, max: 100000, def: 0 }),
    route_id:
      req.body.route_id === undefined || req.body.route_id === null || req.body.route_id === ''
        ? null
        : v.int(req.body.route_id, 'Percorso', { min: 1 }),
    area_lat: v.latitude(req.body.area_lat, 'Latitudine area'),
    area_lng: v.longitude(req.body.area_lng, 'Longitudine area'),
    area_name: v.optStr(req.body.area_name, 'Nome area', { max: 120 }),
    radius_m: v.int(req.body.radius_m, 'Raggio', { min: 50, max: 200000, def: 1000 }),
  };

  // Il percorso associato deve esistere ed essere visibile all'utente.
  if (input.route_id) {
    const route = await db.prepare('SELECT id, privacy, creator_id FROM routes WHERE id = ?').get(input.route_id);
    if (!route) throw new HttpError(404, 'Percorso non trovato.');
    if (route.privacy === 'private' && route.creator_id !== req.user.id) {
      throw new HttpError(403, 'Percorso non accessibile.');
    }
  }

  const event = await createEvent(req.user.id, input);
  res.status(201).json({ event });
});

/** PUT /api/events/:id — aggiorna i metadati modificabili (solo il creatore). */
export const update = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) throw new HttpError(404, 'Evento non trovato.');
  if (event.creator_id !== req.user.id) throw new HttpError(403, "Solo il creatore può modificare l'evento.");

  const fields = [];
  const args = [];
  const set = (col, val) => {
    fields.push(`${col} = ?`);
    args.push(val);
  };

  if (req.body.name !== undefined) set('name', v.str(req.body.name, 'Nome', { max: 80 }));
  if (req.body.description !== undefined) set('description', v.optStr(req.body.description, 'Descrizione', { max: 2000 }));
  if (req.body.photo !== undefined) set('photo', req.body.photo ? v.optStr(req.body.photo, 'Foto', { max: 500 }) : null);
  if (req.body.starts_at !== undefined) set('starts_at', v.isoDate(req.body.starts_at, 'Data di inizio'));
  if (req.body.duration_min !== undefined) set('duration_min', v.int(req.body.duration_min, 'Durata', { min: 1, max: 1440 }));
  if (req.body.max_participants !== undefined)
    set('max_participants', v.int(req.body.max_participants, 'Partecipanti max', { min: 0, max: 100000 }));
  if (req.body.route_id !== undefined) {
    let rid = null;
    if (req.body.route_id !== null && req.body.route_id !== '') {
      rid = v.int(req.body.route_id, 'Percorso', { min: 1 });
      const route = await db.prepare('SELECT id, privacy, creator_id FROM routes WHERE id = ?').get(rid);
      if (!route) throw new HttpError(404, 'Percorso non trovato.');
      if (route.privacy === 'private' && route.creator_id !== req.user.id) {
        throw new HttpError(403, 'Percorso non accessibile.');
      }
    }
    set('route_id', rid);
  }
  if (req.body.area_name !== undefined) set('area_name', v.optStr(req.body.area_name, 'Nome area', { max: 120 }));
  if (req.body.radius_m !== undefined) set('radius_m', v.int(req.body.radius_m, 'Raggio', { min: 50, max: 200000 }));

  if (!fields.length) throw new HttpError(400, 'Nessun campo da aggiornare.');

  args.push(id);
  await db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  res.json({ event: await db.prepare('SELECT * FROM events WHERE id = ?').get(id) });
});

/** DELETE /api/events/:id — elimina (creatore o admin). */
export const remove = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const event = await db.prepare('SELECT creator_id FROM events WHERE id = ?').get(id);
  if (!event) throw new HttpError(404, 'Evento non trovato.');
  if (event.creator_id !== req.user.id && req.user.role !== 'admin') {
    throw new HttpError(403, 'Non autorizzato.');
  }
  await db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.status(204).end();
});

/** POST /api/events/:id/join — iscrizione (RSVP). */
export const join = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) throw new HttpError(404, 'Evento non trovato.');
  res.json(await joinEvent(event, req.user));
});

/** POST /api/events/:id/checkin — presenza verificata via GPS. */
export const checkin = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) throw new HttpError(404, 'Evento non trovato.');
  const lat = v.latitude(req.body.lat);
  const lng = v.longitude(req.body.lng);
  res.json(await checkinEvent(event, req.user, lat, lng));
});

/** POST /api/events/:id/position — aggiornamento posizione live (solo partecipanti). */
export const position = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const lat = v.latitude(req.body.lat);
  const lng = v.longitude(req.body.lng);
  const part = await db
    .prepare('SELECT status FROM event_participants WHERE event_id = ? AND user_id = ?')
    .get(id, req.user.id);
  if (!part || part.status === 'left') throw new HttpError(403, 'Non partecipi a questo evento.');
  await db
    .prepare(
      "UPDATE event_participants SET last_lat = ?, last_lng = ?, last_seen = datetime('now') WHERE event_id = ? AND user_id = ?"
    )
    .run(lat, lng, id, req.user.id);
  res.json({ ok: true });
});

/** POST /api/events/:id/leave — abbandona l'evento. */
export const leave = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  res.json(await leaveEvent(id, req.user.id));
});

/**
 * GET /api/events/:id/participants — posizioni live dei presenti (check-in
 * effettuato) visti negli ultimi 10 minuti.
 */
export const participants = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const rows = await db
    .prepare(
      `SELECT ep.user_id, u.nickname, u.avatar, ep.last_lat, ep.last_lng, ep.last_seen, ep.status
         FROM event_participants ep
         JOIN users u ON u.id = ep.user_id
        WHERE ep.event_id = ? AND ep.status = 'checked_in'
          AND ep.last_seen IS NOT NULL
          AND ep.last_seen >= datetime('now', '-10 minutes')
        ORDER BY ep.last_seen DESC`
    )
    .all(id);
  res.json({ participants: rows });
});
