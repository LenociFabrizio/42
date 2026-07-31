/* =============================================================
   home.js — Schermata principale: mappa a tutto schermo con percorsi,
   eventi, POI e (dal livello sbloccato) amici live. Ricarica i dati
   quando la vista cambia. Pulsanti flottanti: posizione + live.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, addMarker, viewportBbox, fitRadius, fitPoints, onMapReady } from '../core/map.js';
import { getCurrentPosition, decodePolyline, haversine } from '../core/geo.js';
import { maybeAutoStart } from '../core/onboarding.js';
import { $, svg, loader, toast, modal, el, esc, fmtDistance, fmtDuration, fmtSpeed, fmtSince, debounce } from '../core/ui.js';
import { catIcon, poiIcon, catLabel, vehIcon, DEFAULT_MAP_RADIUS_KM, DRIVE_MODE_ENABLED } from '../core/constants.js';
import { initSound, playNotify, playHorn } from '../core/sound.js';
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
let sharing = false;       // sto condividendo la mia posizione?
let refreshingLive = false; // un giro di /live/nearby è già in corso?
let lastLiveOkAt = 0;      // ultimo giro andato a buon fine
let knownLive = null;      // id già visti live (null = primo giro)
let watchId = null;
let lastShareAt = 0;       // throttle invio posizione live
let lastShareOkAt = 0;     // ultimo invio accettato dal server
let liveFriends = [];      // amici che stanno condividendo adesso
let liveSheet = null;      // foglio "Posizione live" aperto (per aggiornarlo)

let mapRadiusKm = DEFAULT_MAP_RADIUS_KM; // raggio di visibilità (Impostazioni)
let myPos = null;          // ultima posizione nota (per il saluto col clacson)
let myCoords = null;       // ultime coordinate GPS complete (per il battito live)
let myCoordsAt = 0;        // quando è arrivato quel fix (ms)
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

  // Tutorial di benvenuto alla prima apertura dopo la registrazione.
  maybeAutoStart();
  // Avviso di guida responsabile all'ingresso (una volta per sessione).
  showRideDisclaimer();

  onMapReady(map, () => {
    centerOnMe();
    reload();
    startWatch();
    refreshLive().then(hintLiveSharing);
    clearInterval(home._liveTimer);
    // Con la mappa in secondo piano non c'è nulla da ridisegnare: si riprende
    // al ritorno in primo piano (vedi visibilitychange).
    home._liveTimer = setInterval(() => { if (!document.hidden) refreshLive(); }, LIVE_POLL_MS);
    // Battito della posizione: da fermi il GPS può non richiamarci per minuti e
    // agli amici scomparirei dalla mappa (la finestra "live" è di 5 minuti).
    // Se non abbiamo un fix recente, pushPositionNow() lo va a chiedere.
    clearInterval(home._shareTimer);
    home._shareTimer = setInterval(() => {
      if (document.hidden) return;
      // Rete di sicurezza: se il giro degli amici si è fermato (timer strozzato
      // dal sistema, richiesta persa) lo si rimette in moto.
      if (Date.now() - lastLiveOkAt > 3 * LIVE_POLL_MS) refreshLive();
      if (sharing && Date.now() - lastShareOkAt > 45000) pushPositionNow();
    }, 45000);
  });
  // Spostando la vista si ricaricano contenuti E chi è live in zona: senza
  // questo, gli sconosciuti della nuova area comparivano solo al giro dopo.
  map.on('moveend', debounce(() => { reload(); refreshLive(); }, 400));

  // Tornando in primo piano i timer sono stati congelati dal sistema: ci
  // rimettiamo in pari subito, altrimenti per qualche minuto risulteremmo
  // spariti dalla mappa degli amici (e loro dalla nostra).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !map) return;
    if (sharing) pushPositionNow();
    refreshLive();
  });

  $('#fab-locate').addEventListener('click', () => locate(true));
  $('#fab-live').addEventListener('click', onLiveFabClick);
}

/** Segue la posizione (aggiorna il marker "tu") e valuta la prossimità. */
function startWatch() {
  if (!('geolocation' in navigator) || watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      myPos = { lat, lng };
      myCoords = pos.coords;
      myCoordsAt = Date.now();
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
      sharing = false;
      lastShareOkAt = 0;
      auth.patchUser({ live_enabled: 0 });
      paintLiveFab();
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
  const n = liveFriends.length;
  fab.classList.toggle('active', sharing);
  fab.setAttribute('aria-label', sharing ? 'Stai condividendo la posizione' : 'Condividi la posizione con gli amici');
  fab.title = sharing
    ? (n ? `Stai condividendo · ${n === 1 ? '1 amico' : `${n} amici`} in strada` : 'Stai condividendo la posizione')
    : 'Condividi la tua posizione con gli amici';

  // Contatore: si vede a colpo d'occhio se c'è qualcuno in strada, anche
  // quando il suo puntino è fuori dalla vista.
  let count = fab.querySelector('.fab-count');
  if (n > 0) {
    if (!count) { count = el('span', { class: 'fab-count' }); fab.append(count); }
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
    sharing = false;
    lastShareOkAt = 0;
    paintLiveFab();
    toast.info('Condivisione disattivata: non sei più sulla mappa degli amici.');
  } catch (err) {
    toast.error(err.message || 'Non è stato possibile disattivare la condivisione.');
  }
}

/** Alla prima apertura, se non condividi, spieghiamo a cosa serve il tasto. */
function hintLiveSharing() {
  if (sharing) return;
  if (sessionStorage.getItem(LIVE_HINT_KEY)) return;
  sessionStorage.setItem(LIVE_HINT_KEY, '1');
  const extra = liveFriends.length ? ` ${liveFriends.length === 1 ? 'Un amico sta condividendo' : `${liveFriends.length} amici stanno condividendo`} adesso.` : '';
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
 * accende la posizione compare da solo, senza toccare niente.
 * Il flag `refreshingLive` evita che una richiesta lenta ne accodi altre.
 */
async function refreshLive() {
  if (refreshingLive) return;
  refreshingLive = true;
  try {
    // Il bbox filtra solo gli sconosciuti: gli amici che condividono arrivano
    // sempre, anche lontani (li si raggiunge dal foglio "Posizione live").
    const { users } = await api.get('/live/nearby', { bbox: viewportBbox(map) });
    const list = users || [];
    checkHorn(list);
    liveFriends = list.filter((u) => u.is_friend);
    paintLiveFab();
    liveSheet?.render();
    announceNewLive();

    const seen = new Set();
    for (const u of list) {
      seen.add(u.id);
      const html = livePopupHtml(u);
      const existing = markers.live.get(u.id);
      if (existing) {
        existing.setLngLat([u.last_lng, u.last_lat]);
        // Aggiorna il contenuto (velocità e tempo scorrono) anche a popup aperto.
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
    lastLiveOkAt = Date.now();
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
