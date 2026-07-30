/**
 * geo.js
 * ------------------------------------------------------------
 * Utilità geospaziali lato server: distanza (haversine), metriche di
 * traccia (distanza/dislivello/velocità), codifica polyline (Google,
 * precisione 5), riquadro di delimitazione (bbox) e geofencing.
 *
 * Formati:
 *  - un "punto" è { lat, lng, ele?, t?, speed? } oppure [lat, lng].
 *  - le coordinate sono in gradi decimali (WGS84).
 * ------------------------------------------------------------
 */

const R_EARTH = 6371008.8; // raggio medio terrestre in metri
const toRad = (d) => (d * Math.PI) / 180;

const lat = (p) => (Array.isArray(p) ? p[0] : p.lat);
const lng = (p) => (Array.isArray(p) ? p[1] : p.lng);

/**
 * Riquadro dell'Italia (leggermente generoso: include isole minori come
 * Lampedusa a sud). La WebApp opera solo sul territorio italiano.
 */
export const ITALY_BBOX = { minLat: 35.2, minLng: 6.5, maxLat: 47.3, maxLng: 18.7 };

/** True se la coordinata ricade nel territorio italiano (approssimazione bbox). */
export function isInItaly(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= ITALY_BBOX.minLat && lat <= ITALY_BBOX.maxLat &&
    lng >= ITALY_BBOX.minLng && lng <= ITALY_BBOX.maxLng
  );
}

/** Distanza in metri tra due coordinate (Haversine). */
export function haversine(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** True se il punto è entro `radiusM` metri dal centro (geofence circolare). */
export function isWithinRadius(pLat, pLng, centerLat, centerLng, radiusM) {
  return haversine(pLat, pLng, centerLat, centerLng) <= radiusM;
}

/**
 * Riquadro di delimitazione di una lista di punti.
 * @returns {{minLat,minLng,maxLat,maxLng}|null}
 */
export function bbox(points) {
  if (!points || !points.length) return null;
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const p of points) {
    const la = lat(p), ln = lng(p);
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  return { minLat, minLng, maxLat, maxLng };
}

/**
 * Metriche di una traccia GPS: distanza totale (m), dislivello positivo (m),
 * velocità media/massima (km/h). Robusto a punti rumorosi:
 *  - ignora salti di distanza irrealistici tra campioni successivi.
 *  - stima la velocità dai timestamp se presenti, altrimenti dal campo speed.
 * @param {Array} points  punti { lat, lng, ele?, t?(ms), speed?(m/s) }
 */
export function trackMetrics(points = []) {
  let distance = 0;
  let elevationGain = 0;
  let maxSpeed = 0;
  let movingTimeS = 0;
  let prev = null;

  for (const p of points) {
    if (prev) {
      const d = haversine(lat(prev), lng(prev), lat(p), lng(p));
      // Glitch GPS: SALTO grande in POCO tempo. Lo riconosciamo solo se ci sono
      // i timestamp (traccia registrata) e la velocità implicita è irrealistica
      // (> 400 km/h). Sui percorsi DISEGNATI a mano i punti non hanno timestamp
      // e possono distare km: in quel caso la distanza va sempre contata.
      let glitch = false;
      if (typeof prev.t === 'number' && typeof p.t === 'number' && p.t > prev.t) {
        const dtS = (p.t - prev.t) / 1000;
        const v = (d / dtS) * 3.6; // km/h
        if (v > 400) glitch = true;
        else {
          movingTimeS += dtS;
          if (v > maxSpeed) maxSpeed = v;
        }
      }
      if (!glitch) {
        distance += d;
        const e0 = prev.ele, e1 = p.ele;
        if (typeof e0 === 'number' && typeof e1 === 'number' && e1 > e0) elevationGain += e1 - e0;
      }
    }
    if (typeof p.speed === 'number') {
      const v = p.speed * 3.6;
      if (v < 400 && v > maxSpeed) maxSpeed = v;
    }
    prev = p;
  }

  const avgSpeed = movingTimeS > 0 ? (distance / movingTimeS) * 3.6 : 0;
  return {
    distance_m: Math.round(distance),
    elevation_gain_m: Math.round(elevationGain),
    moving_time_s: Math.round(movingTimeS),
    avg_speed_kmh: Math.round(avgSpeed * 10) / 10,
    max_speed_kmh: Math.round(maxSpeed * 10) / 10,
  };
}

/* ============================================================
 *  Polyline (algoritmo Google Encoded Polyline, precisione 5)
 *  Compatibile con il decoder lato client (public/js/core/geo.js).
 * ============================================================ */

function encodeSigned(num) {
  let sgn = num << 1;
  if (num < 0) sgn = ~sgn;
  let out = '';
  while (sgn >= 0x20) {
    out += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  out += String.fromCharCode(sgn + 63);
  return out;
}

/**
 * Codifica una lista di punti in una polyline (precisione 5).
 * @param {Array} points  [{lat,lng}] oppure [[lat,lng]]
 */
export function encodePolyline(points = [], precision = 5) {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0, prevLng = 0;
  for (const p of points) {
    const la = Math.round(lat(p) * factor);
    const ln = Math.round(lng(p) * factor);
    out += encodeSigned(la - prevLat);
    out += encodeSigned(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

/**
 * Decodifica una polyline in [{lat,lng}].
 */
export function decodePolyline(str = '', precision = 5) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0, latSum = 0, lngSum = 0;
  while (index < str.length) {
    let result = 0, shift = 0, b;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    latSum += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lngSum += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: latSum / factor, lng: lngSum / factor });
  }
  return points;
}

/**
 * Semplifica una traccia riducendo i punti (Douglas–Peucker) per storage e
 * rendering leggeri. tolerance in gradi (~1e-5 ≈ 1.1 m). Preserva la forma.
 */
export function simplify(points = [], tolerance = 0.00002) {
  if (points.length < 3) return points.slice();
  const sqTol = tolerance * tolerance;

  const getSqSegDist = (p, a, b) => {
    let x = lng(a), y = lat(a);
    let dx = lng(b) - x, dy = lat(b) - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((lng(p) - x) * dx + (lat(p) - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = lng(b); y = lat(b); }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = lng(p) - x;
    dy = lat(p) - y;
    return dx * dx + dy * dy;
  };

  const markers = new Uint8Array(points.length);
  markers[0] = markers[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0, idx = 0;
    for (let i = first + 1; i < last; i++) {
      const sq = getSqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) { idx = i; maxSq = sq; }
    }
    if (maxSq > sqTol) {
      markers[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => markers[i]);
}
