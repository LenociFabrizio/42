/* =============================================================
   route-create.js — Creazione percorso DISEGNANDO sulla mappa.
   Tocchi la mappa per aggiungere i punti: il primo è la partenza,
   l'ultimo l'arrivo, gli intermedi sono waypoint. Il tracciato è la
   spezzata tra i punti (nessun timestamp: metriche calcolate dal server).
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, setRouteLine, addMarker } from '../core/map.js';
import { getCurrentPosition, haversine } from '../core/geo.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, ROUTE_VEHICLE_TYPES } from '../core/constants.js';
import { $, svg, el, loader, toast, modal, fmtDistance, fmtDuration } from '../core/ui.js';
import api from '../core/api.js';

let map;
const points = [];   // [{lat,lng}, ...]
let markers = [];

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

function addPoint(lat, lng) {
  points.push({ lat, lng });
  renderAll();
}
function undo() {
  points.pop();
  renderAll();
}

/** Ridisegna marker + linea + statistiche. */
function renderAll() {
  markers.forEach((m) => m.remove());
  markers = [];
  const last = points.length - 1;
  points.forEach((p, i) => {
    let cfg;
    if (i === 0) cfg = { className: 'mk route', html: '🏁' };
    else if (i === last) cfg = { className: 'mk route', html: '🏆' };
    else cfg = { className: 'mk-user' };
    markers.push(addMarker(map, { lat: p.lat, lng: p.lng, ...cfg }));
  });

  if (points.length >= 2) setRouteLine(map, 'draw', points.map((p) => [p.lat, p.lng]), { color: '#ffb020', width: 6 });
  else if (map.getLayer('route-draw-line')) {
    // svuota la linea se restano meno di 2 punti
    map.getSource('route-draw')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  }

  $('#pt-count').textContent = points.length;
  $('#pt-dist').textContent = fmtDistance(totalDistance());
  $('#btn-undo').disabled = points.length === 0;
  $('#btn-continue').disabled = points.length < 2;
}

function totalDistance() {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return Math.round(d);
}

/* -------------------- Salvataggio -------------------- */
function openSaveSheet() {
  if (points.length < 2) return;
  const dist = totalDistance();
  const est = Math.round((dist / 1000 / 45) * 3600); // stima a 45 km/h

  const catSel = ROUTE_CATEGORIES.map((c) => `<option value="${c.v}">${c.ic} ${c.l}</option>`).join('');
  const diffSel = ROUTE_DIFFICULTIES.map((d) => `<option value="${d.v}" ${d.v === 'media' ? 'selected' : ''}>${d.l}</option>`).join('');
  const vehSel = ROUTE_VEHICLE_TYPES.map((v) => `<option value="${v.v}">${v.ic} ${v.l}</option>`).join('');

  const form = el('div', { html: `
    <div class="stats-row mb-4">
      <div class="stat"><div class="v accent">${fmtDistance(dist)}</div><div class="k">Distanza</div></div>
      <div class="stat"><div class="v">~${fmtDuration(est)}</div><div class="k">Tempo stim.</div></div>
      <div class="stat"><div class="v">${points.length}</div><div class="k">Punti</div></div>
    </div>
    <div class="field"><label>Nome del percorso</label><input class="input" id="r-name" placeholder="es. Giro delle colline" maxlength="80" /></div>
    <div class="field"><label>Descrizione</label><textarea class="textarea" id="r-desc" placeholder="Racconta il percorso…" maxlength="2000"></textarea></div>
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
        track: points, // punti [{lat,lng}] → il server calcola distanza/polyline
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
