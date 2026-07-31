/**
 * routes/admin.js
 * ------------------------------------------------------------
 * Pannello sviluppatore: numeri, utenti, contenuti, segnalazioni.
 * Tutto in sola lettura e tutto dietro requireAdmin.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { overview, users, content, feedback } from '../controllers/adminController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// requireAuth prima di requireAdmin: senza token la risposta è 401, non 403
// (chi non ha fatto l'accesso non è "non autorizzato", non è ancora nessuno).
router.use(requireAuth, requireAdmin);

router.get('/overview', overview);
router.get('/users', users);
router.get('/content', content);
router.get('/feedback', feedback);

export default router;
