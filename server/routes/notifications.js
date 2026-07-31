/**
 * routes/notifications.js
 * ------------------------------------------------------------
 * Centro notifiche: tutte le rotte richiedono autenticazione.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import { list, getUnreadCount, markRead, markAllRead, remove, removeAll } from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, list);
router.get('/unread-count', requireAuth, getUnreadCount);
router.post('/read', requireAuth, markRead);
router.post('/read-all', requireAuth, markAllRead);
// Prima della rotta con parametro, così "/" non viene interpretato come ":id".
router.delete('/', requireAuth, removeAll);
router.delete('/:id', requireAuth, remove);

export default router;
