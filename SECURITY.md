# Sicurezza — 4 &amp; | 2

Sintesi delle misure implementate. Principio guida: **mai fidarsi del client**.

## Autenticazione & autorizzazione
- Password con hash **bcrypt** (cost 10). Mai in chiaro, mai restituite (`sanitizeUser` rimuove `password_hash`).
- Sessioni via **JWT** firmati (`JWT_SECRET`, scadenza configurabile). Middleware `requireAuth` / `optionalAuth` / `requireAdmin` / `requireLevel`.
- La **Live Map** è gated dal livello 5 (`requireLevel`) e richiede consenso esplicito (`live_enabled`).

## Validazione input
- Ogni endpoint valida e normalizza i dati con `server/utils/validate.js` (stringhe con min/max, email, nickname whitelist `[a-zA-Z0-9._-]`, interi/float con range, coordinate lat/lng, enum `oneOf`, date ISO, tracce GPS con limite di punti). Errori → `400` con messaggio chiaro.
- Le tracce GPS sono limitate nel numero di punti (anti-abuso) e semplificate/filtrate lato server.

## Anti-injection / XSS / CSRF
- **SQL injection**: tutte le query usano statement **parametrizzati** (`?`), mai concatenazione di input.
- **XSS**: il client usa `textContent`/`el()` e una funzione `esc()` per l'HTML; **Content-Security-Policy** via Helmet limita gli origini di script/stili/immagini/connessioni (CDN MapLibre, tiles CARTO/OSM, Google Fonts).
- **CSRF**: l'auth è **Bearer token** in header (non cookie di sessione ambientale), quindi non soggetta a CSRF classico; CORS riflette l'origine con credenziali limitate.
- Header di sicurezza (HSTS, noSniff, frameguard, referrer-policy, ecc.) via Helmet.

## Rate limiting
- Globale morbido su `/api`. Stringente su login/registrazione (anti brute-force). Limitatori dedicati su scritture e aggiornamenti di posizione live.

## Privacy & dati GPS
- Visibilità profilo e posizione configurabili (`public` / `friends` / `private`). La `GET /live/nearby` filtra ogni utente secondo la **sua** `location_visibility` e verifica l'amicizia lato server.
- Le posizioni live mostrano solo campioni recenti (ultimi 5 minuti) e solo di utenti con condivisione attiva.
- Il check-in agli eventi verifica la distanza dal raggio **lato server** (haversine): il client non può auto-dichiararsi presente.
- **Eliminazione account** con conferma password → cancellazione a cascata di tutti i dati collegati.

## Note per la produzione (deploy futuro)
- Impostare un `JWT_SECRET` lungo e casuale, `NODE_ENV=production`.
- Configurare Turso (`DATABASE_URL`/`DATABASE_AUTH_TOKEN`) e Vercel Blob (`BLOB_READ_WRITE_TOKEN`).
- Valutare l'attivazione di `upgrade-insecure-requests` in CSP e HSTS preload a livello di hosting.
