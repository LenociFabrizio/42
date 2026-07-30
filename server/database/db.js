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
  // Esempio di pattern (aggiungere colonna se mancante):
  // const cols = await db.all('PRAGMA table_info(users)');
  // if (!cols.some((c) => c.name === 'nuova_colonna')) {
  //   await db.run("ALTER TABLE users ADD COLUMN nuova_colonna TEXT DEFAULT ''");
  // }
}

export default db;
