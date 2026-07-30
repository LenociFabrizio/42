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
} from '../controllers/clubController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Rotte statiche prima di quelle con :id.
router.get('/', optionalAuth, list);
router.get('/leaderboard', optionalAuth, leaderboard);
router.post('/', requireAuth, writeLimiter, create);

router.get('/:id', optionalAuth, getOne);
router.put('/:id', requireAuth, update);
router.delete('/:id', requireAuth, remove);

router.post('/:id/join', requireAuth, join);
router.post('/:id/leave', requireAuth, leave);

router.post('/:id/requests/:userId/accept', requireAuth, acceptRequest);
router.post('/:id/requests/:userId/decline', requireAuth, declineRequest);

router.post('/:id/members/:userId/role', requireAuth, setMemberRole);
router.delete('/:id/members/:userId', requireAuth, kickMember);

router.get('/:id/leaderboard', optionalAuth, clubLeaderboard);

export default router;
