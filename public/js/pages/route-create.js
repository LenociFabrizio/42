/* =============================================================
   route-create.js — Creazione percorso DISEGNANDO sulla mappa.
   Tocchi la mappa per aggiungere i waypoint: il primo è la partenza,
   l'ultimo l'arrivo. Il tracciato SEGUE LE STRADE reali (routing OSRM);
   se il routing non è disponibile ripiega sulla linea dritta.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, setRouteLine, addMarker } from '../core/map.js';
import { getCurrentPosition, haversine, roadRoute } from '../core/geo.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, ROUTE_VEHICLE_TYPES } from '../core/constants.js';
import { $, svg, el, loader, toast, modal, fmtDistance, fmtDuration } from '../core/ui.js';
import { buildPrivacyControl } from '../core/visibility.js';
import api from '../core/api.js';

let map;
const waypoints = [];      // punti toccati dall'utente [{lat,lng}]
let routeGeom = [];        // geometria stradale [[lat,lng]] (o dritta di fallback)
let onRoad = false;        // true se la geometria segue le strade
let distanceM = 0;
let markers = [];
let seq = 0;               // per ignorare risposte di routing obsolete

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  $('#back-btn').innerHTML = svg('chevronLeft', 24);
  $('#fab-locate').innerHTML = svg('crosshair', 22);

  map = await createMap('map', { zoom: 13 });
  loader.hide();

  map.on('load', async () => {
    try { const p = await getCurrentPosition(); map.jumpTo({ center: [p.lng, p.lat], zoom: 14 }); } catch {}
  });
  map.on('click', (e) => addPoint(e.lngLat.lat, e.lngLat.lng));

  $('#fab-locate').addEventListener('click', async () => {
    try { const p = await getCurrentPosition(); map.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 600 }); }
    catch { toast.warning('Posizione non disponibile.'); }
  });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-continue').addEventListener('click', openSaveSheet);
}

function addPoint(lat, lng) { waypoints.push({ lat, lng }); recompute(); }
function undo() { waypoints.pop(); recompute(); }

/** Ridisegna i marker dei waypoint (partenza/arrivo/intermedi). */
function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers = [];
  const last = waypoints.length - 1;
  waypoints.forEach((p, i) => {
    let cfg;
    if (i === 0) cfg = { className: 'mk route', html: svg('flag', 14) };
    else if (i === last) cfg = { className: 'mk route', html: svg('trophy', 14) };
    else cfg = { className: 'mk-user' };
    markers.push(addMarker(map, { lat: p.lat, lng: p.lng, ...cfg }));
  });
}

/** Ricalcola il percorso su strada (con fallback linea dritta) e aggiorna la UI. */
async function recompute() {
  renderMarkers();
  const my = ++seq;

  if (waypoints.length < 2) {
    routeGeom = [];
    clearLine();
    updateStats(0, false, false);
    return;
  }

  // 1) Anteprima immediata: linea dritta tra i waypoint.
  const straight = waypoints.map((p) => [p.lat, p.lng]);
  drawLine(straight);
  routeGeom = straight;
  onRoad = false;
  distanceM = straightDistance();
  updateStats(distanceM, false, true);

  // 2) Routing su strada (asincrono). Ignora se nel frattempo è cambiato.
  const r = await roadRoute(waypoints);
  if (my !== seq) return; // waypoint cambiati: risultato obsoleto
  if (r && r.points && r.points.length > 1) {
    routeGeom = r.points;
    onRoad = true;
    distanceM = r.distance_m;
    drawLine(r.points);
    updateStats(distanceM, true, false);
  } else {
    updateStats(distanceM, false, false); // resta la linea dritta
  }
}

function drawLine(pts) { setRouteLine(map, 'draw', pts, { color: '#ffb020', width: 6 }); }
function clearLine() {
  if (map.getSource('route-draw')) {
    map.getSource('route-draw').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  }
}
function straightDistance() {
  let d = 0;
  for (let i = 1; i < waypoints.length; i++) d += haversine(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
  return Math.round(d);
}

function updateStats(dist, road, loading) {
  $('#pt-count').textContent = waypoints.length;
  $('#pt-dist').textContent = fmtDistance(dist);
  const badge = $('#road-badge');
  if (loading) { badge.textContent = 'calcolo su strada…'; badge.className = 'pill gray'; }
  else if (road) { badge.textContent = 'su strada'; badge.className = 'pill green'; }
  else if (waypoints.length >= 2) { badge.textContent = 'linea diretta'; badge.className = 'pill gray'; }
  else { badge.textContent = ''; badge.className = 'pill gray'; badge.style.display = waypoints.length >= 2 ? '' : 'none'; }
  if (waypoints.length >= 2) badge.style.display = '';
  $('#btn-undo').disabled = waypoints.length === 0;
  $('#btn-continue').disabled = waypoints.length < 2;
}

/* -------------------- Salvataggio -------------------- */
function openSaveSheet() {
  if (waypoints.length < 2 || routeGeom.length < 2) return;
  const dist = distanceM;
  const est = Math.round((dist / 1000 / 45) * 3600);

  const catSel = ROUTE_CATEGORIES.map((c) => `<option value="${c.v}">${c.l}</option>`).join('');
  const diffSel = ROUTE_DIFFICULTIES.map((d) => `<option value="${d.v}" ${d.v === 'media' ? 'selected' : ''}>${d.l}</option>`).join('');
  const vehSel = ROUTE_VEHICLE_TYPES.map((v) => `<option value="${v.v}">${v.l}</option>`).join('');

  const form = el('div', { html: `
    <div class="stats-row mb-4">
      <div class="stat"><div class="v accent">${fmtDistance(dist)}</div><div class="k">Distanza</div></div>
      <div class="stat"><div class="v">~${fmtDuration(est)}</div><div class="k">Tempo stim.</div></div>
      <div class="stat"><div class="v">${onRoad ? 'Su strada' : 'Diretta'}</div><div class="k">Tracciato</div></div>
    </div>
    <div class="field"><label>Nome del percorso</label><input class="input" id="r-name" placeholder="es. Giro delle colline" maxlength="80" /></div>
    <div class="field"><label>Descrizione</label><textarea class="textarea" id="r-desc" placeholder="Racconta il percorso…" maxlength="2000"></textarea></div>
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
      const track = routeGeom.map((p) => ({ lat: p[0] ?? p.lat, lng: p[1] ?? p.lng }));
      const { route } = await api.post('/routes', {
        name,
        description: $('#r-desc', form).value.trim(),
        category: $('#r-cat', form).value,
        difficulty: $('#r-diff', form).value,
        vehicle_type: $('#r-veh', form).value,
        privacy: pv.privacy,
        club_id: pv.club_id,
        track,
      });
      toast.success('Percorso creato! +XP 🎉');
      m.close();
      setTimeout(() => (location.href = `/route.html?id=${route.id}`), 500);
    } catch (err) {
      toast.error(err.message || 'Salvataggio non riuscito.');
      save.disabled = false; save.textContent = 'Salva percorso';
    }
  });
}

main();
