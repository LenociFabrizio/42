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
import { getCurrentPosition, decodePolyline, haversine } from '../core/geo.js';
import { maybeAutoStart } from '../core/onboarding.js';
import { $, svg, loader, toast, modal, el, fmtDistance, fmtDuration, debounce } from '../core/ui.js';
import { catIcon, poiIcon, catLabel } from '../core/constants.js';
import api from '../core/api.js';

let map;
let userMarker = null;
let liveOn = false;
let watchId = null;
const markers = { routes: new Map(), events: new Map(), pois: new Map(), live: new Map() };
// Dati correnti (per il rilevamento di prossimità) + stato del prompt.
let dataRoutes = [];
let dataEvents = [];
const proxDismissed = new Set();
let proxCurrent = null;
let proxEl = null;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'map' });

  $('#fab-locate').innerHTML = svg('crosshair', 22);
  $('#fab-live').innerHTML = svg('users', 22);
  $('#fab-drive').innerHTML = svg('navigation', 22);

  map = await createMap('map');
  loader.hide();

  // Tutorial di benvenuto alla prima apertura dopo la registrazione.
  maybeAutoStart();

  map.on('load', () => {
    locate(false);
    reload();
    startWatch();
  });
  map.on('moveend', debounce(reload, 400));

  $('#fab-locate').addEventListener('click', () => locate(true));
  $('#fab-live').addEventListener('click', toggleLive);
  $('#fab-drive').addEventListener('click', () => (location.href = '/drive.html'));
}

/** Segue la posizione (aggiorna il marker "tu") e valuta la prossimità. */
function startWatch() {
  if (!('geolocation' in navigator) || watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      if (userMarker) userMarker.setLngLat([lng, lat]);
      else userMarker = addMarker(map, { lat, lng, className: 'mk-user pulse' });
      checkProximity(lat, lng);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
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
    dataRoutes = r.routes || [];
    dataEvents = e.events || [];
    syncRoutes(dataRoutes);
    syncEvents(dataEvents);
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

/* ============================================================
 *  PROSSIMITÀ — quando ti avvicini a un percorso o a un evento,
 *  compare un prompt animato per partecipare (Sì/No). Se ti allontani
 *  il prompt sparisce e l'app torna com'era. Isteresi enter/exit per
 *  evitare che appaia e sparisca di continuo.
 * ============================================================ */
function checkProximity(lat, lng) {
  const candidates = [];

  for (const ev of dataEvents) {
    if (ev.status === 'ended' || ev.status === 'cancelled') continue;
    const enter = Math.min(ev.radius_m || 500, 1000);
    const exit = enter + 250;
    const d = haversine(lat, lng, ev.area_lat, ev.area_lng);
    const key = `e${ev.id}`;
    if (d > exit) { proxDismissed.delete(key); if (proxCurrent === key) hideProx(); continue; }
    if (d <= enter && !proxDismissed.has(key)) candidates.push({ key, type: 'event', item: ev, d });
  }
  for (const rt of dataRoutes) {
    const enter = 150, exit = 400;
    const d = haversine(lat, lng, rt.start_lat, rt.start_lng);
    const key = `r${rt.id}`;
    if (d > exit) { proxDismissed.delete(key); if (proxCurrent === key) hideProx(); continue; }
    if (d <= enter && !proxDismissed.has(key)) candidates.push({ key, type: 'route', item: rt, d });
  }

  if (proxCurrent) return; // un prompt alla volta: resta finché non ci si allontana/risponde
  if (!candidates.length) return;
  candidates.sort((a, b) => a.d - b.d);
  showProx(candidates[0], lat, lng);
}

function showProx(cand, lat, lng) {
  hideProx(true);
  proxCurrent = cand.key;
  const isEvent = cand.type === 'event';
  const name = cand.item.name || (isEvent ? 'evento' : 'percorso');

  const yes = el('button', { class: 'btn btn-primary', text: 'Sì' });
  const no = el('button', { class: 'btn btn-outline', text: 'No, grazie' });
  proxEl = el('div', { class: 'prox-prompt' }, [
    el('div', { class: 'prox-head' }, [
      el('div', { class: 'prox-ic', html: svg(isEvent ? 'megaphone' : 'flag', 24) }),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'prox-title', text: isEvent ? `Sei al ritrovo di «${name}»` : `Sei all'inizio di «${name}»` }),
        el('div', { class: 'prox-sub', text: isEvent ? 'Vuoi partecipare e fare il check-in?' : 'Vuoi registrare un tentativo su questo percorso?' }),
      ]),
    ]),
    el('div', { class: 'prox-actions' }, [no, yes]),
  ]);
  document.body.append(proxEl);

  no.addEventListener('click', () => { proxDismissed.add(cand.key); hideProx(); });
  yes.addEventListener('click', async () => {
    if (isEvent) {
      yes.disabled = true; yes.textContent = 'Check-in…';
      try {
        const res = await api.post(`/events/${cand.item.id}/checkin`, { lat, lng });
        toast.success('Sei presente all\'evento! ✅');
        proxDismissed.add(cand.key);
        hideProx();
      } catch (err) {
        toast.error(err.message || 'Check-in non riuscito.');
        yes.disabled = false; yes.textContent = 'Sì';
      }
    } else {
      location.href = `/record.html?route=${cand.item.id}`;
    }
  });
}

function hideProx(immediate = false) {
  const node = proxEl;
  proxEl = null; proxCurrent = null;
  if (!node) return;
  if (immediate) { node.remove(); return; }
  node.classList.add('leaving');
  setTimeout(() => node.remove(), 260);
}

const home = {};
main();
