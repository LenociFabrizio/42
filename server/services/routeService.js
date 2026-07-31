/**
 * services/routeService.js
 * ------------------------------------------------------------
 * Logica di dominio dei PERCORSI e del sistema RECORD.
 *
 * REGOLA FONDAMENTALE:
 *   Il record UFFICIALE di un percorso appartiene SEMPRE al suo CREATORE
 *   (routes.record_completion_id → migliore completion del creatore).
 *   Gli altri utenti possono completare il percorso e conservano il proprio
 *   MIGLIOR TEMPO PERSONALE (route_completions.is_personal_best), ma NON
 *   possono sostituire il record principale. Se battono il tempo ufficiale,
 *   il creatore riceve una notifica (sfida!), ma il record resta suo.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { HttpError } from '../utils/helpers.js';
import { XP, MIN_ROUTE_DISTANCE_M, ATTEMPT_GATE_RADIUS_M, ATTEMPT_MIN_COVERAGE } from '../utils/constants.js';
import { trackMetrics, simplify, encodePolyline, bbox, haversine } from '../utils/geo.js';
import { awardXp, bumpMissions, checkBadges } from './gamification.js';
import { recomputeUserStats } from './stats.js';
import { regionCodeAt } from './areaAccess.js';
import { notify } from './notifications.js';

/**
 * Crea un percorso da una traccia GPS (o da estremi + geometria).
 * @returns {object} il percorso creato
 */
export async function createRoute(userId, input) {
  const points = input.track; // già validati dal controller (v.track)
  const simplified = simplify(points);
  const metrics = trackMetrics(points);
  // Lunghezza minima: il client la blocca già, ma la regola vale anche via API.
  if (metrics.distance_m < MIN_ROUTE_DISTANCE_M) {
    throw new HttpError(400, `Il percorso deve essere lungo almeno ${MIN_ROUTE_DISTANCE_M / 1000} km.`);
  }
  const box = bbox(simplified) || {};
  const polyline = encodePolyline(simplified);

  const start = simplified[0];
  const end = simplified[simplified.length - 1];
  // Tempo stimato: dai timestamp della traccia se presenti, altrimenti da una
  // velocità di crociera prudente (45 km/h) sulla distanza.
  const estTime = metrics.moving_time_s > 0 ? metrics.moving_time_s : Math.round((metrics.distance_m / 1000 / 45) * 3600);

  const info = await db
    .prepare(
      `INSERT INTO routes
         (creator_id, name, description, photo, category, difficulty, vehicle_type,
          start_lat, start_lng, start_name, end_lat, end_lng, end_name,
          track_polyline, distance_m, elevation_gain_m, est_time_s,
          bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, privacy, club_id, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId, input.name, input.description, input.photo || null, input.category, input.difficulty, input.vehicle_type,
      start.lat, start.lng, input.start_name || '', end.lat, end.lng, input.end_name || '',
      polyline, metrics.distance_m, metrics.elevation_gain_m, estTime,
      box.minLat, box.minLng, box.maxLat, box.maxLng, input.privacy, input.club_id || null,
      // Area della partenza: la decide il server dalle coordinate, così il
      // percorso comparirà solo a chi ha conquistato quella regione.
      regionCodeAt(start.lat, start.lng)
    );
  const routeId = info.lastInsertRowid;

  if (Array.isArray(input.tags)) {
    for (const tag of input.tags.slice(0, 12)) {
      const t = String(tag).trim().toLowerCase().slice(0, 24);
      if (t) await db.prepare('INSERT OR IGNORE INTO route_tags (route_id, tag) VALUES (?, ?)').run(routeId, t);
    }
  }

  // Se il percorso nasce da una REGISTRAZIONE GPS (la traccia ha i timestamp,
  // quindi moving_time_s > 0), il creatore lo ha appena GUIDATO: registriamo
  // quel giro come suo primo completamento. Senza questo passaggio i km
  // percorsi e il tempo di guida non entrerebbero mai nelle statistiche e il
  // percorso resterebbe senza record ufficiale.
  // I percorsi DISEGNATI sulla mappa non hanno timestamp: nessun completamento.
  if (metrics.moving_time_s > 0) {
    const timeMs = metrics.moving_time_s * 1000;
    const avgSpeed = metrics.avg_speed_kmh || 0;
    const maxSpeed = metrics.max_speed_kmh || avgSpeed;
    const compInfo = await db
      .prepare(
        `INSERT INTO route_completions
           (route_id, user_id, time_ms, distance_m, avg_speed_kmh, max_speed_kmh,
            weather, vehicle_id, track_polyline, is_personal_best)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 1)`
      )
      .run(routeId, userId, timeMs, metrics.distance_m, avgSpeed, maxSpeed, input.vehicle_id || null, polyline);
    // Primo giro del creatore = record ufficiale del percorso (regola di dominio).
    await db
      .prepare('UPDATE routes SET record_completion_id = ?, completions_count = completions_count + 1 WHERE id = ?')
      .run(compInfo.lastInsertRowid, routeId);
    await bumpMissions(userId, 'completions', 1);
    await bumpMissions(userId, 'distance_m', metrics.distance_m || 0);
  }

  // Ricompense
  await awardXp(userId, XP.CREATE_ROUTE, 'route_created', 'route', routeId);
  await bumpMissions(userId, 'routes_created', 1);
  await recomputeUserStats(userId);
  await checkBadges(userId);

  return db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
}

/**
 * Il tentativo passa dal cancelletto? Guarda i primi (o gli ultimi) campioni e
 * non solo l'estremo: il primo fix di una registrazione può essere ancora
 * impreciso, e l'ultimo può cadere qualche metro oltre il traguardo.
 */
function gatePassed(points, lat, lng) {
  return points.some((p) => haversine(p.lat, p.lng, lat, lng) <= ATTEMPT_GATE_RADIUS_M);
}

/**
 * Registra un completamento cronometrato e applica la logica record/PB.
 *
 * Un tempo vale solo se è un GIRO VERO: il tracciato deve partire dalla
 * partenza del percorso, coprirlo quasi tutto e chiudersi sull'arrivo. Il
 * client lo impone già (non lascia avviare lontano dallo start e ferma il
 * cronometro da sé sul traguardo), ma la regola la fa rispettare qui: senza
 * questa verifica basterebbe una chiamata all'API per inventarsi un record.
 *
 * @param {number} routeId
 * @param {number} userId
 * @param {object} data  { time_ms, track, weather?, vehicle_id? }
 * @returns {object} riepilogo { completion, is_personal_best, new_official_record, beat_official, xp }
 */
export async function submitCompletion(routeId, userId, data) {
  const route = await db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
  if (!route) throw new HttpError(404, 'Percorso non trovato.');

  const track = Array.isArray(data.track) ? data.track : [];
  if (track.length < 2) {
    throw new HttpError(400, 'Serve il tracciato GPS del giro: il tempo si registra guidando il percorso.');
  }
  if (!gatePassed(track.slice(0, 5), route.start_lat, route.start_lng)) {
    throw new HttpError(400, `Il giro non parte dalla partenza del percorso (serve essere entro ${ATTEMPT_GATE_RADIUS_M} m dallo start).`);
  }
  if (!gatePassed(track.slice(-5), route.end_lat, route.end_lng)) {
    throw new HttpError(400, 'Il giro non si chiude sull\'arrivo del percorso: il tempo vale solo fino al traguardo.');
  }

  const m = trackMetrics(track);
  const minCoverage = Math.round((route.distance_m || 0) * ATTEMPT_MIN_COVERAGE);
  if (m.distance_m < minCoverage) {
    throw new HttpError(400, 'Il percorso non è stato completato: il tracciato è troppo corto rispetto al tracciato originale.');
  }

  // Il cronometro lo detta il TRACCIATO, non il client: se i campioni hanno i
  // timestamp il tempo è la loro durata (primo → ultimo). `time_ms` resta solo
  // come ripiego per le tracce senza orari.
  const spanMs = Number(track[track.length - 1].t) - Number(track[0].t);
  let timeMs = Number.isFinite(spanMs) && spanMs > 0
    ? Math.round(spanMs)
    : Math.round(Number(data.time_ms) || 0);
  if (timeMs <= 0) throw new HttpError(400, 'Tempo del completamento non valido.');

  const distance = m.distance_m || route.distance_m;
  const polyline = encodePolyline(simplify(track));
  const avgSpeed = distance > 0 ? Math.round((distance / (timeMs / 1000)) * 3.6 * 10) / 10 : 0;
  const maxSpeed = m.max_speed_kmh || avgSpeed;

  // Miglior tempo personale attuale dell'utente su questo percorso.
  const prevPb = await db
    .prepare('SELECT * FROM route_completions WHERE route_id = ? AND user_id = ? AND is_personal_best = 1')
    .get(routeId, userId);
  const isPb = !prevPb || timeMs < prevPb.time_ms;

  const info = await db
    .prepare(
      `INSERT INTO route_completions
         (route_id, user_id, time_ms, distance_m, avg_speed_kmh, max_speed_kmh, weather, vehicle_id, track_polyline, is_personal_best)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(routeId, userId, timeMs, distance, avgSpeed, maxSpeed, data.weather || '', data.vehicle_id || null, polyline, isPb ? 1 : 0);
  const completionId = info.lastInsertRowid;

  if (isPb && prevPb) {
    await db.prepare('UPDATE route_completions SET is_personal_best = 0 WHERE id = ?').run(prevPb.id);
  }

  await db.prepare('UPDATE routes SET completions_count = completions_count + 1 WHERE id = ?').run(routeId);

  // --- Logica RECORD UFFICIALE (solo per il creatore) ---
  let newOfficialRecord = false;
  let beatOfficial = false;

  const officialTime = route.record_completion_id
    ? (await db.prepare('SELECT time_ms FROM route_completions WHERE id = ?').get(route.record_completion_id))?.time_ms
    : null;

  if (userId === route.creator_id) {
    // Il creatore può (ri)fissare il record ufficiale con il proprio miglior tempo.
    if (isPb && (officialTime == null || timeMs < officialTime)) {
      await db.prepare('UPDATE routes SET record_completion_id = ? WHERE id = ?').run(completionId, routeId);
      newOfficialRecord = true;
    }
  } else if (officialTime != null && timeMs < officialTime) {
    // Un altro utente ha battuto il tempo ufficiale: il record resta del creatore
    // (regola), ma lo sfidiamo con una notifica.
    beatOfficial = true;
    await notify(
      route.creator_id,
      'record_beaten',
      `Il tuo record è sotto attacco! 🏁`,
      `Qualcuno ha superato il tuo tempo su "${route.name}". Difendi il tuo primato!`,
      { route_id: routeId, by_user_id: userId }
    );
  }

  // --- Ricompense XP ---
  let xp = XP.COMPLETE_ROUTE;
  xp += Math.floor((distance || 0) / XP.METERS_PER_XP); // bonus distanza
  if (isPb) xp += XP.PERSONAL_BEST;
  if (newOfficialRecord) xp += XP.NEW_OFFICIAL_RECORD;
  await awardXp(userId, xp, newOfficialRecord ? 'new_official_record' : 'route_completed', 'route', routeId);

  await bumpMissions(userId, 'completions', 1);
  await bumpMissions(userId, 'distance_m', distance || 0);
  await recomputeUserStats(userId);
  await checkBadges(userId);

  const completion = await db.prepare('SELECT * FROM route_completions WHERE id = ?').get(completionId);
  return {
    completion,
    is_personal_best: isPb,
    new_official_record: newOfficialRecord,
    beat_official: beatOfficial,
    xp,
  };
}
