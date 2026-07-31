/**
 * helpers.js
 * ------------------------------------------------------------
 * Funzioni di utilità generiche lato server.
 * ------------------------------------------------------------
 */

/** Wrapper per gestire errori async nei controller senza try/catch ripetuti. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Crea un errore HTTP con status code. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Timestamp ISO corrente (UTC). */
export const now = () => new Date().toISOString();

/** Giorno UTC corrente 'YYYY-MM-DD' (per streak/missioni giornaliere). */
export const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Chiave settimana ISO 'YYYY-Www' (per missioni settimanali). */
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // lun=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // giovedì della settimana
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Slugify semplice per URL / codici. */
export function slugify(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Rimuove campi sensibili da un oggetto utente prima di inviarlo al client. */
export function sanitizeUser(user) {
  if (!user) return null;
  // Mai esporre l'hash della password né l'id Google: al loro posto due flag
  // utili al client (es. impostazioni: "accedi con Google", "imposta password").
  const { password_hash, google_id, ...safe } = user;
  return {
    ...safe,
    has_password: !!password_hash,
    google_linked: !!google_id,
  };
}

/**
 * Proiezione pubblica ridotta di un utente (per liste, marker, classifiche):
 * espone solo ciò che è sicuro mostrare a chiunque.
 */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    level: user.level,
    xp: user.xp,
  };
}

/** Arrotonda a n decimali restituendo un numero. */
export function round(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) return 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Parse JSON sicuro con fallback. */
export function safeJson(str, fallback = null) {
  if (str == null) return fallback;
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/** Clamp numerico. */
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
