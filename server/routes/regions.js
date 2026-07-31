/**
 * routes/regions.js
 * ------------------------------------------------------------
 * Aree di gioco (regioni italiane): catalogo + aree scoperte, scelta
 * dell'area di partenza e sblocco per posizione.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { listRegions, listCatalog, setHome, visit } from '../controllers/regionController.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Catalogo aperto: la registrazione deve poter mostrare le aree prima del login.
router.get('/catalog', listCatalog);
router.get('/', requireAuth, listRegions);
router.post('/home', requireAuth, writeLimiter, setHome);
router.post('/visit', requireAuth, writeLimiter, visit);

export default router;
