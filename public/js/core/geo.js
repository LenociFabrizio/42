/* =============================================================
   geo.js — Utilità geospaziali lato client + tracker GPS.
   La codifica polyline è compatibile con server/utils/geo.js
   (algoritmo Google, precisione 5).
   ============================================================= */

const R_EARTH = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Rotta iniziale da A a B, in gradi 0-360 (0 = nord, 90 = est). Serve a orientare
 * la freccia del pilota quando il GPS non fornisce `heading` (fermi o dispositivi
 * senza bussola): la direzione si ricava dallo spostamento.
 */
export function bearing(aLat, aLng, bLat, bLng) {
  const toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat))
    - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Distanza in metri dal punto P al segmento A→B. Alla scala di un percorso la
 * curvatura terrestre è trascurabile: i gradi si proiettano in metri locali e il
 * problema si risolve in piano.
 *
 * Serve a riconoscere il TAGLIO DEL TRAGUARDO anche in velocità: fra due
 * campioni GPS a 100 km/h si percorrono decine di metri, e controllando solo i
 * punti si potrebbe attraversare l'arrivo senza risultarci mai dentro.
 */
export function distanceToSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
  const mLat = 111320;
  const mLng = 111320 * Math.cos(toRad((aLat + bLat) / 2));
  const bx = (bLng - aLng) * mLng, by = (bLat - aLat) * mLat;   // B rispetto ad A
  const px = (pLng - aLng) * mLng, py = (pLat - aLat) * mLat;   // P rispetto ad A
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}

export function decodePolyline(str = '', precision = 5) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let result = 0, shift = 0, b;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / factor, lng / factor]); // [lat, lng]
  }
  return points;
}

export function bounds(points) {
  if (!points || !points.length) return null;
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  for (const p of points) {
    const la = p[0] ?? p.lat, ln = p[1] ?? p.lng;
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln);
  }
  return [[minLng, minLat], [maxLng, maxLat]]; // formato LngLatBounds MapLibre
}

/**
 * GpsTracker — registra la posizione (watchPosition), accumula i punti,
 * calcola distanza/velocità in tempo reale. Filtra i campioni imprecisi.
 *
 * Eventi tramite callback onUpdate(state): { points, distance_m, speed_kmh,
 * maxSpeed_kmh, elapsed_s, last:{lat,lng} }.
 */
export class GpsTracker {
  constructor({ onUpdate, onError } = {}) {
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.points = [];
    this.distance = 0;
    this.maxSpeed = 0;
    this.watchId = null;
    this.startTs = null;
    this.pausedMs = 0;
    this._pauseStart = null;
    this.running = false;
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.onError?.(new Error('Geolocalizzazione non supportata dal dispositivo.'));
      return;
    }
    this.running = true;
    this.startTs = Date.now();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._onPos(pos),
      (err) => this.onError?.(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  pause() { if (this.running) { this.running = false; this._pauseStart = Date.now(); } }
  resume() { if (!this.running) { this.running = true; if (this._pauseStart) { this.pausedMs += Date.now() - this._pauseStart; this._pauseStart = null; } } }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.running = false;
    return this.result();
  }

  _onPos(pos) {
    if (!this.running) return;
    const { latitude: lat, longitude: lng, altitude, speed, accuracy } = pos.coords;
    // Scarta campioni molto imprecisi (> 40 m).
    if (accuracy != null && accuracy > 40 && this.points.length) return;
    const t = Date.now();
    const point = { lat, lng, t };
    if (typeof altitude === 'number' && !isNaN(altitude)) point.ele = altitude;
    if (typeof speed === 'number' && !isNaN(speed) && speed >= 0) point.speed = speed;

    const prev = this.points[this.points.length - 1];
    if (prev) {
      const d = haversine(prev.lat, prev.lng, lat, lng);
      if (d < 1.5) return; // rumore da fermo: ignora spostamenti < 1.5 m
      if (d <= 2000) this.distance += d;
    }
    this.points.push(point);

    const inst = typeof point.speed === 'number' ? point.speed * 3.6
      : prev && point.t > prev.t ? (haversine(prev.lat, prev.lng, lat, lng) / ((point.t - prev.t) / 1000)) * 3.6 : 0;
    if (inst < 400 && inst > this.maxSpeed) this.maxSpeed = inst;

    this.onUpdate?.(this.state(inst));
  }

  elapsed() {
    if (!this.startTs) return 0;
    const now = this.running ? Date.now() : (this._pauseStart || Date.now());
    return Math.max(0, Math.round((now - this.startTs - this.pausedMs) / 1000));
  }

  state(instSpeed = 0) {
    const last = this.points[this.points.length - 1];
    return {
      points: this.points,
      distance_m: Math.round(this.distance),
      speed_kmh: Math.round(instSpeed),
      maxSpeed_kmh: Math.round(this.maxSpeed),
      elapsed_s: this.elapsed(),
      last: last ? { lat: last.lat, lng: last.lng } : null,
    };
  }

  result() {
    return {
      track: this.points,
      distance_m: Math.round(this.distance),
      maxSpeed_kmh: Math.round(this.maxSpeed),
      elapsed_s: this.elapsed(),
      time_ms: this.elapsed() * 1000,
    };
  }
}

/**
 * Calcola un percorso che SEGUE LE STRADE tra i waypoint usando OSRM
 * (istanza demo pubblica, senza chiave). Ritorna
 *   { points: [[lat,lng], ...], distance_m, duration_s }
 * dove `points` è la geometria stradale. In caso di errore/limite ritorna
 * null, così il chiamante può ripiegare sulla linea dritta tra i punti.
 * @param {Array<{lat:number,lng:number}>} waypoints  almeno 2
 * @param {string} profile  'driving' (default) | 'bike' | 'foot'
 */
/**
 * Calcola un itinerario RISPETTANDO le preferenze di guida (evita pedaggi,
 * autostrade, traghetti) con Valhalla, che le supporta davvero — a differenza
 * del server OSRM pubblico, che rifiuta il parametro `exclude`.
 *
 * @param {Array<{lat:number,lng:number}>} waypoints
 * @param {object} o
 * @param {boolean} [o.avoidTolls]
 * @param {boolean} [o.avoidMotorways]
 * @param {boolean} [o.avoidFerries]
 * @param {'auto'|'motorcycle'} [o.costing]  modello di costo (auto o moto)
 * @returns {Promise<{points:Array,distance_m:number,duration_s:number,engine:string}|null>}
 */
export async function navRoute(waypoints, { avoidTolls = false, avoidMotorways = false, avoidFerries = false, costing = 'auto' } = {}) {
  if (!waypoints || waypoints.length < 2) return null;

  const model = costing === 'motorcycle' ? 'motorcycle' : 'auto';
  // In Valhalla i "use_*" sono propensioni 0..1: 0 = evita il più possibile.
  const opts = {};
  if (avoidTolls) opts.use_tolls = 0;
  if (avoidMotorways) opts.use_highways = 0;
  if (avoidFerries) opts.use_ferry = 0;

  try {
    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: waypoints.map((p) => ({ lat: p.lat, lon: p.lng })),
        costing: model,
        costing_options: { [model]: opts },
        directions_options: { units: 'kilometers' },
      }),
    });
    if (!res.ok) throw new Error('valhalla');
    const data = await res.json();
    const trip = data.trip;
    const shape = trip?.legs?.map((l) => l.shape).join('') || '';
    if (!trip?.summary || !shape) throw new Error('valhalla-empty');
    return {
      // Valhalla codifica la shape con precisione 6 (non 5 come OSRM).
      points: decodePolyline(shape, 6),
      distance_m: Math.round((trip.summary.length || 0) * 1000),
      duration_s: Math.round(trip.summary.time || 0),
      engine: 'valhalla',
      applied: Object.keys(opts),
      dropped: [],
    };
  } catch {
    // Valhalla non raggiungibile: ripieghiamo su OSRM (percorso più veloce,
    // senza poter applicare le preferenze) segnalandolo al chiamante.
    const r = await roadRoute(waypoints, 'driving');
    if (!r) return null;
    const wanted = [];
    if (avoidTolls) wanted.push('toll');
    if (avoidMotorways) wanted.push('motorway');
    if (avoidFerries) wanted.push('ferry');
    return { ...r, engine: 'osrm', applied: [], dropped: wanted };
  }
}

export async function roadRoute(waypoints, profile = 'driving', { exclude = [] } = {}) {
  if (!waypoints || waypoints.length < 2) return null;
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';');

  // OSRM accetta `exclude` solo per le classi previste dal profilo e non
  // sempre in combinazione. Proviamo con tutte le esclusioni richieste e, se
  // il router rifiuta, ne togliamo una alla volta finché la richiesta passa:
  // meglio un percorso con qualche preferenza in meno che nessun percorso.
  const attempts = [];
  const list = [...new Set(exclude.filter(Boolean))];
  for (let n = list.length; n > 0; n--) attempts.push(list.slice(0, n));
  attempts.push([]); // ultimo tentativo: nessuna esclusione

  for (const ex of attempts) {
    const params = new URLSearchParams({ overview: 'full', geometries: 'polyline' });
    if (ex.length) params.set('exclude', ex.join(','));
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?${params}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue; // esclusione non supportata: prova con meno vincoli
      const data = await res.json();
      const r = data.routes && data.routes[0];
      if (!r || !r.geometry) continue;
      return {
        points: decodePolyline(r.geometry),
        distance_m: Math.round(r.distance),
        duration_s: Math.round(r.duration),
        // Esclusioni effettivamente applicate e quelle cadute per strada.
        applied: ex,
        dropped: list.filter((x) => !ex.includes(x)),
      };
    } catch {
      return null; // rete assente: inutile insistere
    }
  }
  return null;
}

/** Ottiene la posizione corrente una tantum (Promise). */
export function getCurrentPosition(opts = { enableHighAccuracy: true, timeout: 12000 }) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Geolocalizzazione non supportata.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      opts
    );
  });
}
