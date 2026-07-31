# Sicurezza — 4 &amp; | 2

Sintesi delle misure implementate. Principio guida: **mai fidarsi del client**.

## Autenticazione & autorizzazione
- Password con hash **bcrypt** (cost 10). Mai in chiaro, mai restituite (`sanitizeUser` rimuove `password_hash`).
- Sessioni via **JWT** firmati (`JWT_SECRET`, scadenza configurabile). Middleware `requireAuth` / `optionalAuth` / `requireAdmin` / `requireLevel`.
- La **Live Map** richiede sempre consenso esplicito (`live_enabled`, revocabile in un tocco) ed è uno **scambio alla pari**: chi non condivide non riceve posizioni. Il livello 5 non serve a condividere con gli **amici**: gate solo per essere visibili agli **sconosciuti** (visibilità `public`).

## Validazione input
- Ogni endpoint valida e normalizza i dati con `server/utils/validate.js` (stringhe con min/max, email, nickname whitelist `[a-zA-Z0-9._-]`, interi/float con range, coordinate lat/lng, enum `oneOf`, date ISO, tracce GPS con limite di punti). Errori → `400` con messaggio chiaro.
- Le tracce GPS sono limitate nel numero di punti (anti-abuso) e semplificate/filtrate lato server.

## Anti-injection / XSS / CSRF
- **SQL injection**: tutte le query usano statement **parametrizzati** (`?`), mai concatenazione di input.
- **XSS**: il client usa `textContent`/`el()` e una funzione `esc()` per l'HTML; **Content-Security-Policy** via Helmet limita gli origini di script/stili/immagini/connessioni (CDN MapLibre, tiles CARTO/OSM, Google Fonts).
- **CSRF**: l'auth è **Bearer token** in header (non cookie di sessione ambientale), quindi non soggetta a CSRF classico; CORS riflette l'origine con credenziali limitate.
- Header di sicurezza (HSTS, noSniff, frameguard, referrer-policy, ecc.) via Helmet.

## Upload immagini
- Solo tipi raster in whitelist (`image/jpeg|png|webp|gif`), limite di dimensione lato multer, nomi di file rigenerati (mai quello scelto dall'utente). **SVG rifiutato**: è un documento che può contenere script, e come immagine di profilo non serve.
- In produzione i file vanno su **Vercel Blob** (dominio separato dall'app): nessuna scrittura sul filesystem della funzione. La foto sostituita e quella di un account eliminato vengono **cancellate** dallo storage.

## Rate limiting
- Globale morbido su `/api`. Stringente su login/registrazione (anti brute-force). Limitatori dedicati su scritture e aggiornamenti di posizione live.

## Privacy & dati GPS
- Visibilità profilo e posizione configurabili (`public` / `friends` / `private`). La `GET /live/nearby` filtra ogni utente secondo la **sua** `location_visibility` e verifica l'amicizia lato server.
- Il filtro di viewport (`bbox`) della `GET /live/nearby` vale **solo per gli sconosciuti** (che devono anche essere `public` e di livello ≥ 5). Gli **amici** che condividono arrivano sempre: è una scelta di prodotto (due amici lontani devono potersi vedere), non un allentamento del consenso.
- **Reciprocità**: chi non condivide non vede. Con `live_enabled = 0` la `GET /live/nearby` non restituisce nessuna coordinata, solo `friends_live` (quanti amici sono in strada) — la stessa informazione della lista amici, che non è una posizione. Niente osservatori invisibili: spegnere la condivisione fa sparire da entrambe le parti.
- Le posizioni live mostrano solo campioni recenti (`LIVE_STALE_SECONDS`, 3 minuti) e solo di utenti con condivisione attiva. Disattivando la condivisione le coordinate vengono **cancellate**, non solo nascoste (unica UPDATE condivisa da `PUT /live/settings` e `POST /live/stop`, così i due percorsi non possono divergere).
- Il check-in agli eventi verifica la distanza dal raggio **lato server** (haversine): il client non può auto-dichiararsi presente.
- Lo sblocco delle **Aree** (regioni) è deciso dal server: il client invia solo `{lat,lng}` a `POST /regions/visit` e il punto viene confrontato coi confini reali. L'**area di partenza** si imposta una volta sola (cambiarla equivarrebbe a regalarsi aree senza viaggiare) e il catalogo pubblico (`/regions/catalog`) espone soltanto nomi di regioni italiane.
- I contenuti delle aree **non ancora scoperte non lasciano il server**: `GET /routes` e `GET /events` filtrano in SQL sulle aree dell'utente (`services/areaAccess.js`), non si limitano a nasconderli lato client. Eccezioni volute: i propri contenuti, gli eventi a cui si è iscritti e quelli riservati al proprio club. Il dettaglio per id resta raggiungibile, così inviti e notifiche continuano a funzionare.
- **Eliminazione account** con conferma password → cancellazione a cascata di tutti i dati collegati.

## Note per la produzione (deploy futuro)
- Impostare un `JWT_SECRET` lungo e casuale, `NODE_ENV=production`.
- Configurare Turso (`DATABASE_URL`/`DATABASE_AUTH_TOKEN`) e Vercel Blob (`BLOB_READ_WRITE_TOKEN`).
- Valutare l'attivazione di `upgrade-insecure-requests` in CSP e HSTS preload a livello di hosting.
