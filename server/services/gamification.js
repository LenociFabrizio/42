/**
 * services/gamification.js
 * ------------------------------------------------------------
 * Il "motore" della gamification: assegnazione XP, livelli, badge,
 * missioni e streak giornaliere.
 *
 * PRINCIPIO: solo attività REALE genera XP (mai pay-to-win). Ogni
 * assegnazione è tracciata in xp_log ed è quindi verificabile/ricostruibile.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { levelForXp, levelTitle } from '../utils/levels.js';
import { todayKey, weekKey } from '../utils/helpers.js';
import { XP } from '../utils/constants.js';
import { notify } from './notifications.js';

/**
 * Assegna XP a un utente, aggiorna il totale e il livello, e — se sale di
 * livello — invia la notifica. NON valuta i badge (per evitare ricorsione):
 * i controller chiamano `checkBadges` dopo le azioni rilevanti.
 *
 * @returns {{xp:number, level:number, leveledUp:boolean, from:number}}
 */
export async function awardXp(userId, amount, reason, refType = null, refId = null) {
  const amt = Math.round(Number(amount) || 0);
  if (!userId || amt === 0) {
    const u = await db.prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
    return { xp: u?.xp || 0, level: u?.level || 1, leveledUp: false, from: u?.level || 1 };
  }

  const before = await db.prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
  const fromLevel = before?.level || 1;
  const newXp = (before?.xp || 0) + amt;
  const newLevel = levelForXp(newXp);

  await db.batch(
    [
      {
        sql: "UPDATE users SET xp = ?, level = ?, updated_at = datetime('now') WHERE id = ?",
        args: [newXp, newLevel, userId],
      },
      {
        sql: 'INSERT INTO xp_log (user_id, amount, reason, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)',
        args: [userId, amt, reason, refType, refId],
      },
    ],
    'write'
  );

  const leveledUp = newLevel > fromLevel;
  if (leveledUp) {
    await notify(
      userId,
      'level_up',
      `Livello ${newLevel} raggiunto! 🎉`,
      `Nuovo grado: ${levelTitle(newLevel)}. Continua a macinare strada!`,
      { level: newLevel, title: levelTitle(newLevel) }
    );
  }

  return { xp: newXp, level: newLevel, leveledUp, from: fromLevel };
}

/* ============================================================
 *  BADGE — regole valutate su uno snapshot di statistiche.
 *  La chiave è il `code` del badge (deve esistere nella tabella badges,
 *  vedi seed.js). Ogni regola riceve `stats` e ritorna true se sbloccato.
 * ============================================================ */
const BADGE_RULES = {
  // Percorsi
  first_route: (s) => s.routes_count >= 1,
  route_maker_5: (s) => s.routes_count >= 5,
  route_maker_25: (s) => s.routes_count >= 25,
  // Record / completamenti
  first_ride: (s) => s.completions >= 1,
  record_holder: (s) => s.records_count >= 1,
  speed_demon: (s) => s.max_speed_kmh >= 150,
  // Distanza
  km_100: (s) => s.total_distance_m >= 100_000,
  km_1000: (s) => s.total_distance_m >= 1_000_000,
  km_5000: (s) => s.total_distance_m >= 5_000_000,
  // Eventi
  first_event: (s) => s.events_count >= 1,
  event_regular: (s) => s.events_count >= 10,
  event_host: (s) => s.events_hosted >= 1,
  // Social
  first_friend: (s) => s.friends >= 1,
  social_butterfly: (s) => s.friends >= 10,
  club_founder: (s) => s.clubs_founded >= 1,
  club_member: (s) => s.clubs_joined >= 1,
  // Livello
  level_5: (s) => s.level >= 5,
  level_10: (s) => s.level >= 10,
  level_25: (s) => s.level >= 25,
  // Costanza
  streak_7: (s) => s.streak_days >= 7,
  streak_30: (s) => s.streak_days >= 30,
  // Aree scoperte (regioni italiane): l'area di partenza conta come la prima,
  // quindi "oltre il confine" scatta con la seconda.
  region_beyond: (s) => s.regions_count >= 2,
  region_5: (s) => s.regions_count >= 5,
  region_10: (s) => s.regions_count >= 10,
  region_all: (s) => s.regions_count >= 20,
};

/** Costruisce lo snapshot statistico usato dalle regole dei badge. */
async function buildStats(userId) {
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const completions = await db
    .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(max_speed_kmh),0) AS mx FROM route_completions WHERE user_id = ?')
    .get(userId);
  const friends = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)"
    )
    .get(userId, userId);
  const clubsFounded = await db.prepare('SELECT COUNT(*) AS n FROM clubs WHERE creator_id = ?').get(userId);
  const clubsJoined = await db.prepare('SELECT COUNT(*) AS n FROM club_members WHERE user_id = ?').get(userId);
  const eventsHosted = await db.prepare('SELECT COUNT(*) AS n FROM events WHERE creator_id = ?').get(userId);
  const regions = await db.prepare('SELECT COUNT(*) AS n FROM user_regions WHERE user_id = ?').get(userId);

  return {
    routes_count: u.routes_count,
    records_count: u.records_count,
    events_count: u.events_count,
    total_distance_m: u.total_distance_m,
    level: u.level,
    streak_days: u.streak_days,
    completions: completions?.n || 0,
    max_speed_kmh: completions?.mx || 0,
    friends: friends?.n || 0,
    clubs_founded: clubsFounded?.n || 0,
    clubs_joined: clubsJoined?.n || 0,
    events_hosted: eventsHosted?.n || 0,
    regions_count: regions?.n || 0,
  };
}

/**
 * Valuta tutte le regole e assegna i badge nuovi. Idempotente.
 * @returns {Array} badge appena sbloccati (con name/icon)
 */
export async function checkBadges(userId) {
  const stats = await buildStats(userId);
  if (!stats) return [];

  const owned = new Set(
    (await db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?').all(userId)).map((r) => r.badge_id)
  );
  const badges = await db.prepare('SELECT * FROM badges').all();
  const unlocked = [];

  for (const badge of badges) {
    if (owned.has(badge.id)) continue;
    const rule = BADGE_RULES[badge.code];
    if (rule && rule(stats)) {
      await db
        .prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)')
        .run(userId, badge.id);
      if (badge.xp_reward > 0) {
        await awardXp(userId, badge.xp_reward, `badge:${badge.code}`, 'badge', badge.id);
      }
      await notify(
        userId,
        'badge',
        `Badge sbloccato: ${badge.name} ${badge.icon}`,
        badge.description,
        { badge_code: badge.code, icon: badge.icon, tier: badge.tier }
      );
      unlocked.push({ code: badge.code, name: badge.name, icon: badge.icon, tier: badge.tier });
    }
  }
  return unlocked;
}

/* ============================================================
 *  MISSIONI — avanzamento per metrica e periodo.
 * ============================================================ */
function periodKeyFor(period) {
  if (period === 'daily') return todayKey();
  if (period === 'weekly') return weekKey();
  return 'all'; // achievement
}

/**
 * Incrementa le missioni attive che tracciano `metric` di `amount`, per il
 * periodo corrente, e assegna la ricompensa quando l'obiettivo è raggiunto.
 * @param {number} userId
 * @param {string} metric  'distance_m'|'completions'|'events'|'routes_created'|'friends'
 * @param {number} amount
 */
export async function bumpMissions(userId, metric, amount = 1) {
  if (!userId || !metric || amount <= 0) return;
  const missions = await db
    .prepare('SELECT * FROM missions WHERE is_active = 1 AND metric = ?')
    .all(metric);

  for (const m of missions) {
    const pk = periodKeyFor(m.period);
    await db
      .prepare(
        `INSERT INTO user_missions (user_id, mission_id, period_key, progress)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, mission_id, period_key)
         DO UPDATE SET progress = progress + excluded.progress`
      )
      .run(userId, m.id, pk, amount);

    const row = await db
      .prepare('SELECT progress, completed_at FROM user_missions WHERE user_id = ? AND mission_id = ? AND period_key = ?')
      .get(userId, m.id, pk);

    if (row && !row.completed_at && row.progress >= m.target) {
      await db
        .prepare(
          "UPDATE user_missions SET completed_at = datetime('now') WHERE user_id = ? AND mission_id = ? AND period_key = ?"
        )
        .run(userId, m.id, pk);
      if (m.xp_reward > 0) await awardXp(userId, m.xp_reward, `mission:${m.code}`, 'mission', m.id);
      await notify(
        userId,
        'mission',
        `Missione completata: ${m.name} ✅`,
        `${m.description} · +${m.xp_reward} XP`,
        { mission_code: m.code, xp: m.xp_reward }
      );
    }
  }
}

/* ============================================================
 *  STREAK GIORNALIERA — bonus di costanza (una volta al giorno).
 * ============================================================ */
/**
 * Registra il check-in giornaliero: aggiorna la streak e assegna XP di login
 * + bonus streak (una sola volta per giorno UTC).
 * @returns {{streakDays:number, awarded:number, alreadyToday:boolean}}
 */
export async function dailyCheckIn(userId) {
  const u = await db.prepare('SELECT streak_days, streak_last_day FROM users WHERE id = ?').get(userId);
  if (!u) return { streakDays: 0, awarded: 0, alreadyToday: false };

  const today = todayKey();
  if (u.streak_last_day === today) {
    return { streakDays: u.streak_days, awarded: 0, alreadyToday: true };
  }

  // Ieri (UTC) per capire se la streak continua o si azzera.
  const y = new Date();
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = todayKey(y);
  const streakDays = u.streak_last_day === yesterday ? (u.streak_days || 0) + 1 : 1;

  await db
    .prepare("UPDATE users SET streak_days = ?, streak_last_day = ? WHERE id = ?")
    .run(streakDays, today, userId);

  const streakBonus = Math.min(streakDays * XP.STREAK_BONUS_PER_DAY, XP.STREAK_BONUS_CAP);
  const total = XP.DAILY_LOGIN + streakBonus;
  await awardXp(userId, total, 'daily_login', null, null);
  await checkBadges(userId);

  return { streakDays, awarded: total, alreadyToday: false };
}
