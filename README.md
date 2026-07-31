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

> In produzione l'app gira su **Vercel** (`api/index.js` + `vercel.json`) con database **Turso** e immagini su **Vercel Blob**. Vedi [Deploy e configurazione](#deploy-e-configurazione).

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
- `npm run build:regions` — rigenera la geometria delle Aree per il server.
- `npm run version:bump` — alza la versione mostrata nell'app.

---

## Deploy e configurazione

Variabili d'ambiente (in locale nel `.env`, in produzione su **Vercel →
Settings → Environment Variables**):

| Variabile | A cosa serve | Se manca |
| --- | --- | --- |
| `JWT_SECRET` | firma delle sessioni | in produzione va impostata lunga e casuale |
| `DATABASE_URL` / `DATABASE_AUTH_TOKEN` | Turso (`libsql://…`) | in locale si usa il file SQLite embedded |
| `BLOB_READ_WRITE_TOKEN` | upload immagini (foto profilo, foto percorsi/eventi) | in locale si scrive in `public/uploads/`; su Vercel l'upload risponde **503** con un messaggio esplicito, perché il filesystem è in sola lettura |
| `RESEND_API_KEY`, `MAIL_FROM`, `BUG_REPORT_TO` | invio email delle segnalazioni | la segnalazione resta solo a database |
| `GOOGLE_CLIENT_ID` | accesso con Google | il pulsante Google non compare |
| `ADMIN_EMAILS` | email (separate da virgola) promosse ad **admin**: sbloccano `/admin.html` | nessun amministratore, il pannello resta chiuso a tutti |

### Pannello sviluppatore (`/admin.html`)

Chi ha un'email in `ADMIN_EMAILS` diventa admin **al primo accesso** (e a ogni
avvio del server, per gli account già esistenti): non serve nessun comando sul
database. Da Impostazioni compare la scheda **Pannello**, con utenti (totali,
attivi, nuovi, in strada ora), iscrizioni degli ultimi 14 giorni, contenuti
creati, distribuzione per Area e le **segnalazioni di bug** — utili soprattutto
finché `RESEND_API_KEY` non è configurata, perché altrimenti nessuno le legge.

È tutto in **sola lettura**: un pannello che modifica o cancella va progettato
con conferme e tracciabilità, e per capire l'andamento i numeri bastano.

### Foto profilo (Vercel Blob)

1. Nel progetto Vercel: **Storage → Blob → Create** (il piano gratuito basta).
2. Collegando lo store al progetto, Vercel aggiunge da sé `BLOB_READ_WRITE_TOKEN`
   agli ambienti; in alternativa `vercel env add BLOB_READ_WRITE_TOKEN`.
3. **Ridistribuire**: le variabili d'ambiente vengono lette all'avvio della
   funzione, quindi un deploy già in corsa non le vede.
4. Verifica: `vercel env ls production` deve elencare `BLOB_READ_WRITE_TOKEN`.

Il ritaglio della foto avviene **nel browser** (`public/js/core/avatar-crop.js`):
parte un JPEG 512×512 di circa 100 KB. Non è solo estetica — una foto da
telefono pesa più del limite di richiesta di una funzione serverless (~4,5 MB) e
verrebbe respinta. Sostituendo la foto, la precedente viene **cancellata** dallo
storage (come alla cancellazione dell'account): il piano gratuito non va sprecato
in file che nessuno vede più.

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
api/index.js         # adapter serverless (Vercel)
public/
  index.html         # home mappa
  *.html             # pagine (login, register, record, routes, route, events,
                     # event, event-create, clubs, club, friends, profile, admin,
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
- **Record**: il **record ufficiale appartiene sempre al creatore** del percorso; ogni altro utente conserva il **miglior tempo personale** e può scalare la classifica dei tempi, ma non sostituisce il record principale (chi batte il tempo del creatore lo "sfida" con una notifica). Un tempo entra in classifica solo se è un **giro vero**: il cronometro si avvia soltanto entro `ATTEMPT_GATE_RADIUS_M` (100 m) dalla **partenza**, si ferma **da sé** sul traguardo e il server ricontrolla tutto sul tracciato (primi/ultimi punti dentro i cancelletti, almeno il 70 % del percorso coperto, tempo ricavato dai timestamp GPS — mai dal client).
- **Evento**: data/ora, durata, max partecipanti, percorso associato, **area + raggio**; la presenza si conferma con **check-in GPS** verificato lato server.
- **Club**: nome univoco, privacy, immagine, membri/ruoli (creatore/moderatore/membro), classifiche. **Nessun livello né XP di club**: i punti sono di chi guida, il club si misura con i membri e i chilometri che macinano.
- **Amicizie**: richiesta / accetta / rifiuta, presenza (online adesso oppure "offline da…", da `users.last_active` aggiornato a ogni richiesta autenticata) e avviso con suono quando un amico entra nell'app.
- **Aree**: le 20 regioni italiane. Alla registrazione si scegli l'**area di partenza** (già scoperta, non più modificabile); le altre restano **zone interdette** sulla mappa (velo scuro, strisce diagonali disegnate in codice, bordo tratteggiato e cartello col lucchetto al centro della regione) e si sbloccano **solo entrandoci davvero**. L'area non è solo grafica: **percorsi ed eventi di una regione non conquistata non vengono nemmeno inviati al client** (`routes.region` / `events.region` + filtro in `services/areaAccess.js`). Restano visibili i propri contenuti, gli eventi a cui sei iscritto e quelli riservati al tuo club — sono inviti, non scoperte — la corrispondenza punto → regione è calcolata **lato server** su `server/utils/regionsGeo.js` (generato da `public/data/italy-regions.geojson` con `npm run build:regions`). Ogni sblocco dà XP, avanza la missione "Cacciatore di Aree" e i distintivi da *Oltre il Confine* a *Stivale Completo*.
- **Gamification**: XP da attività reale, curva livelli, badge, missioni (giornaliere/settimanali/obiettivi), streak. **Mai pay-to-win.**
- **Live Map** multiplayer: opt-in con un tocco sul tasto della mappa (`live_enabled`); gli **amici** si vedono sempre, anche lontani, mentre agli **sconosciuti** si appare solo con visibilità `public` e dal **livello 5**. È uno **scambio alla pari**: chi spegne sparisce dalla mappa degli altri e loro dalla sua (resta solo il numero di amici in strada, come invito a riaccendere).

Dettagli sicurezza in [`SECURITY.md`](./SECURITY.md).

---

## API (panoramica)

`/api/auth` · `/api/users` · `/api/routes` · `/api/events` · `/api/clubs` · `/api/friends` · `/api/gamification` · `/api/notifications` · `/api/live` · `/api/regions` · `/api/admin` · `/api/pois` · `/api/settings` · `/api/feedback` · `/api/config` · `/api/health`

Tutte le rotte protette usano `Authorization: Bearer <jwt>`. Le risposte d'errore hanno forma `{ "error": "messaggio" }`.

---

## Segnalazioni di bug (email)

Impostazioni → **Assistenza → Segnala un bug**: il messaggio viene salvato in
`bug_reports` e inviato per email, **senza aprire un client di posta**.

L'invio usa l'API HTTP di [Resend](https://resend.com) (piano gratuito, nessuna
dipendenza SMTP). Nel `.env`:

```
RESEND_API_KEY=re_...                       # se manca, l'invio è disattivato
MAIL_FROM=4 e 2 <onboarding@resend.dev>     # mittente verificato su Resend
BUG_REPORT_TO=youfusion945@gmail.com        # destinatario delle segnalazioni
```

Senza `RESEND_API_KEY` nulla va perso: la segnalazione resta a database e il
client risponde "registrata" invece di "inviata". In produzione va aggiunta
anche tra le Environment Variables dell'hosting.
