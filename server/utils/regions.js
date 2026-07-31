/**
 * regions.js
 * ------------------------------------------------------------
 * Le "Aree" del gioco = le 20 regioni italiane. Ogni utente scegli la sua area
 * di partenza alla registrazione e sblocca le altre solo entrandoci davvero:
 * la verifica è QUI, lato server, sulle coordinate GPS inviate dal client.
 *
 * Le geometrie stanno in regionsGeo.js (generato da public/data/italy-regions.geojson
 * con `npm run build:regions`): stessa sorgente della mappa, semplificata.
 * ------------------------------------------------------------
 */
import { REGIONS_GEO } from './regionsGeo.js';

/**
 * Catalogo pubblico, in ordine geografico (nord → sud).
 * `geo_name` è il nome della feature nel GeoJSON dei confini: serve al client
 * per collegare le aree scoperte ai poligoni da svelare sulla mappa.
 */
export const REGIONS = REGIONS_GEO.map((r) => ({ code: r.code, name: r.name, geo_name: r.geoName }));

export const REGION_CODES = REGIONS.map((r) => r.code);

const BY_CODE = new Map(REGIONS_GEO.map((r) => [r.code, r]));

/** Vero se `code` è una delle aree esistenti. */
export function isRegionCode(code) {
  return BY_CODE.has(String(code || ''));
}

/** Nome leggibile di un'area ('puglia' → 'Puglia'), o null. */
export function regionName(code) {
  return BY_CODE.get(String(code || ''))?.name || null;
}

/** Riquadro [minLng, minLat, maxLng, maxLat] di un'area, o null. */
export function regionBbox(code) {
  return BY_CODE.get(String(code || ''))?.bbox || null;
}

/**
 * Punto dentro un anello (ray casting). L'anello è una lista [lng, lat].
 * I punti esattamente sul confine possono cadere da una parte o dall'altra:
 * per sbloccare un'area è del tutto irrilevante.
 */
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * In quale area cade questo punto?
 * @returns {{code:string, name:string}|null} null se fuori dall'Italia.
 */
export function regionAt(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const r of REGIONS_GEO) {
    const [minLng, minLat, maxLng, maxLat] = r.bbox;
    // Scarto rapido col riquadro: evita di scandire gli anelli di tutta l'Italia.
    if (ln < minLng || ln > maxLng || la < minLat || la > maxLat) continue;
    for (const ring of r.rings) {
      if (inRing(ln, la, ring)) return { code: r.code, name: r.name };
    }
  }
  return null;
}

export default { REGIONS, REGION_CODES, isRegionCode, regionName, regionBbox, regionAt };
