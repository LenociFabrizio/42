/**
 * build-regions.cjs
 * ------------------------------------------------------------
 * Genera `server/utils/regionsGeo.js` dai confini in
 * `public/data/italy-regions.geojson` (la stessa sorgente che la mappa usa per
 * disegnare le aree).
 *
 * PERCHÉ un file generato invece di leggere il GeoJSON a runtime: in produzione
 * l'API gira come funzione serverless e il bundle include solo i file
 * raggiungibili staticamente dagli import. Un modulo JS importato è sempre
 * incluso; un readFileSync su un percorso costruito a runtime no. Le geometrie
 * vengono anche semplificate (Douglas-Peucker) e arrotondate: al server serve
 * rispondere "in quale regione sei", non ridisegnare i confini.
 *
 * Uso: npm run build:regions
 * ------------------------------------------------------------
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'data', 'italy-regions.geojson');
const OUT = path.join(ROOT, 'server', 'utils', 'regionsGeo.js');

// Tolleranza in gradi (~0.002° ≈ 200 m): confine impreciso di un paio di
// centinaia di metri, irrilevante per sbloccare un'area grande come una regione.
const EPS = 0.002;
const DEC = 4; // ~11 m di risoluzione per coordinata

// Nome leggibile per le regioni che nel dataset hanno la forma bilingue.
const DISPLAY = {
  "Valle d'Aosta/Vallée d'Aoste": "Valle d'Aosta",
  'Trentino-Alto Adige/Südtirol': 'Trentino-Alto Adige',
};

const slug = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Distanza punto-segmento al quadrato (in gradi, piano locale). */
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker ricorsivo. */
function simplify(points, eps) {
  if (points.length <= 3) return points;
  const sq = eps * eps;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0, index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > sq && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n) => Number(n.toFixed(DEC));

function ringsOf(geometry) {
  // Solo gli anelli esterni: i buchi (enclavi tipo San Marino) non cambiano la
  // risposta utile e raddoppierebbero il peso.
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly[0]);
  return [];
}

const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const regions = [];
let rawPoints = 0, keptPoints = 0;

for (const f of geo.features) {
  const geoName = f.properties.name;
  const name = DISPLAY[geoName] || geoName;
  const rings = [];
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

  for (const ring of ringsOf(f.geometry)) {
    rawPoints += ring.length;
    // Anelli minuscoli (isolotti): si scartano, non sono "aree" da scoprire.
    const simplified = simplify(ring, EPS);
    if (simplified.length < 4) continue;
    keptPoints += simplified.length;
    const out = [];
    for (const [lng, lat] of simplified) {
      out.push([round(lng), round(lat)]);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    rings.push(out);
  }

  regions.push({
    code: slug(name), name, geoName,
    bbox: [round(minLng), round(minLat), round(maxLng), round(maxLat)],
    rings,
  });
}

const body = regions
  .map((r) => `  {\n    code: ${JSON.stringify(r.code)},\n    name: ${JSON.stringify(r.name)},\n    geoName: ${JSON.stringify(r.geoName)},\n    bbox: ${JSON.stringify(r.bbox)},\n    rings: [\n${r.rings.map((ring) => `      ${JSON.stringify(ring)},`).join('\n')}\n    ],\n  },`)
  .join('\n');

const out = `/**
 * regionsGeo.js — GENERATO, non modificare a mano.
 * Sorgente: public/data/italy-regions.geojson · rigenera con \`npm run build:regions\`
 *
 * Confini delle regioni italiane semplificati (tolleranza ~${EPS}° ≈ 200 m) e
 * ridotti agli anelli esterni: servono al server per rispondere "in quale
 * regione si trova questo punto?" quando si sblocca una nuova area.
 */
export const REGIONS_GEO = [
${body}
];

export default REGIONS_GEO;
`;

fs.writeFileSync(OUT, out, 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`  ✓ ${regions.length} regioni · punti ${rawPoints} → ${keptPoints} · ${OUT.replace(ROOT + path.sep, '')} (${kb} KB)`);
