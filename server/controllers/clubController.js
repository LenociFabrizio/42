/**
 * clubController.js
 * ------------------------------------------------------------
 * Club: creazione/ricerca/dettaglio/aggiornamento/eliminazione,
 * gestione membri (ingresso, uscita, richieste, ruoli, espulsioni)
 * e classifiche (globale club + membri per contributo).
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { CLUB_ROLES, PRIVACY, ROLES, XP } from '../utils/constants.js';
import { awardXp, checkBadges } from '../services/gamification.js';
import { notify } from '../services/notifications.js';
import { recomputeClubStats } from '../services/stats.js';

/** Colonne "card" di un club per liste e classifiche. */
const CARD_COLS = 'id, name, photo, description, privacy, level, xp, members_count, total_distance_m';

/* -------------------- HELPER INTERNI -------------------- */

/** Ritorna il ruolo di un utente nel club ('creator'|'moderator'|'member') oppure null. */
async function memberRole(clubId, userId) {
  if (!userId) return null;
  const row = await db
    .prepare('SELECT role FROM club_members WHERE club_id = ? AND user_id = ?')
    .get(clubId, userId);
  return row ? row.role : null;
}

/** Verifica che l'utente sia creatore o moderatore del club; altrimenti 403. Ritorna il ruolo. */
async function requireClubManager(clubId, userId) {
  const role = await memberRole(clubId, userId);
  if (role !== CLUB_ROLES.CREATOR && role !== CLUB_ROLES.MODERATOR) {
    throw new HttpError(403, 'Solo il creatore o i moderatori possono gestire il club.');
  }
  return role;
}

/** Recupera un club per id o lancia 404. */
async function getClubOr404(id) {
  const club = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(id);
  if (!club) throw new HttpError(404, 'Club non trovato.');
  return club;
}

/* -------------------- LISTA / RICERCA -------------------- */

/**
 * GET /api/clubs — lista/ricerca club.
 * Query: q (nome/descrizione LIKE), sort (xp|distance|members, def xp).
 * Se autenticato, ogni club riporta is_member.
 */
export const list = asyncHandler(async (req, res) => {
  const args = [];
  // Se l'utente è autenticato, calcoliamo is_member con una sotto-query EXISTS.
  const extra = req.user
    ? ', EXISTS(SELECT 1 FROM club_members cm WHERE cm.club_id = c.id AND cm.user_id = ?) AS is_member'
    : '';
  if (req.user) args.push(req.user.id);

  let sql = `SELECT ${CARD_COLS}${extra} FROM clubs c`;

  if (req.query.q) {
    const q = v.optStr(req.query.q, 'Ricerca', { max: 80 });
    sql += ' WHERE (name LIKE ? OR description LIKE ?)';
    args.push(`%${q}%`, `%${q}%`);
  }

  const sort = v.oneOf(req.query.sort, ['xp', 'distance', 'members'], 'Ordinamento', { def: 'xp' });
  const orderBy =
    sort === 'distance' ? 'total_distance_m DESC' : sort === 'members' ? 'members_count DESC' : 'xp DESC';
  sql += ` ORDER BY ${orderBy}, id ASC LIMIT ?`;
  args.push(100);

  const rows = await db.prepare(sql).all(...args);
  res.json({ clubs: rows.map((c) => ({ ...c, is_member: !!c.is_member })) });
});

/** GET /api/clubs/leaderboard — top club per XP (poi distanza). */
export const leaderboard = asyncHandler(async (_req, res) => {
  const rows = await db
    .prepare(`SELECT ${CARD_COLS} FROM clubs ORDER BY xp DESC, total_distance_m DESC, id ASC LIMIT 50`)
    .all();
  res.json({ leaderboard: rows.map((c, i) => ({ ...c, rank: i + 1 })) });
});

/* -------------------- CREAZIONE -------------------- */

/** POST /api/clubs — crea un nuovo club (il creatore ne diventa il primo membro). */
export const create = asyncHandler(async (req, res) => {
  const name = v.str(req.body.name, 'Nome', { min: 3, max: 40 });
  const description = v.optStr(req.body.description, 'Descrizione', { max: 1000 });
  const photo = req.body.photo ? v.optStr(req.body.photo, 'Foto', { max: 500 }) : null;
  const privacy = v.oneOf(req.body.privacy, PRIVACY, 'Privacy', { def: 'public' });
  const maxMembers = v.int(req.body.max_members, 'Numero massimo membri', { min: 0, max: 100000, def: 0 });

  const taken = await db.prepare('SELECT id FROM clubs WHERE name = ?').get(name);
  if (taken) throw new HttpError(409, 'Nome club già in uso.');

  const info = await db
    .prepare(
      `INSERT INTO clubs (name, photo, description, creator_id, max_members, privacy, xp, level, members_count)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)`
    )
    .run(name, photo, description, req.user.id, maxMembers, privacy);
  const id = info.lastInsertRowid;

  await db
    .prepare('INSERT INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)')
    .run(id, req.user.id, CLUB_ROLES.CREATOR);

  await awardXp(req.user.id, XP.CREATE_CLUB, 'club_created', 'club', id);
  await recomputeClubStats(id);
  await checkBadges(req.user.id);

  const club = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(id);
  res.status(201).json({ club });
});

/* -------------------- DETTAGLIO -------------------- */

/** GET /api/clubs/:id — dettaglio del club con creatore, membri e (per i gestori) richieste pendenti. */
export const getOne = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const club = await getClubOr404(id);

  const creator = await db.prepare('SELECT id, nickname, avatar FROM users WHERE id = ?').get(club.creator_id);

  // Membri: prima il creatore, poi i moderatori, poi i membri; a parità, livello decrescente.
  const members = await db
    .prepare(
      `SELECT cm.user_id, u.nickname, u.avatar, u.level, cm.role, cm.joined_at
         FROM club_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.club_id = ?
        ORDER BY CASE cm.role WHEN 'creator' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, u.level DESC`
    )
    .all(id);

  const myRole = await memberRole(id, req.user?.id);

  // Le richieste pendenti sono visibili solo a creatore/moderatori.
  let pendingRequests = [];
  if (myRole === CLUB_ROLES.CREATOR || myRole === CLUB_ROLES.MODERATOR) {
    pendingRequests = await db
      .prepare(
        `SELECT r.id, r.user_id, u.nickname, u.avatar, r.created_at
           FROM club_join_requests r JOIN users u ON u.id = r.user_id
          WHERE r.club_id = ? AND r.status = 'pending'
          ORDER BY r.created_at ASC`
      )
      .all(id);
  }

  res.json({
    club,
    creator,
    members,
    is_member: !!myRole,
    my_role: myRole,
    pending_requests: pendingRequests,
  });
});

/* -------------------- AGGIORNAMENTO -------------------- */

/** PUT /api/clubs/:id — aggiorna il club (creatore o moderatore; rinomina solo il creatore). */
export const update = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  await getClubOr404(id);
  const role = await memberRole(id, req.user.id);
  if (role !== CLUB_ROLES.CREATOR && role !== CLUB_ROLES.MODERATOR) {
    throw new HttpError(403, 'Solo il creatore o i moderatori possono modificare il club.');
  }

  const fields = [];
  const args = [];
  const set = (col, val) => {
    fields.push(`${col} = ?`);
    args.push(val);
  };

  if (req.body.name !== undefined) {
    // Il cambio nome è riservato al creatore.
    if (role !== CLUB_ROLES.CREATOR) throw new HttpError(403, 'Solo il creatore può rinominare il club.');
    const name = v.str(req.body.name, 'Nome', { min: 3, max: 40 });
    const taken = await db.prepare('SELECT id FROM clubs WHERE name = ? AND id != ?').get(name, id);
    if (taken) throw new HttpError(409, 'Nome club già in uso.');
    set('name', name);
  }
  if (req.body.description !== undefined) set('description', v.optStr(req.body.description, 'Descrizione', { max: 1000 }));
  if (req.body.photo !== undefined) set('photo', req.body.photo ? v.optStr(req.body.photo, 'Foto', { max: 500 }) : null);
  if (req.body.privacy !== undefined) set('privacy', v.oneOf(req.body.privacy, PRIVACY, 'Privacy'));
  if (req.body.max_members !== undefined) {
    set('max_members', v.int(req.body.max_members, 'Numero massimo membri', { min: 0, max: 100000 }));
  }
  if (!fields.length) throw new HttpError(400, 'Nessun campo da aggiornare.');

  args.push(id);
  await db.prepare(`UPDATE clubs SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  res.json({ club: await db.prepare('SELECT * FROM clubs WHERE id = ?').get(id) });
});

/* -------------------- ELIMINAZIONE -------------------- */

/** DELETE /api/clubs/:id — elimina il club (solo creatore o admin). */
export const remove = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const club = await getClubOr404(id);
  if (club.creator_id !== req.user.id && req.user.role !== ROLES.ADMIN) {
    throw new HttpError(403, 'Non autorizzato.');
  }
  // Il cascade dello schema rimuove membri e richieste collegate.
  await db.prepare('DELETE FROM clubs WHERE id = ?').run(id);
  res.status(204).end();
});

/* -------------------- INGRESSO / USCITA -------------------- */

/**
 * POST /api/clubs/:id/join — richiesta di ingresso.
 * Club pubblico: ingresso immediato. Club privato: richiesta in attesa.
 */
export const join = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const club = await getClubOr404(id);

  if (await memberRole(id, req.user.id)) throw new HttpError(409, 'Sei già un membro di questo club.');
  if (club.max_members > 0 && club.members_count >= club.max_members) {
    throw new HttpError(409, 'Club al completo.');
  }

  if (club.privacy === 'public') {
    // Ingresso diretto.
    await db
      .prepare('INSERT INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)')
      .run(id, req.user.id, CLUB_ROLES.MEMBER);
    await awardXp(req.user.id, XP.JOIN_CLUB, 'club_joined', 'club', id);
    await recomputeClubStats(id);
    await checkBadges(req.user.id);
    // Avvisa informalmente il creatore del nuovo ingresso.
    await notify(
      club.creator_id,
      'club_request',
      'Nuovo membro',
      `${req.user.nickname} è entrato nel club ${club.name}.`,
      { club_id: id, user_id: req.user.id }
    );
    return res.json({ joined: true });
  }

  // Club privato: crea la richiesta (idempotente) e avvisa i gestori.
  await db
    .prepare("INSERT OR IGNORE INTO club_join_requests (club_id, user_id, status) VALUES (?, ?, 'pending')")
    .run(id, req.user.id);
  const managers = await db
    .prepare("SELECT user_id FROM club_members WHERE club_id = ? AND role IN ('creator', 'moderator')")
    .all(id);
  for (const m of managers) {
    await notify(
      m.user_id,
      'club_request',
      'Nuova richiesta di ingresso',
      `${req.user.nickname} vuole unirsi a ${club.name}.`,
      { club_id: id, user_id: req.user.id }
    );
  }
  res.json({ requested: true });
});

/** POST /api/clubs/:id/leave — un membro lascia il club (il creatore non può). */
export const leave = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  await getClubOr404(id);
  const role = await memberRole(id, req.user.id);
  if (!role) throw new HttpError(404, 'Non sei un membro di questo club.');
  if (role === CLUB_ROLES.CREATOR) {
    throw new HttpError(409, 'Il creatore non può lasciare il club; eliminalo o trasferisci il ruolo.');
  }
  await db.prepare('DELETE FROM club_members WHERE club_id = ? AND user_id = ?').run(id, req.user.id);
  await recomputeClubStats(id);
  res.json({ ok: true });
});

/* -------------------- RICHIESTE DI INGRESSO -------------------- */

/** POST /api/clubs/:id/requests/:userId/accept — accetta una richiesta (creatore/moderatore). */
export const acceptRequest = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const userId = v.int(req.params.userId, 'id utente', { min: 1 });
  const club = await getClubOr404(id);
  await requireClubManager(id, req.user.id);

  const request = await db
    .prepare("SELECT id FROM club_join_requests WHERE club_id = ? AND user_id = ? AND status = 'pending'")
    .get(id, userId);
  if (!request) throw new HttpError(404, 'Richiesta non trovata.');

  await db
    .prepare("UPDATE club_join_requests SET status = 'accepted' WHERE club_id = ? AND user_id = ?")
    .run(id, userId);
  await db
    .prepare('INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)')
    .run(id, userId, CLUB_ROLES.MEMBER);

  await awardXp(userId, XP.JOIN_CLUB, 'club_joined', 'club', id);
  await recomputeClubStats(id);
  await checkBadges(userId);
  await notify(userId, 'club_accepted', 'Richiesta accettata', `Sei stato accettato in ${club.name}.`, {
    club_id: id,
  });

  res.json({ ok: true });
});

/** POST /api/clubs/:id/requests/:userId/decline — rifiuta una richiesta (creatore/moderatore). */
export const declineRequest = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const userId = v.int(req.params.userId, 'id utente', { min: 1 });
  await getClubOr404(id);
  await requireClubManager(id, req.user.id);

  const request = await db
    .prepare("SELECT id FROM club_join_requests WHERE club_id = ? AND user_id = ? AND status = 'pending'")
    .get(id, userId);
  if (!request) throw new HttpError(404, 'Richiesta non trovata.');

  await db
    .prepare("UPDATE club_join_requests SET status = 'declined' WHERE club_id = ? AND user_id = ?")
    .run(id, userId);
  res.json({ ok: true });
});

/* -------------------- RUOLI / MEMBRI -------------------- */

/** POST /api/clubs/:id/members/:userId/role — cambia il ruolo di un membro (solo creatore). */
export const setMemberRole = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const userId = v.int(req.params.userId, 'id utente', { min: 1 });
  const club = await getClubOr404(id);
  if (club.creator_id !== req.user.id) throw new HttpError(403, 'Solo il creatore può gestire i ruoli.');

  const role = v.oneOf(req.body.role, [CLUB_ROLES.MODERATOR, CLUB_ROLES.MEMBER], 'Ruolo');
  const current = await memberRole(id, userId);
  if (!current) throw new HttpError(404, 'Membro non trovato.');
  if (current === CLUB_ROLES.CREATOR) throw new HttpError(400, 'Non puoi cambiare il ruolo del creatore.');

  await db.prepare('UPDATE club_members SET role = ? WHERE club_id = ? AND user_id = ?').run(role, id, userId);
  res.json({ ok: true });
});

/** DELETE /api/clubs/:id/members/:userId — espelli un membro (creatore/moderatore). */
export const kickMember = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const userId = v.int(req.params.userId, 'id utente', { min: 1 });
  await getClubOr404(id);
  const actorRole = await requireClubManager(id, req.user.id);

  const targetRole = await memberRole(id, userId);
  if (!targetRole) throw new HttpError(404, 'Membro non trovato.');
  if (targetRole === CLUB_ROLES.CREATOR) throw new HttpError(403, 'Non puoi rimuovere il creatore.');
  if (actorRole === CLUB_ROLES.MODERATOR && targetRole === CLUB_ROLES.MODERATOR) {
    throw new HttpError(403, 'Un moderatore non può rimuovere un altro moderatore.');
  }

  await db.prepare('DELETE FROM club_members WHERE club_id = ? AND user_id = ?').run(id, userId);
  await recomputeClubStats(id);
  res.status(204).end();
});

/* -------------------- CLASSIFICA MEMBRI -------------------- */

/** GET /api/clubs/:id/leaderboard — membri ordinati per contributo (distanza totale). */
export const clubLeaderboard = asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  await getClubOr404(id);
  const rows = await db
    .prepare(
      `SELECT u.id AS user_id, u.nickname, u.avatar, u.level, u.total_distance_m, u.records_count
         FROM club_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.club_id = ?
        ORDER BY u.total_distance_m DESC, u.id ASC LIMIT 100`
    )
    .all(id);
  res.json({ leaderboard: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
});
