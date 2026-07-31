/**
 * routeController.js
 * ------------------------------------------------------------
 * CRUD percorsi, ricerca per mappa (bbox), like, completamenti/record,
 * classifica del percorso.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError, safeJson, publicUser } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, ROUTE_VEHICLE_TYPES, ROUTE_PRIVACY } from '../utils/constants.js';
import { persistUpload } from '../middleware/upload.js';
import { isInItaly } from '../utils/geo.js';
import { createRoute, submitCompletion } from '../services/routeService.js';
import { recomputeUserStats } from '../services/stats.js';
import { isClubAdmin, isClubMember } from '../services/clubAccess.js';

/** Proiezione "card" di un percorso per liste/mappa. */
const CARD_COLS =
  'id, creator_id, name, description, photo, category, difficulty, vehicle_type, distance_m, elevation_gain_m, est_time_s, start_lat, start_lng, end_lat, end_lng, privacy, club_id, completions_count, likes_count, created_at';

/**
 * GET /api/routes — lista/ricerca. Filtri: bbox, category, difficulty, q, mine.
 * Mostra i percorsi pubblici + (se autenticato) i propri privati.
 */
export const list = asyncHandler(async (req, res) => {
  const where = [];
  const args = [];

  // Visibilità: pubblici a tutti; privati solo al proprietario; "club" ai membri.
  if (req.user) {
    where.push(
      "(privacy = 'public' OR creator_id = ? OR (privacy = 'club' AND club_id IN (SELECT club_id FROM club_members WHERE user_id = ?)))"
    );
    args.push(req.user.id, req.user.id);
  } else {
    where.push("privacy = 'public'");
  }

  if (req.query.category) {
    where.push('category = ?');
    args.push(v.oneOf(req.query.category, ROUTE_CATEGORIES, 'Categoria'));
  }
  if (req.query.difficulty) {
    where.push('difficulty = ?');
    args.push(v.oneOf(req.query.difficulty, ROUTE_DIFFICULTIES, 'Difficoltà'));
  }
  if (req.query.q) {
    const q = v.optStr(req.query.q, 'Ricerca', { max: 80 });
    where.push('(name LIKE ? OR description LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  // Filtro mappa: percorsi il cui bbox interseca la viewport richiesta.
  if (req.query.bbox) {
    const parts = String(req.query.bbox).split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = parts;
      where.push('bbox_min_lat <= ? AND bbox_max_lat >= ? AND bbox_min_lng <= ? AND bbox_max_lng >= ?');
      args.push(maxLat, minLat, maxLng, minLng);
    }
  }

  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 200, def: 60 });
  const rows = await db
    .prepare(`SELECT ${CARD_COLS} FROM routes WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, limit);
  res.json({ routes: rows });
});

/** GET /api/routes/:id — dettaglio completo. */
export const getOne = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const route = await db.prepare('SELECT * FROM routes WHERE id = ?').get(id);
  if (!route) throw new HttpError(404, 'Percorso non trovato.');
  if (route.privacy === 'private' && route.creator_id !== req.user?.id) {
    throw new HttpError(403, 'Percorso privato.');
  }
  if (route.privacy === 'club' && route.creator_id !== req.user?.id) {
    const ok = req.user ? await isClubMember(route.club_id, req.user.id) : false;
    if (!ok) throw new HttpError(403, 'Percorso riservato ai membri del club.');
  }

  const creator = await db.prepare('SELECT id, nickname, avatar, level FROM users WHERE id = ?').get(route.creator_id);
  const tags = (await db.prepare('SELECT tag FROM route_tags WHERE route_id = ?').all(id)).map((r) => r.tag);

  // Record ufficiale (del creatore).
  let record = null;
  if (route.record_completion_id) {
    record = await db
      .prepare(
        `SELECT rc.time_ms, rc.avg_speed_kmh, rc.max_speed_kmh, rc.created_at, u.nickname, u.avatar
           FROM route_completions rc JOIN users u ON u.id = rc.user_id WHERE rc.id = ?`
      )
      .get(route.record_completion_id);
  }

  // Miglior tempo personale del visitatore.
  let myBest = null;
  let liked = false;
  if (req.user) {
    myBest = await db
      .prepare('SELECT * FROM route_completions WHERE route_id = ? AND user_id = ? AND is_personal_best = 1')
      .get(id, req.user.id);
    liked = !!(await db.prepare('SELECT 1 FROM route_likes WHERE route_id = ? AND user_id = ?').get(id, req.user.id));
  }

  res.json({ route, creator, tags, record, my_best: myBest, liked });
});

/** GET /api/routes/:id/leaderboard — classifica dei tempi (miglior tempo per utente). */
export const routeLeaderboard = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const rows = await db
    .prepare(
      `SELECT rc.time_ms, rc.avg_speed_kmh, rc.created_at, u.id AS user_id, u.nickname, u.avatar, u.level,
              (rc.user_id = r.creator_id) AS is_creator
         FROM route_completions rc
         JOIN users u ON u.id = rc.user_id
         JOIN routes r ON r.id = rc.route_id
        WHERE rc.route_id = ? AND rc.is_personal_best = 1
        ORDER BY rc.time_ms ASC LIMIT 100`
    )
    .all(id);
  res.json({ leaderboard: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
});

/** POST /api/routes — crea percorso. */
export const create = asyncHandler(async (req, res) => {
  const input = {
    name: v.str(req.body.name, 'Nome', { max: 80 }),
    description: v.optStr(req.body.description, 'Descrizione', { max: 2000 }),
    photo: req.body.photo ? v.optStr(req.body.photo, 'Foto', { max: 500 }) : null,
    category: v.oneOf(req.body.category, ROUTE_CATEGORIES, 'Categoria', { def: 'misto' }),
    difficulty: v.oneOf(req.body.difficulty, ROUTE_DIFFICULTIES, 'Difficoltà', { def: 'media' }),
    vehicle_type: v.oneOf(req.body.vehicle_type, ROUTE_VEHICLE_TYPES, 'Tipo veicolo', { def: 'both' }),
    privacy: v.oneOf(req.body.privacy, ROUTE_PRIVACY, 'Privacy', { def: 'public' }),
    start_name: v.optStr(req.body.start_name, 'Partenza', { max: 120 }),
    end_name: v.optStr(req.body.end_name, 'Arrivo', { max: 120 }),
    tags: Array.isArray(req.body.tags) ? req.body.tags : [],
    track: v.track(req.body.track, 'Tracciato'),
    // Veicolo usato durante la registrazione (facoltativo): attribuisce il
    // primo giro del creatore al mezzo giusto.
    vehicle_id: req.body.vehicle_id ? v.int(req.body.vehicle_id, 'Veicolo', { min: 1 }) : null,
  };
  // Il veicolo dichiarato deve essere dell'utente.
  if (input.vehicle_id) {
    const owned = await db
      .prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?')
      .get(input.vehicle_id, req.user.id);
    if (!owned) throw new HttpError(404, 'Veicolo non trovato.');
  }
  // Solo territorio italiano: partenza e arrivo devono essere in Italia.
  const t0 = input.track[0], t1 = input.track[input.track.length - 1];
  if (!isInItaly(t0.lat, t0.lng) || !isInItaly(t1.lat, t1.lng)) {
    throw new HttpError(400, 'La WebApp è disponibile solo per il territorio italiano: il percorso deve trovarsi in Italia.');
  }
  // Visibilità "solo club": consentita solo agli admin (creatore/moderatore) del club.
  if (input.privacy === 'club') {
    input.club_id = v.int(req.body.club_id, 'Club', { min: 1 });
    if (!(await isClubAdmin(input.club_id, req.user.id))) {
      throw new HttpError(403, 'Solo gli admin del club possono creare contenuti riservati al club.');
    }
  } else {
    input.club_id = null;
  }
  const route = await createRoute(req.user.id, input);
  res.status(201).json({ route });
});

/** PUT /api/routes/:id — aggiorna metadati (non la geometria). */
export const update = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const route = await db.prepare('SELECT * FROM routes WHERE id = ?').get(id);
  if (!route) throw new HttpError(404, 'Percorso non trovato.');
  if (route.creator_id !== req.user.id) throw new HttpError(403, 'Solo il creatore può modificare il percorso.');

  const fields = [];
  const args = [];
  const set = (col, val) => { fields.push(`${col} = ?`); args.push(val); };
  if (req.body.name !== undefined) set('name', v.str(req.body.name, 'Nome', { max: 80 }));
  if (req.body.description !== undefined) set('description', v.optStr(req.body.description, 'Descrizione', { max: 2000 }));
  if (req.body.photo !== undefined) set('photo', v.optStr(req.body.photo, 'Foto', { max: 500 }));
  if (req.body.category !== undefined) set('category', v.oneOf(req.body.category, ROUTE_CATEGORIES, 'Categoria'));
  if (req.body.difficulty !== undefined) set('difficulty', v.oneOf(req.body.difficulty, ROUTE_DIFFICULTIES, 'Difficoltà'));
  if (req.body.vehicle_type !== undefined) set('vehicle_type', v.oneOf(req.body.vehicle_type, ROUTE_VEHICLE_TYPES, 'Tipo veicolo'));
  if (req.body.privacy !== undefined) {
    const privacy = v.oneOf(req.body.privacy, ROUTE_PRIVACY, 'Privacy');
    set('privacy', privacy);
    if (privacy === 'club') {
      const clubId = v.int(req.body.club_id ?? route.club_id, 'Club', { min: 1 });
      if (!(await isClubAdmin(clubId, req.user.id))) {
        throw new HttpError(403, 'Solo gli admin del club possono riservare il percorso al club.');
      }
      set('club_id', clubId);
    } else {
      set('club_id', null);
    }
  }
  if (!fields.length) throw new HttpError(400, 'Nessun campo da aggiornare.');

  args.push(id);
  await db.prepare(`UPDATE routes SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args);
  res.json({ route: await db.prepare('SELECT * FROM routes WHERE id = ?').get(id) });
});

/** DELETE /api/routes/:id */
export const remove = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const route = await db.prepare('SELECT creator_id FROM routes WHERE id = ?').get(id);
  if (!route) throw new HttpError(404, 'Percorso non trovato.');
  if (route.creator_id !== req.user.id && req.user.role !== 'admin') {
    throw new HttpError(403, 'Non autorizzato.');
  }
  await db.prepare('DELETE FROM routes WHERE id = ?').run(id);
  // I completamenti del percorso cadono in cascata: le statistiche del
  // creatore (km, tempo, percorsi, record) vanno ricalcolate.
  await recomputeUserStats(route.creator_id);
  res.status(204).end();
});

/** POST /api/routes/:id/complete — invia un completamento cronometrato. */
export const complete = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const data = {
    time_ms: v.int(req.body.time_ms, 'Tempo', { min: 1, max: 100 * 3600 * 1000 }),
    weather: v.optStr(req.body.weather, 'Meteo', { max: 40 }),
    vehicle_id: req.body.vehicle_id ? v.int(req.body.vehicle_id, 'Veicolo', { min: 1 }) : null,
    track: Array.isArray(req.body.track) ? v.track(req.body.track, 'Tracciato', { minPoints: 2 }) : null,
  };
  const result = await submitCompletion(id, req.user.id, data);
  res.status(201).json(result);
});

/** POST /api/routes/:id/like  ·  DELETE /api/routes/:id/like */
export const like = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const exists = await db.prepare('SELECT 1 FROM route_likes WHERE route_id = ? AND user_id = ?').get(id, req.user.id);
  if (!exists) {
    await db.prepare('INSERT INTO route_likes (route_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    await db.prepare('UPDATE routes SET likes_count = likes_count + 1 WHERE id = ?').run(id);
  }
  res.json({ liked: true });
});

export const unlike = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const del = await db.prepare('DELETE FROM route_likes WHERE route_id = ? AND user_id = ?').run(id, req.user.id);
  if (del.changes) await db.prepare('UPDATE routes SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(id);
  res.json({ liked: false });
});

/** POST /api/routes/photo — upload foto percorso (ritorna URL da salvare poi). */
export const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Nessun file ricevuto.');
  const url = await persistUpload(req.file, 'routes');
  res.json({ url });
});
