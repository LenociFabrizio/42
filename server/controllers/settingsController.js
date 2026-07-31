/**
 * settingsController.js
 * ------------------------------------------------------------
 * Impostazioni utente (tema, lingua, unità, privacy, notifiche) ed
 * eliminazione definitiva dell'account.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import bcrypt from 'bcryptjs';

/** Recupera la riga di impostazioni dell'utente, creandola coi default se assente. */
async function ensureSettings(userId) {
  let row = await db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
    row = await db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }
  return row;
}

/** GET /api/settings — impostazioni correnti (crea i default se mancanti). */
export const getSettings = asyncHandler(async (req, res) => {
  const settings = await ensureSettings(req.user.id);
  res.json({ settings });
});

/** PUT /api/settings — aggiorna solo i campi forniti e ammessi. */
export const updateSettings = asyncHandler(async (req, res) => {
  await ensureSettings(req.user.id);

  const fields = [];
  const args = [];
  const set = (col, val) => { fields.push(`${col} = ?`); args.push(val); };

  if (req.body.theme !== undefined) set('theme', v.oneOf(req.body.theme, ['dark', 'light'], 'Tema'));
  if (req.body.language !== undefined) set('language', v.oneOf(req.body.language, ['it', 'en'], 'Lingua'));
  if (req.body.units !== undefined) set('units', v.oneOf(req.body.units, ['metric', 'imperial'], 'Unità'));
  if (req.body.profile_visibility !== undefined) {
    set('profile_visibility', v.oneOf(req.body.profile_visibility, ['public', 'friends', 'private'], 'Visibilità profilo'));
  }
  if (req.body.location_visibility !== undefined) {
    set('location_visibility', v.oneOf(req.body.location_visibility, ['public', 'friends', 'private'], 'Visibilità posizione'));
  }
  if (req.body.notify_friends !== undefined) set('notify_friends', v.bool(req.body.notify_friends) ? 1 : 0);
  if (req.body.notify_events !== undefined) set('notify_events', v.bool(req.body.notify_events) ? 1 : 0);
  if (req.body.notify_records !== undefined) set('notify_records', v.bool(req.body.notify_records) ? 1 : 0);
  if (req.body.notify_clubs !== undefined) set('notify_clubs', v.bool(req.body.notify_clubs) ? 1 : 0);

  // Preferenze di navigazione (indicazioni verso percorsi/eventi).
  if (req.body.nav_avoid_tolls !== undefined) set('nav_avoid_tolls', v.bool(req.body.nav_avoid_tolls) ? 1 : 0);
  if (req.body.nav_avoid_motorways !== undefined) set('nav_avoid_motorways', v.bool(req.body.nav_avoid_motorways) ? 1 : 0);
  if (req.body.nav_avoid_ztl !== undefined) set('nav_avoid_ztl', v.bool(req.body.nav_avoid_ztl) ? 1 : 0);
  if (req.body.nav_avoid_ferries !== undefined) set('nav_avoid_ferries', v.bool(req.body.nav_avoid_ferries) ? 1 : 0);
  if (req.body.nav_profile !== undefined) {
    set('nav_profile', v.oneOf(req.body.nav_profile, ['auto', 'car', 'moto'], 'Profilo navigazione'));
  }

  // Raggio di visibilità iniziale della mappa (km).
  if (req.body.map_radius_km !== undefined) {
    set('map_radius_km', v.int(req.body.map_radius_km, 'Raggio mappa', { min: 1, max: 200 }));
  }

  if (!fields.length) throw new HttpError(400, 'Nessun campo da aggiornare.');

  args.push(req.user.id);
  await db.prepare(`UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...args);
  const settings = await db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  res.json({ settings });
});

/**
 * DELETE /api/settings/account — elimina l'account previa verifica password.
 * La cancellazione dell'utente rimuove tutte le righe correlate (ON DELETE CASCADE).
 */
export const deleteAccount = asyncHandler(async (req, res) => {
  if (req.user.password_hash) {
    const password = req.body.password == null ? '' : String(req.body.password);
    const ok = await bcrypt.compare(password, req.user.password_hash);
    if (!ok) throw new HttpError(400, 'Password errata.');
  } else {
    // Account solo-Google: non c'è password da verificare. Chiediamo di
    // riscrivere il nickname come conferma esplicita e non ambigua.
    const confirm = String(req.body.confirm_nickname || '').trim();
    if (confirm !== req.user.nickname) {
      throw new HttpError(400, 'Per confermare, riscrivi esattamente il tuo nickname.');
    }
  }

  await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.status(204).end();
});
