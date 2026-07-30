/**
 * app.js
 * ------------------------------------------------------------
 * Costruzione dell'applicazione Express: sicurezza (helmet/CSP),
 * compressione, CORS, parsing, rate limiting, montaggio delle API,
 * servizio dei file statici (PWA) e gestione errori.
 * ------------------------------------------------------------
 */
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import path from 'node:path';
import { config } from './config/config.js';
import apiRouter from './routes/index.js';
import { securityHeaders } from './middleware/security.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  // Dietro il proxy di Vercel: necessario per rate-limit basato su IP e per
  // ottenere il protocollo/host reali.
  app.set('trust proxy', 1);

  // Sicurezza: header protettivi + Content-Security-Policy calibrata sugli
  // origini realmente usati (mappe, font). Vedi middleware/security.js.
  app.use(securityHeaders());

  // Compressione risposte (Performance).
  app.use(compression());

  // Same-origin su Vercel; l'auth usa Bearer token, quindi riflettere l'origine
  // della richiesta è sicuro e semplifica il deploy.
  app.use(cors({ origin: true, credentials: true }));

  // Le tracce GPS aggregate possono essere corpose (migliaia di punti): 8mb.
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Rate limit globale morbido (anti-abuso); i limiti stringenti sono sulle
  // singole rotte sensibili (login/registrazione/telemetria live).
  app.use('/api', globalLimiter);

  // Logger minimale in sviluppo
  if (!config.isProd()) {
    app.use((req, _res, next) => {
      console.log(`${req.method} ${req.url}`);
      next();
    });
  }

  // API
  app.use('/api', apiRouter);

  // File statici (frontend PWA + upload). Il service worker deve poter essere
  // servito dalla root con scope massimo.
  app.use(
    express.static(config.paths.public, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/');
        }
      },
    })
  );

  // 404 per le API
  app.use(notFoundHandler);

  // Fallback: per rotte non-API serve index.html (permette link diretti/SPA).
  // NON serviamo l'app per richieste di asset (path con estensione): un file
  // mancante deve dare 404, così <img> rotte scatenano l'onerror di fallback.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path)) {
      return res.status(404).type('txt').send('Not found');
    }
    res.sendFile(path.join(config.paths.public, 'index.html'));
  });

  // Gestione errori
  app.use(errorHandler);

  return app;
}

export default createApp;
