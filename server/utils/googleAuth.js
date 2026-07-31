/**
 * googleAuth.js
 * ------------------------------------------------------------
 * Verifica degli ID token di Google Identity Services (GIS) SENZA
 * dipendenze extra: scarichiamo le chiavi pubbliche di Google (JWKS),
 * le convertiamo in KeyObject con `crypto` (Node 18+ supporta il
 * formato 'jwk') e verifichiamo la firma RS256 con `jsonwebtoken`.
 *
 * Il token arriva dal client (credential del pulsante Google) e NON è
 * affidabile: senza questa verifica chiunque potrebbe impersonare un
 * altro utente. Controlliamo firma, issuer, audience e scadenza.
 * ------------------------------------------------------------
 */
import { createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { HttpError } from './helpers.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Cache delle chiavi: Google le ruota, quindi rispettiamo il Cache-Control.
let cache = { keys: null, expiresAt: 0 };

/** Scarica (con cache) il JWKS di Google. */
async function fetchCerts() {
  const now = Date.now();
  if (cache.keys && now < cache.expiresAt) return cache.keys;

  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new HttpError(503, 'Verifica Google non disponibile, riprova.');
  const body = await res.json();

  // TTL dal Cache-Control (fallback 1 ora).
  const cc = res.headers.get('cache-control') || '';
  const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1]) || 3600;
  cache = { keys: body.keys || [], expiresAt: now + maxAge * 1000 };
  return cache.keys;
}

/**
 * Verifica un ID token Google e restituisce il profilo essenziale.
 * @param {string} credential ID token (JWT firmato da Google)
 * @returns {Promise<{sub:string,email:string,email_verified:boolean,name:string,picture:string}>}
 */
export async function verifyGoogleIdToken(credential) {
  const clientId = config.google.clientId;
  if (!clientId) throw new HttpError(503, 'Accesso con Google non configurato su questo server.');
  if (!credential || typeof credential !== 'string') throw new HttpError(400, 'Token Google mancante.');

  // Header → kid, per scegliere la chiave giusta.
  const decoded = jwt.decode(credential, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) throw new HttpError(401, 'Token Google non valido.');

  let keys = await fetchCerts();
  let jwk = keys.find((k) => k.kid === kid);
  // Chiave sconosciuta: probabilmente rotazione: invalida la cache e riprova.
  if (!jwk) {
    cache = { keys: null, expiresAt: 0 };
    keys = await fetchCerts();
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new HttpError(401, 'Token Google non valido (chiave sconosciuta).');

  let payload;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    payload = jwt.verify(credential, key, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: ISSUERS,
    });
  } catch {
    throw new HttpError(401, 'Token Google non valido o scaduto.');
  }

  if (!payload.sub) throw new HttpError(401, 'Token Google incompleto.');
  if (!payload.email) throw new HttpError(400, "L'account Google non espone un'email.");
  // Google indica email_verified come boolean o stringa 'true'.
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  if (!verified) throw new HttpError(403, 'Email Google non verificata.');

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    email_verified: true,
    name: payload.name || payload.given_name || '',
    picture: payload.picture || '',
  };
}

export default verifyGoogleIdToken;
