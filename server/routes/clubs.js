/**
 * routes/clubs.js
 * ------------------------------------------------------------
 * Club: lista/ricerca, classifica, CRUD, gestione membri
 * (ingresso, uscita, richieste, ruoli, espulsioni) e classifica membri.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import {
  list,
  leaderboard,
  create,
  getOne,
  update,
  remove,
  join,
  leave,
  acceptRequest,
  declineRequest,
  setMemberRole,
  kickMember,
  clubLeaderboard,
  uploadPhoto,
} from '../controllers/clubController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { upload } from '../middleware/upload.js';

const router = Router();

// Rotte statiche prima di quelle con :id.
router.get('/', optionalAuth, list);
router.get('/leaderboard', optionalAuth, leaderboard);
router.post('/', requireAuth, writeLimiter, create);

router.get('/:id', optionalAuth, getOne);
router.put('/:id', requireAuth, update);
router.delete('/:id', requireAuth, remove);
// Immagine del club: multipart, come l'avatar utente (il permesso è nel controller).
router.post('/:id/photo', requireAuth, upload.single('image'), uploadPhoto);

router.post('/:id/join', requireAuth, join);
router.post('/:id/leave', requireAuth, leave);

router.post('/:id/requests/:userId/accept', requireAuth, acceptRequest);
router.post('/:id/requests/:userId/decline', requireAuth, declineRequest);

router.post('/:id/members/:userId/role', requireAuth, setMemberRole);
router.delete('/:id/members/:userId', requireAuth, kickMember);

router.get('/:id/leaderboard', optionalAuth, clubLeaderboard);

export default router;
