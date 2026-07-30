/* =============================================================
   event-create.js — Creazione evento (wizard 2 step).
   Step 1: scelta AREA di ritrovo su mappa (mirino centrale) + raggio.
   Step 2: dettagli (nome, descrizione, data/ora, durata, posti, percorso).
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap } from '../core/map.js';
import { getCurrentPosition } from '../core/geo.js';
import { $, el, svg, loader, toast, fmtDistance } from '../core/ui.js';
import api from '../core/api.js';

const data = {
  area_lat: null,
  area_lng: null,
  area_name: '',
  radius_m: 1000,
  name: '',
  description: '',
  date: '',
  time: '',
  duration_min: 120,
  max_participants: 0,
  route_id: '',
};

let map = null;
let routesCache = null;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'events' });
  renderStep1();
  loader.hide();
}

function steps(current) {
  return el('div', { class: 'wizard-steps' }, [
    el('span', { class: `st ${current > 1 ? 'done' : 'current'}` }),
    el('span', { class: `st ${current === 2 ? 'current' : ''}` }),
  ]);
}

/* -------------------- Step 1: area + raggio -------------------- */
function renderStep1() {
  if (map) { try { map.remove(); } catch { /* noop */ } map = null; }

  const root = $('#root');
  root.innerHTML = '';

  const mapEl = el('div', { id: 'map', style: 'position:absolute;inset:0' });
  const crosshair = el('div', {
    style: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);font-size:2.4rem;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));z-index:2',
    text: '📍',
  });
  const mapWrap = el('div', {
    class: 'mb-3',
    style: 'position:relative;height:320px;border-radius:var(--r-lg);overflow:hidden',
  }, [mapEl, crosshair]);

  const locateBtn = el('button', { class: 'btn btn-outline btn-block mb-3', html: `${svg('crosshair', 20)} Usa la mia posizione` });

  const radiusVal = el('span', { class: 'text-accent', style: 'font-weight:700', text: fmtDistance(data.radius_m) });
  const radius = el('input', {
    class: 'input', type: 'range', min: '200', max: '10000', step: '100', value: String(data.radius_m),
    style: 'padding:0;min-height:auto',
  });
  radius.addEventListener('input', () => { radiusVal.textContent = fmtDistance(+radius.value); });

  const areaName = el('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'es. Piazza del Duomo', value: data.area_name });

  const next = el('button', { class: 'btn btn-primary btn-block btn-lg mt-2', text: 'Continua' });

  root.append(
    steps(1),
    el('div', { class: 'flex items-center justify-between gap-3 mb-3' }, [
      el('h1', { text: 'Crea evento' }),
    ]),
    el('p', { class: 'text-mid mb-3', text: 'Sposta la mappa per centrare il mirino sul punto di ritrovo.' }),
    mapWrap,
    locateBtn,
    el('div', { class: 'field' }, [
      el('label', {}, [
        'Raggio del ritrovo ',
        radiusVal,
      ]),
      radius,
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Nome zona (facoltativo)' }),
      areaName,
    ]),
    next,
  );

  next.addEventListener('click', () => {
    const c = map.getCenter();
    data.area_lat = c.lat;
    data.area_lng = c.lng;
    data.radius_m = +radius.value;
    data.area_name = areaName.value.trim();
    renderStep2();
  });

  createMap('map', data.area_lat != null ? { center: [data.area_lng, data.area_lat], zoom: 13 } : {}).then((m) => {
    map = m;
    if (data.area_lat == null) {
      m.on('load', async () => {
        try { const p = await getCurrentPosition(); m.jumpTo({ center: [p.lng, p.lat], zoom: 13 }); } catch { /* noop */ }
      });
    }
  });

  locateBtn.addEventListener('click', async () => {
    try {
      const p = await getCurrentPosition();
      map.flyTo({ center: [p.lng, p.lat], zoom: 14, duration: 700 });
    } catch {
      toast.warning('Posizione non disponibile. Controlla i permessi GPS.');
    }
  });
}

/* -------------------- Step 2: dettagli -------------------- */
async function renderStep2() {
  if (map) { try { map.remove(); } catch { /* noop */ } map = null; }

  const root = $('#root');
  root.innerHTML = '';

  const fName = el('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'es. Raduno del sabato', value: data.name });
  const fDesc = el('textarea', { class: 'textarea', maxlength: '2000', placeholder: 'Ritrovo, giro previsto, note…' });
  fDesc.value = data.description;
  const fDate = el('input', { class: 'input', type: 'date', value: data.date });
  const fTime = el('input', { class: 'input', type: 'time', value: data.time });
  const fDur = el('input', { class: 'input', type: 'number', min: '15', step: '15', value: String(data.duration_min) });
  const fMax = el('input', { class: 'input', type: 'number', min: '0', step: '1', value: String(data.max_participants) });

  const fRoute = el('select', { class: 'select' }, [el('option', { value: '', text: 'Nessuno' })]);

  const back = el('button', { class: 'btn btn-outline', style: 'flex:1', text: 'Indietro' });
  const submit = el('button', { class: 'btn btn-primary', style: 'flex:2', text: 'Crea evento' });

  root.append(
    steps(2),
    el('h1', { class: 'mb-3', text: 'Dettagli evento' }),
    el('div', { class: 'field' }, [el('label', { text: 'Nome' }), fName]),
    el('div', { class: 'field' }, [el('label', { text: 'Descrizione' }), fDesc]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Data' }), fDate]),
      el('div', { class: 'field' }, [el('label', { text: 'Ora' }), fTime]),
    ]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Durata (min)' }), fDur]),
      el('div', { class: 'field' }, [el('label', { text: 'Posti (0 = illimitati)' }), fMax]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Percorso collegato (facoltativo)' }), fRoute]),
    el('div', { class: 'flex gap-2 mt-2' }, [back, submit]),
  );

  // Popola il selettore percorsi.
  loadRoutes().then((routes) => {
    for (const r of routes) {
      fRoute.append(el('option', { value: String(r.id), text: r.name }));
    }
    if (data.route_id) fRoute.value = String(data.route_id);
  });

  back.addEventListener('click', () => {
    saveStep2({ fName, fDesc, fDate, fTime, fDur, fMax, fRoute });
    renderStep1();
  });

  submit.addEventListener('click', () => onSubmit({ fName, fDesc, fDate, fTime, fDur, fMax, fRoute, submit }));
}

function saveStep2({ fName, fDesc, fDate, fTime, fDur, fMax, fRoute }) {
  data.name = fName.value.trim();
  data.description = fDesc.value.trim();
  data.date = fDate.value;
  data.time = fTime.value;
  data.duration_min = parseInt(fDur.value, 10) || 0;
  data.max_participants = parseInt(fMax.value, 10) || 0;
  data.route_id = fRoute.value;
}

async function loadRoutes() {
  if (routesCache) return routesCache;
  try {
    const { routes = [] } = await api.get('/routes', { limit: 100 });
    routesCache = routes;
  } catch {
    routesCache = [];
  }
  return routesCache;
}

async function onSubmit(f) {
  saveStep2(f);

  if (data.area_lat == null || data.area_lng == null) {
    toast.error('Scegli l\'area di ritrovo (torna al passo 1).');
    return;
  }
  if (data.name.length < 3) { toast.error('Il nome deve avere almeno 3 caratteri.'); return; }
  if (!data.date || !data.time) { toast.error('Inserisci data e ora di inizio.'); return; }

  const dt = new Date(`${data.date}T${data.time}`);
  if (isNaN(dt.getTime())) { toast.error('Data/ora non valide.'); return; }
  if (data.duration_min < 15) { toast.error('La durata minima è 15 minuti.'); return; }

  const payload = {
    name: data.name,
    description: data.description,
    starts_at: dt.toISOString(),
    duration_min: data.duration_min,
    max_participants: data.max_participants,
    area_lat: data.area_lat,
    area_lng: data.area_lng,
    area_name: data.area_name || undefined,
    radius_m: data.radius_m,
  };
  if (data.route_id) payload.route_id = parseInt(data.route_id, 10);

  const btn = f.submit;
  btn.disabled = true;
  btn.textContent = 'Creazione…';
  try {
    const { event } = await api.post('/events', payload);
    toast.success('Evento creato! 🎉');
    setTimeout(() => (location.href = `/event.html?id=${event.id}`), 500);
  } catch (err) {
    toast.error(err.message || 'Creazione non riuscita.');
    btn.disabled = false;
    btn.textContent = 'Crea evento';
  }
}

main();
