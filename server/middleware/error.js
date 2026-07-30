/**
 * error.js (middleware)
 * ------------------------------------------------------------
 * 404 per le API e gestore errori centralizzato.
 * Non espone stack o dettagli interni in produzione.
 * ------------------------------------------------------------
 */
import { config } from '../config/config.js';

/** 404 per rotte API non trovate. */
export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Risorsa non trovata', path: req.path });
  }
  next();
}

/** Gestore errori finale. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  // Errori multer (upload) → messaggi chiari.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File troppo grande.' });
  }

  if (status >= 500) {
    console.error('Errore server:', err);
  }

  const body = { error: err.message || 'Errore interno del server' };
  if (!config.isProd() && status >= 500) body.stack = err.stack;
  res.status(status).json(body);
}
