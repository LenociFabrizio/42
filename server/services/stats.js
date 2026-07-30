/**
 * services/stats.js
 * ------------------------------------------------------------
 * Ricalcolo delle statistiche cache (utenti e club) a partire dalle
 * tabelle sorgente. Le colonne *_count / total_* su users e clubs sono
 * cache di performance: questi helper le mantengono coerenti e sono
 * sempre ricostruibili in caso di drift.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';

/**
 * Ricalcola le statistiche di un utente dai completamenti, percorsi ed eventi.
 * total_distance_m / total_time_s considerano SOLO il miglior tempo personale
 * per percorso (evita doppi conteggi su ritentativi dello stesso tracciato).
 */
export async function recomputeUserStats(userId) {
  const agg = await db
    .prepare(
      `SELECT
         COALESCE(SUM(distance_m), 0) AS dist,
         COALESCE(SUM(time_ms), 0)    AS time_ms
       FROM route_completions
       WHERE user_id = ? AND is_personal_best = 1`
    )
    .get(userId);

  const routes = await db.prepare('SELECT COUNT(*) AS n FROM routes WHERE creator_id = ?').get(userId);
  // Record ufficiali detenuti: percorsi creati dall'utente con un record impostato.
  const records = await db
    .prepare('SELECT COUNT(*) AS n FROM routes WHERE creator_id = ? AND record_completion_id IS NOT NULL')
    .get(userId);
  const events = await db
    .prepare("SELECT COUNT(*) AS n FROM event_participants WHERE user_id = ? AND status != 'left'")
    .get(userId);

  await db
    .prepare(
      `UPDATE users SET
         total_distance_m = ?,
         total_time_s = ?,
         routes_count = ?,
         records_count = ?,
         events_count = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      Math.round(agg?.dist || 0),
      Math.round((agg?.time_ms || 0) / 1000),
      routes?.n || 0,
      records?.n || 0,
      events?.n || 0,
      userId
    );
}

/**
 * Ricalcola le statistiche di un club: numero membri e distanza totale
 * (somma delle distanze totali dei membri).
 */
export async function recomputeClubStats(clubId) {
  const members = await db.prepare('SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?').get(clubId);
  const dist = await db
    .prepare(
      `SELECT COALESCE(SUM(u.total_distance_m), 0) AS d
         FROM club_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.club_id = ?`
    )
    .get(clubId);

  await db
    .prepare('UPDATE clubs SET members_count = ?, total_distance_m = ? WHERE id = ?')
    .run(members?.n || 0, Math.round(dist?.d || 0), clubId);
}
