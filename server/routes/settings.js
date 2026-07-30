/**
 * routes/settings.js
 * ------------------------------------------------------------
 * Impostazioni utente ed eliminazione account (tutte autenticate).
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { getSettings, updateSettings, deleteAccount } from '../controllers/settingsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, getSettings);
router.put('/', requireAuth, updateSettings);
router.delete('/account', requireAuth, deleteAccount);

export default router;
