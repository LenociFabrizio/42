/**
 * poiController.js
 * ------------------------------------------------------------
 * Punti di interesse (POI) mostrati sulla mappa: elenco per viewport
 * (bbox), creazione (con ricompensa XP) ed eliminazione.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { XP } from '../utils/constants.js';
import { isInItaly } from '../utils/geo.js';
import { awardXp, checkBadges } from '../services/gamification.js';

// Categorie ammesse per i POI (vedi schema.sql: pois.category).
const POI_CATEGORIES = ['benzina', 'officina', 'bar', 'panorama', 'curva', 'ritrovo'];

// Proiezione esposta al client.
const POI_COLS = 'id, name, description, category, lat, lng, creator_id, created_at';

/**
 * GET /api/pois — elenco POI. Con bbox = "minLng,minLat,maxLng,maxLat"
 * filtra per viewport; altrimenti restituisce i 200 più recenti.
 */
export const list = asyncHandler(async (req, res) => {
  if (req.query.bbox) {
    const parts = String(req.query.bbox).split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = parts;
      const rows = await db
        .prepare(
          `SELECT ${POI_COLS} FROM pois
            WHERE lat >= ? AND lat <= ? AND lng >= ? AND lng <= ?
            ORDER BY created_at DESC LIMIT 500`
        )
        .all(minLat, maxLat, minLng, maxLng);
      return res.json({ pois: rows });
    }
  }

  const rows = await db
    .prepare(`SELECT ${POI_COLS} FROM pois ORDER BY created_at DESC LIMIT 200`)
    .all();
  res.json({ pois: rows });
});

/** POST /api/pois — crea un POI (assegna XP e valuta i badge). */
export const create = asyncHandler(async (req, res) => {
  const name = v.str(req.body.name, 'Nome', { max: 80 });
  const description = v.optStr(req.body.description, 'Descrizione', { max: 500 });
  const category = v.oneOf(req.body.category, POI_CATEGORIES, 'Categoria', { def: 'panorama' });
  const lat = v.latitude(req.body.lat);
  const lng = v.longitude(req.body.lng);
  if (!isInItaly(lat, lng)) {
    throw new HttpError(400, 'La WebApp è disponibile solo per il territorio italiano: il punto deve trovarsi in Italia.');
  }

  const info = await db
    .prepare('INSERT INTO pois (creator_id, name, description, category, lat, lng) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, name, description, category, lat, lng);
  const poi = await db.prepare(`SELECT ${POI_COLS} FROM pois WHERE id = ?`).get(info.lastInsertRowid);

  await awardXp(req.user.id, XP.ADD_POI, 'poi_added', 'poi', poi.id);
  await checkBadges(req.user.id);

  res.status(201).json({ poi });
});

/** DELETE /api/pois/:id — solo il creatore o un admin. */
export const remove = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const poi = await db.prepare('SELECT creator_id FROM pois WHERE id = ?').get(id);
  if (!poi) throw new HttpError(404, 'Punto di interesse non trovato.');
  if (poi.creator_id !== req.user.id && req.user.role !== 'admin') {
    throw new HttpError(403, 'Non autorizzato.');
  }
  await db.prepare('DELETE FROM pois WHERE id = ?').run(id);
  res.status(204).end();
});
