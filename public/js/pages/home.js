/* =============================================================
   home.js — Schermata principale: mappa a tutto schermo con percorsi,
   eventi, POI e (dal livello sbloccato) amici live. Ricarica i dati
   quando la vista cambia. Pulsanti flottanti: posizione + live.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, addMarker, viewportBbox } from '../core/map.js';
import { getCurrentPosition, decodePolyline } from '../core/geo.js';
import { maybeAutoStart } from '../core/onboarding.js';
import { $, svg, loader, toast, modal, el, fmtDistance, fmtDuration, debounce } from '../core/ui.js';
import { catIcon, poiIcon, catLabel } from '../core/constants.js';
import api from '../core/api.js';

let map;
let userMarker = null;
let liveOn = false;
const markers = { routes: new Map(), events: new Map(), pois: new Map(), live: new Map() };

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'map' });

  $('#fab-locate').innerHTML = svg('crosshair', 22);
  $('#fab-live').innerHTML = svg('users', 22);

  map = await createMap('map');
  loader.hide();

  // Tutorial di benvenuto alla prima apertura dopo la registrazione.
  maybeAutoStart();

  map.on('load', () => {
    locate(false);
    reload();
  });
  map.on('moveend', debounce(reload, 400));

  $('#fab-locate').addEventListener('click', () => locate(true));
  $('#fab-live').addEventListener('click', toggleLive);
}

/** Centra sulla posizione dell'utente e mostra il marker "tu". */
async function locate(fly = true) {
  try {
    const pos = await getCurrentPosition();
    if (userMarker) userMarker.setLngLat([pos.lng, pos.lat]);
    else userMarker = addMarker(map, { lat: pos.lat, lng: pos.lng, className: 'mk-user pulse' });
    if (fly) map.flyTo({ center: [pos.lng, pos.lat], zoom: 12, duration: 700 });
    else if (map.getZoom() < 7) map.jumpTo({ center: [pos.lng, pos.lat], zoom: 11 });
  } catch {
    if (fly) toast.warning('Posizione non disponibile. Controlla i permessi GPS.');
  }
}

/** Ricarica percorsi/eventi/POI visibili nella viewport. */
const reload = async () => {
  const bbox = viewportBbox(map);
  try {
    const [r, e, p] = await Promise.all([
      api.get('/routes', { bbox, limit: 80 }),
      api.get('/events', { status: 'scheduled' }),
      api.get('/pois', { bbox }),
    ]);
    syncRoutes(r.routes || []);
    syncEvents(e.events || []);
    syncPois(p.pois || []);
  } catch { /* offline: silenzioso */ }
};

function syncRoutes(routes) {
  for (const rt of routes) {
    if (markers.routes.has(rt.id)) continue;
    const m = addMarker(map, {
      lat: rt.start_lat, lng: rt.start_lng, className: 'mk route', html: svg(catIcon(rt.category), 14),
      onClick: () => openRouteSheet(rt),
    });
    markers.routes.set(rt.id, m);
  }
}
function syncEvents(events) {
  for (const ev of events) {
    if (markers.events.has(ev.id)) continue;
    const m = addMarker(map, {
      lat: ev.area_lat, lng: ev.area_lng, className: 'mk event', html: svg('megaphone', 14),
      onClick: () => (location.href = `/event.html?id=${ev.id}`),
    });
    markers.events.set(ev.id, m);
  }
}
function syncPois(pois) {
  for (const po of pois) {
    if (markers.pois.has(po.id)) continue;
    const m = addMarker(map, {
      lat: po.lat, lng: po.lng, className: 'mk poi', html: svg(poiIcon(po.category), 14),
      popupHtml: `<strong>${po.name}</strong><br><span style="color:#666">${po.description || ''}</span>`,
    });
    markers.pois.set(po.id, m);
  }
}

/** Foglio riepilogo percorso con anteprima linea sulla mappa. */
function openRouteSheet(rt) {
  const body = el('div', {}, [
    el('div', { class: 'flex gap-2 wrap mb-3' }, [
      el('span', { class: 'chip sm', html: `${svg(catIcon(rt.category), 14)} ${catLabel(rt.category)}` }),
      el('span', { class: 'chip sm', text: rt.difficulty }),
    ]),
    rt.description ? el('p', { class: 'text-mid mb-3', text: rt.description }) : null,
    el('div', { class: 'stats-row mb-4' }, [
      stat(fmtDistance(rt.distance_m), 'Distanza'),
      stat(fmtDuration(rt.est_time_s), 'Tempo stim.'),
      stat(`${rt.elevation_gain_m || 0} m`, 'Dislivello'),
    ]),
    el('a', { class: 'btn btn-primary btn-block', href: `/route.html?id=${rt.id}`, text: 'Apri percorso' }),
  ]);
  modal({ title: rt.name, content: body });
}
const stat = (v, k) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })]);

/** Attiva/disattiva il livello "live": mostra amici (sempre) e sconosciuti public. */
async function toggleLive() {
  const fab = $('#fab-live');
  liveOn = !liveOn;
  fab.classList.toggle('active', liveOn);
  if (!liveOn) {
    markers.live.forEach((m) => m.remove());
    markers.live.clear();
    clearInterval(home._liveTimer);
    return;
  }
  await refreshLive();
  home._liveTimer = setInterval(refreshLive, 8000);
}

async function refreshLive() {
  try {
    const { users } = await api.get('/live/nearby', { bbox: viewportBbox(map) });
    const seen = new Set();
    for (const u of users || []) {
      seen.add(u.id);
      if (markers.live.has(u.id)) markers.live.get(u.id).setLngLat([u.last_lng, u.last_lat]);
      else markers.live.set(u.id, addMarker(map, {
        lat: u.last_lat, lng: u.last_lng, className: 'mk-friend',
        html: `<img src="${u.avatar}" alt="${u.nickname}">`,
        popupHtml: `<strong>${u.nickname}</strong> · Liv. ${u.level}`,
      }));
    }
    // Rimuovi chi non è più live.
    for (const [id, m] of markers.live) if (!seen.has(id)) { m.remove(); markers.live.delete(id); }
  } catch { /* silenzioso */ }
}

const home = {};
main();
