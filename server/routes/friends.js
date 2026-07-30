/**
 * routes/friends.js
 * ------------------------------------------------------------
 * Amicizie: elenco amici, presenza online, richieste in sospeso,
 * invio/accettazione/rifiuto richieste e rimozione amici.
 * Tutte le rotte richiedono autenticazione.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import {
  listFriends,
  listOnline,
  listRequests,
  sendRequest,
  acceptRequest,
  declineRequest,
  removeFriend,
} from '../controllers/friendController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, listFriends);
router.get('/requests', requireAuth, listRequests);
router.get('/online', requireAuth, listOnline);

router.post('/request', requireAuth, sendRequest);
router.post('/:id/accept', requireAuth, acceptRequest);
router.post('/:id/decline', requireAuth, declineRequest);
router.delete('/:id', requireAuth, removeFriend);

export default router;
