/**
 * routes/pois.js
 * ------------------------------------------------------------
 * Punti di interesse (POI): elenco per mappa, creazione, eliminazione.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { list, create, remove } from '../controllers/poiController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuth, list);
router.post('/', requireAuth, create);
router.delete('/:id', requireAuth, remove);

export default router;
