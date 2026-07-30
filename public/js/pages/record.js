/* =============================================================
   record.js — Registrazione GPS di un percorso.
   Modalità:
     - CREA (default): a fine registrazione salva un nuovo percorso.
     - COMPLETA (?route=ID): invia un completamento cronometrato sul
       percorso indicato (per scalare la classifica / battere il record).
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, setRouteLine, addMarker } from '../core/map.js';
import { GpsTracker, getCurrentPosition } from '../core/geo.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, ROUTE_VEHICLE_TYPES } from '../core/constants.js';
import { $, svg, el, loader, toast, modal, confirmDialog, fmtDistance, fmtDuration, fmtChrono, qs } from '../core/ui.js';
import { TrackingSession } from '../core/tracking.js';
import api from '../core/api.js';

const routeId = qs.get('route'); // se presente → modalità COMPLETA
const isComplete = !!routeId;

let map, tracker, userMarker;
let session = null; // sessione di tracciamento (wake lock + notifica background)
let state = 'idle'; // idle | recording | paused | done
let hudTimer = null;
const live = []; // [[lat,lng], ...]

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  $('#back-btn').innerHTML = svg('chevronLeft', 24);
  $('#btn-main').innerHTML = `${svg('play', 22)} Avvia`;
  $('#btn-pause').innerHTML = `${svg('pause', 22)} Pausa`;

  if (isComplete) {
    try {
      const { route } = await api.get(`/routes/${routeId}`);
      $('#rec-title').textContent = `Sfida: ${route.name}`;
    } catch { $('#rec-title').textContent = 'Completa percorso'; }
  }

  map = await createMap('map', { zoom: 14 });
  loader.hide();
  map.on('load', async () => {
    try { const p = await getCurrentPosition(); map.jumpTo({ center: [p.lng, p.lat], zoom: 15 }); } catch {}
  });

  $('#btn-main').addEventListener('click', onMain);
  $('#btn-pause').addEventListener('click', onPause);
  window.addEventListener('beforeunload', (e) => { if (state === 'recording' || state === 'paused') { e.preventDefault(); e.returnValue = ''; } });
}

function onMain() {
  if (state === 'idle') startRec();
  else stopRec();
}

function startRec() {
  tracker = new GpsTracker({
    onUpdate: (s) => {
      if (s.last) {
        live.push([s.last.lat, s.last.lng]);
        setRouteLine(map, 'live', live, { color: '#ffb020', width: 6 });
        if (userMarker) userMarker.setLngLat([s.last.lng, s.last.lat]);
        else userMarker = addMarker(map, { lat: s.last.lat, lng: s.last.lng, className: 'mk-user' });
        map.easeTo({ center: [s.last.lng, s.last.lat], duration: 500 });
      }
      renderHud(s);
    },
    onError: () => toast.error('GPS non disponibile. Attiva la posizione ad alta precisione.'),
  });
  tracker.start();
  session = new TrackingSession({ label: 'Registrazione percorso in corso: la tua posizione è in uso.' });
  session.start();
  state = 'recording';
  $('#rec-status').classList.remove('hidden');
  $('#btn-pause').classList.remove('hidden');
  $('#btn-main').innerHTML = `${svg('stop', 22)} Termina`;
  $('#btn-main').classList.replace('btn-primary', 'btn-danger');
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
  const ok = await confirmDialog({ title: 'Terminare la registrazione?', message: 'Salverai il tracciato registrato.', confirmText: 'Termina' });
  if (!ok) return;
  const result = tracker.stop();
  session?.stop();
  state = 'done';
  $('#rec-status').classList.add('hidden');
  clearInterval(hudTimer);

  if (result.track.length < 2) {
    toast.error('Tracciato troppo breve. Serve un po\' di movimento GPS.');
    resetUi();
    return;
  }
  isComplete ? openCompleteSheet(result) : openSaveSheet(result);
}

function resetUi() {
  state = 'idle';
  $('#btn-pause').classList.add('hidden');
  $('#btn-main').innerHTML = `${svg('play', 22)} Avvia`;
  $('#btn-main').classList.replace('btn-danger', 'btn-primary');
}

/* HUD: aggiorna anche il tempo ogni secondo mentre registra. */
function renderHud(s) {
  $('#hud-speed').textContent = s.speed_kmh ?? 0;
  $('#hud-dist').textContent = fmtDistance(s.distance_m);
  $('#hud-max').textContent = s.maxSpeed_kmh ?? 0;
  $('#hud-time').textContent = fmtDuration(s.elapsed_s);
}
main().then(() => {
  hudTimer = setInterval(() => { if (tracker && state === 'recording') $('#hud-time').textContent = fmtDuration(tracker.elapsed()); }, 1000);
});

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
    <div class="grid grid-2">
      <div class="field"><label>Veicolo</label><select class="select" id="r-veh">${vehSel}</select></div>
      <div class="field"><label>Privacy</label><select class="select" id="r-priv"><option value="public">Pubblico</option><option value="private">Privato</option></select></div>
    </div>
  ` });

  const save = el('button', { class: 'btn btn-primary', text: 'Salva percorso' });
  const m = modal({ title: 'Salva il percorso', content: form, footer: [save] });

  save.addEventListener('click', async () => {
    const name = $('#r-name', form).value.trim();
    if (name.length < 3) { toast.error('Dai un nome al percorso (min. 3 caratteri).'); return; }
    save.disabled = true; save.textContent = 'Salvataggio…';
    try {
      const { route } = await api.post('/routes', {
        name,
        description: $('#r-desc', form).value.trim(),
        category: $('#r-cat', form).value,
        difficulty: $('#r-diff', form).value,
        vehicle_type: $('#r-veh', form).value,
        privacy: $('#r-priv', form).value,
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
  const form = el('div', { html: `
    <div class="stats-row mb-4">
      <div class="stat"><div class="v accent">${fmtChrono(result.time_ms)}</div><div class="k">Tempo</div></div>
      <div class="stat"><div class="v">${fmtDistance(result.distance_m)}</div><div class="k">Distanza</div></div>
      <div class="stat"><div class="v">${result.maxSpeed_kmh}</div><div class="k">Max km/h</div></div>
    </div>
    <div class="field"><label>Meteo</label><input class="input" id="c-weather" placeholder="es. sereno, pioggia…" maxlength="40" /></div>
  ` });
  const send = el('button', { class: 'btn btn-primary', text: 'Invia tempo' });
  const m = modal({ title: 'Registra il tuo tempo', content: form, footer: [send] });

  send.addEventListener('click', async () => {
    send.disabled = true; send.textContent = 'Invio…';
    try {
      const res = await api.post(`/routes/${routeId}/complete`, {
        time_ms: result.time_ms,
        weather: $('#c-weather', form).value.trim(),
        track: result.track,
      });
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
