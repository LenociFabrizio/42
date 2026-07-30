# 4 &amp; | 2 — Community su 4 e/o 2 ruote 🏍️🚗

Piattaforma (PWA mobile-first) per **motociclisti, automobilisti e viaggiatori**: crea e registra **percorsi** via GPS, sfida i **record**, organizza **eventi live** con check-in geolocalizzato, fonda **club**, stringi **amicizie**, scala le **classifiche** e sblocca **badge** con un sistema XP coinvolgente. Home centrata sulla **mappa** con un grande pulsante **CREA**.

> Estetica: strumentazione analogica automotive — nero profondo, altissimo contrasto (leggibile sotto il sole), un accento ambra "luce quadrante" + rosso "redline". Dark mode come tema principale.

---

## Stack

- **Backend**: Node.js (ESM) + Express — architettura a livelli `routes → controllers → services → db`.
- **Database**: libSQL (SQLite-compatibile) via `@libsql/client`. In locale un file embedded; in produzione Turso (`libsql://…`) — **gratuito**.
- **Auth**: JWT (`jsonwebtoken`) + `bcryptjs`.
- **Sicurezza**: `helmet` + CSP calibrata, `express-rate-limit`, validazione input server-side su ogni endpoint.
- **Frontend**: vanilla ESM (nessun build step), multi-pagina. Core condiviso in `public/js/core/`.
- **Mappe**: MapLibre GL JS (CDN) + tiles raster CARTO dark (gratis, senza chiave).
- **PWA**: `manifest.webmanifest` + service worker (`sw.js`) con app shell offline.
- **Upload**: `multer` in memoria → Vercel Blob in produzione, `public/uploads/` in locale.

> Il **deployment** (Vercel / dominio / CI-CD / hosting) è **volutamente rimandato**: qui ci si concentra su progettazione e sviluppo della WebApp. Lo scaffold serverless (`api/index.js`, `vercel.json`) è predisposto ma non attivato.

---

## Avvio rapido

```bash
npm install
cp .env.example .env        # personalizza JWT_SECRET ecc.
npm run seed                # crea schema + badge + missioni + dati demo
npm run dev                 # server con --watch su http://localhost:3000
```

Apri **http://localhost:3000**. Utente demo: **demo@4e2.app / password123**.

Script:
- `npm run dev` — server in sviluppo (auto-reload).
- `npm start` — server in produzione.
- `npm run seed` — popolamento idempotente.
- `npm run db:reset` — azzera i dati e ripopola.

---

## Struttura

```
server/
  app.js            # Express: sicurezza, compressione, static, API, errori
  index.js          # avvio locale
  config/config.js  # configurazione centralizzata (.env)
  database/
    db.js           # facade async libSQL + initSchema/migrazioni
    schema.sql      # schema completo (idempotente)
    seed.js         # badge, missioni, dati demo
  middleware/        # auth, upload, error, rateLimit, security(CSP)
  utils/             # helpers, jwt, geo, levels, validate, constants
  services/          # gamification (XP/badge/missioni/streak), routeService
                     # (record/PB), stats, notifications
  controllers/       # un controller per dominio
  routes/            # un router per dominio (montati in routes/index.js)
api/index.js         # adapter serverless (deploy futuro)
public/
  index.html         # home mappa
  *.html             # pagine (login, register, record, routes, route, events,
                     # event, event-create, clubs, club, friends, profile,
                     # notifications, settings)
  css/               # variables, base, layout, components, animations
  js/core/           # api, auth, ui, icons, map, geo, gamification, shell,
                     # constants, theme, pwa
  js/pages/          # uno script per pagina
  manifest.webmanifest, sw.js, offline.html, icons/
```

---

## Modello di dominio (sintesi)

- **Utente**: nickname univoco, email, avatar, bio, livello/XP, statistiche (km, tempo, percorsi, record, eventi), streak, veicoli (auto/moto), impostazioni, posizione live opt-in.
- **Percorso**: nome, descrizione, foto, categoria, difficoltà, tipo veicolo, estremi, tracciato (polyline), distanza/dislivello/tempo, privacy, tag.
- **Record**: il **record ufficiale appartiene sempre al creatore** del percorso; ogni altro utente conserva il **miglior tempo personale** e può scalare la classifica dei tempi, ma non sostituisce il record principale (chi batte il tempo del creatore lo "sfida" con una notifica).
- **Evento**: data/ora, durata, max partecipanti, percorso associato, **area + raggio**; la presenza si conferma con **check-in GPS** verificato lato server.
- **Club**: nome univoco, privacy, membri/ruoli (creatore/moderatore/membro), livello/XP, classifiche.
- **Amicizie**: richiesta / accetta / rifiuta, stato online.
- **Gamification**: XP da attività reale, curva livelli, badge, missioni (giornaliere/settimanali/obiettivi), streak. **Mai pay-to-win.**
- **Live Map** multiplayer: opt-in, visibile secondo privacy, sbloccata dal **livello 5**.

Dettagli sicurezza in [`SECURITY.md`](./SECURITY.md).

---

## API (panoramica)

`/api/auth` · `/api/users` · `/api/routes` · `/api/events` · `/api/clubs` · `/api/friends` · `/api/gamification` · `/api/notifications` · `/api/live` · `/api/pois` · `/api/settings` · `/api/config` · `/api/health`

Tutte le rotte protette usano `Authorization: Bearer <jwt>`. Le risposte d'errore hanno forma `{ "error": "messaggio" }`.
