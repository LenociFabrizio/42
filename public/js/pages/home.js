/* =============================================================
   home.js — Schermata principale: mappa a tutto schermo con percorsi,
   eventi, POI e (dal livello sbloccato) amici live. Ricarica i dati
   quando la vista cambia. Pulsanti flottanti: posizione + live.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, addMarker, viewportBbox, fitRadius, fitPoints, onMapReady, setRegionFog, fitRegion } from '../core/map.js';
import { ensureHomeArea, checkArea, discoveredGeoNames, homeGeoName, nameByGeoName, onAreasChange } from '../core/areas.js';
import { getCurrentPosition, decodePolyline, haversine, bearing } from '../core/geo.js';
import { maybeAutoStart } from '../core/onboarding.js';
import { $, svg, loader, toast, modal, el, esc, fmtDistance, fmtDuration, fmtSpeed, fmtSince, debounce } from '../core/ui.js';
import { catIcon, poiIcon, catLabel, vehIcon, DEFAULT_MAP_RADIUS_KM, DRIVE_MODE_ENABLED } from '../core/constants.js';
import { initSound, playHorn, playRadarPing } from '../core/sound.js';
import { showDirections } from '../core/nav.js';
import { showRideDisclaimer } from '../core/disclaimer.js';
import api from '../core/api.js';

let map;
let userMarker = null;
// Condivisione della posizione con gli amici: è ciò che comanda il tasto in
// basso a destra. Lo stato vero sta sul server (users.live_enabled); qui c'è la
// copia locale, riallineata a ogni cambio e a ogni rifiuto del server.
const LIVE_HINT_KEY = '4e2_live_hint';
const LIVE_POLL_MS = 8000; // ogni quanto si aggiornano i puntini degli amici
const LIVE_IDLE_POLL_MS = 60000; // senza condividere: solo il conto, di rado
let sharing = false;       // sto condividendo la mia posizione?
let refreshingLive = false; // un giro di /live/nearby è già in corso?
let lastLiveOkAt = 0;      // ultimo giro andato a buon fine
let knownLive = null;      // id già visti live (null = primo giro)
let watchId = null;
let lastShareAt = 0;       // throttle invio posizione live
let lastShareOkAt = 0;     // ultimo invio accettato dal server
let liveFriends = [];      // amici che stanno condividendo adesso
let friendsLiveCount = 0;  // quanti sono in strada (anche se non condivido: solo il numero)
let liveSheet = null;      // foglio "Posizione live" aperto (per aggiornarlo)

/* Segnaposto in stile arcade (Need for Speed Most Wanted): una punta di freccia
   con bordo scuro che indica la direzione di marcia, invece di un pallino che
   lampeggia. Stessa forma per tutti i puntini vivi, colore dalla CSS via
   `currentColor`: bianca io, verde gli amici, rossa gli sconosciuti.
   Il triangolo interno scuro dà il rilievo tipico del HUD. */
const arrowHtml = (size = 40) => `
  <span class="arrow-mk">
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true">
      <path d="M12 1.8 3.9 21.4 12 17.1 20.1 21.4 12 1.8Z" fill="currentColor" stroke="#05070b" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M12 6.4 7.6 17.4 12 15.1 12 6.4Z" fill="#05070b" opacity=".22" />
    </svg>
  </span>`;
// Direzione di marcia degli altri piloti, per orientare la loro freccia.
const liveHeadings = new Map();

let mapRadiusKm = DEFAULT_MAP_RADIUS_KM; // raggio di visibilità (Impostazioni)
let myPos = null;          // ultima posizione nota (per il saluto col clacson)
let myHeading = 0;         // direzione di marcia mostrata dalla freccia (gradi)
let prevFix = null;        // posizione precedente, per ricavare la direzione
let myCoords = null;       // ultime coordinate GPS complete (per il battito live)
let myCoordsAt = 0;        // quando è arrivato quel fix (ms)
// Ultima posizione salvata: apre la mappa già dalle tue parti, senza attese.
const LAST_POS_KEY = '4e2_last_pos';
let centered = false;      // la mappa è già stata inquadrata su di me?

// Radar di prossimità: entro RADAR_RANGE_M il bersaglio compare sul disco,
// RADAR_HIDE_M è l'isteresi per non farlo sfarfallare al limite, da
// RADAR_SOUND_M inizia il suono e a RADAR_LOCK_M è al massimo.
const RADAR_RANGE_M = 1000;
const RADAR_HIDE_M = 1250;
const RADAR_SOUND_M = 100;
const RADAR_CLOSE_M = 25;
const RADAR_LOCK_M = 5;
const markers = { routes: new Map(), events: new Map(), pois: new Map(), live: new Map() };
// Dati correnti (usati anche dal radar per calcolare il bersaglio più vicino).
let dataRoutes = [];
let dataEvents = [];
let radarTarget = null;    // bersaglio agganciato {key,type,item,d,brg}
let radarSounding = false; // anello del ping in corso?

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'map' });
  initSound(); // sblocca l'audio al primo tocco (policy autoplay)

  $('#fab-locate').innerHTML = svg('crosshair', 22);
  $('#fab-refresh').innerHTML = svg('refresh', 22);
  // Segnaposto con una persona dentro: un tocco e sei sulla mappa degli amici.
  // Acceso = stai condividendo la posizione.
  sharing = !!user.live_enabled;
  $('#fab-live').innerHTML = svg('pinUser', 22);
  paintLiveFab();
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

  // Aree di gioco: senza area di partenza la chiediamo subito (vale per gli
  // account creati prima di questa funzione e per chi entra con Google).
  // Sbloccando un'area cade il velo E arrivano i suoi contenuti: percorsi ed
  // eventi delle regioni non conquistate il server non li manda affatto, quindi
  // vanno richiesti di nuovo (`reload`), non solo ridisegnati.
  onAreasChange(() => { paintFog(); reload(); });
  await ensureHomeArea();

  // Tutorial di benvenuto alla prima apertura dopo la registrazione.
  maybeAutoStart();
  // Avviso di guida responsabile all'ingresso (una volta per sessione).
  showRideDisclaimer();

  onMapReady(map, () => {
    paintFog();
    centerOnMe();
    reload();
    startWatch();
    refreshLive().then(hintLiveSharing);
    clearInterval(home._liveTimer);
    // Con la mappa in secondo piano non c'è nulla da ridisegnare: si riprende
    // al ritorno in primo piano (vedi visibilitychange).
    home._liveTimer = setInterval(() => {
      if (document.hidden) return;
      // Senza condivisione non ci sono puntini da muovere (il server non ne
      // manda): si chiede solo di rado, per sapere se qualche amico è in strada.
      if (!sharing && Date.now() - lastLiveOkAt < LIVE_IDLE_POLL_MS) return;
      refreshLive();
    }, LIVE_POLL_MS);
    // Battito della posizione: da fermi il GPS può non richiamarci per minuti e
    // agli amici scomparirei dalla mappa (la finestra "live" è di 3 minuti, vedi
    // LIVE_STALE_SECONDS). Senza un fix recente, pushPositionNow() lo va a chiedere.
    clearInterval(home._shareTimer);
    home._shareTimer = setInterval(() => {
      if (document.hidden) return;
      // Rete di sicurezza: se il giro degli amici si è fermato (timer strozzato
      // dal sistema, richiesta persa) lo si rimette in moto.
      if (sharing && Date.now() - lastLiveOkAt > 3 * LIVE_POLL_MS) refreshLive();
      if (sharing && Date.now() - lastShareOkAt > 45000) pushPositionNow();
    }, 45000);
  });
  // Spostando la vista si ricaricano contenuti E chi è live in zona: senza
  // questo, gli sconosciuti della nuova area comparivano solo al giro dopo.
  // (Chi non condivide non ha puntini da ricaricare: solo i contenuti.)
  map.on('moveend', debounce(() => { reload(); if (sharing) refreshLive(); }, 400));

  // Tornando in primo piano i timer sono stati congelati dal sistema: ci
  // rimettiamo in pari subito, altrimenti per qualche minuto risulteremmo
  // spariti dalla mappa degli amici (e loro dalla nostra).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !map) return;
    if (sharing) pushPositionNow();
    refreshLive();
    // Il radar riparte con la cadenza giusta: in secondo piano il timer viene
    // strozzato dal sistema e la sequenza dei ping si sfalsa.
    if (radarSounding) radarLoop();
  });

  $('#fab-locate').addEventListener('click', () => locate(true));
  $('#fab-refresh').addEventListener('click', onRefreshClick);
  $('#fab-live').addEventListener('click', onLiveFabClick);
  // Il radar è un pulsante: check-in all'evento o tentativo sul percorso.
  $('#radar').addEventListener('click', openRadarTarget);
}

/** Segue la posizione (aggiorna il marker "tu") e valuta la prossimità. */
function startWatch() {
  if (!('geolocation' in navigator) || watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      updateHeading(lat, lng, pos.coords);
      myPos = { lat, lng };
      myCoords = pos.coords;
      myCoordsAt = Date.now();
      showMe(lat, lng);
      // Se l'inquadratura iniziale non è ancora riuscita (permesso concesso
      // in ritardo, primo fix lento), il primo aggiornamento centra la mappa.
      if (!centered) { centered = true; fitRadius(map, lat, lng, mapRadiusKm, { animate: true }); }
      updateRadar(lat, lng);
      shareLive(pos.coords);
      // Aree: il server dice se questa posizione sblocca una regione nuova.
      checkArea(lat, lng);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

/**
 * Condivide la posizione live (solo con la condivisione attiva).
 * Throttle a 15s: basta per la live map e risparmia batteria.
 * @returns {Promise<boolean>} true se il server ha accettato la posizione.
 */
async function shareLive(coords) {
  if (!sharing) return false;
  const now = Date.now();
  if (now - lastShareAt < 15000) return false;
  lastShareAt = now;
  try {
    await api.post('/live/position', {
      lat: coords.latitude,
      lng: coords.longitude,
      // speed in m/s dal GPS → km/h; heading può essere null se fermo.
      speed: Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed * 3.6 : null,
      heading: Number.isFinite(coords.heading) ? coords.heading : null,
    });
    lastShareOkAt = Date.now();
    return true;
  } catch (err) {
    // Rete assente: riprova al prossimo aggiornamento GPS, senza aspettare il
    // throttle. Se invece il server dice "consenso spento" (403) allineiamo
    // tutto, altrimenti continueremmo a bussare a vuoto mostrando il tasto
    // acceso: è così che "condivido ma non mi vedono" restava invisibile.
    lastShareAt = 0;
    if (err?.status === 403) {
      auth.patchUser({ live_enabled: 0 });
      goneFromLiveMap();
    }
    return false;
  }
}

/**
 * Invia SUBITO la posizione, ignorando il throttle. Se non c'è un fix recente
 * lo va a chiedere: da fermi il GPS può tacere per minuti e senza questo passo
 * l'attivazione non produrrebbe nessun puntino sulla mappa degli amici.
 * @returns {Promise<boolean>} true se la posizione è arrivata al server.
 */
async function pushPositionNow() {
  if (!sharing) return false;
  if (!myCoords || Date.now() - myCoordsAt > 60000) {
    try {
      const p = await getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
      myPos = { lat: p.lat, lng: p.lng };
      myCoords = { latitude: p.lat, longitude: p.lng, speed: null, heading: null };
      myCoordsAt = Date.now();
      showMe(p.lat, p.lng);
    } catch {
      return false; // permesso negato o GPS muto: lo diciamo a chi ha attivato
    }
  }
  lastShareAt = 0; // richiesta esplicita: niente throttle
  return shareLive(myCoords);
}

/**
 * Centra sulla posizione dell'utente e mostra il marker "tu".
 * L'inquadratura usa il raggio di visibilità scelto in Impostazioni
 * (default: vista ravvicinata), non uno zoom fisso.
 */
async function locate(fly = true, opts, { quiet = false } = {}) {
  try {
    const pos = await getCurrentPosition(opts);
    showMe(pos.lat, pos.lng);
    // Col tasto si inquadra sempre; all'avvio no, se il GPS ci ha già pensato.
    if (fly || !centered) fitRadius(map, pos.lat, pos.lng, mapRadiusKm, { animate: fly });
    centered = true;
    return true;
  } catch {
    if (fly && !quiet) toast.warning('Posizione non disponibile. Controlla i permessi GPS.');
    return false;
  }
}

/**
 * Aggiornamento manuale (tasto in alto a sinistra): ricarica percorsi, eventi e
 * POI della vista corrente e i puntini live, senza dover spostare la mappa —
 * che è ciò che di solito fa scattare `reload`. Serve a vedere subito un evento
 * o un percorso appena creato da qualcun altro. L'icona gira mentre carica.
 */
async function onRefreshClick() {
  const fab = $('#fab-refresh');
  if (!fab || fab.classList.contains('spinning')) return;
  fab.classList.add('spinning');
  const startedAt = Date.now();
  try {
    // reload() e refreshLive() ingoiano i propri errori (offline compreso): qui
    // ci interessa solo dare un feedback e non lasciare l'icona a girare.
    await Promise.all([reload(), refreshLive()]);
    toast.success('Mappa aggiornata');
  } finally {
    // Un mezzo secondo minimo di rotazione anche con rete velocissima: senza,
    // il giro sarebbe troppo breve per accorgersi che è successo qualcosa.
    const rest = Math.max(0, 500 - (Date.now() - startedAt));
    setTimeout(() => fab.classList.remove('spinning'), rest);
  }
}

/** Marker "tu" + memoria dell'ultima posizione (per la prossima apertura). */
function showMe(lat, lng) {
  if (userMarker) userMarker.setLngLat([lng, lat]);
  else userMarker = addMarker(map, { lat, lng, className: 'mk-player', html: arrowHtml(40) });
  turnArrow(userMarker, myHeading);
  try { localStorage.setItem(LAST_POS_KEY, JSON.stringify({ lat, lng })); } catch { /* quota */ }
}

/** Orienta la freccia di un marker (la CSS anima la rotazione). */
function turnArrow(marker, deg) {
  const arrow = marker?.getElement()?.querySelector('.arrow-mk');
  if (arrow) arrow.style.transform = `rotate(${Math.round(deg || 0)}deg)`;
}

/**
 * Direzione di marcia di un altro pilota: il `last_heading` inviato dal suo GPS
 * se c'è, altrimenti la si ricava dallo spostamento fra due giri di polling.
 * Da fermo si tiene l'ultima direzione: la freccia non deve girare a vuoto.
 */
function liveHeading(u) {
  const prev = liveHeadings.get(u.id);
  const moved = prev ? haversine(prev.lat, prev.lng, u.last_lat, u.last_lng) : Infinity;
  let brg = prev?.brg ?? 0;
  if (Number.isFinite(u.last_heading) && u.last_heading >= 0) brg = u.last_heading;
  else if (prev && moved > 8) brg = bearing(prev.lat, prev.lng, u.last_lat, u.last_lng);
  if (moved > 8) liveHeadings.set(u.id, { lat: u.last_lat, lng: u.last_lng, brg });
  else if (prev) liveHeadings.set(u.id, { ...prev, brg });
  return brg;
}

/**
 * Direzione di marcia: il `heading` del GPS quando è affidabile (serve un minimo
 * di movimento), altrimenti la si ricava dallo spostamento rispetto al punto
 * precedente. Da fermi si tiene l'ultima direzione valida: la freccia non deve
 * mettersi a girare a vuoto per colpa del rumore del GPS.
 */
function updateHeading(lat, lng, coords) {
  const spd = Number.isFinite(coords?.speed) ? coords.speed : null;
  const gps = Number.isFinite(coords?.heading) ? coords.heading : null;
  if (gps != null && gps >= 0 && (spd == null || spd > 0.5)) myHeading = gps;
  else if (prevFix && haversine(prevFix.lat, prevFix.lng, lat, lng) > 8) {
    myHeading = bearing(prevFix.lat, prevFix.lng, lat, lng);
  }
  if (!prevFix || haversine(prevFix.lat, prevFix.lng, lat, lng) > 8) prevFix = { lat, lng };
}

/**
 * Inquadratura di partenza: aprendo la mappa si deve vedere SUBITO dove si è,
 * senza toccare il tasto "la mia posizione".
 * 1) l'ultima posizione nota dà subito la vista giusta (nessuna attesa);
 * 2) senza nulla in memoria si inquadra la propria AREA di partenza, invece di
 *    mostrare l'Italia intera;
 * 3) poi si fa esattamente quello che fa il tasto: fix ad alta precisione e
 *    volo sulla posizione reale. Il primo tentativo è silenzioso, perché al
 *    primo avvio il permesso può arrivare con qualche secondo di ritardo;
 * 4) se scade, si ritenta accettando un fix meno preciso (rete, posizione
 *    recente) prima di dire che la posizione non c'è: era il punto debole di
 *    prima, un solo tentativo "morbido" che sui telefoni con la sola
 *    localizzazione GPS falliva in silenzio;
 * 5) ultima rete di sicurezza: il primo aggiornamento di startWatch() (`centered`).
 */
async function centerOnMe() {
  let framed = false;
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
      showMe(saved.lat, saved.lng);
      fitRadius(map, saved.lat, saved.lng, mapRadiusKm, { animate: false });
      framed = true;
    }
  } catch { /* niente in memoria: si aspetta il GPS */ }
  // Prima apertura senza posizione salvata: si parte dalla propria area.
  if (!framed) {
    const home = homeGeoName();
    if (home) fitRegion(map, home);
  }
  if (await locate(true, { enableHighAccuracy: true, timeout: 15000 }, { quiet: true })) return;
  await locate(true, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 });
}

/** Svela le aree scoperte e lascia in ombra quelle ancora da conquistare. */
function paintFog() {
  if (!map) return;
  setRegionFog(map, discoveredGeoNames(), {
    labelFor: nameByGeoName,
    // Il cartello col lucchetto risponde: dice come si sblocca, invece di
    // lasciare l'utente a chiedersi se sia un segnaposto rotto.
    onLocked: (name) => toast.info(`${name} è ancora da conquistare: entra nella regione e l'area si sblocca.`, { duration: 4200 }),
  });
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
    // Con dati nuovi il bersaglio del radar può cambiare anche stando fermi.
    if (myPos) updateRadar(myPos.lat, myPos.lng);
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
      // Niente colori fissi nel popup: li mette il tema (.map-popup), altrimenti
      // il testo resta illeggibile sulla card scura. Nome e descrizione arrivano
      // dal database: vanno sempre passati da esc().
      popupHtml: `<div class="map-popup"><strong>${esc(po.name)}</strong>${po.description ? `<span>${esc(po.description)}</span>` : ''}</div>`,
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

/* ============================================================
 *  POSIZIONE LIVE — il tasto in basso a destra
 *  Un tocco quando è spento: attivi la condivisione e gli amici ti vedono.
 *  Un tocco quando è acceso: si apre il foglio "Posizione live" con chi è in
 *  strada adesso (anche fuori dalla vista) e il tasto per smettere.
 *  I puntini degli amici sono SEMPRE disegnati: era il vecchio "livello live",
 *  spegnibile per sbaglio, a far sembrare la funzione rotta.
 * ============================================================ */

/** Aggiorna aspetto, etichette e contatore del tasto live. */
function paintLiveFab() {
  const fab = $('#fab-live');
  if (!fab) return;
  // Condividendo, il conto è quello dei puntini disegnati; se non condivido, il
  // numero arriva dal server senza nessuna posizione (vedi `friends_live`).
  const n = sharing ? liveFriends.length : friendsLiveCount;
  const people = n === 1 ? '1 amico' : `${n} amici`;
  fab.classList.toggle('active', sharing);
  fab.setAttribute('aria-label', sharing ? 'Stai condividendo la posizione' : 'Condividi la posizione con gli amici');
  fab.title = sharing
    ? (n ? `Stai condividendo · ${people} in strada` : 'Stai condividendo la posizione')
    : (n ? `${people} in strada: condividi anche tu per vederli` : 'Condividi la tua posizione con gli amici');

  // Contatore: si vede a colpo d'occhio se c'è qualcuno in strada, anche
  // quando il suo puntino è fuori dalla vista.
  let count = fab.querySelector('.fab-count');
  if (n > 0) {
    if (!count) { count = el('span', { class: 'fab-count' }); fab.append(count); }
    count.classList.toggle('muted', !sharing);
    count.textContent = n > 9 ? '9+' : String(n);
  } else count?.remove();
}

function onLiveFabClick() {
  if (sharing) openLiveSheet();
  else startSharing();
}

/** Attiva la condivisione e la fa partire davvero (consenso + prima posizione). */
async function startSharing() {
  const fab = $('#fab-live');
  fab.disabled = true;
  try {
    await api.put('/live/settings', { live_enabled: true });
    auth.patchUser({ live_enabled: 1 });
    sharing = true;
    paintLiveFab();

    // Il consenso da solo non basta: senza una posizione a bordo server agli
    // amici non compare nessun puntino.
    const sent = await pushPositionNow();
    await refreshLive();

    if (!sent) {
      toast.warning('Condivisione attiva, ma la posizione non arriva: controlla i permessi GPS del browser.', { duration: 5600 });
    } else if (liveFriends.length) {
      toast.success(`Ci sei: gli amici ti vedono. In strada adesso: ${liveFriends.length}.`);
      if (!friendsInView()) openLiveSheet();
    } else {
      toast.success('Ci sei: gli amici ti vedono sulla mappa. Nessuno sta condividendo in questo momento: anche loro devono toccare questo tasto.', { duration: 6400 });
    }
  } catch (err) {
    toast.error(err.message || 'Non è stato possibile attivare la condivisione.');
  } finally {
    fab.disabled = false;
  }
}

/** Smette di condividere: la posizione viene cancellata dal server. */
async function stopSharing() {
  try {
    await api.put('/live/settings', { live_enabled: false });
    auth.patchUser({ live_enabled: 0 });
    goneFromLiveMap();
    toast.info('Condivisione disattivata: non sei più sulla mappa degli amici, e loro non sono più sulla tua.');
  } catch (err) {
    toast.error(err.message || 'Non è stato possibile disattivare la condivisione.');
  }
}

/**
 * Fuori dalla mappa dei vivi: la condivisione è spenta, quindi si cancellano
 * SUBITO anche i puntini degli altri. È la stessa regola che applica il server
 * (`nearby` non restituisce posizioni a chi non condivide): senza pulire qui,
 * le frecce degli amici resterebbero disegnate fino al giro dopo — ferme, e
 * quindi bugiarde. Vale sia quando spegni tu, sia quando lo scopriamo da un 403.
 */
function goneFromLiveMap() {
  sharing = false;
  lastShareOkAt = 0;
  // Gli amici in strada restano quelli: cambia solo che non ne vediamo più la
  // posizione. Il numero resta sul tasto, spento, come invito a riaccendere.
  friendsLiveCount = liveFriends.length;
  for (const [, mk] of markers.live) mk.remove();
  markers.live.clear();
  liveHeadings.clear();
  liveFriends = [];
  // Il prossimo giro riparte da zero: senza questo, riaccendendo la
  // condivisione, tutti gli amici già in strada verrebbero annunciati come
  // "appena arrivati".
  knownLive = null;
  paintLiveFab();
  liveSheet?.render();
}

/** Alla prima apertura, se non condividi, spieghiamo a cosa serve il tasto. */
function hintLiveSharing() {
  if (sharing) return;
  if (sessionStorage.getItem(LIVE_HINT_KEY)) return;
  sessionStorage.setItem(LIVE_HINT_KEY, '1');
  // Non condividendo non abbiamo le loro posizioni, ma sappiamo quanti sono:
  // è l'informazione che rende il tasto interessante.
  const n = friendsLiveCount;
  const extra = n ? ` ${n === 1 ? 'Un amico sta condividendo' : `${n} amici stanno condividendo`} adesso: accendi anche tu per vederli.` : '';
  toast.info(`Tocca il segnaposto in basso a destra per farti vedere dagli amici.${extra}`, { duration: 5600 });
}

/** Vero se almeno un amico live è dentro la vista corrente. */
function friendsInView() {
  if (!liveFriends.length || !map) return false;
  const b = map.getBounds();
  return liveFriends.some((u) => b.contains([u.last_lng, u.last_lat]));
}

/** Inquadra tutti gli amici live (e me). */
function fitLiveFriends() {
  const pts = liveFriends.map((u) => [u.last_lat, u.last_lng]);
  if (myPos) pts.push([myPos.lat, myPos.lng]);
  if (!pts.length) return;
  centered = true; // niente ricentramenti automatici sopra questa inquadratura
  fitPoints(map, pts, { padding: 70, maxZoom: 15 });
}

/** Porta la mappa su un amico e apre il suo popup. */
function focusFriend(u) {
  centered = true;
  map.flyTo({ center: [u.last_lng, u.last_lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  const mk = markers.live.get(u.id);
  if (mk && !mk.getPopup()?.isOpen()) mk.togglePopup();
}

/** "Aggiornata adesso / N min fa" per l'ultimo invio andato a buon fine. */
function shareAgoLabel() {
  if (!lastShareOkAt) return 'in attesa della posizione GPS';
  const s = Math.max(0, Math.round((Date.now() - lastShareOkAt) / 1000));
  if (s < 60) return 'aggiornata adesso';
  return `aggiornata ${Math.floor(s / 60)} min fa`;
}

/**
 * Foglio "Posizione live": stato della mia condivisione + chi è in strada.
 * Serve anche a raggiungere gli amici lontani, che restano fuori dalla vista.
 */
function openLiveSheet() {
  if (liveSheet) return;
  const body = el('div', {});
  const fit = el('button', { class: 'btn btn-outline', text: 'Inquadra tutti' });
  const stop = el('button', { class: 'btn btn-danger', text: 'Smetti di condividere' });

  const render = () => {
    body.innerHTML = '';
    body.append(el('div', {
      class: sharing ? 'pill green' : 'pill gray',
      text: sharing ? `• Stai condividendo · ${shareAgoLabel()}` : '• Non stai condividendo',
    }));

    if (liveFriends.length) {
      const list = el('div', { class: 'list', style: 'margin-top:var(--sp-3)' });
      for (const u of liveFriends) list.append(liveFriendRow(u));
      body.append(list);
    } else {
      body.append(el('div', { class: 'empty', style: 'margin-top:var(--sp-3)' }, [
        el('div', { class: 'ic', text: '📍' }),
        el('div', { class: 'li-title', text: 'Nessun amico in strada' }),
        el('div', { class: 'text-lo mt-1', text: 'Compaiono qui appena toccano lo stesso tasto sulla loro mappa. La posizione si aggiorna da sola ogni pochi secondi.' }),
      ]));
    }
    // Limite reale del web, meglio dirlo: col telefono bloccato o l'app chiusa
    // il browser sospende il GPS e dopo pochi minuti spariamo dalla mappa.
    if (sharing) {
      body.append(el('div', {
        class: 'text-lo',
        style: 'font-size:.78rem;margin-top:var(--sp-3)',
        text: 'Tieni l\'app aperta mentre guidi: a telefono bloccato la posizione smette di aggiornarsi dopo pochi minuti.',
      }));
    }
    fit.hidden = !liveFriends.length;
    stop.hidden = !sharing;
  };

  const m = modal({
    title: 'Posizione live',
    content: body,
    footer: [fit, stop],
    onClose: () => { liveSheet = null; },
  });
  fit.addEventListener('click', () => { m.close(); fitLiveFriends(); });
  stop.addEventListener('click', async () => { m.close(); await stopSharing(); });

  liveSheet = { close: m.close, render };
  render();

  function liveFriendRow(u) {
    const dist = myPos ? fmtDistance(haversine(myPos.lat, myPos.lng, u.last_lat, u.last_lng)) : null;
    const sub = [dist, `online da ${fmtSince(u.live_since || u.last_seen)}`].filter(Boolean).join(' · ');
    const row = el('button', { class: 'list-item', style: 'width:100%;text-align:left' }, [
      el('img', { class: 'avatar', src: u.avatar || '/images/avatars/default.svg', alt: '' }),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: u.nickname }),
        el('div', { class: 'li-sub', text: sub }),
      ]),
      el('span', { class: 'chev', html: svg('crosshair', 18) }),
    ]);
    row.addEventListener('click', () => { m.close(); focusFriend(u); });
    return row;
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
 * Scheda dell'utente live mostrata nel popup sulla mappa: chi è, che mezzo
 * guida, a che velocità e da quanto è in strada. Etichetta piccola sopra e dato
 * grande sotto (come un quadrante): a colpo d'occhio, anche in movimento.
 */
function livePopupHtml(u) {
  const kind = u.vehicle_type === 'car' ? 'Auto' : u.vehicle_type === 'moto' ? 'Moto' : null;
  const model = [u.vehicle_make, u.vehicle_model].filter(Boolean).join(' ').trim() || (u.vehicle_name || '').trim();
  const speed = Number.isFinite(u.last_speed) && u.last_speed > 1 ? fmtSpeed(u.last_speed) : null;
  const since = fmtSince(u.live_since || u.last_seen);

  const cell = (label, value, { wide = false, muted = false } = {}) => `
    <div class="lp-cell${wide ? ' wide' : ''}">
      <span class="lp-k">${esc(label)}</span>
      <span class="lp-v${muted ? ' lp-v-muted' : ''}">${esc(value)}</span>
    </div>`;

  const cells = [
    kind
      ? cell(kind, model || 'Modello non indicato', { wide: true, muted: !model })
      : cell('Veicolo', 'Non indicato', { wide: true, muted: true }),
    speed ? cell('Velocità', speed) : '',
    // Da fermo la velocità non c'è: il tempo si prende tutta la riga invece di
    // restare spaiato in mezza colonna.
    cell('In strada da', since, { wide: !speed }),
  ].join('');

  return `
    <div class="live-popup">
      <div class="lp-head">
        <img class="lp-avatar" src="${esc(u.avatar || '/images/avatars/default.svg')}" alt="" />
        <div class="lp-id">
          <strong>${esc(u.nickname)}</strong>
          <span class="lp-lvl">${u.is_friend ? 'Amico' : 'Pilota'} · Liv. ${Number(u.level) || 1}</span>
        </div>
        ${kind ? `<span class="lp-veh">${svg(vehIcon(u.vehicle_type), 20)}</span>` : ''}
      </div>
      <div class="lp-grid">${cells}</div>
    </div>`;
}

/**
 * Aggiorna i puntini di chi è live. Girando ogni LIVE_POLL_MS (più: cambio
 * vista, ritorno in primo piano, attivazione della condivisione) un amico che
 * accende la posizione compare da solo, senza toccare niente — e chi spegne
 * sparisce entro un giro, perché il server smette di restituirlo.
 * Il flag `refreshingLive` evita che una richiesta lenta ne accodi altre.
 */
async function refreshLive() {
  if (refreshingLive) return;
  refreshingLive = true;
  try {
    // Il bbox filtra solo gli sconosciuti: gli amici che condividono arrivano
    // sempre, anche lontani (li si raggiunge dal foglio "Posizione live").
    const res = await api.get('/live/nearby', { bbox: viewportBbox(map) });
    const list = res.users || [];
    friendsLiveCount = Number(res.friends_live) || 0;
    lastLiveOkAt = Date.now();

    // Il server è l'autorità sulla condivisione: se dice che è spenta (spenta da
    // un altro dispositivo, dalle impostazioni, o consenso scaduto) ci
    // riallineiamo invece di continuare a mostrare una mappa che non è vera.
    if (res.sharing === false) {
      if (sharing) { auth.patchUser({ live_enabled: 0 }); goneFromLiveMap(); }
      // goneFromLiveMap() stima il contatore dall'ultima lista vista: il numero
      // appena arrivato dal server è più fresco e vince.
      friendsLiveCount = Number(res.friends_live) || 0;
      paintLiveFab();
      return;
    }

    checkHorn(list);
    liveFriends = list.filter((u) => u.is_friend);
    paintLiveFab();
    liveSheet?.render();
    announceNewLive();

    const seen = new Set();
    for (const u of list) {
      seen.add(u.id);
      const html = livePopupHtml(u);
      // Stessa freccia della mia posizione: verde se è un amico, rossa se è uno
      // sconosciuto. Il colore lo mette la CSS, qui basta la classe.
      const cls = `mk-live ${u.is_friend ? 'friend' : 'stranger'}`;
      let mk = markers.live.get(u.id);
      if (mk) {
        mk.setLngLat([u.last_lng, u.last_lat]);
        // Aggiorna il contenuto (velocità e tempo scorrono) anche a popup aperto.
        mk.getPopup()?.setHTML(html);
        const node = mk.getElement()?.firstElementChild;
        if (node && node.className !== cls) node.className = cls; // amicizia appena nata
      } else {
        mk = addMarker(map, {
          lat: u.last_lat, lng: u.last_lng, className: cls,
          html: arrowHtml(34), popupHtml: html,
        });
        markers.live.set(u.id, mk);
      }
      turnArrow(mk, liveHeading(u));
    }
    // Chi non è più live esce dalla mappa: ha spento la condivisione oppure il
    // suo ultimo battito è scaduto. In entrambi i casi la sua freccia sparisce,
    // perché una posizione ferma sarebbe una bugia.
    for (const [id, m] of markers.live) {
      if (!seen.has(id)) { m.remove(); markers.live.delete(id); liveHeadings.delete(id); }
    }
  } catch { /* rete assente: si riprova al giro dopo */ }
  finally { refreshingLive = false; }
}

/**
 * Avvisa quando un amico ACCENDE la posizione mentre sei sulla mappa: è il
 * momento in cui prima non succedeva niente e sembrava che non funzionasse.
 * Il primo giro registra solo la situazione di partenza.
 */
function announceNewLive() {
  const ids = new Set(liveFriends.map((u) => u.id));
  if (knownLive === null) { knownLive = ids; return; }
  const arrivals = liveFriends.filter((u) => !knownLive.has(u.id));
  knownLive = ids;
  if (!arrivals.length) return;
  const b = map.getBounds();
  const anyInView = arrivals.some((u) => b.contains([u.last_lng, u.last_lat]));
  const where = anyInView ? '' : ' — è fuori dalla vista, tocca il segnaposto per raggiungerlo';
  const msg = arrivals.length === 1
    ? `${arrivals[0].nickname} ha attivato la posizione${where}`
    : `${arrivals.length} amici hanno attivato la posizione`;
  toast.info(msg, { duration: 4600 });
}

/* ============================================================
 *  RADAR DI PROSSIMITÀ (stile arcade)
 *  Sotto la topbar compare un disco con anelli e sweep rotante: il blip mostra
 *  dove si trova il bersaglio più vicino (un evento o la partenza di un
 *  percorso), con l'angolo della direzione reale e il raggio proporzionale alla
 *  distanza. Da 100 m inizia a suonare piano e infittisce fino all'allarme a
 *  5 m. Toccandolo si fa il check-in all'evento o si registra un tentativo.
 *
 *  Ha preso il posto del vecchio pannello Sì/No che compariva da solo: mentre si
 *  guida un avviso che occupa lo schermo è la cosa meno desiderabile.
 * ============================================================ */
/** Bersaglio più vicino tra eventi e partenze dei percorsi caricati. */
function nearestTarget(lat, lng) {
  let best = null;
  const consider = (key, type, item, tLat, tLng) => {
    if (tLat == null || tLng == null) return;
    const d = haversine(lat, lng, tLat, tLng);
    if (!best || d < best.d) best = { key, type, item, d, brg: bearing(lat, lng, tLat, tLng) };
  };
  for (const ev of dataEvents) {
    if (ev.status === 'ended' || ev.status === 'cancelled') continue;
    consider(`e${ev.id}`, 'event', ev, ev.area_lat, ev.area_lng);
  }
  for (const rt of dataRoutes) consider(`r${rt.id}`, 'route', rt, rt.start_lat, rt.start_lng);
  return best;
}

/** Ricalcola il bersaglio e aggiorna disco e suono. */
function updateRadar(lat, lng) {
  const t = nearestTarget(lat, lng);
  // Isteresi: il bersaglio già agganciato resta fino a RADAR_HIDE_M, così al
  // limite del raggio il radar non appare e sparisce a ogni oscillazione GPS.
  const limit = t && radarTarget && t.key === radarTarget.key ? RADAR_HIDE_M : RADAR_RANGE_M;
  radarTarget = t && t.d <= limit ? t : null;
  paintRadar();
  if (radarTarget && radarTarget.d <= RADAR_SOUND_M) startRadarSound();
  else stopRadarSound();
}

/** Disegna lo stato del radar (testi, blip, intensità). */
function paintRadar() {
  const box = $('#radar');
  if (!box) return;
  if (!radarTarget) {
    box.hidden = true;
    document.body.classList.remove('radar-on');
    return;
  }
  const { type, item, d, brg } = radarTarget;
  const isEvent = type === 'event';
  const name = item.name || (isEvent ? 'Evento' : 'Percorso');
  box.hidden = false;
  document.body.classList.add('radar-on');
  box.classList.toggle('near', d <= RADAR_SOUND_M);
  box.classList.toggle('close', d <= RADAR_CLOSE_M);
  box.querySelector('.radar-kind').textContent = isEvent ? 'Evento' : 'Percorso';
  box.querySelector('.radar-name').textContent = name;
  box.querySelector('.radar-dist').textContent = `${fmtDistance(d)} · ${isEvent ? 'tocca per il check-in' : 'tocca per un tentativo'}`;
  box.setAttribute('aria-label', `${isEvent ? 'Evento' : 'Percorso'} ${name} a ${fmtDistance(d)}`);

  // Blip: angolo = direzione reale del bersaglio (mappa a nord in alto), raggio
  // in radice quadrata così i bersagli vicini non collassano tutti sul centro.
  const r = Math.sqrt(Math.min(d, RADAR_RANGE_M) / RADAR_RANGE_M) * 24;
  const rad = (brg * Math.PI) / 180;
  const x = (Math.sin(rad) * r).toFixed(1);
  const y = (-Math.cos(rad) * r).toFixed(1);
  box.querySelector('.radar-blip').style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

/**
 * Cadenza e intensità del ping in base alla distanza: 100 m → un tocco ogni
 * 1,2 s appena percettibile; 50 m → 0,7 s; 5 m → 0,14 s a volume pieno.
 */
function radarSpec(d) {
  const lerp = (a, b, t) => a + (b - a) * t;
  if (d >= 50) {
    const t = (RADAR_SOUND_M - Math.min(RADAR_SOUND_M, d)) / (RADAR_SOUND_M - 50);
    return { ms: lerp(1200, 700, t), k: lerp(0.05, 0.35, t) };
  }
  const t = (50 - Math.max(RADAR_LOCK_M, d)) / (50 - RADAR_LOCK_M);
  return { ms: lerp(700, 140, t), k: lerp(0.35, 1, t) };
}

function startRadarSound() {
  if (radarSounding) return;
  radarSounding = true;
  radarLoop();
}
function stopRadarSound() {
  radarSounding = false;
  clearTimeout(home._radarPing);
}
/**
 * Anello del suono: si riprogramma da sé leggendo OGNI VOLTA la distanza
 * corrente, così la cadenza segue l'avvicinarsi senza essere riavviata (e
 * rimandata) a ogni aggiornamento GPS.
 */
function radarLoop() {
  if (!radarSounding) return;
  clearTimeout(home._radarPing);
  const d = radarTarget?.d;
  if (d == null || d > RADAR_SOUND_M) { stopRadarSound(); return; }
  const { ms, k } = radarSpec(d);
  if (!document.hidden) playRadarPing(k);
  home._radarPing = setTimeout(radarLoop, ms);
}

/** Tocco sul radar: l'azione giusta per il bersaglio agganciato. */
function openRadarTarget() {
  const t = radarTarget;
  if (!t) return;
  if (t.type === 'event') openCheckinSheet(t.item, t.d);
  else openAttemptSheet(t.item, t.d);
}

function openCheckinSheet(ev, d) {
  const go = el('button', { class: 'btn btn-primary btn-block', html: `${svg('check', 20)} Fai il check-in` });
  const body = el('div', {}, [
    el('p', { class: 'text-mid mb-3', text: `Sei a ${fmtDistance(d)} dal ritrovo. Il check-in conferma la tua presenza: la posizione viene verificata dal server.` }),
    go,
    el('a', { class: 'btn btn-outline btn-block', style: 'margin-top:var(--sp-2)', href: `/event.html?id=${ev.id}`, text: 'Apri evento' }),
  ]);
  const m = modal({ title: ev.name || 'Evento', content: body });
  go.addEventListener('click', async () => {
    if (!myPos) { toast.warning('Posizione non disponibile: controlla i permessi GPS.'); return; }
    go.disabled = true;
    go.textContent = 'Check-in…';
    try {
      await api.post(`/events/${ev.id}/checkin`, { lat: myPos.lat, lng: myPos.lng });
      m.close();
      toast.success('Sei presente all\'evento! ✅');
    } catch (err) {
      toast.error(err.message || 'Check-in non riuscito.');
      go.disabled = false;
      go.innerHTML = `${svg('check', 20)} Fai il check-in`;
    }
  });
}

function openAttemptSheet(rt, d) {
  const body = el('div', {}, [
    el('p', { class: 'text-mid mb-3', text: `Sei a ${fmtDistance(d)} dalla partenza. Il cronometro parte solo dalla linea di partenza e si ferma da sé all'arrivo: il tempo entra in classifica.` }),
    el('a', { class: 'btn btn-primary btn-block', href: `/record.html?route=${rt.id}`, html: `${svg('play', 20)} Registra un tentativo` }),
    el('a', { class: 'btn btn-outline btn-block', style: 'margin-top:var(--sp-2)', href: `/route.html?id=${rt.id}`, text: 'Apri percorso' }),
  ]);
  modal({ title: rt.name || 'Percorso', content: body });
}

const home = {};
main();
