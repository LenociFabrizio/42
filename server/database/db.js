/**
 * db.js
 * ------------------------------------------------------------
 * Connessione al database e inizializzazione dello schema.
 *
 * DATA LAYER ASTRATTO (async): tutta l'app usa `db` da questo file.
 * Il motore è libSQL (@libsql/client), compatibile SQLite:
 *   - in locale usa un file embedded  (url `file:...`)
 *   - in produzione (Vercel) usa Turso (url `libsql://...` + authToken)
 *
 * La facade replica l'interfaccia sincrona di better-sqlite3
 * (`prepare(sql).get/all/run(...)`) ma è ASINCRONA: i consumer
 * devono usare `await`.
 * ------------------------------------------------------------
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Per il file locale, assicura che la cartella esista (url tipo "file:server/database/x.db")
if (config.db.url.startsWith('file:')) {
  const filePath = config.db.url.slice('file:'.length);
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(config.paths.root, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
}

const client = createClient({
  url: config.db.url,
  authToken: config.db.authToken || undefined,
});

/* --- Utility di conversione --- */
const rowToObj = (row, cols) => {
  const o = {};
  for (const c of cols) o[c] = row[c];
  return o;
};

// Accetta sia varargs posizionali (?) sia un oggetto (@name).
const normArgs = (params) =>
  params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])
    ? params[0]
    : params;

const mapRun = (rs) => ({
  lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : undefined,
  changes: rs.rowsAffected,
});

/**
 * Facade asincrona sul client libSQL.
 */
export const db = {
  async get(sql, ...params) {
    const rs = await client.execute({ sql, args: normArgs(params) });
    return rs.rows[0] ? rowToObj(rs.rows[0], rs.columns) : undefined;
  },
  async all(sql, ...params) {
    const rs = await client.execute({ sql, args: normArgs(params) });
    return rs.rows.map((r) => rowToObj(r, rs.columns));
  },
  async run(sql, ...params) {
    return mapRun(await client.execute({ sql, args: normArgs(params) }));
  },
  /** Statement "preparato" (lazy): stessa forma di better-sqlite3 ma async. */
  prepare(sql) {
    return {
      get: (...a) => db.get(sql, ...a),
      all: (...a) => db.all(sql, ...a),
      run: (...a) => db.run(sql, ...a),
    };
  },
  /** Esegue più statement separati da ';' (usato per lo schema). */
  async exec(sql) {
    await client.executeMultiple(sql);
  },
  /** Batch atomico. mode: 'write' | 'read' | 'deferred'. */
  async batch(statements, mode = 'write') {
    return client.batch(statements, mode);
  },
  /** Accesso diretto al client (per batch/transazioni avanzate). */
  raw: client,
};

/**
 * Inizializza lo schema eseguendo schema.sql (idempotente grazie a IF NOT EXISTS).
 * NON è chiamata automaticamente: la invocano server/index.js (dev),
 * api/index.js (prod) e seed.js.
 */
export async function initSchema() {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await db.exec(schema);
  await runMigrations();
  // Popola il catalogo gamification (badge/missioni) se assente: così anche un
  // DB nuovo in produzione è subito funzionale, senza seed manuale.
  const { ensureCatalog } = await import('./catalog.js');
  await ensureCatalog(db);
}

/**
 * Migrazioni idempotenti per DB già esistenti (aggiunge colonne mancanti).
 * Il progetto è recente: qui teniamo il punto di estensione per evoluzioni
 * future dello schema senza perdere dati.
 */
async function runMigrations() {
  // Visibilità "solo club" per percorsi ed eventi.
  const routeCols = await db.all('PRAGMA table_info(routes)');
  if (routeCols.length && !routeCols.some((c) => c.name === 'club_id')) {
    await db.run('ALTER TABLE routes ADD COLUMN club_id INTEGER');
  }
  const eventCols = await db.all('PRAGMA table_info(events)');
  if (eventCols.length && !eventCols.some((c) => c.name === 'privacy')) {
    await db.run("ALTER TABLE events ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public'");
  }
  if (eventCols.length && !eventCols.some((c) => c.name === 'club_id')) {
    await db.run('ALTER TABLE events ADD COLUMN club_id INTEGER');
  }

  // Area (regione) di percorsi ed eventi: decide a chi sono visibili. I
  // contenuti già a database non ce l'hanno, quindi la si ricava dalle loro
  // coordinate una volta sola (vedi backfillRegions).
  if (routeCols.length && !routeCols.some((c) => c.name === 'region')) {
    await db.run('ALTER TABLE routes ADD COLUMN region TEXT');
  }
  if (eventCols.length && !eventCols.some((c) => c.name === 'region')) {
    await db.run('ALTER TABLE events ADD COLUMN region TEXT');
  }
  // Gli indici stanno qui e non in schema.sql: su un database già esistente la
  // colonna nasce dall'ALTER TABLE appena eseguito, mentre schema.sql gira prima.
  await db.run('CREATE INDEX IF NOT EXISTS idx_routes_region ON routes(region)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_events_region ON events(region)');
  await backfillRegions();
  await promoteAdmins();

  // Accesso con Google + stato della sessione live (da quando è online e con
  // quale veicolo sta guidando: mostrati nel popup della live map).
  const userCols = await db.all('PRAGMA table_info(users)');
  const hasUserCol = (name) => userCols.some((c) => c.name === name);
  if (userCols.length && !hasUserCol('google_id')) {
    await db.run('ALTER TABLE users ADD COLUMN google_id TEXT');
    await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id)');
  }
  if (userCols.length && !hasUserCol('live_since')) {
    await db.run('ALTER TABLE users ADD COLUMN live_since TEXT');
  }
  if (userCols.length && !hasUserCol('live_vehicle_id')) {
    await db.run('ALTER TABLE users ADD COLUMN live_vehicle_id INTEGER');
  }
  // Presenza nell'app (vedi middleware/auth.js): "online" e "offline da quanto"
  // nella lista amici non dipendono più dalla condivisione live.
  if (userCols.length && !hasUserCol('last_active')) {
    await db.run('ALTER TABLE users ADD COLUMN last_active TEXT');
  }
  // Aree di gioco: area di partenza (regione italiana). Nullable di proposito —
  // gli account creati prima di questa funzione restano validi e l'app chiede
  // loro di scegliere l'area alla prima apertura della mappa.
  if (userCols.length && !hasUserCol('region')) {
    await db.run('ALTER TABLE users ADD COLUMN region TEXT');
  }

  // Preferenze di navigazione (evita pedaggi, autostrade, ZTL, traghetti).
  const setCols = await db.all('PRAGMA table_info(user_settings)');
  const NAV_COLS = [
    ['nav_avoid_tolls', 'INTEGER NOT NULL DEFAULT 0'],
    ['nav_avoid_motorways', 'INTEGER NOT NULL DEFAULT 0'],
    ['nav_avoid_ztl', 'INTEGER NOT NULL DEFAULT 0'],
    ['nav_avoid_ferries', 'INTEGER NOT NULL DEFAULT 0'],
    ['nav_profile', "TEXT NOT NULL DEFAULT 'auto'"],
    // Raggio di visibilità iniziale della mappa (km).
    ['map_radius_km', 'INTEGER NOT NULL DEFAULT 5'],
  ];
  if (setCols.length) {
    for (const [name, decl] of NAV_COLS) {
      if (!setCols.some((c) => c.name === name)) {
        await db.run(`ALTER TABLE user_settings ADD COLUMN ${name} ${decl}`);
      }
    }
  }
}

/**
 * Promuove ad amministratore gli account elencati in ADMIN_EMAILS (separati da
 * virgola). Sta in una variabile d'ambiente e non nel codice per due motivi: un
 * indirizzo personale non finisce in un repository pubblico, e l'elenco si
 * cambia senza toccare il sorgente.
 *
 * Gira a ogni avvio: se l'account non esiste ancora (o si registrerà con
 * Google), la promozione scatta al primo avvio utile senza bisogno di comandi.
 */
async function promoteAdmins() {
  for (const email of config.adminEmails) {
    try {
      const info = await db
        .prepare("UPDATE users SET role = 'admin' WHERE lower(email) = ? AND role != 'admin'")
        .run(email);
      if (info?.changes) console.log(`[db] ${email} è ora amministratore`);
    } catch { /* utente non ancora registrato: si riprova al prossimo avvio */ }
  }
}

/**
 * Assegna l'area a percorsi ed eventi che non l'hanno ancora (contenuti creati
 * prima delle Aree). Gira a ogni avvio ma tocca solo le righe con `region` NULL:
 * dopo il primo giro non ce ne sono più, perché anche "fuori dall'Italia" viene
 * scritto — come stringa vuota — invece di restare NULL. Senza quella
 * distinzione i punti fuori confine verrebbero ricalcolati per sempre.
 */
async function backfillRegions() {
  // Import dinamico: la geometria delle regioni è un modulo grosso e la
  // migrazione è l'unico punto del boot che ne ha bisogno.
  const { regionCodeAt } = await import('../services/areaAccess.js');
  const jobs = [
    { table: 'routes', lat: 'start_lat', lng: 'start_lng' },
    { table: 'events', lat: 'area_lat', lng: 'area_lng' },
  ];
  for (const j of jobs) {
    let rows = [];
    try {
      rows = await db.all(`SELECT id, ${j.lat} AS lat, ${j.lng} AS lng FROM ${j.table} WHERE region IS NULL`);
    } catch { continue; } // tabella o colonna non ancora presenti
    for (const r of rows) {
      await db
        .prepare(`UPDATE ${j.table} SET region = ? WHERE id = ?`)
        .run(regionCodeAt(r.lat, r.lng), r.id);
    }
    if (rows.length) console.log(`[db] area assegnata a ${rows.length} ${j.table}`);
  }
}

export default db;
