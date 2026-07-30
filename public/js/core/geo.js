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
export async function roadRoute(waypoints, profile = 'driving') {
  if (!waypoints || waypoints.length < 2) return null;
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=polyline`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.routes && data.routes[0];
    if (!r || !r.geometry) return null;
    return { points: decodePolyline(r.geometry), distance_m: Math.round(r.distance), duration_s: Math.round(r.duration) };
  } catch {
    return null;
  }
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
