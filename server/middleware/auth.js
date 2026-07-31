/**
 * auth.js (middleware)
 * ------------------------------------------------------------
 * Autenticazione (JWT) e autorizzazione (ruoli / livello).
 * ------------------------------------------------------------
 */
import { verifyToken } from '../utils/jwt.js';
import { HttpError } from '../utils/helpers.js';
import db from '../database/db.js';
import { ROLES, LIVE_MAP_MIN_LEVEL } from '../utils/constants.js';

/** Estrae il token da header Authorization o cookie. */
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

/**
 * "Battito" di presenza: segna l'utente come attivo adesso. Scrive al massimo
 * una volta al minuto (il client interroga l'API ogni 30s) per non appesantire
 * ogni richiesta. È indipendente da last_seen, che riguarda solo la
 * condivisione live della posizione.
 *
 * "Online" deve voler dire "sta usando l'app", non "ha una scheda aperta": le
 * richieste che arrivano da una pagina in secondo piano (header X-App-Active: 0)
 * NON aggiornano la presenza, altrimenti una PWA dimenticata aperta terrebbe
 * l'utente online per sempre agli occhi degli amici. Un client che non manda
 * l'header viene considerato attivo (compatibilità con le versioni in cache).
 */
const PRESENCE_TOUCH_MS = 60 * 1000;
async function touchPresence(req, user) {
  if (req.headers['x-app-active'] === '0') return;
  const last = user.last_active ? Date.parse(`${String(user.last_active).replace(' ', 'T')}Z`) : NaN;
  if (!Number.isNaN(last) && Date.now() - last < PRESENCE_TOUCH_MS) return;
  try {
    await db.prepare("UPDATE users SET last_active = datetime('now') WHERE id = ?").run(user.id);
  } catch {
    /* la presenza è un extra: se fallisce, la richiesta prosegue */
  }
}

/** Richiede un utente autenticato. Popola req.user con il record dal DB. */
export async function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(new HttpError(401, 'Autenticazione richiesta'));
  try {
    const payload = verifyToken(token);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id);
    if (!user) return next(new HttpError(401, 'Utente non valido'));
    req.user = user;
    await touchPresence(req, user);
    next();
  } catch {
    next(new HttpError(401, 'Token non valido o scaduto'));
  }
}

/** Autenticazione opzionale: popola req.user se il token è valido, altrimenti prosegue. */
export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id);
    if (user) req.user = user;
  } catch {
    /* token invalido in modalità opzionale: ignora */
  }
  next();
}

/** Richiede il ruolo admin (usare dopo requireAuth). */
export function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return next(new HttpError(403, 'Accesso riservato agli amministratori'));
  }
  next();
}

/** Richiede un livello minimo (es. per sbloccare la Live Map). */
export function requireLevel(minLevel = LIVE_MAP_MIN_LEVEL) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Autenticazione richiesta'));
    if ((req.user.level || 1) < minLevel) {
      return next(new HttpError(403, `Funzione sbloccata dal livello ${minLevel}.`));
    }
    next();
  };
}
