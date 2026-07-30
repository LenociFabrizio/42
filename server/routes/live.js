/**
 * routes/live.js
 * ------------------------------------------------------------
 * Live Map (multiplayer): consenso, posizione, stop, vicinanze.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { setLive, updatePosition, stop, nearby } from '../controllers/liveController.js';
import { requireAuth, requireLevel } from '../middleware/auth.js';
import { liveLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.put('/settings', requireAuth, setLive);
router.post('/position', requireAuth, liveLimiter, updatePosition);
router.post('/stop', requireAuth, stop);
router.get('/nearby', requireAuth, requireLevel(), nearby);

export default router;
