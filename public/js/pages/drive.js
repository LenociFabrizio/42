/* =============================================================
   drive.js — Modalità "Solo Mappa" (minimappa stile NFS MW 2005).
   Mappa a schermo intero centrata sull'utente, orientata verso la
   direzione di marcia (heading-up): la mappa ruota, la freccia del
   giocatore resta ferma al centro. Bussola per alternare
   direzione-in-alto / nord-in-alto. Tachimetro live.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { registerPWA } from '../core/pwa.js';
import { createMap } from '../core/map.js';
import { $, svg, loader, toast } from '../core/ui.js';
import { TrackingSession, bgEnabled } from '../core/tracking.js';

let map;
let watchId = null;
let headingUp = true;
let lastBearing = 0;
let prev = null; // ultima posizione per calcolare la direzione se manca il course GPS
let follow = true;
const session = new TrackingSession({ label: 'Modalità Solo Mappa attiva: la tua posizione è in uso.' });

function bearingBetween(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180, toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();

  $('#exit').innerHTML = svg('x', 22);
  $('#recenter').innerHTML = svg('crosshair', 22);
  $('#needle').innerHTML = svg('navigation', 20);

  map = await createMap('map', { zoom: 16.5 });
  loader.hide();

  $('#exit').addEventListener('click', () => { stop(); location.href = '/index.html'; });
  $('#recenter').addEventListener('click', () => { follow = true; if (prev) map.easeTo({ center: [prev.lng, prev.lat], zoom: 16.5, duration: 500 }); });
  $('#compass').addEventListener('click', toggleOrientation);
  // Se l'utente sposta la mappa manualmente, sospendi il "follow" finché non ricentra.
  map.on('dragstart', () => { follow = false; });

  await session.start();
  if (!('geolocation' in navigator)) { toast.error('Geolocalizzazione non supportata.'); return; }
  watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });

  window.addEventListener('pagehide', stop);
}

function onPos(pos) {
  const { latitude: lat, longitude: lng, heading, speed } = pos.coords;
  // Direzione: course GPS se valido, altrimenti calcolata dallo spostamento.
  let bearing = lastBearing;
  if (typeof heading === 'number' && !isNaN(heading) && heading >= 0 && (speed == null || speed > 0.5)) {
    bearing = heading;
  } else if (prev) {
    const moved = Math.abs(prev.lat - lat) + Math.abs(prev.lng - lng);
    if (moved > 0.00002) bearing = bearingBetween(prev.lat, prev.lng, lat, lng);
  }
  lastBearing = bearing;
  prev = { lat, lng };

  applyOrientation(bearing, lat, lng);
  const kmh = typeof speed === 'number' && speed >= 0 ? Math.round(speed * 3.6) : null;
  $('#spd').textContent = kmh == null ? '0' : kmh;
}

function applyOrientation(bearing, lat, lng) {
  const opts = { duration: 500 };
  if (follow && lat != null) opts.center = [lng, lat];
  opts.bearing = headingUp ? bearing : 0;
  map.easeTo(opts);
  // La freccia del giocatore: in heading-up punta sempre in alto; in nord-in-alto ruota verso la direzione.
  const arrow = document.querySelector('.drive-arrow');
  if (arrow) arrow.style.transform = `rotate(${headingUp ? 0 : bearing}deg)`;
  // Bussola: in heading-up l'ago del nord ruota di -bearing; in nord-in-alto resta su.
  const needle = $('#needle');
  if (needle) needle.style.transform = `rotate(${headingUp ? -bearing : 0}deg)`;
}

function toggleOrientation() {
  headingUp = !headingUp;
  toast.info(headingUp ? 'Direzione in alto' : 'Nord in alto', { duration: 1200 });
  applyOrientation(lastBearing, prev?.lat, prev?.lng);
}

function onErr() { toast.warning('Posizione non disponibile. Controlla i permessi GPS.'); }

function stop() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  session.stop();
}

main();
