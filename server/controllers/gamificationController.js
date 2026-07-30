/**
 * gamificationController.js
 * ------------------------------------------------------------
 * Sola LETTURA della gamification lato client: elenco badge (con stato
 * "sbloccato" per l'utente), missioni attive con avanzamento del periodo
 * corrente, curva dei livelli e registro XP recente.
 *
 * L'assegnazione di XP/badge/missioni vive in services/gamification.js:
 * qui esponiamo solo viste consultabili.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, todayKey, weekKey } from '../utils/helpers.js';
import { xpForLevel, levelTitle } from '../utils/levels.js';

/**
 * GET /api/gamification/badges — tutti i badge del catalogo.
 * Con autenticazione opzionale: se l'utente è loggato aggiunge `earned`
 * ed `earned_at`. Ordinati per categoria, poi tier (bronze→silver→gold→
 * special), infine nome.
 */
export const listBadges = asyncHandler(async (req, res) => {
  const uid = req.user?.id || 0; // 0 = nessun match nella LEFT JOIN (utente anonimo)
  const rows = await db
    .prepare(
      `SELECT b.code, b.name, b.description, b.icon, b.tier, b.category, b.xp_reward,
              CASE WHEN ub.user_id IS NOT NULL THEN 1 ELSE 0 END AS earned,
              ub.earned_at
         FROM badges b
         LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
        ORDER BY b.category,
                 CASE b.tier
                   WHEN 'bronze'  THEN 0
                   WHEN 'silver'  THEN 1
                   WHEN 'gold'    THEN 2
                   WHEN 'special' THEN 3
                   ELSE 4
                 END,
                 b.name`
    )
    .all(uid);

  res.json({
    badges: rows.map((b) => ({
      code: b.code,
      name: b.name,
      description: b.description,
      icon: b.icon,
      tier: b.tier,
      category: b.category,
      xp_reward: b.xp_reward,
      earned: !!b.earned,
      earned_at: b.earned_at || null,
    })),
  });
});

/**
 * GET /api/gamification/missions — missioni attive con l'avanzamento del
 * periodo CORRENTE per l'utente. La period_key dipende dal tipo di missione:
 * daily→giorno UTC, weekly→settimana ISO, achievement→'all'.
 * Ordinate per gruppo: daily, weekly, achievement.
 */
export const listMissions = asyncHandler(async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT m.code, m.name, m.description, m.period, m.metric, m.target, m.xp_reward,
              COALESCE(um.progress, 0) AS progress,
              CASE WHEN um.completed_at IS NOT NULL THEN 1 ELSE 0 END AS completed
         FROM missions m
         LEFT JOIN user_missions um
                ON um.mission_id = m.id
               AND um.user_id = ?
               AND um.period_key = CASE m.period
                     WHEN 'daily'  THEN ?
                     WHEN 'weekly' THEN ?
                     ELSE 'all'
                   END
        WHERE m.is_active = 1
        ORDER BY CASE m.period
                   WHEN 'daily'       THEN 0
                   WHEN 'weekly'      THEN 1
                   WHEN 'achievement' THEN 2
                   ELSE 3
                 END,
                 m.id`
    )
    .all(req.user.id, todayKey(), weekKey());

  res.json({
    missions: rows.map((m) => ({
      code: m.code,
      name: m.name,
      description: m.description,
      period: m.period,
      metric: m.metric,
      target: m.target,
      xp_reward: m.xp_reward,
      progress: m.progress || 0,
      completed: !!m.completed,
    })),
  });
});

/**
 * GET /api/gamification/levels — riferimento statico della curva dei livelli
 * per il client (livelli 1..30). Nessuna autenticazione richiesta.
 */
export const listLevels = asyncHandler(async (_req, res) => {
  const levels = [];
  for (let level = 1; level <= 30; level++) {
    levels.push({ level, xp_required: xpForLevel(level), title: levelTitle(level) });
  }
  res.json({ levels });
});

/**
 * GET /api/gamification/xp-log — ultimi 50 eventi XP dell'utente,
 * dal più recente.
 */
export const xpLog = asyncHandler(async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT amount, reason, ref_type, ref_id, created_at
         FROM xp_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({ log: rows });
});
