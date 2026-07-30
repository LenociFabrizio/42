/**
 * routes/live.js
 * ------------------------------------------------------------
 * Live Map (multiplayer): consenso, posizione, stop, vicinanze.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { setLive, updatePosition, stop, nearby } from '../controllers/liveController.js';
import { requireAuth } from '../middleware/auth.js';
import { liveLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Nessun gate di livello: gli amici si vedono sempre (con consenso). Il livello
// minimo per gli sconosciuti è applicato dentro `nearby` (visibilità 'public').
router.put('/settings', requireAuth, setLive);
router.post('/position', requireAuth, liveLimiter, updatePosition);
router.post('/stop', requireAuth, stop);
router.get('/nearby', requireAuth, nearby);

export default router;
