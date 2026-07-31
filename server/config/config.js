/**
 * config.js
 * ------------------------------------------------------------
 * Configurazione centralizzata dell'applicazione.
 * Legge le variabili d'ambiente (file .env) e fornisce valori
 * di default sensati. Unico punto di verità per la configurazione.
 * ------------------------------------------------------------
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root del progetto (due livelli sopra /server/config)
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,

  jwt: {
    secret: process.env.JWT_SECRET || 'insecure-dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  db: {
    // libSQL/Turso. In locale un file embedded; in prod l'URL Turso (libsql://...).
    url: process.env.DATABASE_URL || 'file:server/database/quattroedue.db',
    authToken: process.env.DATABASE_AUTH_TOKEN || '',
  },

  paths: {
    root: ROOT_DIR,
    public: path.resolve(ROOT_DIR, 'public'),
    uploads: path.resolve(ROOT_DIR, 'public', 'uploads'),
  },

  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  // Accesso con Google (Google Identity Services). Il Client ID è pubblico:
  // viene esposto al client via /api/config. Se vuoto, il pulsante "Continua
  // con Google" non viene mostrato e l'endpoint /auth/google risponde 503.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  // Invio email (segnalazioni di bug) via API Resend. Senza apiKey l'invio è
  // disattivato: le segnalazioni restano salvate a database.
  mail: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || '4 e 2 <onboarding@resend.dev>',
    bugReportTo: process.env.BUG_REPORT_TO || 'youfusion945@gmail.com',
  },

  // Configurazione mappa esposta al client via /api/config.
  // Di default: tiles raster CARTO dark (gratuiti, nessuna chiave richiesta).
  map: {
    styleUrl: process.env.MAP_STYLE_URL || '',
    tileKey: process.env.MAP_TILE_KEY || '',
  },

  isProd() {
    return this.env === 'production';
  },
};

export default config;
