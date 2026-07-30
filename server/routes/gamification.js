/**
 * routes/gamification.js
 * ------------------------------------------------------------
 * Viste in sola lettura della gamification: badge, missioni, curva
 * dei livelli e registro XP.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { listBadges, listMissions, listLevels, xpLog } from '../controllers/gamificationController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/badges', optionalAuth, listBadges);
router.get('/missions', requireAuth, listMissions);
router.get('/levels', listLevels);
router.get('/xp-log', requireAuth, xpLog);

export default router;
