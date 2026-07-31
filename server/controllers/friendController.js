/**
 * friendController.js
 * ------------------------------------------------------------
 * Sistema di amicizie: invio/accettazione/rifiuto richieste, elenco
 * amici, richieste in sospeso e presenza "online" (basata su
 * users.last_active, aggiornato a ogni richiesta autenticata; per i dati
 * storici vale anche users.last_seen). Ogni amicizia accettata assegna XP social a
 * ENTRAMBI gli utenti e rivaluta i badge (gamification social).
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { FRIEND_STATUS, XP } from '../utils/constants.js';
import { awardXp, checkBadges } from '../services/gamification.js';
import { notify } from '../services/notifications.js';

// Finestra di presenza: un utente è "online" se attivo negli ultimi 5 minuti.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Interpreta un timestamp del DB ("YYYY-MM-DD HH:MM:SS", UTC) o una stringa
 * ISO. SQLite non mette la "Z": senza aggiungerla il valore verrebbe letto
 * come ora locale del server. Ritorna NaN se non valido.
 */
function dbTime(value) {
  if (!value) return NaN;
  const s = String(value).trim();
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s);
  return Date.parse(naive ? `${s.replace(' ', 'T')}Z` : s);
}

/**
 * Ultimo istante di presenza: l'attività nell'app (last_active) e, per
 * retrocompatibilità con i dati già raccolti, l'ultimo ping live (last_seen).
 * @returns {string|null} il più recente dei due, o null.
 */
function lastPresence(u) {
  const a = dbTime(u.last_active);
  const b = dbTime(u.last_seen);
  if (Number.isNaN(a)) return Number.isNaN(b) ? null : u.last_seen;
  if (Number.isNaN(b)) return u.last_active;
  return a >= b ? u.last_active : u.last_seen;
}

/** Vero se l'istante di presenza cade entro la finestra "online". */
function isOnline(value) {
  const t = dbTime(value);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= ONLINE_WINDOW_MS;
}

/**
 * Arricchisce una riga amico con la presenza per la UI:
 * `online` e `last_active` (l'istante da cui calcolare "offline da…").
 */
function withPresence(u) {
  const last = lastPresence(u);
  return { ...u, last_active: last, online: isOnline(last) };
}

/**
 * Trova l'amicizia tra due utenti in QUALSIASI direzione, indipendentemente
 * dallo stato. Ritorna la riga friendships o undefined.
 */
async function friendshipBetween(aId, bId) {
  return db
    .prepare(
      `SELECT * FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(aId, bId, bId, aId);
}

/**
 * Proiezione degli amici ACCETTATI di `userId` (l'altro capo dell'amicizia,
 * in entrambe le direzioni) con i campi utili alla UI + last_seen.
 */
async function acceptedFriends(userId) {
  return db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, u.level, u.last_seen, u.last_active
         FROM friendships f
         JOIN users u
           ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.status = ? AND (f.requester_id = ? OR f.addressee_id = ?)`
    )
    .all(userId, FRIEND_STATUS.ACCEPTED, userId, userId);
}

/**
 * Porta un'amicizia pendente allo stato "accepted": aggiorna la riga,
 * assegna XP social a entrambi, rivaluta i badge e notifica il richiedente.
 * `accepter` è il record utente che accetta (il destinatario della richiesta).
 * @returns la riga friendships aggiornata.
 */
async function acceptFriendship(friendship, accepter) {
  await db
    .prepare("UPDATE friendships SET status = ?, responded_at = datetime('now') WHERE id = ?")
    .run(FRIEND_STATUS.ACCEPTED, friendship.id);

  const requesterId = friendship.requester_id;
  const addresseeId = friendship.addressee_id;

  // XP social a entrambi + rivalutazione badge ("first_friend", "social_butterfly").
  await awardXp(requesterId, XP.ADD_FRIEND, 'friend_added', 'user', addresseeId);
  await awardXp(addresseeId, XP.ADD_FRIEND, 'friend_added', 'user', requesterId);
  await checkBadges(requesterId);
  await checkBadges(addresseeId);

  // Notifica il richiedente che la sua richiesta è stata accettata.
  await notify(
    requesterId,
    'friend_accepted',
    `${accepter.nickname} ha accettato la tua richiesta`,
    '',
    { friendship_id: friendship.id, from_user_id: addresseeId }
  );

  return db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendship.id);
}

/** GET /api/friends — i miei amici accettati, ordinati online DESC poi nickname. */
export const listFriends = asyncHandler(async (req, res) => {
  const rows = await acceptedFriends(req.user.id);
  const friends = rows
    .map(withPresence)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname));
  res.json({ friends });
});

/** GET /api/friends/online — solo gli amici attualmente online (ordinati per nickname). */
export const listOnline = asyncHandler(async (req, res) => {
  const rows = await acceptedFriends(req.user.id);
  const friends = rows
    .map(withPresence)
    .filter((u) => u.online)
    .sort((a, b) => a.nickname.localeCompare(b.nickname));
  res.json({ friends });
});

/** GET /api/friends/requests — richieste in sospeso, in entrata e in uscita. */
export const listRequests = asyncHandler(async (req, res) => {
  const me = req.user.id;

  const incomingRows = await db
    .prepare(
      `SELECT f.id, f.created_at, u.id AS user_id, u.nickname, u.avatar, u.level
         FROM friendships f JOIN users u ON u.id = f.requester_id
        WHERE f.addressee_id = ? AND f.status = ? ORDER BY f.created_at DESC`
    )
    .all(me, FRIEND_STATUS.PENDING);

  const outgoingRows = await db
    .prepare(
      `SELECT f.id, f.created_at, u.id AS user_id, u.nickname, u.avatar, u.level
         FROM friendships f JOIN users u ON u.id = f.addressee_id
        WHERE f.requester_id = ? AND f.status = ? ORDER BY f.created_at DESC`
    )
    .all(me, FRIEND_STATUS.PENDING);

  const incoming = incomingRows.map((r) => ({
    id: r.id,
    from: { id: r.user_id, nickname: r.nickname, avatar: r.avatar, level: r.level },
    created_at: r.created_at,
  }));
  const outgoing = outgoingRows.map((r) => ({
    id: r.id,
    to: { id: r.user_id, nickname: r.nickname, avatar: r.avatar, level: r.level },
    created_at: r.created_at,
  }));

  res.json({ incoming, outgoing });
});

/**
 * POST /api/friends/request — invia una richiesta di amicizia.
 * Body: { nickname } OPPURE { user_id }.
 */
export const sendRequest = asyncHandler(async (req, res) => {
  const me = req.user.id;

  // Risolvi l'utente destinatario da user_id o, in alternativa, dal nickname.
  let target;
  if (req.body.user_id !== undefined && req.body.user_id !== null && req.body.user_id !== '') {
    const uid = v.int(req.body.user_id, 'user_id', { min: 1 });
    target = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(uid);
  } else {
    const nick = v.nickname(req.body.nickname);
    target = await db.prepare('SELECT * FROM users WHERE nickname = ? AND is_active = 1').get(nick);
  }
  if (!target) throw new HttpError(404, 'Utente non trovato.');
  if (target.id === me) throw new HttpError(400, 'Non puoi aggiungere te stesso.');

  const existing = await friendshipBetween(me, target.id);
  if (existing) {
    if (existing.status === FRIEND_STATUS.ACCEPTED) throw new HttpError(409, 'Siete già amici.');
    if (existing.status === FRIEND_STATUS.PENDING) {
      // Se l'altro utente mi ha GIÀ inviato una richiesta pendente, la accettiamo
      // automaticamente (interesse reciproco): trattiamo il caso come un accept.
      if (existing.addressee_id === me) {
        const friendship = await acceptFriendship(existing, req.user);
        return res.status(201).json({ request: friendship });
      }
      throw new HttpError(409, 'Richiesta già in sospeso.');
    }
    // Stato 'declined'/'blocked': rimuoviamo la vecchia riga per ripartire pulito
    // (ed evitare il conflitto UNIQUE su una nuova INSERT nella stessa direzione).
    await db.prepare('DELETE FROM friendships WHERE id = ?').run(existing.id);
  }

  const info = await db
    .prepare('INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)')
    .run(me, target.id, FRIEND_STATUS.PENDING);
  const request = await db.prepare('SELECT * FROM friendships WHERE id = ?').get(info.lastInsertRowid);

  await notify(
    target.id,
    'friend_request',
    `${req.user.nickname} ti ha inviato una richiesta di amicizia`,
    '',
    { friendship_id: request.id, from_user_id: me }
  );

  res.status(201).json({ request });
});

/** POST /api/friends/:id/accept — accetta una richiesta ricevuta. */
export const acceptRequest = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const friendship = await db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
  if (!friendship || friendship.addressee_id !== req.user.id || friendship.status !== FRIEND_STATUS.PENDING) {
    throw new HttpError(404, 'Richiesta non trovata.');
  }
  const updated = await acceptFriendship(friendship, req.user);
  res.json({ friendship: updated });
});

/** POST /api/friends/:id/decline — rifiuta una richiesta ricevuta. */
export const declineRequest = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const friendship = await db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
  if (!friendship || friendship.addressee_id !== req.user.id || friendship.status !== FRIEND_STATUS.PENDING) {
    throw new HttpError(404, 'Richiesta non trovata.');
  }
  await db
    .prepare("UPDATE friendships SET status = ?, responded_at = datetime('now') WHERE id = ?")
    .run(FRIEND_STATUS.DECLINED, id);
  res.json({ ok: true });
});

/**
 * DELETE /api/friends/:id — rimuove un'amicizia oppure annulla una richiesta
 * in uscita. Consentito solo se sono il richiedente o il destinatario.
 */
export const removeFriend = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const friendship = await db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
  if (!friendship || (friendship.requester_id !== req.user.id && friendship.addressee_id !== req.user.id)) {
    throw new HttpError(404, 'Amicizia non trovata.');
  }
  await db.prepare('DELETE FROM friendships WHERE id = ?').run(id);
  res.status(204).end();
});
