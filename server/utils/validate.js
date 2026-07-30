/**
 * validate.js
 * ------------------------------------------------------------
 * Validazione e sanificazione input lato server.
 * PRINCIPIO: mai fidarsi del client. Ogni valore che arriva dal
 * browser passa da qui prima di toccare il DB.
 *
 * Le funzioni lanciano HttpError(400, ...) con messaggi in italiano
 * quando il valore non è valido, altrimenti restituiscono il valore
 * normalizzato/coercizzato.
 * ------------------------------------------------------------
 */
import { HttpError } from './helpers.js';

const fail = (msg) => {
  throw new HttpError(400, msg);
};

/** Stringa obbligatoria, con lunghezza min/max e trim. */
export function str(value, field, { min = 1, max = 5000, trim = true } = {}) {
  let v = value == null ? '' : String(value);
  if (trim) v = v.trim();
  if (v.length < min) fail(`${field}: minimo ${min} caratteri.`);
  if (v.length > max) fail(`${field}: massimo ${max} caratteri.`);
  return v;
}

/** Stringa opzionale (ritorna '' se assente), con max. */
export function optStr(value, field, { max = 5000, trim = true } = {}) {
  if (value == null || value === '') return '';
  let v = String(value);
  if (trim) v = v.trim();
  if (v.length > max) fail(`${field}: massimo ${max} caratteri.`);
  return v;
}

/** Email valida e normalizzata (lowercase). */
export function email(value, field = 'Email') {
  const v = str(value, field, { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(`${field}: indirizzo non valido.`);
  return v;
}

/**
 * Nickname: 3–24 caratteri, lettere/numeri/._-, univocità gestita a valle.
 */
export function nickname(value, field = 'Nickname') {
  const v = str(value, field, { min: 3, max: 24 });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    fail(`${field}: usa solo lettere, numeri, punto, trattino e underscore.`);
  }
  return v;
}

/** Password: minimo 8 caratteri (non svuota spazi interni). */
export function password(value, field = 'Password') {
  const v = value == null ? '' : String(value);
  if (v.length < 8) fail(`${field}: almeno 8 caratteri.`);
  if (v.length > 200) fail(`${field}: troppo lunga.`);
  return v;
}

/** Numero intero in range. */
export function int(value, field, { min = -Infinity, max = Infinity, def } = {}) {
  if ((value === '' || value == null) && def !== undefined) return def;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) fail(`${field}: deve essere un numero intero.`);
  if (n < min || n > max) fail(`${field}: valore fuori intervallo (${min}–${max}).`);
  return n;
}

/** Numero (float) in range. */
export function num(value, field, { min = -Infinity, max = Infinity, def } = {}) {
  if ((value === '' || value == null) && def !== undefined) return def;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${field}: deve essere un numero.`);
  if (n < min || n > max) fail(`${field}: valore fuori intervallo (${min}–${max}).`);
  return n;
}

/** Latitudine valida. */
export const latitude = (v, field = 'Latitudine') => num(v, field, { min: -90, max: 90 });
/** Longitudine valida. */
export const longitude = (v, field = 'Longitudine') => num(v, field, { min: -180, max: 180 });

/** Valore in un insieme consentito. */
export function oneOf(value, allowed, field, { def } = {}) {
  if ((value === '' || value == null) && def !== undefined) return def;
  if (!allowed.includes(value)) fail(`${field}: valore non ammesso.`);
  return value;
}

/** Booleano coercizzato (accetta true/1/'true'/'on'). */
export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

/** Data ISO valida (ritorna stringa ISO). */
export function isoDate(value, field = 'Data') {
  const d = new Date(value);
  if (isNaN(d.getTime())) fail(`${field}: data non valida.`);
  return d.toISOString();
}

/**
 * Valida una traccia GPS grezza in ingresso: array di punti con lat/lng validi
 * e campi opzionali. Limita il numero di punti per prevenire abusi.
 * @returns {Array<{lat,lng,ele?,t?,speed?}>}
 */
export function track(value, field = 'Traccia', { maxPoints = 100000, minPoints = 2 } = {}) {
  if (!Array.isArray(value)) fail(`${field}: formato non valido.`);
  if (value.length < minPoints) fail(`${field}: servono almeno ${minPoints} punti.`);
  if (value.length > maxPoints) fail(`${field}: troppi punti (max ${maxPoints}).`);
  return value.map((p, i) => {
    const la = Array.isArray(p) ? p[0] : p.lat;
    const ln = Array.isArray(p) ? p[1] : p.lng;
    const lat = Number(la);
    const lng = Number(ln);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      fail(`${field}: punto ${i} con coordinate non valide.`);
    }
    const out = { lat, lng };
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      if (Number.isFinite(Number(p.ele))) out.ele = Number(p.ele);
      if (Number.isFinite(Number(p.t))) out.t = Number(p.t);
      if (Number.isFinite(Number(p.speed))) out.speed = Number(p.speed);
    }
    return out;
  });
}
