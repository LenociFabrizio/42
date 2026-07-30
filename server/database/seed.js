/**
 * seed.js
 * ------------------------------------------------------------
 * Popolamento iniziale del database:
 *   - BADGE (i codici devono combaciare con BADGE_RULES in
 *     services/gamification.js)
 *   - MISSIONI (le metriche devono essere tra quelle incrementate:
 *     'completions' | 'distance_m' | 'routes_created' | 'events')
 *   - DATI DEMO (un utente, un percorso panoramico, alcuni POI) così
 *     la mappa non è vuota al primo avvio.
 *
 * Uso:
 *   npm run seed          → idempotente (non duplica)
 *   npm run db:reset      → azzera i dati e ricrea da capo
 * ------------------------------------------------------------
 */
import bcrypt from 'bcryptjs';
import db, { initSchema } from './db.js';
import { encodePolyline, trackMetrics, bbox, simplify } from '../utils/geo.js';

/* ------------------------------ BADGE ------------------------------ */
const BADGES = [
  // Percorsi
  ['first_route', 'Primo Tracciato', 'Hai creato il tuo primo percorso.', '🗺️', 'bronze', 20, 'routes'],
  ['route_maker_5', 'Cartografo', 'Hai creato 5 percorsi.', '🧭', 'silver', 50, 'routes'],
  ['route_maker_25', 'Maestro dei Percorsi', 'Hai creato 25 percorsi.', '🏗️', 'gold', 150, 'routes'],
  // Record / completamenti
  ['first_ride', 'Si Parte!', 'Hai completato il tuo primo percorso.', '🏁', 'bronze', 20, 'records'],
  ['record_holder', 'Detentore', 'Detieni il record ufficiale di un tuo percorso.', '⏱️', 'silver', 60, 'records'],
  ['speed_demon', 'Fulmine', 'Hai superato i 150 km/h in un completamento.', '⚡', 'gold', 80, 'records'],
  // Distanza
  ['km_100', 'Centurione', 'Hai percorso 100 km in totale.', '💯', 'bronze', 30, 'records'],
  ['km_1000', 'Macinastrada', 'Hai percorso 1.000 km in totale.', '🛣️', 'silver', 120, 'records'],
  ['km_5000', 'Gran Viaggiatore', 'Hai percorso 5.000 km in totale.', '🌍', 'gold', 400, 'records'],
  // Eventi
  ['first_event', 'Presente!', 'Hai partecipato al tuo primo evento.', '📍', 'bronze', 25, 'events'],
  ['event_regular', 'Habitué', 'Hai partecipato a 10 eventi.', '🎉', 'silver', 100, 'events'],
  ['event_host', 'Organizzatore', 'Hai creato un evento.', '📣', 'silver', 60, 'events'],
  // Social
  ['first_friend', 'Compagno di Viaggio', 'Hai stretto la tua prima amicizia.', '🤝', 'bronze', 15, 'social'],
  ['social_butterfly', 'Anima del Gruppo', 'Hai 10 amici.', '🦋', 'silver', 80, 'social'],
  ['club_founder', 'Fondatore', 'Hai fondato un club.', '🏛️', 'gold', 90, 'social'],
  ['club_member', 'Membro', 'Ti sei unito a un club.', '👥', 'bronze', 20, 'social'],
  // Livello
  ['level_5', 'Esploratore', 'Hai raggiunto il livello 5.', '🌟', 'silver', 0, 'general'],
  ['level_10', 'Viaggiatore', 'Hai raggiunto il livello 10.', '✨', 'gold', 0, 'general'],
  ['level_25', 'Veterano', 'Hai raggiunto il livello 25.', '👑', 'special', 0, 'general'],
  // Costanza
  ['streak_7', 'In Sella', 'Serie di 7 giorni consecutivi.', '🔥', 'silver', 50, 'general'],
  ['streak_30', 'Inarrestabile', 'Serie di 30 giorni consecutivi.', '🚀', 'special', 200, 'general'],
];

/* ------------------------------ MISSIONI ------------------------------ */
// [code, name, description, period, metric, target, xp_reward]
const MISSIONS = [
  // Giornaliere
  ['daily_ride', 'Giro del Giorno', 'Completa 1 percorso oggi.', 'daily', 'completions', 1, 30],
  ['daily_distance', 'Scaldare le Gomme', 'Percorri 20 km oggi.', 'daily', 'distance_m', 20000, 40],
  // Settimanali
  ['weekly_creator', 'Esploratore Settimanale', 'Crea 2 percorsi questa settimana.', 'weekly', 'routes_created', 2, 80],
  ['weekly_distance', 'Divoratore di Asfalto', 'Percorri 100 km questa settimana.', 'weekly', 'distance_m', 100000, 120],
  ['weekly_event', 'Vita Sociale', 'Partecipa a 1 evento questa settimana.', 'weekly', 'events', 1, 60],
  // Obiettivi (achievement, cumulativi)
  ['ach_finisher', 'Finisher', 'Completa 25 percorsi.', 'achievement', 'completions', 25, 250],
  ['ach_explorer', 'Grande Esploratore', 'Crea 10 percorsi.', 'achievement', 'routes_created', 10, 200],
  ['ach_marathoner', 'Maratoneta', 'Percorri 500 km in totale.', 'achievement', 'distance_m', 500000, 300],
  ['ach_eventgoer', 'Frequentatore', 'Partecipa a 5 eventi.', 'achievement', 'events', 5, 200],
];

/* ------------------------------ DEMO ------------------------------ */
// Un tratto panoramico dimostrativo (zona Passo dello Stelvio, IT).
const DEMO_TRACK = [
  { lat: 46.5285, lng: 10.4530, ele: 1900 },
  { lat: 46.5301, lng: 10.4498, ele: 1980 },
  { lat: 46.5325, lng: 10.4471, ele: 2075 },
  { lat: 46.5342, lng: 10.4443, ele: 2160 },
  { lat: 46.5366, lng: 10.4420, ele: 2240 },
  { lat: 46.5388, lng: 10.4405, ele: 2320 },
  { lat: 46.5407, lng: 10.4451, ele: 2410 },
  { lat: 46.5423, lng: 10.4490, ele: 2500 },
  { lat: 46.5440, lng: 10.4527, ele: 2610 },
  { lat: 46.5453, lng: 10.4560, ele: 2757 },
];

const DEMO_POIS = [
  ['Vetta dello Stelvio', 'Uno dei passi più iconici delle Alpi.', 'panorama', 46.5453, 10.4560],
  ['Tornante dei 48', "Il celebre tratto di tornanti sul versante nord.", 'curva', 46.539, 10.446],
  ['Rifugio & Caffè', 'Sosta per un caffè con vista.', 'bar', 46.5455, 10.4562],
];

async function seedBadges() {
  for (const [code, name, description, icon, tier, xp, category] of BADGES) {
    const exists = await db.prepare('SELECT id FROM badges WHERE code = ?').get(code);
    if (!exists) {
      await db
        .prepare('INSERT INTO badges (code, name, description, icon, tier, xp_reward, category) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(code, name, description, icon, tier, xp, category);
    }
  }
  console.log(`  ✓ Badge: ${BADGES.length} definiti`);
}

async function seedMissions() {
  for (const [code, name, description, period, metric, target, xp] of MISSIONS) {
    const exists = await db.prepare('SELECT id FROM missions WHERE code = ?').get(code);
    if (!exists) {
      await db
        .prepare('INSERT INTO missions (code, name, description, period, metric, target, xp_reward) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(code, name, description, period, metric, target, xp);
    }
  }
  console.log(`  ✓ Missioni: ${MISSIONS.length} definite`);
}

async function seedDemo() {
  const MARK = 'demo_seed_v1';
  if (await db.prepare('SELECT value FROM app_meta WHERE key = ?').get(MARK)) {
    console.log('  · Dati demo già presenti (skip)');
    return;
  }

  // Utente demo
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get('demo@4e2.app');
  if (!user) {
    const hash = await bcrypt.hash('password123', 10);
    const info = await db
      .prepare('INSERT INTO users (nickname, email, password_hash, bio, xp, level) VALUES (?, ?, ?, ?, ?, ?)')
      .run('rider_demo', 'demo@4e2.app', hash, 'Amante dei passi alpini su due ruote. 🏍️', 1200, 5);
    await db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(info.lastInsertRowid);
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }

  // Percorso demo
  const simplified = simplify(DEMO_TRACK);
  const metrics = trackMetrics(DEMO_TRACK);
  const box = bbox(simplified) || {};
  const polyline = encodePolyline(simplified);
  const est = Math.round((metrics.distance_m / 1000 / 40) * 3600);
  const rInfo = await db
    .prepare(
      `INSERT INTO routes
        (creator_id, name, description, category, difficulty, vehicle_type,
         start_lat, start_lng, start_name, end_lat, end_lng, end_name,
         track_polyline, distance_m, elevation_gain_m, est_time_s,
         bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, privacy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public')`
    )
    .run(
      user.id, 'Salita al Passo dello Stelvio', 'Tornanti leggendari e panorami mozzafiato. Un must per ogni motociclista.',
      'montagna', 'difficile', 'both',
      simplified[0].lat, simplified[0].lng, 'Bormio',
      simplified[simplified.length - 1].lat, simplified[simplified.length - 1].lng, 'Passo dello Stelvio',
      polyline, metrics.distance_m, metrics.elevation_gain_m, est,
      box.minLat, box.minLng, box.maxLat, box.maxLng
    );
  await db.prepare('INSERT OR IGNORE INTO route_tags (route_id, tag) VALUES (?, ?)').run(rInfo.lastInsertRowid, 'alpi');
  await db.prepare('INSERT OR IGNORE INTO route_tags (route_id, tag) VALUES (?, ?)').run(rInfo.lastInsertRowid, 'tornanti');
  await db.prepare("UPDATE users SET routes_count = 1 WHERE id = ?").run(user.id);

  // POI demo
  for (const [name, desc, cat, lat, lng] of DEMO_POIS) {
    await db
      .prepare('INSERT INTO pois (creator_id, name, description, category, lat, lng) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, name, desc, cat, lat, lng);
  }

  await db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(MARK, new Date().toISOString());
  console.log('  ✓ Dati demo creati (utente demo@4e2.app / password123, 1 percorso, 3 POI)');
}

async function resetData() {
  console.log('  ⚠ Reset dati in corso...');
  const tables = [
    'route_likes', 'route_completions', 'route_tags', 'routes',
    'event_participants', 'events',
    'club_join_requests', 'club_members', 'clubs',
    'friendships', 'user_badges', 'user_missions', 'xp_log',
    'notifications', 'pois', 'vehicles', 'user_settings', 'users',
  ];
  for (const t of tables) await db.run(`DELETE FROM ${t}`);
  await db.run("DELETE FROM app_meta WHERE key = 'demo_seed_v1'");
  // Azzera i contatori AUTOINCREMENT così gli id ripartono da 1 (demo pulita).
  try { await db.run('DELETE FROM sqlite_sequence'); } catch { /* tabella assente se nessun AUTOINCREMENT usato */ }
  console.log('  ✓ Dati azzerati');
}

async function main() {
  const reset = process.argv.includes('--reset');
  console.log('\n  🌱 Seed 4 & | 2\n  ────────────────────────────');
  await initSchema();
  if (reset) await resetData();
  await seedBadges();
  await seedMissions();
  await seedDemo();
  console.log('  ────────────────────────────\n  Fatto.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed fallito:', err);
  process.exit(1);
});
