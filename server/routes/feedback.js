/**
 * routes/feedback.js
 * ------------------------------------------------------------
 * Segnalazioni di bug dall'app. Limite di frequenza stretto: è un
 * canale che manda email, non deve poter diventare uno spam-cannon.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createBugReport } from '../controllers/feedbackController.js';
import { requireAuth } from '../middleware/auth.js';

const bugLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 10 * 60 * 1000,
  max: 5, // 5 segnalazioni ogni 10 minuti per IP
  message: { error: 'Hai inviato diverse segnalazioni: aspetta qualche minuto.' },
});

const router = Router();

router.post('/bug', requireAuth, bugLimiter, createBugReport);

export default router;
