/**
 * routes/users.js
 * ------------------------------------------------------------
 * Profili, aggiornamento profilo, avatar, veicoli, classifica.
 * ------------------------------------------------------------
 */
import { Router } from 'express';
import {
  leaderboard,
  getProfile,
  getUserRoutes,
  updateProfile,
  uploadAvatar,
  listVehicles,
  addVehicle,
  deleteVehicle,
} from '../controllers/userController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.get('/leaderboard', leaderboard);

// Profilo corrente e sottorisorse (prima delle rotte con :id).
router.put('/me', requireAuth, updateProfile);
router.post('/me/avatar', requireAuth, upload.single('image'), uploadAvatar);
router.get('/me/vehicles', requireAuth, listVehicles);
router.post('/me/vehicles', requireAuth, addVehicle);
router.delete('/me/vehicles/:vid', requireAuth, deleteVehicle);

router.get('/:id', optionalAuth, getProfile);
router.get('/:id/routes', optionalAuth, getUserRoutes);

export default router;
