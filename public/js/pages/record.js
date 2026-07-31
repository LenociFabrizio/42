/* =============================================================
   record.js — Registrazione GPS di un percorso.
   Modalità:
     - CREA (default): a fine registrazione salva un nuovo percorso.
     - COMPLETA (?route=ID): tentativo cronometrato sul percorso indicato
       (per scalare la classifica / sfidare il record). Qui il cronometro
       ha due cancelletti: si può partire SOLO dalla partenza del percorso
       e il tempo si ferma DA SÉ al traguardo. Niente pausa: un giro
       cronometrato non si mette in pausa.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, setRouteLine, addMarker, onMapReady, fitPoints } from '../core/map.js';
import { GpsTracker, getCurrentPosition, haversine, decodePolyline, distanceToSegment } from '../core/geo.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, ROUTE_VEHICLE_TYPES, ATTEMPT_GATE_RADIUS_M, ATTEMPT_MIN_COVERAGE } from '../core/constants.js';
import { $, svg, el, loader, toast, modal, confirmDialog, fmtDistance, fmtDuration, fmtChrono, qs } from '../core/ui.js';
import { TrackingSession } from '../core/tracking.js';
import { startCountdown } from '../core/countdown.js';
import { initSound, playUnlock } from '../core/sound.js';
import { buildPrivacyControl } from '../core/visibility.js';
import api from '../core/api.js';

const routeId = qs.get('route'); // se presente → modalità COMPLETA
const isComplete = !!routeId;

let map, tracker, userMarker;
let session = null; // sessione di tracciamento (wake lock + notifica background)
let state = 'idle'; // idle | starting | recording | paused | done
let hudTimer = null;
const live = []; // [[lat,lng], ...]

/* --- Modalità COMPLETA: il percorso da sfidare e i suoi cancelletti --- */
let target = null;    // { name, start, end, distance_m, points }
let gateWatch = null; // watchPosition d'attesa, prima del via
let atStart = false;  // sono dentro il raggio della partenza?
let armed = false;    // percorso coperto a sufficienza: l'arrivo può chiudere il tempo
let finished = false; // chiusura automatica già avvenuta (evita doppioni)
let framed = false;   // prima inquadratura già fatta
let pending = null;   // tempo chiuso ma non ancora inviato (foglio chiuso per sbaglio)

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  initSound(); // sblocca l'audio: countdown di partenza e fanfara dell'arrivo
  $('#back-btn').innerHTML = svg('chevronLeft', 24);
  $('#btn-main').innerHTML = `${svg('play', 22)} Avvia`;
  $('#btn-pause').innerHTML = `${svg('pause', 22)} Pausa`;

  if (isComplete) await loadTarget();

  map = await createMap('map', { zoom: 14 });
  loader.hide();
  onMapReady(map, async () => {
    if (target) drawTarget();
    try {
      const p = await getCurrentPosition();
      showMe(p.lat, p.lng);
      frameFirst(p.lat, p.lng);
    } catch { /* posizione non disponibile: ci pensa il watch del cancelletto */ }
  });

  $('#btn-main').addEventListener('click', onMain);
  $('#btn-pause').addEventListener('click', onPause);
  window.addEventListener('beforeunload', (e) => { if (state === 'recording' || state === 'paused') { e.preventDefault(); e.returnValue = ''; } });

  if (isComplete) {
    if (target) { paintGateButton(); startGate(); }
    else {
      // Senza i dati del percorso non si può verificare nulla: meglio non far
      // partire un tentativo che nascerebbe già invalido.
      $('#btn-main').disabled = true;
      setGate('Percorso non disponibile: riprova più tardi.');
    }
  }
}
main();

/** Carica il percorso da sfidare (estremi, geometria, lunghezza). */
async function loadTarget() {
  try {
    const { route } = await api.get(`/routes/${routeId}`);
    $('#rec-title').textContent = `Sfida: ${route.name}`;
    target = {
      name: route.name,
      start: { lat: route.start_lat, lng: route.start_lng },
      end: { lat: route.end_lat, lng: route.end_lng },
      distance_m: route.distance_m || 0,
      points: route.track_polyline ? decodePolyline(route.track_polyline) : [],
    };
  } catch {
    $('#rec-title').textContent = 'Completa percorso';
    toast.error('Percorso non caricato.');
  }
}

/** Disegna il percorso da sfidare con i pin di partenza e arrivo. */
function drawTarget() {
  if (target.points.length > 1) setRouteLine(map, 'target', target.points, { color: '#7cc4ff', width: 5 });
  addMarker(map, { ...target.start, className: 'mk route', html: svg('play', 15) });
  addMarker(map, { ...target.end, className: 'mk event', html: svg('flag', 15) });
}

/* -------------------- Cancelletto di partenza --------------------
   Prima del via il GPS serve già: senza sapere dove siamo non si può decidere
   se il tentativo è lecito. Il watch resta attivo finché non si parte. */
function startGate() {
  if (!target || gateWatch != null) return;
  if (!('geolocation' in navigator)) { setGate('GPS non disponibile su questo dispositivo.'); return; }
  setGate('Cerco il GPS…');
  gateWatch = navigator.geolocation.watchPosition(
    (pos) => onGateFix(pos.coords.latitude, pos.coords.longitude),
    () => setGate('Posizione non disponibile: controlla i permessi GPS.'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

function stopGate() {
  if (gateWatch != null) navigator.geolocation.clearWatch(gateWatch);
  gateWatch = null;
}

function onGateFix(lat, lng) {
  if (state !== 'idle') return;
  showMe(lat, lng);
  frameFirst(lat, lng);
  const d = haversine(lat, lng, target.start.lat, target.start.lng);
  atStart = d <= ATTEMPT_GATE_RADIUS_M;
  setGate(
    atStart
      ? 'Sei sulla linea di partenza: puoi lanciarti! 🏁'
      : `Sei a ${fmtDistance(d)} dalla partenza: il tempo parte solo da lì.`,
    atStart
  );
  paintGateButton();
}

/** Il tasto principale in attesa: attivo solo dentro il raggio di partenza. */
function paintGateButton() {
  if (state !== 'idle') return;
  const btn = $('#btn-main');
  btn.disabled = !atStart;
  btn.innerHTML = atStart ? `${svg('play', 22)} Avvia` : `${svg('flag', 22)} Vai alla partenza`;
}

/** Fascia informativa in basso (solo modalità COMPLETA). */
function setGate(text, ok = false) {
  const g = $('#gate');
  if (!g) return;
  g.textContent = text;
  g.classList.remove('hidden');
  g.style.color = ok ? 'var(--accent)' : '';
}

function showMe(lat, lng) {
  if (userMarker) userMarker.setLngLat([lng, lat]);
  else userMarker = addMarker(map, { lat, lng, className: 'mk-user' });
}

/** Prima inquadratura: nella sfida mostra tutto il percorso e dove sono io. */
function frameFirst(lat, lng) {
  if (framed || !map) return;
  framed = true;
  if (target?.points?.length > 1) fitPoints(map, [...target.points, [lat, lng]], { padding: 50, maxZoom: 15 });
  else map.jumpTo({ center: [lng, lat], zoom: 15 });
}

/* -------------------- Avvio / stop -------------------- */
async function onMain() {
  if (state === 'recording' || state === 'paused') { stopRec(); return; }
  // Tempo già chiuso e foglio d'invio chiuso senza inviare: si ripropone.
  if (state === 'done' && pending) { openCompleteSheet(pending); return; }
  if (state !== 'idle') return;
  // Regola della sfida: si parte solo dalla partenza del percorso.
  if (target && !atStart) {
    toast.warning(`Avvicinati alla partenza: il tempo parte entro ${ATTEMPT_GATE_RADIUS_M} m dallo start.`);
    return;
  }
  // Countdown 3-2-1-VIA! con bip: si parte al segnale, non al tocco.
  const btn = $('#btn-main');
  btn.disabled = true;
  state = 'starting'; // evita doppi avvii durante il conteggio
  try {
    await startCountdown();
  } finally {
    state = 'idle';
    btn.disabled = false;
  }
  startRec();
}

function startRec() {
  stopGate(); // da qui in poi i campioni li raccoglie il tracker
  armed = false;
  finished = false;
  tracker = new GpsTracker({
    onUpdate: (s) => {
      if (s.last) {
        live.push([s.last.lat, s.last.lng]);
        setRouteLine(map, 'live', live, { color: '#ffb020', width: 6 });
        showMe(s.last.lat, s.last.lng);
        map.easeTo({ center: [s.last.lng, s.last.lat], duration: 500 });
      }
      renderHud(s);
      if (target) checkFinish(s);
    },
    onError: () => toast.error('GPS non disponibile. Attiva la posizione ad alta precisione.'),
  });
  tracker.start();
  session = new TrackingSession({
    label: target
      ? `Tentativo su "${target.name}" in corso: la tua posizione è in uso.`
      : 'Registrazione percorso in corso: la tua posizione è in uso.',
  });
  session.start();
  state = 'recording';
  startHudTimer();
  $('#rec-status').classList.remove('hidden');
  // Nella sfida non c'è pausa: il cronometro di un giro non si sospende.
  if (!target) $('#btn-pause').classList.remove('hidden');
  if (target) setGate('Tempo avviato: il cronometro si ferma da sé all\'arrivo.');
  paintMainButton();
}

/** Tasto principale durante la registrazione. */
function paintMainButton() {
  const btn = $('#btn-main');
  btn.disabled = false;
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-danger');
  // Nella sfida, finché il percorso non è coperto, terminare significa buttare
  // il tentativo: il tasto lo dice.
  btn.innerHTML = !target || armed ? `${svg('stop', 22)} Termina` : `${svg('x', 22)} Annulla`;
}

/* -------------------- Arrivo automatico --------------------
   Il tempo si chiude quando si taglia il traguardo, non quando si tocca un
   tasto. Due condizioni, entrambe necessarie:
     1) il percorso è stato coperto per almeno ATTEMPT_MIN_COVERAGE — sugli
        anelli partenza e arrivo coincidono, senza questo il tempo si
        chiuderebbe dopo due metri;
     2) l'ultimo tratto GPS passa entro ATTEMPT_GATE_RADIUS_M dall'arrivo. */
function checkFinish(s) {
  if (finished || !s.last) return;

  if (!armed) {
    const need = target.distance_m * ATTEMPT_MIN_COVERAGE;
    if (!(target.distance_m > 0) || s.distance_m >= need) { armed = true; paintMainButton(); }
  }

  const pts = s.points || [];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const dEnd = prev
    ? distanceToSegment(target.end.lat, target.end.lng, prev.lat, prev.lng, s.last.lat, s.last.lng)
    : haversine(s.last.lat, s.last.lng, target.end.lat, target.end.lng);

  if (armed) setGate(`Arrivo tra ${fmtDistance(Math.max(0, dEnd))}: il tempo si ferma da sé.`);
  else {
    const pct = target.distance_m > 0 ? Math.min(99, Math.round((s.distance_m / target.distance_m) * 100)) : 0;
    setGate(`Percorso completato al ${pct}% · il tempo si chiude all'arrivo.`);
  }

  if (armed && dEnd <= ATTEMPT_GATE_RADIUS_M) finishAttempt();
}

/**
 * Il tempo di un tentativo è la durata del TRACCIATO (primo → ultimo campione),
 * la stessa misura che userà il server: così il cronometro mostrato e quello
 * registrato in classifica non possono divergere di qualche decimo.
 */
function applyTrackTime(result) {
  const t = result.track;
  const span = t.length > 1 ? Number(t[t.length - 1].t) - Number(t[0].t) : 0;
  if (Number.isFinite(span) && span > 0) {
    result.time_ms = Math.round(span);
    result.elapsed_s = Math.round(span / 1000);
  }
  return result;
}

/** Traguardo tagliato: ferma tutto e propone l'invio del tempo. */
function finishAttempt() {
  finished = true;
  const result = applyTrackTime(tracker.stop());
  session?.stop();
  state = 'done';
  clearInterval(hudTimer);
  $('#rec-status').classList.add('hidden');
  $('#hud-time').textContent = fmtDuration(result.elapsed_s);
  const btn = $('#btn-main');
  btn.disabled = true;
  btn.innerHTML = `${svg('flag', 22)} Arrivo!`;
  setGate('Traguardo tagliato: cronometro fermo. 🏁', true);
  playUnlock();
  if (result.track.length < 2) {
    toast.error('Tracciato troppo breve. Serve un po\' di movimento GPS.');
    resetUi();
    return;
  }
  openCompleteSheet(result);
}

function onPause() {
  if (state === 'recording') {
    tracker.pause(); state = 'paused';
    $('#btn-pause').innerHTML = `${svg('play', 22)} Riprendi`;
    $('#rec-status').classList.add('hidden');
  } else if (state === 'paused') {
    tracker.resume(); state = 'recording';
    $('#btn-pause').innerHTML = `${svg('pause', 22)} Pausa`;
    $('#rec-status').classList.remove('hidden');
  }
}

async function stopRec() {
  const ok = target
    ? await confirmDialog({
        title: armed ? 'Terminare il tentativo?' : 'Annullare il tentativo?',
        message: armed
          ? 'Il tempo viene registrato solo se hai chiuso sull\'arrivo del percorso.'
          : 'Non hai ancora percorso il tratto: il tempo verrà scartato.',
        confirmText: armed ? 'Termina' : 'Annulla tentativo',
      })
    : await confirmDialog({ title: 'Terminare la registrazione?', message: 'Salverai il tracciato registrato.', confirmText: 'Termina' });
  if (!ok) return;
  const result = tracker.stop();
  if (target) applyTrackTime(result);
  session?.stop();
  state = 'done';
  $('#rec-status').classList.add('hidden');
  clearInterval(hudTimer);

  if (result.track.length < 2) {
    toast.error('Tracciato troppo breve. Serve un po\' di movimento GPS.');
    resetUi();
    return;
  }
  if (target && !armed) {
    toast.warning('Tentativo scartato: il percorso non è stato completato.');
    resetUi();
    return;
  }
  isComplete ? openCompleteSheet(result) : openSaveSheet(result);
}

function resetUi() {
  state = 'idle';
  armed = false;
  finished = false;
  pending = null;
  live.length = 0;
  clearInterval(hudTimer);
  $('#btn-pause').classList.add('hidden');
  const btn = $('#btn-main');
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-primary');
  btn.innerHTML = `${svg('play', 22)} Avvia`;
  btn.disabled = false;
  if (target) { atStart = false; paintGateButton(); startGate(); }
}

/* HUD: aggiorna anche il tempo ogni secondo mentre registra. */
function renderHud(s) {
  $('#hud-speed').textContent = s.speed_kmh ?? 0;
  $('#hud-dist').textContent = fmtDistance(s.distance_m);
  $('#hud-max').textContent = s.maxSpeed_kmh ?? 0;
  $('#hud-time').textContent = fmtDuration(s.elapsed_s);
}

function startHudTimer() {
  clearInterval(hudTimer);
  hudTimer = setInterval(() => { if (tracker && state === 'recording') $('#hud-time').textContent = fmtDuration(tracker.elapsed()); }, 1000);
}

/* -------------------- Salvataggio nuovo percorso -------------------- */
function openSaveSheet(result) {
  const catSel = ROUTE_CATEGORIES.map((c) => `<option value="${c.v}">${c.l}</option>`).join('');
  const diffSel = ROUTE_DIFFICULTIES.map((d) => `<option value="${d.v}" ${d.v === 'media' ? 'selected' : ''}>${d.l}</option>`).join('');
  const vehSel = ROUTE_VEHICLE_TYPES.map((v) => `<option value="${v.v}">${v.l}</option>`).join('');

  const form = el('div', { html: `
    <div class="stats-row mb-4">
      <div class="stat"><div class="v accent">${fmtDistance(result.distance_m)}</div><div class="k">Distanza</div></div>
      <div class="stat"><div class="v">${fmtDuration(result.elapsed_s)}</div><div class="k">Tempo</div></div>
      <div class="stat"><div class="v">${result.maxSpeed_kmh}</div><div class="k">Max km/h</div></div>
    </div>
    <div class="field"><label>Nome del percorso</label><input class="input" id="r-name" placeholder="es. Curve del lago" maxlength="80" /></div>
    <div class="field"><label>Descrizione</label><textarea class="textarea" id="r-desc" placeholder="Cosa lo rende speciale?" maxlength="2000"></textarea></div>
    <div class="grid grid-2">
      <div class="field"><label>Categoria</label><select class="select" id="r-cat">${catSel}</select></div>
      <div class="field"><label>Difficoltà</label><select class="select" id="r-diff">${diffSel}</select></div>
    </div>
    <div class="field"><label>Veicolo</label><select class="select" id="r-veh">${vehSel}</select></div>
    <div id="priv-slot"></div>
  ` });

  const priv = buildPrivacyControl('route');
  form.querySelector('#priv-slot').append(priv.node);

  const save = el('button', { class: 'btn btn-primary', text: 'Salva percorso' });
  const m = modal({ title: 'Salva il percorso', content: form, footer: [save] });

  save.addEventListener('click', async () => {
    const name = $('#r-name', form).value.trim();
    if (name.length < 3) { toast.error('Dai un nome al percorso (min. 3 caratteri).'); return; }
    const pv = priv.value;
    if (!pv.valid) { toast.error(pv.error); return; }
    save.disabled = true; save.textContent = 'Salvataggio…';
    try {
      const { route } = await api.post('/routes', {
        name,
        description: $('#r-desc', form).value.trim(),
        category: $('#r-cat', form).value,
        difficulty: $('#r-diff', form).value,
        vehicle_type: $('#r-veh', form).value,
        privacy: pv.privacy,
        club_id: pv.club_id,
        track: result.track,
      });
      toast.success('Percorso salvato! +XP 🎉');
      m.close();
      setTimeout(() => (location.href = `/route.html?id=${route.id}`), 500);
    } catch (err) {
      toast.error(err.message || 'Salvataggio non riuscito.');
      save.disabled = false; save.textContent = 'Salva percorso';
    }
  });
}

/* -------------------- Invio completamento -------------------- */
function openCompleteSheet(result) {
  let sent = false;
  const form = el('div', { html: `
    <div class="stats-row mb-4">
      <div class="stat"><div class="v accent">${fmtChrono(result.time_ms)}</div><div class="k">Tempo</div></div>
      <div class="stat"><div class="v">${fmtDistance(result.distance_m)}</div><div class="k">Distanza</div></div>
      <div class="stat"><div class="v">${result.maxSpeed_kmh}</div><div class="k">Max km/h</div></div>
    </div>
    <div class="field"><label>Meteo</label><input class="input" id="c-weather" placeholder="es. sereno, pioggia…" maxlength="40" /></div>
  ` });
  const send = el('button', { class: 'btn btn-primary', text: 'Invia tempo' });
  // Chiuso senza inviare (capita: l'arrivo ferma il tempo da sé e il foglio
  // compare mentre si è ancora in sella) → il tempo resta in mano e il tasto
  // principale lo ripropone, invece di sparire.
  const m = modal({
    title: 'Registra il tuo tempo',
    content: form,
    footer: [send],
    onClose: () => { if (!sent) keepPending(result); },
  });

  send.addEventListener('click', async () => {
    send.disabled = true; send.textContent = 'Invio…';
    try {
      const res = await api.post(`/routes/${routeId}/complete`, {
        time_ms: result.time_ms,
        weather: $('#c-weather', form).value.trim(),
        track: result.track,
      });
      sent = true;
      pending = null;
      m.close();
      let msg = 'Tempo registrato!';
      if (res.new_official_record) msg = 'Nuovo RECORD ufficiale! 🏆';
      else if (res.is_personal_best) msg = 'Nuovo record personale! 🎉';
      else if (res.beat_official) msg = 'Hai battuto il tempo del creatore! 🔥';
      toast.success(`${msg} +${res.xp} XP`);
      setTimeout(() => (location.href = `/route.html?id=${routeId}`), 700);
    } catch (err) {
      toast.error(err.message || 'Invio non riuscito.');
      send.disabled = false; send.textContent = 'Invia tempo';
    }
  });
}

/** Tempo chiuso e non ancora inviato: il tasto principale lo riapre. */
function keepPending(result) {
  pending = result;
  const btn = $('#btn-main');
  btn.disabled = false;
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-primary');
  btn.innerHTML = `${svg('flag', 22)} Invia il tempo`;
  if (target) setGate(`Tempo pronto: ${fmtChrono(result.time_ms)}. Tocca "Invia il tempo".`, true);
}
