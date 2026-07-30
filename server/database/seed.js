/**
 * seed.js
 * ------------------------------------------------------------
 * Popolamento del database:
 *   - CATALOGO gamification (badge + missioni) → delegato a catalog.js
 *     (lo stesso usato in automatico da initSchema).
 *   - DATI DEMO (un utente, un percorso panoramico, alcuni POI) così
 *     la mappa non è vuota al primo avvio locale.
 *
 * Uso:
 *   npm run seed          → idempotente (non duplica)
 *   npm run db:reset      → azzera i dati e ricrea da capo
 * ------------------------------------------------------------
 */
import bcrypt from 'bcryptjs';
import db, { initSchema } from './db.js';
import { ensureCatalog, BADGES, MISSIONS } from './catalog.js';
import { encodePolyline, trackMetrics, bbox, simplify } from '../utils/geo.js';

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

async function seedDemo() {
  const MARK = 'demo_seed_v1';
  if (await db.prepare('SELECT value FROM app_meta WHERE key = ?').get(MARK)) {
    console.log('  · Dati demo già presenti (skip)');
    return;
  }

  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get('demo@4e2.app');
  if (!user) {
    const hash = await bcrypt.hash('password123', 10);
    const info = await db
      .prepare('INSERT INTO users (nickname, email, password_hash, bio, xp, level) VALUES (?, ?, ?, ?, ?, ?)')
      .run('rider_demo', 'demo@4e2.app', hash, 'Amante dei passi alpini su due ruote. 🏍️', 1200, 5);
    await db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(info.lastInsertRowid);
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }

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
  await db.prepare('UPDATE users SET routes_count = 1 WHERE id = ?').run(user.id);

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
  try { await db.run('DELETE FROM sqlite_sequence'); } catch { /* nessun AUTOINCREMENT ancora */ }
  console.log('  ✓ Dati azzerati');
}

async function main() {
  const reset = process.argv.includes('--reset');
  console.log('\n  🌱 Seed 4 & | 2\n  ────────────────────────────');
  await initSchema(); // crea schema + catalogo (badge/missioni) automaticamente
  if (reset) {
    await resetData();
    await ensureCatalog(db); // ripristina il catalogo dopo il reset
  }
  console.log(`  ✓ Catalogo: ${BADGES.length} badge, ${MISSIONS.length} missioni`);
  await seedDemo();
  console.log('  ────────────────────────────\n  Fatto.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed fallito:', err);
  process.exit(1);
});
