/**
 * routes/index.js
 * ------------------------------------------------------------
 * Router principale: monta tutti i sotto-router sotto /api.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { config } from '../config/config.js';
import authRoutes from './auth.js';
import userRoutes from './users.js';
import routeRoutes from './routes.js';
import eventRoutes from './events.js';
import clubRoutes from './clubs.js';
import friendRoutes from './friends.js';
import gamificationRoutes from './gamification.js';
import notificationRoutes from './notifications.js';
import liveRoutes from './live.js';
import poiRoutes from './pois.js';
import settingsRoutes from './settings.js';
import feedbackRoutes from './feedback.js';
import regionRoutes from './regions.js';
import adminRoutes from './admin.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', service: '4e2', time: new Date().toISOString() }));

// Configurazione pubblica per il client (stile mappa, chiavi pubbliche, ecc.).
router.get('/config', (_req, res) => {
  res.json({
    map: {
      styleUrl: config.map.styleUrl || null,
      tileKey: config.map.tileKey || null,
    },
    // Client ID Google (pubblico per progetto): se assente il client non
    // mostra il pulsante "Continua con Google".
    google: {
      clientId: config.google.clientId || null,
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/routes', routeRoutes);
router.use('/events', eventRoutes);
router.use('/clubs', clubRoutes);
router.use('/friends', friendRoutes);
router.use('/gamification', gamificationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/live', liveRoutes);
router.use('/pois', poiRoutes);
router.use('/settings', settingsRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/regions', regionRoutes);
router.use('/admin', adminRoutes);

export default router;
