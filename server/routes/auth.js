/**
 * routes/auth.js
 * ------------------------------------------------------------
 * Rotte di autenticazione. Login e registrazione hanno un rate
 * limit stringente (anti brute-force).
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { register, login, me, changePassword } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);

export default router;
