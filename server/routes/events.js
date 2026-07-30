/**
 * routes/events.js
 * ------------------------------------------------------------
 * Eventi live (create/list/detail/update/delete), iscrizione (RSVP),
 * check-in via GPS, posizione live e abbandono.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import {
  list, getOne, create, update, remove, join, checkin, position, leave, participants,
} from '../controllers/eventController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { writeLimiter, liveLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/', optionalAuth, list);
router.post('/', requireAuth, writeLimiter, create);

router.get('/:id', optionalAuth, getOne);
router.put('/:id', requireAuth, update);
router.delete('/:id', requireAuth, remove);

router.post('/:id/join', requireAuth, join);
router.post('/:id/checkin', requireAuth, checkin);
router.post('/:id/position', requireAuth, liveLimiter, position);
router.post('/:id/leave', requireAuth, leave);
router.get('/:id/participants', optionalAuth, participants);

export default router;
