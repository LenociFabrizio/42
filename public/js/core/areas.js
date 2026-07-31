/* =============================================================
   areas.js — Le "Aree" di gioco: le 20 regioni italiane.

   Alla registrazione si scegli l'area di partenza; le altre si sbloccano SOLO
   entrandoci davvero. Qui vivono: lo stato locale delle aree, la finestra di
   scelta (anche per chi si è registrato prima di questa funzione) e il
   controllo periodico della posizione.

   Chi decide lo sblocco è il server (POST /regions/visit): il client si limita
   a dire dove si trova e a festeggiare la risposta.
   ============================================================= */
import { el, modal, toast } from './ui.js';
import { auth } from './auth.js';
import { playUnlock } from './sound.js';
import api from './api.js';

// Distanza e tempo oltre i quali vale la pena richiedere il controllo dell'area:
// le regioni sono grandi, non serve chiedere a ogni fix del GPS.
const CHECK_DIST_M = 1000;
const CHECK_EVERY_MS = 120000;

const state = {
  home: null,          // codice dell'area di partenza
  discovered: [],      // codici delle aree scoperte
  regions: [],         // catalogo [{code, name, geo_name}]
  total: 20,
};
let lastCheck = null;  // { lat, lng, at }
let onChange = null;   // callback per ridisegnare la nebbia

/** Stato corrente delle aree (sola lettura). */
export function areas() {
  return state;
}

/** Nomi GeoJSON delle aree scoperte: servono a togliere la nebbia. */
export function discoveredGeoNames() {
  const byCode = new Map(state.regions.map((r) => [r.code, r.geo_name || r.name]));
  return state.discovered.map((c) => byCode.get(c)).filter(Boolean);
}

/** Nome GeoJSON dell'area di partenza (per inquadrarla), o null. */
export function homeGeoName() {
  const r = state.regions.find((x) => x.code === state.home);
  return r ? r.geo_name || r.name : null;
}

/** Nome leggibile di un'area. */
export function areaName(code) {
  return state.regions.find((r) => r.code === code)?.name || code || '';
}

/**
 * Nome dell'area dal nome GeoJSON. Servono entrambi perché due regioni sul
 * GeoJSON portano la dicitura bilingue ("Trentino-Alto Adige/Südtirol"): sui
 * cartelli della mappa mostriamo il nome che usa l'app.
 */
export function nameByGeoName(geoName) {
  return state.regions.find((r) => (r.geo_name || r.name) === geoName)?.name || geoName;
}

function apply(data) {
  if (!data) return state;
  if (Array.isArray(data.regions) && data.regions.length) state.regions = data.regions;
  if (Array.isArray(data.discovered)) state.discovered = data.discovered;
  if (data.home !== undefined) state.home = data.home;
  if (data.total) state.total = data.total;
  onChange?.(state);
  return state;
}

/** Registra chi ridisegna la mappa quando le aree cambiano. */
export function onAreasChange(fn) { onChange = fn; }

/** Carica lo stato delle aree dal server. */
export async function loadAreas() {
  try { return apply(await api.get('/regions')); }
  catch { return state; }
}

/** Catalogo delle aree, disponibile anche senza account (registrazione). */
export async function fetchCatalog() {
  try {
    const { regions } = await api.get('/regions/catalog', {}, { auth: false });
    if (Array.isArray(regions)) state.regions = regions;
  } catch { /* senza catalogo la scelta si fa più tardi, dalla mappa */ }
  return state.regions;
}

/**
 * Garantisce che l'utente abbia un'area di partenza.
 * Gli account creati prima di questa funzione (e chi entra con Google) non ne
 * hanno una: gliela chiediamo qui, una volta, senza poter annullare — è il dato
 * che decide da dove comincia la mappa.
 */
export async function ensureHomeArea() {
  await loadAreas();
  if (state.home) return state;
  if (!state.regions.length) await fetchCatalog();
  // Senza catalogo (offline al primo avvio) non si chiede: la mappa resta
  // usabile e la domanda torna alla prossima apertura.
  if (!state.regions.length) return state;
  await askHomeArea();
  return state;
}

/** Finestra di scelta dell'area di partenza. Si chiude solo scegliendo. */
function askHomeArea() {
  return new Promise((resolve) => {
    const grid = el('div', { class: 'area-grid' });
    let chosen = null;
    const confirm = el('button', { class: 'btn btn-primary btn-block', text: 'Conferma area', disabled: true });

    for (const r of state.regions) {
      const b = el('button', { class: 'area-chip', text: r.name, 'data-code': r.code });
      b.addEventListener('click', () => {
        chosen = r.code;
        grid.querySelectorAll('.area-chip').forEach((x) => x.classList.toggle('on', x === b));
        confirm.disabled = false;
        confirm.textContent = `Parti dal/dalla ${r.name}`;
      });
      grid.append(b);
    }

    const body = el('div', {}, [
      el('p', { class: 'text-mid mb-3', text: 'Da dove parti? La tua area è già scoperta: il resto d\'Italia resta in ombra finché non ci entri davvero.' }),
      grid,
      el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:10px', text: 'La scelta è definitiva: l\'area di partenza non si cambia (sarebbe un modo per sbloccare aree senza viaggiare).' }),
    ]);

    // Scelta obbligatoria: senza area la mappa non sa da dove far partire il gioco.
    const m = modal({ title: 'Scegli la tua area', content: body, footer: [confirm], dismissible: false });

    confirm.addEventListener('click', async () => {
      if (!chosen) return;
      confirm.disabled = true;
      const label = confirm.textContent;
      confirm.textContent = 'Salvataggio…';
      try {
        apply(await api.post('/regions/home', { region: chosen }));
        auth.patchUser({ region: chosen });
        m.close();
        toast.success(`Area di partenza: ${areaName(chosen)}. Buon viaggio!`);
        resolve(state);
      } catch (err) {
        toast.error(err.message || 'Non è stato possibile salvare l\'area.');
        confirm.disabled = false;
        confirm.textContent = label;
      }
    });
  });
}

/**
 * Comunica la posizione al server per lo sblocco delle aree, con parsimonia
 * (vedi CHECK_DIST_M / CHECK_EVERY_MS). Se l'area è nuova festeggia.
 * @returns {Promise<string|null>} codice dell'area appena sbloccata, o null
 */
export async function checkArea(lat, lng, { force = false } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!force && lastCheck) {
    const far = distance(lastCheck.lat, lastCheck.lng, lat, lng) > CHECK_DIST_M;
    const old = Date.now() - lastCheck.at > CHECK_EVERY_MS;
    if (!far && !old) return null;
  }
  lastCheck = { lat, lng, at: Date.now() };
  try {
    const res = await api.post('/regions/visit', { lat, lng });
    apply(res);
    if (res?.unlocked && res.region) {
      celebrate(res.name || areaName(res.region), res.discovered?.length || 0);
      return res.region;
    }
  } catch { /* rete assente: si riprova al prossimo controllo */ }
  return null;
}

/** Festa per l'area appena sbloccata: suono dedicato + avviso. */
function celebrate(name, count) {
  playUnlock();
  toast(`Nuova area sbloccata: ${name}! ${count}/${state.total} d'Italia`, 'success', {
    title: 'Area sbloccata 🗺️',
    duration: 6000,
  });
}

/** Distanza in metri (formula haversine, copia locale per non creare cicli). */
function distance(aLat, aLng, bLat, bLng) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export default { areas, loadAreas, ensureHomeArea, checkArea, discoveredGeoNames, homeGeoName, nameByGeoName, onAreasChange };
