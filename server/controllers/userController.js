/**
 * userController.js
 * ------------------------------------------------------------
 * Profilo pubblico, aggiornamento profilo, avatar, veicoli,
 * classifica globale per XP.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError, sanitizeUser, publicUser } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { VEHICLE_TYPES } from '../utils/constants.js';
import { progress, levelTitle } from '../utils/levels.js';
import { persistUpload } from '../middleware/upload.js';
import { checkBadges } from '../services/gamification.js';

/** Verifica se `viewerId` può vedere il profilo di `owner` secondo la privacy. */
async function canViewProfile(owner, viewerId) {
  if (!owner) return false;
  if (viewerId && owner.id === viewerId) return true;
  const s = await db.prepare('SELECT profile_visibility FROM user_settings WHERE user_id = ?').get(owner.id);
  const vis = s?.profile_visibility || 'public';
  if (vis === 'public') return true;
  if (vis === 'private') return false;
  // 'friends'
  if (!viewerId) return false;
  const f = await db
    .prepare(
      "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))"
    )
    .get(owner.id, viewerId, viewerId, owner.id);
  return !!f;
}

/** GET /api/users/leaderboard — top utenti per XP. */
export const leaderboard = asyncHandler(async (req, res) => {
  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 100, def: 50 });
  const rows = await db
    .prepare(
      `SELECT id, nickname, avatar, level, xp, total_distance_m, records_count
         FROM users WHERE is_active = 1 ORDER BY xp DESC, id ASC LIMIT ?`
    )
    .all(limit);
  res.json({ leaderboard: rows.map((u, i) => ({ ...u, rank: i + 1, title: levelTitle(u.level) })) });
});

/** GET /api/users/:id — profilo pubblico (rispetta privacy). */
export const getProfile = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);
  if (!user) throw new HttpError(404, 'Utente non trovato.');

  if (!(await canViewProfile(user, req.user?.id))) {
    // Profilo privato: esponi solo il minimo indispensabile.
    return res.json({ user: publicUser(user), private: true });
  }

  const badges = await db
    .prepare(
      `SELECT b.code, b.name, b.icon, b.tier, b.description, ub.earned_at
         FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = ? ORDER BY ub.earned_at DESC`
    )
    .all(id);
  const vehicles = await db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, id').all(id);
  const clubs = await db
    .prepare(
      `SELECT c.id, c.name, c.photo, cm.role FROM club_members cm
         JOIN clubs c ON c.id = cm.club_id WHERE cm.user_id = ?`
    )
    .all(id);

  res.json({
    user: { ...sanitizeUser(user), title: levelTitle(user.level), progress: progress(user.xp) },
    badges,
    vehicles,
    clubs,
  });
});

/** GET /api/users/:id/routes — percorsi pubblici di un utente. */
export const getUserRoutes = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const own = req.user?.id === id;
  const rows = await db
    .prepare(
      `SELECT id, name, category, difficulty, distance_m, est_time_s, photo, privacy, completions_count, created_at
         FROM routes WHERE creator_id = ? ${own ? '' : "AND privacy = 'public'"} ORDER BY created_at DESC`
    )
    .all(id);
  res.json({ routes: rows });
});

/** PUT /api/users/me — aggiorna profilo (nickname, bio). */
export const updateProfile = asyncHandler(async (req, res) => {
  const fields = [];
  const args = [];

  if (req.body.nickname !== undefined) {
    const nick = v.nickname(req.body.nickname);
    const taken = await db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(nick, req.user.id);
    if (taken) throw new HttpError(409, 'Nickname già in uso.');
    fields.push('nickname = ?');
    args.push(nick);
  }
  if (req.body.bio !== undefined) {
    fields.push('bio = ?');
    args.push(v.optStr(req.body.bio, 'Bio', { max: 500 }));
  }
  if (!fields.length) throw new HttpError(400, 'Nessun campo da aggiornare.');

  args.push(req.user.id);
  await db.prepare(`UPDATE users SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args);
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: sanitizeUser(fresh) });
});

/** POST /api/users/me/avatar — upload immagine profilo. */
export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Nessun file ricevuto.');
  const url = await persistUpload(req.file, 'avatars');
  await db.prepare("UPDATE users SET avatar = ?, updated_at = datetime('now') WHERE id = ?").run(url, req.user.id);
  res.json({ avatar: url });
});

/* -------------------- VEICOLI -------------------- */

/** GET /api/users/me/vehicles */
export const listVehicles = asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, id').all(req.user.id);
  res.json({ vehicles: rows });
});

/** POST /api/users/me/vehicles */
export const addVehicle = asyncHandler(async (req, res) => {
  const type = v.oneOf(req.body.type, VEHICLE_TYPES, 'Tipo veicolo');
  const name = v.str(req.body.name, 'Nome', { max: 60 });
  const make = v.optStr(req.body.make, 'Marca', { max: 40 });
  const model = v.optStr(req.body.model, 'Modello', { max: 40 });
  const year = req.body.year ? v.int(req.body.year, 'Anno', { min: 1900, max: 2100 }) : null;
  const isPrimary = v.bool(req.body.is_primary) ? 1 : 0;

  if (isPrimary) await db.prepare('UPDATE vehicles SET is_primary = 0 WHERE user_id = ?').run(req.user.id);
  const info = await db
    .prepare('INSERT INTO vehicles (user_id, type, name, make, model, year, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, type, name, make, model, year, isPrimary);
  const vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ vehicle });
});

/** DELETE /api/users/me/vehicles/:vid */
export const deleteVehicle = asyncHandler(async (req, res) => {
  const vid = v.int(req.params.vid, 'id', { min: 1 });
  const owned = await db.prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?').get(vid, req.user.id);
  if (!owned) throw new HttpError(404, 'Veicolo non trovato.');
  await db.prepare('DELETE FROM vehicles WHERE id = ?').run(vid);
  res.status(204).end();
});
