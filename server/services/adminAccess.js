/**
 * adminAccess.js
 * ------------------------------------------------------------
 * Chi è amministratore lo dice la variabile d'ambiente ADMIN_EMAILS.
 *
 * L'allineamento avviene in due momenti, e servono entrambi:
 *   - all'avvio del server (database/db.js), che copre gli account già esistenti;
 *   - al momento dell'accesso (qui), perché in ambiente serverless un riavvio
 *     non si può ordinare: senza questo passo, aggiungere un'email alla
 *     variabile non avrebbe effetto fino al prossimo avvio a freddo, chissà
 *     quando. Così basta rientrare nell'app.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { config } from '../config/config.js';
import { ROLES } from '../utils/constants.js';

/** L'email è tra quelle dichiarate amministratrici? */
export function isAdminEmail(email) {
  if (!email) return false;
  return config.adminEmails.includes(String(email).trim().toLowerCase());
}

/**
 * Promuove l'utente ad admin se la sua email è in elenco.
 * @param {object} user riga utente
 * @returns {Promise<object>} l'utente, col ruolo aggiornato se è cambiato
 */
export async function promoteIfAdmin(user) {
  if (!user || user.role === ROLES.ADMIN || !isAdminEmail(user.email)) return user;
  await db.prepare("UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE id = ?").run(user.id);
  return { ...user, role: ROLES.ADMIN };
}

export default { isAdminEmail, promoteIfAdmin };
