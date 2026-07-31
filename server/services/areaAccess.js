/**
 * areaAccess.js
 * ------------------------------------------------------------
 * Le Aree non sono solo grafica: un percorso o un evento che sta in una regione
 * che non hai ancora conquistato NON si vede. Si scopre entrandoci — è il senso
 * del gioco, e il motivo per cui l'elenco lo filtra il SERVER: un filtro fatto
 * dal client sarebbe solo una tendina davanti a dati già consegnati.
 *
 * Ogni contenuto porta la sua area in colonna (`routes.region`, `events.region`),
 * calcolata dalle coordinate alla creazione: così il filtro è una condizione
 * indicizzata dentro la query, non una scansione geometrica per ogni riga.
 * ------------------------------------------------------------
 */
import { regionAt } from '../utils/regions.js';

/**
 * Codice dell'area in cui cade un punto, da salvare in colonna.
 * @returns {string} codice regione, oppure '' se fuori dall'Italia o senza
 *   coordinate valide — in quel caso il contenuto resta sempre visibile: meglio
 *   mostrare qualcosa in più che nascondere per un buco nella geometria.
 */
export function regionCodeAt(lat, lng) {
  return regionAt(lat, lng)?.code || '';
}

/**
 * Condizione SQL che limita i contenuti alle aree scoperte dall'utente.
 *
 * Restano visibili in ogni caso:
 *   - i contenuti fuori dall'Italia o senza area (`region` NULL o '');
 *   - i propri (li hai creati tu: nasconderli sarebbe assurdo);
 *   - tutto, se l'utente non ha ancora NESSUNA area (account creato prima delle
 *     Aree e che non ha ancora scelto quella di partenza): senza questa via di
 *     fuga si troverebbe l'app vuota, che è peggio del gioco non iniziato.
 *
 * @param {number} userId
 * @param {object} [opts]
 * @param {string} [opts.alias]  prefisso della tabella nella query (es. 'e')
 * @param {string} [opts.ownerCol] colonna del proprietario
 * @param {{sql: string, args: any[]}} [opts.extra] ulteriore condizione in OR
 *   (es. "sono iscritto all'evento"): sql e args viaggiano insieme, così l'ordine
 *   dei segnaposto resta corretto senza che il chiamante debba indovinarlo.
 * @returns {{sql: string, args: any[]}}
 */
export function areaGate(userId, { alias = '', ownerCol = 'creator_id', extra = null } = {}) {
  const p = alias ? `${alias}.` : '';
  const clauses = [
    `${p}region IS NULL`,
    `${p}region = ''`,
    `${p}${ownerCol} = ?`,
    'NOT EXISTS (SELECT 1 FROM user_regions ur0 WHERE ur0.user_id = ?)',
    `${p}region IN (SELECT ur.region FROM user_regions ur WHERE ur.user_id = ?)`,
  ];
  const args = [userId, userId, userId];
  if (extra?.sql) {
    clauses.push(extra.sql);
    args.push(...(extra.args || []));
  }
  return { sql: `(${clauses.join(' OR ')})`, args };
}

export default { regionCodeAt, areaGate };
