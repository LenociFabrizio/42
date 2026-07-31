/**
 * adminController.js
 * ------------------------------------------------------------
 * Pannello di controllo per chi sviluppa l'app: quanti utenti ci sono, chi si
 * muove, cosa viene creato, cosa segnalano.
 *
 * È tutto in SOLA LETTURA. Un pannello che può anche cancellare o modificare va
 * progettato con conferme, tracciabilità e la possibilità di tornare indietro:
 * qui serve capire l'andamento, e per quello i numeri bastano.
 *
 * L'accesso è vincolato a `requireAdmin` sulle rotte. Chi diventa admin lo
 * decide la variabile d'ambiente ADMIN_EMAILS (vedi database/db.js): nessun
 * indirizzo personale finisce nel codice.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { LIVE_STALE_SECONDS } from '../utils/constants.js';

/** Numero secco da una query di conteggio. */
async function count(sql, ...args) {
  const row = await db.prepare(sql).get(...args);
  return row?.n || 0;
}

/**
 * GET /api/admin/overview — la fotografia dell'app in un colpo d'occhio.
 * Attivi = chi ha usato l'app di recente (users.last_active, scritto a ogni
 * richiesta autenticata con l'app in primo piano), non chi si è solo registrato.
 */
export const overview = asyncHandler(async (_req, res) => {
  const [
    users, users7, users30, active24, active7, sharingNow, withArea,
    routes, routes7, completions, events, eventsUpcoming, clubs, pois,
    friendships, vehicles, bugs, bugs7,
  ] = await Promise.all([
    count('SELECT COUNT(*) AS n FROM users'),
    count("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 days')"),
    count("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-30 days')"),
    count("SELECT COUNT(*) AS n FROM users WHERE last_active >= datetime('now', '-1 day')"),
    count("SELECT COUNT(*) AS n FROM users WHERE last_active >= datetime('now', '-7 days')"),
    count(`SELECT COUNT(*) AS n FROM users WHERE live_enabled = 1 AND last_seen >= datetime('now', ?)`, `-${LIVE_STALE_SECONDS} seconds`),
    count('SELECT COUNT(*) AS n FROM users WHERE region IS NOT NULL'),
    count('SELECT COUNT(*) AS n FROM routes'),
    count("SELECT COUNT(*) AS n FROM routes WHERE created_at >= datetime('now', '-7 days')"),
    count('SELECT COUNT(*) AS n FROM route_completions'),
    count('SELECT COUNT(*) AS n FROM events'),
    count("SELECT COUNT(*) AS n FROM events WHERE starts_at >= datetime('now') AND status != 'cancelled'"),
    count('SELECT COUNT(*) AS n FROM clubs'),
    count('SELECT COUNT(*) AS n FROM pois'),
    count("SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted'"),
    count('SELECT COUNT(*) AS n FROM vehicles'),
    count('SELECT COUNT(*) AS n FROM bug_reports'),
    count("SELECT COUNT(*) AS n FROM bug_reports WHERE created_at >= datetime('now', '-7 days')"),
  ]);

  // Km: quelli registrati nei percorsi creati e quelli davvero percorsi.
  const dist = await db
    .prepare('SELECT COALESCE(SUM(distance_m), 0) AS created FROM routes')
    .get();
  const driven = await db
    .prepare('SELECT COALESCE(SUM(r.distance_m), 0) AS driven FROM route_completions rc JOIN routes r ON r.id = rc.route_id')
    .get();

  // Iscrizioni degli ultimi 14 giorni: serve a vedere la tendenza, non il totale.
  const signups = await db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n
         FROM users
        WHERE created_at >= datetime('now', '-14 days')
        GROUP BY day ORDER BY day`
    )
    .all();

  // Da dove arrivano: aree di partenza più scelte.
  const areas = await db
    .prepare(
      `SELECT region, COUNT(*) AS n FROM users
        WHERE region IS NOT NULL GROUP BY region ORDER BY n DESC, region LIMIT 20`
    )
    .all();

  // Aree conquistate: dice se la funzione viene davvero usata.
  const explored = await db
    .prepare('SELECT COALESCE(AVG(c), 0) AS avg_areas, COALESCE(MAX(c), 0) AS max_areas FROM (SELECT COUNT(*) AS c FROM user_regions GROUP BY user_id)')
    .get();

  res.json({
    users: { total: users, new_7d: users7, new_30d: users30, active_24h: active24, active_7d: active7, sharing_now: sharingNow, with_area: withArea },
    content: { routes, routes_7d: routes7, completions, events, events_upcoming: eventsUpcoming, clubs, pois, vehicles, friendships },
    distance: { created_m: dist?.created || 0, driven_m: driven?.driven || 0 },
    feedback: { total: bugs, last_7d: bugs7 },
    areas,
    explored: { avg: Math.round((explored?.avg_areas || 0) * 10) / 10, max: explored?.max_areas || 0 },
    signups,
  });
});

/**
 * GET /api/admin/users — elenco utenti, i più recenti per primi.
 * L'email c'è perché è l'unico modo di riconoscere un account quando serve
 * assistenza: è un pannello per il proprietario dell'app, non una pagina.
 */
export const users = asyncHandler(async (req, res) => {
  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 200, def: 50 });
  const q = req.query.q ? v.optStr(req.query.q, 'Ricerca', { max: 60 }) : '';
  const where = q ? 'WHERE u.nickname LIKE ? OR u.email LIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];

  const rows = await db
    .prepare(
      `SELECT u.id, u.nickname, u.email, u.role, u.level, u.xp, u.region, u.created_at,
              u.last_active, u.live_enabled, u.google_id IS NOT NULL AS via_google,
              u.total_distance_m, u.routes_count, u.records_count,
              (SELECT COUNT(*) FROM user_regions ur WHERE ur.user_id = u.id) AS areas
         FROM users u
         ${where}
        ORDER BY u.created_at DESC
        LIMIT ?`
    )
    .all(...args, limit);
  res.json({ users: rows });
});

/** GET /api/admin/content — ultimi percorsi, eventi e club creati. */
export const content = asyncHandler(async (req, res) => {
  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 100, def: 20 });
  const [routes, events, clubs] = await Promise.all([
    db.prepare(
      `SELECT r.id, r.name, r.category, r.difficulty, r.distance_m, r.region, r.privacy,
              r.completions_count, r.created_at, u.nickname AS creator
         FROM routes r JOIN users u ON u.id = r.creator_id
        ORDER BY r.created_at DESC LIMIT ?`
    ).all(limit),
    db.prepare(
      `SELECT e.id, e.name, e.starts_at, e.area_name, e.region, e.privacy, e.status, e.created_at,
              u.nickname AS creator,
              (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id AND ep.status != 'left') AS participants
         FROM events e JOIN users u ON u.id = e.creator_id
        ORDER BY e.created_at DESC LIMIT ?`
    ).all(limit),
    db.prepare(
      `SELECT c.id, c.name, c.privacy, c.level, c.members_count, c.total_distance_m, c.created_at,
              c.photo IS NOT NULL AS has_photo, u.nickname AS creator
         FROM clubs c JOIN users u ON u.id = c.creator_id
        ORDER BY c.created_at DESC LIMIT ?`
    ).all(limit),
  ]);
  res.json({ routes, events, clubs });
});

/**
 * GET /api/admin/feedback — segnalazioni di bug.
 * Utile soprattutto quando l'invio per email non è configurato: senza questa
 * pagina le segnalazioni resterebbero a database e nessuno le leggerebbe.
 */
export const feedback = asyncHandler(async (req, res) => {
  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 200, def: 50 });
  const rows = await db
    .prepare(
      `SELECT b.id, b.message, b.contact_email, b.page, b.app_version, b.user_agent,
              b.emailed, b.created_at, u.nickname, u.email
         FROM bug_reports b LEFT JOIN users u ON u.id = b.user_id
        ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(limit);
  res.json({ reports: rows });
});

export default { overview, users, content, feedback };
