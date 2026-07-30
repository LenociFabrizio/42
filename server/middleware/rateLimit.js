/**
 * rateLimit.js (middleware)
 * ------------------------------------------------------------
 * Limitatori di frequenza (anti brute-force / anti-abuso).
 *  - globalLimiter: soglia morbida su tutte le /api.
 *  - authLimiter:   stringente su login/registrazione (per IP).
 *  - writeLimiter:  su creazioni/scritture pesanti.
 *  - liveLimiter:   alto, per gli aggiornamenti di posizione live.
 * ------------------------------------------------------------
 */
import rateLimit from 'express-rate-limit';

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste. Riprova tra poco.' },
};

export const globalLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: 300, // 300 richieste/min per IP
});

export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 tentativi/15min per IP su login+register
  message: { error: 'Troppi tentativi di accesso. Riprova tra qualche minuto.' },
});

export const writeLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: 60,
});

export const liveLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: 240, // ~1 aggiornamento posizione ogni 250ms max
});
