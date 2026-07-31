/**
 * repair-stats.js
 * ------------------------------------------------------------
 * Ricalcola le statistiche cache di TUTTI gli utenti e i club a partire
 * dalle tabelle sorgente (route_completions, routes, event_participants,
 * club_members). Le statistiche su users e clubs sono solo
 * cache (colonne total_… e …_count): questo script le riallinea se hanno
 * accumulato drift.
 *
 * Uso:  npm run stats:repair
 * ------------------------------------------------------------
 */
import db, { initSchema } from './db.js';
import { recomputeUserStats, recomputeClubStats } from '../services/stats.js';

async function main() {
  await initSchema();

  const users = await db.prepare('SELECT id, nickname FROM users ORDER BY id').all();
  console.log(`Ricalcolo statistiche di ${users.length} utenti…`);
  for (const u of users) {
    await recomputeUserStats(u.id);
    const s = await db
      .prepare('SELECT total_distance_m, total_time_s, routes_count, records_count, events_count FROM users WHERE id = ?')
      .get(u.id);
    console.log(
      `  #${u.id} ${u.nickname}: ${(s.total_distance_m / 1000).toFixed(1)} km · ` +
      `${Math.round(s.total_time_s / 60)} min · ${s.routes_count} percorsi · ` +
      `${s.records_count} record · ${s.events_count} eventi`
    );
  }

  const clubs = await db.prepare('SELECT id, name FROM clubs ORDER BY id').all();
  console.log(`Ricalcolo statistiche di ${clubs.length} club…`);
  for (const c of clubs) await recomputeClubStats(c.id);

  console.log('Fatto.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('Errore:', err);
    process.exit(1);
  }
);
