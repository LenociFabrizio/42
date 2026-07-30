/**
 * services/clubAccess.js
 * ------------------------------------------------------------
 * Helper di accesso ai club, usati da percorsi ed eventi per la
 * visibilità/creazione dei contenuti "solo club".
 *   - Admin del club = ruolo 'creator' o 'moderator'.
 *   - I contenuti riservati al club sono visibili a tutti i membri.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';

/** L'utente è admin (creatore o moderatore) del club? */
export async function isClubAdmin(clubId, userId) {
  if (!clubId || !userId) return false;
  const r = await db.prepare('SELECT role FROM club_members WHERE club_id = ? AND user_id = ?').get(clubId, userId);
  return !!r && (r.role === 'creator' || r.role === 'moderator');
}

/** L'utente è membro (a qualsiasi titolo) del club? */
export async function isClubMember(clubId, userId) {
  if (!clubId || !userId) return false;
  const r = await db.prepare('SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?').get(clubId, userId);
  return !!r;
}
