/**
 * regionController.js
 * ------------------------------------------------------------
 * Aree di gioco = le 20 regioni italiane. Ogni utente sceglie l'area di
 * partenza (scoperta da subito) e sblocca le altre solo entrandoci davvero.
 *
 * REGOLA IMPORTANTE: lo sblocco lo decide il SERVER. Il client dice "sono in
 * questo punto", non "ho sbloccato la Toscana": la corrispondenza punto → area
 * è calcolata qui sui confini reali (utils/regions.js).
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { REGIONS, REGION_CODES, isRegionCode, regionName, regionAt } from '../utils/regions.js';
import { XP } from '../utils/constants.js';
import { awardXp, checkBadges, bumpMissions } from '../services/gamification.js';
import { notify } from '../services/notifications.js';

/** Stato delle aree per un utente: catalogo, area di partenza, scoperte. */
async function areasOf(user) {
  const rows = await db
    .prepare('SELECT region, discovered_at FROM user_regions WHERE user_id = ? ORDER BY discovered_at')
    .all(user.id);
  return {
    home: user.region || null,
    home_name: regionName(user.region),
    regions: REGIONS,
    discovered: rows.map((r) => r.region),
    discovered_at: Object.fromEntries(rows.map((r) => [r.region, r.discovered_at])),
    total: REGIONS.length,
  };
}

/** GET /api/regions — catalogo delle aree e quali ho già scoperto. */
export const listRegions = asyncHandler(async (req, res) => {
  res.json(await areasOf(req.user));
});

/**
 * GET /api/regions/catalog — solo l'elenco delle aree, senza autenticazione:
 * serve alla registrazione, dove l'utente scegli l'area di partenza prima di
 * avere un account. Sono nomi di regioni italiane: nessun dato personale.
 */
export const listCatalog = asyncHandler(async (_req, res) => {
  res.json({ regions: REGIONS, total: REGIONS.length });
});

/**
 * POST /api/regions/home — sceglie l'area di partenza.
 * Si imposta UNA volta sola: potendola cambiare a piacere si otterrebbero aree
 * senza muoversi, dato che quella di partenza è scoperta da subito.
 */
export const setHome = asyncHandler(async (req, res) => {
  if (req.user.region) throw new HttpError(409, 'L\'area di partenza è già stata scelta.');
  const code = v.oneOf(String(req.body.region || ''), REGION_CODES, 'Area');
  if (!isRegionCode(code)) throw new HttpError(400, 'Area non valida.');

  await db.prepare("UPDATE users SET region = ?, updated_at = datetime('now') WHERE id = ?").run(code, req.user.id);
  await db.prepare('INSERT OR IGNORE INTO user_regions (user_id, region) VALUES (?, ?)').run(req.user.id, code);
  req.user.region = code;

  // Nessun XP: scegliere da dove si parte non è un'impresa. Il distintivo
  // "Oltre il Confine" arriva con la PRIMA area guadagnata sul campo.
  await checkBadges(req.user.id);
  res.status(201).json(await areasOf(req.user));
});

/**
 * POST /api/regions/visit — "sono in questo punto".
 * Se cade in un'area non ancora scoperta la sblocca: XP, missioni, distintivi
 * e notifica. Chiamata dal client quando il GPS cambia regione.
 */
export const visit = asyncHandler(async (req, res) => {
  const lat = v.latitude(req.body.lat);
  const lng = v.longitude(req.body.lng);
  const here = regionAt(lat, lng);

  // Fuori dai confini italiani non c'è nulla da sbloccare (l'app copre l'Italia).
  if (!here) {
    res.json({ region: null, name: null, unlocked: false, ...(await areasOf(req.user)) });
    return;
  }

  const known = await db
    .prepare('SELECT 1 AS x FROM user_regions WHERE user_id = ? AND region = ?')
    .get(req.user.id, here.code);

  let unlocked = false;
  if (!known) {
    await db
      .prepare('INSERT OR IGNORE INTO user_regions (user_id, region) VALUES (?, ?)')
      .run(req.user.id, here.code);
    unlocked = true;
    await awardXp(req.user.id, XP.DISCOVER_REGION, 'region_discovered', 'region', null);
    await bumpMissions(req.user.id, 'regions', 1);
    await checkBadges(req.user.id);
    await notify(
      req.user.id,
      'region',
      `Nuova area sbloccata: ${here.name} 🗺️`,
      `Hai messo le ruote in ${here.name}. +${XP.DISCOVER_REGION} XP`,
      { region: here.code, region_name: here.name }
    );
  }

  res.json({ region: here.code, name: here.name, unlocked, ...(await areasOf(req.user)) });
});
