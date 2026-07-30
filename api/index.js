/**
 * api/index.js
 * ------------------------------------------------------------
 * Entry point serverless per Vercel (predisposto — il deploy verrà
 * configurato solo a WebApp completata). Espone l'app Express come
 * funzione: tutte le /api/* sono instradate qui (vedi vercel.json);
 * i file statici in /public sono serviti dalla CDN di Vercel.
 * ------------------------------------------------------------
 */
import { initSchema } from '../server/database/db.js';
import { createApp } from '../server/app.js';

const app = createApp();

// Inizializzazione schema "lazy" una sola volta per istanza (idempotente).
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = initSchema().catch((err) => {
      ready = null; // consenti un nuovo tentativo alla prossima richiesta
      console.error('initSchema error:', err.message);
    });
  }
  return ready;
}

export default async function handler(req, res) {
  await ensureReady();
  return app(req, res);
}
