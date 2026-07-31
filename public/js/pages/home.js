/* =============================================================
   home.js — Schermata principale: mappa a tutto schermo con percorsi,
   eventi, POI e (dal livello sbloccato) amici live. Ricarica i dati
   quando la vista cambia. Pulsanti flottanti: posizione + live.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, addMarker, viewportBbox, fitRadius } from '../core/map.js';
import { getCurrentPosition, decodePolyline, haversine } from '../core/geo.js';
import { maybeAutoStart } from '../core/onboarding.js';
import { $, svg, loader, toast, modal, confirmDialog, el, esc, fmtDistance, fmtDuration, fmtSpeed, fmtSince, debounce } from '../core/ui.js';
import { catIcon, poiIcon, catLabel, vehIcon, DEFAULT_MAP_RADIUS_KM, DRIVE_MODE_ENABLED } from '../core/constants.js';
import { initSound, playNotify, playHorn } from '../core/sound.js';
import { showDirections } from '../core/nav.js';
import { showRideDisclaimer } from '../core/disclaimer.js';
import api from '../core/api.js';

let map;
let userMarker = null;
// Livello "dove sono gli amici": attivo per impostazione predefinita (è il
// senso della mappa) e ricordato sul dispositivo.
const LIVE_LAYER_KEY = '4e2_live_layer';
const LIVE_ASK_KEY = '4e2_live_ask';
const LIVE_HINT_KEY = '4e2_live_hint';
let liveOn = localStorage.getItem(LIVE_LAYER_KEY) !== 'off';
let watchId = null;
let lastShareAt = 0;       // throttle invio posizione live

let mapRadiusKm = DEFAULT_MAP_RADIUS_KM; // raggio di visibilità (Impostazioni)
let myPos = null;          // ultima posizione nota (per il saluto col clacson)
let myCoords = null;       // ultime coordinate GPS complete (per il battito live)
// Ultima posizione salvata: apre la mappa già dalle tue parti, senza attese.
const LAST_POS_KEY = '4e2_last_pos';
let centered = false;      // la mappa è già stata inquadrata su di me?

// Prossimità: raggio MASSIMO entro cui può comparire l'avviso (1 km) e
// margine extra usato solo per farlo sparire senza sfarfallii.
const PROX_MAX_M = 1000;
const PROX_HYSTERESIS_M = 250;
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
  initSound(); // sblocca l'audio al primo tocco (policy autoplay)

  $('#fab-locate').innerHTML = svg('crosshair', 22);
  // Segnaposto con una persona dentro: si capisce a colpo d'occhio che mostra
  // "dove sono" gli amici, non solo "gli amici".
  $('#fab-live').innerHTML = svg('pinUser', 22);
  $('#fab-live').classList.toggle('active', liveOn);
  // Solo Mappa: funzionalità sospesa, il tasto resta fuori dal DOM.
  const fabDrive = $('#fab-drive');
  if (DRIVE_MODE_ENABLED) {
    fabDrive.hidden = false;
    fabDrive.innerHTML = svg('navigation', 22);
    fabDrive.addEventListener('click', () => (location.href = '/drive.html'));
  } else fabDrive.remove();

  // Il raggio preferito serve già alla prima inquadratura.
  const [createdMap] = await Promise.all([createMap('map'), loadMapRadius()]);
  map = createdMap;
  loader.hide();

  // Tutorial di benvenuto alla prima apertura dopo la registrazione.
  maybeAutoStart();
  // Avviso di guida responsabile all'ingresso (una volta per sessione).
  showRideDisclaimer();

  map.on('load', () => {
    centerOnMe();
    reload();
    startWatch();
    // Vicinanze: sempre in ascolto (serve al saluto col clacson), i marker
    // compaiono solo col livello live attivo.
    refreshLive().then(hintLiveSharing);
    clearInterval(home._liveTimer);
    home._liveTimer = setInterval(refreshLive, 8000);
    // Battito della posizione: da fermi il GPS può non richiamarci per minuti e
    // agli amici scomparirei dalla mappa (la finestra "live" è di 5 minuti).
    clearInterval(home._shareTimer);
    home._shareTimer = setInterval(() => { if (myCoords) shareLive(myCoords); }, 60000);
  });
  map.on('moveend', debounce(reload, 400));

  $('#fab-locate').addEventListener('click', () => locate(true));
  $('#fab-live').addEventListener('click', toggleLive);
}

/** Segue la posizione (aggiorna il marker "tu") e valuta la prossimità. */
function startWatch() {
  if (!('geolocation' in navigator) || watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      myPos = { lat, lng };
      myCoords = pos.coords;
      showMe(lat, lng);
      // Se l'inquadratura iniziale non è ancora riuscita (permesso concesso
      // in ritardo, primo fix lento), il primo aggiornamento centra la mappa.
      if (!centered) { centered = true; fitRadius(map, lat, lng, mapRadiusKm, { animate: true }); }
      checkProximity(lat, lng);
      shareLive(pos.coords);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

/**
 * Condivide la posizione live (solo se l'utente ha dato il consenso in
 * Impostazioni). Throttle a 15s: basta per la live map e risparmia batteria.
 */
async function shareLive(coords) {
  if (!auth.user?.live_enabled) return;
  const now = Date.now();
  if (now - lastShareAt < 15000) return;
  lastShareAt = now;
  try {
    await api.post('/live/position', {
      lat: coords.latitude,
      lng: coords.longitude,
      // speed in m/s dal GPS → km/h; heading può essere null se fermo.
      speed: Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed * 3.6 : null,
      heading: Number.isFinite(coords.heading) ? coords.heading : null,
    });
  } catch (err) {
    // Rete assente: riprova al prossimo aggiornamento GPS, senza aspettare il
    // throttle. Se invece il server dice "consenso spento" (403) allineiamo la
    // copia locale, altrimenti continueremmo a bussare a vuoto.
    lastShareAt = 0;
    if (err?.status === 403) auth.patchUser({ live_enabled: 0 });
  }
}

/**
 * Centra sulla posizione dell'utente e mostra il marker "tu".
 * L'inquadratura usa il raggio di visibilità scelto in Impostazioni
 * (default: vista ravvicinata), non uno zoom fisso.
 */
async function locate(fly = true, opts) {
  try {
    const pos = await getCurrentPosition(opts);
    showMe(pos.lat, pos.lng);
    // Col tasto si inquadra sempre; all'avvio no, se il GPS ci ha già pensato.
    if (fly || !centered) fitRadius(map, pos.lat, pos.lng, mapRadiusKm, { animate: fly });
    centered = true;
  } catch {
    if (fly) toast.warning('Posizione non disponibile. Controlla i permessi GPS.');
  }
}

/** Marker "tu" + memoria dell'ultima posizione (per la prossima apertura). */
function showMe(lat, lng) {
  if (userMarker) userMarker.setLngLat([lng, lat]);
  else userMarker = addMarker(map, { lat, lng, className: 'mk-user pulse' });
  try { localStorage.setItem(LAST_POS_KEY, JSON.stringify({ lat, lng })); } catch { /* quota */ }
}

/**
 * Inquadratura di partenza: la mappa deve aprirsi SEMPRE su di te, senza
 * dover toccare il tasto "la mia posizione".
 * 1) l'ultima posizione nota dà subito la vista giusta (nessuna attesa);
 * 2) in parallelo si chiede al GPS il punto reale, con parametri "morbidi"
 *    (accetta una posizione recente: è molto più rapida del fix preciso);
 * 3) se il permesso arriva tardi o il primo tentativo scade, ci pensa il
 *    primo aggiornamento di startWatch() (vedi `centered`).
 */
async function centerOnMe() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
      showMe(saved.lat, saved.lng);
      fitRadius(map, saved.lat, saved.lng, mapRadiusKm, { animate: false });
    }
  } catch { /* niente in memoria: si aspetta il GPS */ }
  await locate(false, { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 });
}

/** Legge il raggio di visibilità preferito (Impostazioni), con fallback. */
async function loadMapRadius() {
  try {
    const { settings } = await api.get('/settings');
    const km = Number(settings?.map_radius_km);
    if (Number.isFinite(km) && km > 0) mapRadiusKm = km;
  } catch { /* si resta sul default */ }
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
      onClick: () => openEventSheet(ev),
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
  const nav = el('button', { class: 'btn btn-outline btn-block', style: 'margin-top:var(--sp-2)', html: `${svg('navigation', 20)} Indicazioni` });
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
    nav,
  ]);
  const m = modal({ title: rt.name, content: body });
  // Indicazioni fino alla PARTENZA del percorso.
  nav.addEventListener('click', () => {
    m.close();
    showDirections({ map, dest: { lat: rt.start_lat, lng: rt.start_lng }, name: rt.name, openHref: `/route.html?id=${rt.id}` });
  });
}

/** Foglio riepilogo evento: indicazioni al ritrovo oppure scheda completa. */
function openEventSheet(ev) {
  const nav = el('button', { class: 'btn btn-outline btn-block', style: 'margin-top:var(--sp-2)', html: `${svg('navigation', 20)} Indicazioni` });
  const body = el('div', {}, [
    el('div', { class: 'flex gap-2 wrap mb-3' }, [
      el('span', { class: 'chip sm', html: `${svg('megaphone', 14)} Evento` }),
      ev.area_name ? el('span', { class: 'chip sm', text: ev.area_name }) : null,
    ]),
    ev.description ? el('p', { class: 'text-mid mb-3', text: ev.description }) : null,
    el('a', { class: 'btn btn-primary btn-block', href: `/event.html?id=${ev.id}`, text: 'Apri evento' }),
    nav,
  ]);
  const m = modal({ title: ev.name, content: body });
  nav.addEventListener('click', () => {
    m.close();
    showDirections({ map, dest: { lat: ev.area_lat, lng: ev.area_lng }, name: ev.name, openHref: `/event.html?id=${ev.id}` });
  });
}
const stat = (v, k) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })]);

/**
 * Attiva/disattiva il livello "live": mostra amici (sempre) e sconosciuti public.
 * Il polling delle vicinanze resta comunque attivo, perché serve al saluto col
 * clacson quando si incrocia un altro pilota; qui cambia solo la visibilità
 * dei marker sulla mappa.
 */
async function toggleLive() {
  const fab = $('#fab-live');
  liveOn = !liveOn;
  fab.classList.toggle('active', liveOn);
  localStorage.setItem(LIVE_LAYER_KEY, liveOn ? 'on' : 'off');
  if (!liveOn) {
    markers.live.forEach((m) => m.remove());
    markers.live.clear();
    return;
  }
  await refreshLive();
  await offerLiveSharing();
  if (!markers.live.size) toast.info('Nessun amico sta condividendo la posizione in questo momento.', { duration: 3200 });
}

/**
 * All'apertura, se il livello amici è attivo ma la mia posizione non è
 * condivisa, lo dico una volta per sessione: è la causa più comune del
 * "l'altro non mi vede". Un avviso leggero, senza bloccare la mappa.
 */
function hintLiveSharing() {
  if (!liveOn || auth.user?.live_enabled) return;
  if (sessionStorage.getItem(LIVE_HINT_KEY)) return;
  sessionStorage.setItem(LIVE_HINT_KEY, '1');
  toast.info('Vedi gli amici, ma loro non vedono te: attiva "Condividi la mia posizione live" in Impostazioni.', { duration: 5200 });
}

/**
 * Vedere gli altri non richiede nulla, farsi vedere sì: se il consenso è
 * spento lo proponiamo qui, con un tocco, invece di mandare in Impostazioni.
 * Chi dice no non viene più disturbato (scelta ricordata sul dispositivo).
 */
async function offerLiveSharing() {
  if (auth.user?.live_enabled) return;
  if (localStorage.getItem(LIVE_ASK_KEY) === 'no') return;
  const ok = await confirmDialog({
    title: 'Farti vedere dagli amici?',
    message: 'Stai vedendo chi condivide la posizione. Per comparire anche tu sulla loro mappa serve il tuo consenso: puoi revocarlo quando vuoi da Impostazioni.',
    confirmText: 'Condividi posizione',
    cancelText: 'Non ora',
  });
  if (!ok) { localStorage.setItem(LIVE_ASK_KEY, 'no'); return; }
  try {
    await api.put('/live/settings', { live_enabled: true });
    auth.patchUser({ live_enabled: 1 });
    lastShareAt = 0; // la prossima posizione GPS parte subito
    toast.success('Condivisione attiva: gli amici ti vedranno sulla mappa.');
  } catch (err) {
    toast.error(err.message || 'Non è stato possibile attivare la condivisione.');
  }
}

/* ---------------- Saluto col clacson ----------------
 * Quando entri entro 100 m da un altro pilota suona un colpetto di clacson.
 * Chi è già stato salutato NON viene risuonato: l'elenco vive in
 * sessionStorage, così cambiando schermata e tornando sulla mappa il suono
 * non si ripete. Ci si "riarma" solo quando quel pilota si allontana oltre
 * la soglia di uscita (evita di suonare a ripetizione al limite dei 100 m).
 */
const HORN_RADIUS_M = 100;
const HORN_EXIT_M = 250;
const HORN_KEY = '4e2_horn_greeted';

function greetedSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem(HORN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveGreeted(set) {
  try { sessionStorage.setItem(HORN_KEY, JSON.stringify([...set])); } catch { /* ignora */ }
}

function checkHorn(users) {
  if (!myPos) return;
  const greeted = greetedSet();
  let changed = false;
  let toGreet = 0;

  for (const u of users) {
    if (u.last_lat == null || u.last_lng == null) continue;
    const d = haversine(myPos.lat, myPos.lng, u.last_lat, u.last_lng);
    const id = String(u.id);
    if (d <= HORN_RADIUS_M) {
      if (!greeted.has(id)) { greeted.add(id); changed = true; toGreet++; }
    } else if (d > HORN_EXIT_M && greeted.has(id)) {
      // Si è allontanato: al prossimo incontro lo salutiamo di nuovo.
      greeted.delete(id);
      changed = true;
    }
  }

  if (changed) saveGreeted(greeted);
  // Un solo clacson anche se incroci più piloti insieme.
  if (toGreet > 0) {
    playHorn();
    toast.info(toGreet === 1 ? 'Un pilota è qui vicino 👋' : `${toGreet} piloti qui vicino 👋`, { duration: 2500 });
  }
}

/**
 * Scheda dell'utente live mostrata nel popup sulla mappa: che veicolo sta
 * guidando e da quanto tempo è online. Resta sulla mappa: nessuna schermata
 * nuova da aprire.
 */
function livePopupHtml(u) {
  const veh = [u.vehicle_make, u.vehicle_model].filter(Boolean).join(' ').trim();
  const vehName = (u.vehicle_name || '').trim();
  // Etichetta veicolo: "Moto · Ducati Panigale" (nome del mezzo se presente).
  const kind = u.vehicle_type === 'car' ? 'Auto' : u.vehicle_type === 'moto' ? 'Moto' : null;
  const vehDetail = veh || vehName;
  const vehLine = kind
    ? `<div class="lp-row">${svg(vehIcon(u.vehicle_type), 15)}
         <span><b>${esc(kind)}</b>${vehDetail ? ` · ${esc(vehDetail)}` : ''}</span>
       </div>`
    : `<div class="lp-row lp-muted">${svg('bike', 15)}<span>Veicolo non indicato</span></div>`;

  const speed = Number.isFinite(u.last_speed) && u.last_speed > 1
    ? `<div class="lp-row">${svg('gauge', 15)}<span>${fmtSpeed(u.last_speed)}</span></div>`
    : '';

  return `
    <div class="live-popup">
      <div class="lp-head">
        <img class="lp-avatar" src="${esc(u.avatar || '/images/avatars/default.svg')}" alt="" />
        <div class="lp-id">
          <strong>${esc(u.nickname)}</strong>
          <span class="lp-muted">Liv. ${Number(u.level) || 1}</span>
        </div>
      </div>
      ${vehLine}
      ${speed}
      <div class="lp-row">${svg('clock', 15)}<span>Online da <b>${esc(fmtSince(u.live_since || u.last_seen))}</b></span></div>
    </div>`;
}

async function refreshLive() {
  try {
    const { users } = await api.get('/live/nearby', { bbox: viewportBbox(map) });
    // Il clacson di saluto funziona anche col livello live spento.
    checkHorn(users || []);
    if (!liveOn) return;
    const seen = new Set();
    for (const u of users || []) {
      seen.add(u.id);
      const html = livePopupHtml(u);
      const existing = markers.live.get(u.id);
      if (existing) {
        existing.setLngLat([u.last_lng, u.last_lat]);
        // Aggiorna il contenuto (il tempo online scorre) anche a popup aperto.
        existing.getPopup()?.setHTML(html);
      } else {
        markers.live.set(u.id, addMarker(map, {
          lat: u.last_lat, lng: u.last_lng, className: 'mk-friend',
          html: `<img src="${esc(u.avatar || '/images/avatars/default.svg')}" alt="${esc(u.nickname)}">`,
          popupHtml: html,
        }));
      }
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

  // L'area di prossimità non supera MAI 1 km: il prompt può comparire solo
  // entro PROX_MAX_M. La soglia di uscita (più larga) serve unicamente a
  // NASCONDERE il prompt senza farlo lampeggiare a ogni oscillazione del GPS.
  for (const ev of dataEvents) {
    if (ev.status === 'ended' || ev.status === 'cancelled') continue;
    const enter = Math.min(ev.radius_m || PROX_MAX_M, PROX_MAX_M);
    const exit = enter + PROX_HYSTERESIS_M;
    const d = haversine(lat, lng, ev.area_lat, ev.area_lng);
    const key = `e${ev.id}`;
    if (d > exit) { proxDismissed.delete(key); if (proxCurrent === key) hideProx(); continue; }
    if (d <= enter && !proxDismissed.has(key)) candidates.push({ key, type: 'event', item: ev, d });
  }
  for (const rt of dataRoutes) {
    const enter = PROX_MAX_M;
    const exit = enter + PROX_HYSTERESIS_M;
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
  // Titolo coerente con la distanza: "sei al ritrovo/inizio" solo se davvero
  // vicino, altrimenti "sei vicino a" (l'avviso arriva fino a 1 km).
  const close = cand.d <= 200;
  const title = isEvent
    ? (close ? `Sei al ritrovo di «${name}»` : `Sei vicino al ritrovo di «${name}»`)
    : (close ? `Sei all'inizio di «${name}»` : `Sei vicino a «${name}»`);

  proxEl = el('div', { class: 'prox-prompt' }, [
    el('div', { class: 'prox-head' }, [
      el('div', { class: 'prox-ic', html: svg(isEvent ? 'megaphone' : 'flag', 24) }),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'prox-title', text: title }),
        el('div', { class: 'prox-sub', text: isEvent ? 'Vuoi partecipare e fare il check-in?' : 'Vuoi registrare un tentativo su questo percorso?' }),
      ]),
    ]),
    el('div', { class: 'prox-actions' }, [no, yes]),
  ]);
  document.body.append(proxEl);
  // Avviso acustico: a bordo lo schermo non lo si guarda.
  playNotify();

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
