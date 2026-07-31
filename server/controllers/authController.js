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
import { verifyGoogleIdToken } from '../utils/googleAuth.js';

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
function authResponse(res, user, status = 200, extra = {}) {
  const token = signToken({ id: user.id, role: user.role });
  res.status(status).json({ token, user: decorateUser(user), ...extra });
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

/* ------------------------------------------------------------------
 *  Accesso con Google
 * ------------------------------------------------------------------ */

/**
 * Deriva un nickname valido e libero dal profilo Google.
 * Regole nickname: 3-24 caratteri, solo [a-zA-Z0-9._-].
 */
async function uniqueNickname(name, email) {
  const base = String(name || email.split('@')[0] || 'pilota')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')    // via gli accenti
    .replace(/[^a-zA-Z0-9._-]/g, '')                     // solo caratteri ammessi
    .slice(0, 20) || 'pilota';
  const padded = base.length >= 3 ? base : `${base}pilota`.slice(0, 20);

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? padded : `${padded}${i}`.slice(0, 24);
    const taken = await db.prepare('SELECT id FROM users WHERE nickname = ?').get(candidate);
    if (!taken) return candidate;
  }
  // Fallback estremamente improbabile: suffisso pseudo-casuale.
  return `${padded.slice(0, 16)}${Date.now().toString(36).slice(-6)}`.slice(0, 24);
}

/**
 * POST /api/auth/google  { credential }
 * Registra O accede con un account Google (stesso endpoint: se l'utente non
 * esiste viene creato). Se l'email corrisponde a un account già registrato
 * con password, i due accessi vengono COLLEGATI allo stesso utente.
 */
export const googleAuth = asyncHandler(async (req, res) => {
  const profile = await verifyGoogleIdToken(req.body.credential);

  // 1) Utente già collegato a questo account Google.
  let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.sub);

  // 2) Altrimenti: stessa email → collega Google all'account esistente.
  if (!user) {
    const existing = await db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
    if (existing) {
      if (!existing.google_id) {
        await db
          .prepare("UPDATE users SET google_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(profile.sub, existing.id);
      }
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    }
  }

  // 3) Nuovo utente: registrazione completa (impostazioni + XP di benvenuto).
  let created = false;
  if (!user) {
    const nickname = await uniqueNickname(profile.name, profile.email);
    // Nessuna password: l'accesso avviene solo via Google (password_hash = '').
    const info = await db
      .prepare(
        `INSERT INTO users (nickname, email, password_hash, google_id, avatar, role)
         VALUES (?, ?, '', ?, COALESCE(NULLIF(?, ''), '/images/avatars/default.svg'), ?)`
      )
      .run(nickname, profile.email, profile.sub, profile.picture, ROLES.USER);
    const userId = info.lastInsertRowid;

    await db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
    await awardXp(userId, XP.REGISTER, 'register', 'user', userId);
    await checkBadges(userId);

    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    created = true;
  }

  if (!user.is_active) throw new HttpError(403, 'Account disattivato.');

  await dailyCheckIn(user.id);
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  authResponse(res, fresh, created ? 201 : 200, { created });
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
  // Account creato con Google: nessuna password da confermare, la imposta ora.
  if (!user.password_hash) {
    const hash = await bcrypt.hash(next, 10);
    await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, user.id);
    res.json({ message: 'Password impostata: ora puoi accedere anche con email e password.' });
    return;
  }
  const ok = await bcrypt.compare(String(current || ''), user.password_hash);
  if (!ok) throw new HttpError(400, 'Password attuale errata.');
  const hash = await bcrypt.hash(next, 10);
  await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, user.id);
  res.json({ message: 'Password aggiornata.' });
});
