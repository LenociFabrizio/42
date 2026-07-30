/**
 * routes/notifications.js
 * ------------------------------------------------------------
 * Centro notifiche: tutte le rotte richiedono autenticazione.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { list, getUnreadCount, markRead, markAllRead, remove } from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, list);
router.get('/unread-count', requireAuth, getUnreadCount);
router.post('/read', requireAuth, markRead);
router.post('/read-all', requireAuth, markAllRead);
router.delete('/:id', requireAuth, remove);

export default router;
