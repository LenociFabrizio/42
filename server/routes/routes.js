/**
 * routes/routes.js
 * ------------------------------------------------------------
 * Percorsi (create/list/detail/update/delete), like, completamenti,
 * classifica, upload foto.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import {
  list, getOne, routeLeaderboard, create, update, remove, complete, like, unlike, uploadPhoto,
} from '../controllers/routeController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/', optionalAuth, list);
router.post('/', requireAuth, writeLimiter, create);
router.post('/photo', requireAuth, upload.single('image'), uploadPhoto);

router.get('/:id', optionalAuth, getOne);
router.put('/:id', requireAuth, update);
router.delete('/:id', requireAuth, remove);

router.get('/:id/leaderboard', optionalAuth, routeLeaderboard);
router.post('/:id/complete', requireAuth, writeLimiter, complete);
router.post('/:id/like', requireAuth, like);
router.delete('/:id/like', requireAuth, unlike);

export default router;
