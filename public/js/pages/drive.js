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
import { createMap, addMarker, viewportBbox, onMapReady } from '../core/map.js';
import { bearing as bearingBetween } from '../core/geo.js';
import { $, svg, loader, toast, debounce, esc } from '../core/ui.js';
import { catIcon, DRIVE_MODE_ENABLED } from '../core/constants.js';
import { TrackingSession, bgEnabled } from '../core/tracking.js';
import api from '../core/api.js';

let map;
let watchId = null;
let headingUp = true;
let lastBearing = 0;
let prev = null; // ultima posizione per calcolare la direzione se manca il course GPS
let follow = true;
let playerMarker = null;
// Percorsi ed eventi mostrati anche in Solo Mappa.
const poiMarkers = { routes: new Map(), events: new Map() };
const session = new TrackingSession({ label: 'Modalità Solo Mappa attiva: la tua posizione è in uso.' });

/** Freccia del pilota: marker ancorato alle coordinate GPS. */
const ARROW_HTML = `
  <span class="drive-arrow">
    <svg viewBox="0 0 24 24" width="44" height="44" fill="none">
      <path d="M12 2 4.5 21 12 17.4 19.5 21 12 2Z" fill="#ffb020" stroke="#120a00" stroke-width="1.3" stroke-linejoin="round" />
    </svg>
  </span>`;

async function main() {
  // Funzionalità sospesa: chi arriva qui da un link salvato torna alla mappa.
  if (!DRIVE_MODE_ENABLED) { location.replace('/index.html'); return; }

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

  // Percorsi ed eventi visibili anche qui: si ricaricano quando cambia la vista.
  onMapReady(map, loadNearbyContent);
  map.on('moveend', debounce(loadNearbyContent, 500));

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

  // La freccia segue le COORDINATE, non il centro dello schermo.
  if (playerMarker) playerMarker.setLngLat([lng, lat]);
  else playerMarker = addMarker(map, { lat, lng, className: 'mk-drive', html: ARROW_HTML });

  applyOrientation(bearing, lat, lng);
  const kmh = typeof speed === 'number' && speed >= 0 ? Math.round(speed * 3.6) : null;
  $('#spd').textContent = kmh == null ? '0' : kmh;
}

function applyOrientation(bearing, lat, lng) {
  const opts = { duration: 500 };
  if (follow && lat != null) opts.center = [lng, lat];
  opts.bearing = headingUp ? bearing : 0;
  map.easeTo(opts);
  // La freccia: in heading-up la mappa è già ruotata, quindi punta in alto; in
  // nord-in-alto è la freccia a ruotare verso la direzione di marcia.
  const arrow = playerMarker?.getElement()?.querySelector('.drive-arrow');
  if (arrow) arrow.style.transform = `rotate(${headingUp ? 0 : bearing}deg)`;
  // Bussola: in heading-up l'ago del nord ruota di -bearing; in nord-in-alto resta su.
  const needle = $('#needle');
  if (needle) needle.style.transform = `rotate(${headingUp ? -bearing : 0}deg)`;
}

/**
 * Carica percorsi ed eventi nella vista corrente e li mostra come marker.
 * Toccandoli si apre la relativa scheda.
 */
async function loadNearbyContent() {
  if (!map) return;
  const bbox = viewportBbox(map);
  try {
    const [r, e] = await Promise.all([
      api.get('/routes', { bbox, limit: 60 }),
      api.get('/events', { status: 'scheduled' }),
    ]);
    // Popup (non navigazione diretta): alla guida un tocco accidentale non
    // deve buttarti fuori dalla minimappa. Il link è dentro il popup.
    for (const rt of r.routes || []) {
      if (poiMarkers.routes.has(rt.id)) continue;
      poiMarkers.routes.set(rt.id, addMarker(map, {
        lat: rt.start_lat, lng: rt.start_lng, className: 'mk route', html: svg(catIcon(rt.category), 14),
        popupHtml: `<div class="map-popup"><strong>${esc(rt.name)}</strong><a href="/route.html?id=${rt.id}">Apri percorso</a></div>`,
      }));
    }
    for (const ev of e.events || []) {
      if (poiMarkers.events.has(ev.id)) continue;
      poiMarkers.events.set(ev.id, addMarker(map, {
        lat: ev.area_lat, lng: ev.area_lng, className: 'mk event', html: svg('megaphone', 14),
        popupHtml: `<div class="map-popup"><strong>${esc(ev.name)}</strong><a href="/event.html?id=${ev.id}">Apri evento</a></div>`,
      }));
    }
  } catch { /* offline: la minimappa resta usabile */ }
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
