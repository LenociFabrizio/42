/**
 * authController.js
 * ------------------------------------------------------------
 * Registrazione, login, profilo corrente (/me), cambio password.
 * ------------------------------------------------------------
 */
import bcrypt from 'bcryptjs';
import db from '../database/db.js';
import { signToken } from '../utils/jwt.js';
import { asyncHandler, HttpError, sanitizeUser } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { ROLES, XP } from '../utils/constants.js';
import { progress, levelTitle } from '../utils/levels.js';
import { awardXp, checkBadges, dailyCheckIn } from '../services/gamification.js';
import { unreadCount } from '../services/notifications.js';

/** Costruisce la risposta arricchita dell'utente (con progresso livello). */
function decorateUser(user) {
  const p = progress(user.xp || 0);
  return {
    ...sanitizeUser(user),
    title: levelTitle(user.level || 1),
    progress: p,
  };
}

/** Risposta standard con token + utente. */
function authResponse(res, user, status = 200) {
  const token = signToken({ id: user.id, role: user.role });
  res.status(status).json({ token, user: decorateUser(user) });
}

/** POST /api/auth/register */
export const register = asyncHandler(async (req, res) => {
  const nickname = v.nickname(req.body.nickname);
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);

  const emailExists = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (emailExists) throw new HttpError(409, 'Email già registrata.');
  const nickExists = await db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (nickExists) throw new HttpError(409, 'Questo nickname è già in uso.');

  const hash = await bcrypt.hash(password, 10);
  const info = await db
    .prepare('INSERT INTO users (nickname, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(nickname, email, hash, ROLES.USER);
  const userId = info.lastInsertRowid;

  // Riga impostazioni di default.
  await db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);

  // XP di benvenuto + eventuali badge iniziali.
  await awardXp(userId, XP.REGISTER, 'register', 'user', userId);
  await checkBadges(userId);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  authResponse(res, user, 201);
});

/** POST /api/auth/login  (email + password) */
export const login = asyncHandler(async (req, res) => {
  const email = v.email(req.body.email);
  const password = req.body.password;
  if (!password) throw new HttpError(400, 'Password mancante.');

  const user = await db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
  if (!user || !user.password_hash) throw new HttpError(401, 'Credenziali non valide.');
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) throw new HttpError(401, 'Credenziali non valide.');

  // Check-in giornaliero (streak + XP di login) al momento dell'accesso.
  await dailyCheckIn(user.id);
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  authResponse(res, fresh);
});

/** GET /api/auth/me  (utente corrente + notifiche non lette) */
export const me = asyncHandler(async (req, res) => {
  // Un GET /me al giorno vale come check-in (utile per PWA sempre loggata).
  await dailyCheckIn(req.user.id);
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const unread = await unreadCount(req.user.id);
  res.json({ user: decorateUser(fresh), unread });
});

/** POST /api/auth/change-password */
export const changePassword = asyncHandler(async (req, res) => {
  const current = req.body.current_password;
  const next = v.password(req.body.new_password, 'Nuova password');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const ok = await bcrypt.compare(String(current || ''), user.password_hash);
  if (!ok) throw new HttpError(400, 'Password attuale errata.');
  const hash = await bcrypt.hash(next, 10);
  await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, user.id);
  res.json({ message: 'Password aggiornata.' });
});
