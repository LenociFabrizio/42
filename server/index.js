/**
 * index.js
 * ------------------------------------------------------------
 * Entry point del server (esecuzione locale/standalone).
 * Inizializza lo schema del DB e avvia Express sulla porta configurata.
 * (Su Vercel l'app è servita da api/index.js come serverless function.)
 * ------------------------------------------------------------
 */
import { initSchema } from './database/db.js';
import { createApp } from './app.js';
import { config } from './config/config.js';

async function main() {
  await initSchema(); // crea le tabelle se non esistono
  const app = createApp();

  app.listen(config.port, () => {
    console.log('');
    console.log('  🏍️  4 & | 2  🚗');
    console.log('  ────────────────────────────────────────');
    console.log(`  Server attivo su: http://localhost:${config.port}`);
    console.log(`  Ambiente:         ${config.env}`);
    console.log(`  Database:         ${config.db.url}`);
    console.log('  ────────────────────────────────────────');
    console.log('  Suggerimento: esegui "npm run seed" per i dati demo.');
    console.log('');
  });
}

main().catch((err) => {
  console.error('Avvio fallito:', err);
  process.exit(1);
});
