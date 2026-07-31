/* =============================================================
   map.js — Wrapper su MapLibre GL JS.
   - Carica la libreria da CDN (una sola volta).
   - Stile mappa: raster CARTO dark (gratuito, senza chiave) di default,
     oppure lo styleUrl configurato lato server (/api/config).
   - Helper per linee-percorso, marker HTML, adattamento ai confini.
   ============================================================= */
import api from './api.js';

const MAPLIBRE_VER = '4.7.1';
let _loading = null;
let _config = null;

/** Carica MapLibre GL (CSS + JS) una sola volta. Risolve con window.maplibregl. */
export function ensureMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (_loading) return _loading;
  _loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VER}/dist/maplibre-gl.css`;
    // Il CSS di MapLibre va PRIMA dei nostri fogli di stile. Aggiunto in coda a
    // <head> (com'era) finiva dopo i nostri e a pari specificità vinceva lui:
    // i popup restavano bianchi come da libreria, col testo del tema chiaro
    // sopra — bianco su bianco, illeggibile.
    const firstSheet = document.head.querySelector('link[rel="stylesheet"], style');
    if (firstSheet) document.head.insertBefore(css, firstSheet);
    else document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VER}/dist/maplibre-gl.js`;
    s.onload = () => resolve(window.maplibregl);
    s.onerror = () => reject(new Error('Impossibile caricare le mappe.'));
    document.head.appendChild(s);
  });
  return _loading;
}

async function mapConfig() {
  if (_config) return _config;
  try { _config = (await api.get('/config', {}, { auth: false })).map || {}; }
  catch { _config = {}; }
  return _config;
}

/** Stile mappa: styleUrl configurato oppure raster CARTO dark/light. */
async function resolveStyle() {
  const cfg = await mapConfig();
  if (cfg.styleUrl) {
    return cfg.tileKey ? cfg.styleUrl.replace('{key}', cfg.tileKey) : cfg.styleUrl;
  }
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  const variant = light ? 'light_all' : 'dark_all';
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`),
        tileSize: 256,
        attribution: '© OpenStreetMap · © CARTO',
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto', minzoom: 0, maxzoom: 20 }],
  };
}

/**
 * Crea una mappa MapLibre nel container dato.
 * @returns {Promise<maplibregl.Map>}
 */
// La WebApp opera solo sul territorio italiano: la vista è vincolata all'Italia.
const ITALY_MAXBOUNDS = [[6.2, 35.0], [19.0, 47.6]]; // [[ovest,sud],[est,nord]]

export async function createMap(container, { center = [12.5, 42.5], zoom = 5.2 } = {}) {
  const maplibregl = await ensureMapLibre();
  const style = await resolveStyle();
  const map = new maplibregl.Map({
    container,
    style,
    center,
    zoom,
    maxBounds: ITALY_MAXBOUNDS,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
  });
  // Niente controlli +/- : in alto a destra finivano sotto la barra superiore
  // (e in basso avrebbero rubato spazio al pollice e ai tasti della mappa). Lo
  // zoom si fa col pizzico, col doppio tocco, con la rotella o coi tasti +/−:
  // su un'app mobile-first due bottoni in meno sono schermo guadagnato.
  map.touchZoomRotate.disableRotation();
  // Confini delle regioni italiane, coerenti col tema (ambra tenue).
  map.on('load', () => addRegionBorders(map));
  return map;
}

/**
 * Esegue `fn` quando la mappa è pronta a ricevere dati e layer.
 *
 * Serve perché l'evento 'load' di MapLibre scatta UNA sola volta: se lo stile ha
 * già finito di caricare (tile in cache, attese di rete della pagina in mezzo)
 * chi si iscrive dopo NON viene mai richiamato. Sulla home significava mappa
 * senza percorsi, senza GPS e senza il polling degli amici live: la posizione
 * degli altri compariva solo forzando un aggiornamento a mano.
 */
export function onMapReady(map, fn) {
  if (map.isStyleLoaded()) { fn(); return; }
  map.once('load', fn);
}

/** Confini delle regioni italiane (una sola richiesta per pagina). */
let _regionsGeo = null;
export function loadRegionsGeo() {
  if (_regionsGeo) return _regionsGeo;
  _regionsGeo = fetch('/data/italy-regions.geojson')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return _regionsGeo;
}

/** Aggiunge il perimetro delle regioni italiane come layer di linee. */
async function addRegionBorders(map) {
  try {
    if (map.getSource('it-regions')) return;
    const data = await loadRegionsGeo();
    if (!data || map.getSource('it-regions')) return;
    map.addSource('it-regions', { type: 'geojson', data });
    map.addLayer({
      id: 'it-regions-line',
      type: 'line',
      source: 'it-regions',
      paint: { 'line-color': '#ffb020', 'line-opacity': 0.3, 'line-width': 1.1, 'line-blur': 0.3 },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  } catch { /* confini non disponibili: la mappa resta usabile */ }
}

/**
 * Pattern a strisce diagonali "zona interdetta": è il nastro segnaletico dei
 * cantieri, quello che sui giochi di guida marca le aree fuori dal tracciato.
 * Si disegna pixel per pixel (16×16 RGBA, periodo 8 sulla diagonale: con
 * (x+y)%8 le strisce restano continue anche al bordo della piastrella, perché
 * 16 è multiplo di 8) invece di caricare un PNG: un file in meno da servire e
 * nessuna richiesta in più sulla mappa.
 */
function hazardPattern(map, id = 'hazard-stripes') {
  if (map.hasImage?.(id)) return id;
  const S = 16;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const on = (x + y) % 8 < 3;
      // Ambra dei quadranti: l'allerta nell'app è calda, non rossa (il rosso è
      // riservato al redline e agli sconosciuti sulla live map).
      data[i] = 255; data[i + 1] = 176; data[i + 2] = 32;
      data[i + 3] = on ? 150 : 0;
    }
  }
  try { map.addImage(id, { width: S, height: S, data }); } catch { /* già aggiunto */ }
  return id;
}

/**
 * "Nebbia" sulle aree non ancora scoperte: le regioni che l'utente non ha mai
 * visitato restano sotto un velo scuro a strisce da zona interdetta, col bordo
 * tratteggiato e un lucchetto al centro. Quelle sbloccate tornano in chiaro.
 *
 * @param {object} map
 * @param {string[]} discoveredGeoNames nomi (campo `name` del GeoJSON) da svelare
 * @param {object} [opts]
 * @param {(geoName: string) => string} [opts.labelFor] nome da mostrare sul lucchetto
 * @param {(name: string) => void} [opts.onLocked] tocco su un'area bloccata
 */
export async function setRegionFog(map, discoveredGeoNames = [], { labelFor, onLocked } = {}) {
  // Prima che lo stile sia pronto non si possono aggiungere sorgenti: chi chiama
  // ripassa a mappa pronta (vedi onMapReady in home.js).
  if (!map.isStyleLoaded()) return;
  const data = await loadRegionsGeo();
  if (!data) return;
  // La sorgente la crea anche addRegionBorders: le due funzioni corrono in
  // parallelo sullo stesso `load`, quindi chi arriva secondo trova già tutto.
  try {
    if (!map.getSource('it-regions')) map.addSource('it-regions', { type: 'geojson', data });
  } catch { /* creata nel frattempo */ }
  if (!map.getSource('it-regions')) return;

  try {
    if (!map.getLayer('it-regions-fog')) {
      map.addLayer({
        id: 'it-regions-fog',
        type: 'fill',
        source: 'it-regions',
        paint: {
          'fill-color': '#05070b',
          'fill-opacity': 0.72,
          'fill-opacity-transition': { duration: 600 },
        },
      });
      // Le strisce vanno sopra il velo: sul buio pieno non si vedrebbero.
      map.addLayer({
        id: 'it-regions-hazard',
        type: 'fill',
        source: 'it-regions',
        paint: {
          'fill-pattern': hazardPattern(map),
          'fill-opacity': 0.5,
          'fill-opacity-transition': { duration: 600 },
        },
      });
      map.addLayer({
        id: 'it-regions-fog-line',
        type: 'line',
        source: 'it-regions',
        paint: { 'line-color': '#ffb020', 'line-opacity': 0.5, 'line-width': 1.6, 'line-dasharray': [2, 2] },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
      // I confini "in chiaro" restano sopra il velo.
      if (map.getLayer('it-regions-line')) map.moveLayer('it-regions-line');
    }
  } catch { /* layer già presenti */ }
  if (!map.getLayer('it-regions-fog')) return;

  // Il filtro tiene il velo SOLO sulle aree non ancora scoperte.
  const filter = ['!', ['in', ['get', 'name'], ['literal', discoveredGeoNames]]];
  for (const id of ['it-regions-fog', 'it-regions-hazard', 'it-regions-fog-line']) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }

  const locked = (data.features || []).filter((f) => f.properties?.name && !discoveredGeoNames.includes(f.properties.name));
  syncLockMarkers(map, locked, { labelFor, onLocked });
}

/* ---------------- Lucchetti sulle aree bloccate ----------------
   Le tile raster CARTO non portano i glyph dei font, quindi MapLibre non può
   disegnare testo: i cartelli sono marker HTML (e così ereditano il tema e
   restano toccabili). */
const lockMarkers = new Map();
let lockZoomWired = false;

function syncLockMarkers(map, features, { labelFor, onLocked } = {}) {
  const maplibregl = window.maplibregl;
  if (!maplibregl) return;
  const seen = new Set();

  for (const f of features) {
    const geoName = f.properties.name;
    seen.add(geoName);
    if (lockMarkers.has(geoName)) continue;
    const point = labelPoint(f);
    if (!point) continue;

    const name = labelFor?.(geoName) || geoName;
    // Il wrapper è l'elemento del marker: MapLibre gli scrive il `transform` per
    // posizionarlo, quindi le animazioni restano al chip interno.
    const wrap = document.createElement('div');
    const chip = document.createElement('div');
    chip.className = 'area-lock';
    chip.title = `${name}: area bloccata`;
    chip.innerHTML = `
      <span class="area-lock-ic" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="10.5" width="16" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
        </svg>
      </span>
      <b></b>`;
    chip.querySelector('b').textContent = name;
    if (onLocked) {
      chip.addEventListener('click', (e) => { e.stopPropagation(); onLocked(name); });
    }
    wrap.appendChild(chip);
    lockMarkers.set(geoName, new maplibregl.Marker({ element: wrap, anchor: 'center' })
      .setLngLat([point[0], point[1]])
      .addTo(map));
  }

  // Area sbloccata: via il cartello.
  for (const [geoName, mk] of lockMarkers) {
    if (!seen.has(geoName)) { mk.remove(); lockMarkers.delete(geoName); }
  }

  // Con l'Italia intera nello schermo i nomi si accavallerebbero: da lontano
  // resta il solo lucchetto (la CSS decide, vedi `.areas-far`).
  if (!lockZoomWired) {
    lockZoomWired = true;
    const paintZoom = () => map.getContainer().classList.toggle('areas-far', map.getZoom() < 6.6);
    map.on('zoom', paintZoom);
    paintZoom();
  }
}

/**
 * Punto dove piantare il cartello di una regione: si prende l'anello esterno più
 * grande e, su alcune latitudini di prova, il centro del tratto interno più
 * largo. Il baricentro non basta — su forme ad arco o a banana (Liguria, Puglia,
 * Calabria) cadrebbe fuori dai confini, e il lucchetto finirebbe nella regione
 * del vicino, che è esattamente l'errore che si nota subito.
 * @returns {[number, number] | null} [lng, lat]
 */
const labelPoints = new Map();
function labelPoint(feature) {
  const key = feature.properties?.name;
  if (key && labelPoints.has(key)) return labelPoints.get(key);

  const g = feature.geometry;
  const polys = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : [];
  const rings = polys.map((p) => p[0]).filter((r) => r && r.length > 3);
  if (!rings.length) return null;
  // "Più grande" per estensione del rettangolo che lo contiene: basta a scegliere
  // la terraferma invece di uno scoglio, senza calcolare aree vere.
  const ring = rings.reduce((a, b) => (bboxSpan(b) > bboxSpan(a) ? b : a));

  let lat = 0, minLat = Infinity, maxLat = -Infinity;
  for (const [, y] of ring) { if (y < minLat) minLat = y; if (y > maxLat) maxLat = y; }
  let best = null;
  for (const t of [0.5, 0.42, 0.58, 0.34, 0.66]) {
    const y = minLat + (maxLat - minLat) * t;
    const span = widestSpanAt(ring, y);
    if (span && (!best || span.w > best.w)) { best = span; lat = y; }
  }
  const point = best ? [best.x, lat] : null;
  if (key) labelPoints.set(key, point);
  return point;
}

function bboxSpan(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return (maxX - minX) * (maxY - minY);
}

/** Tratto interno più largo dell'anello alla latitudine `y`. */
function widestSpanAt(ring, y) {
  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if (y1 === y2) continue;
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1] - xs[i];
    if (!best || w > best.w) best = { w, x: (xs[i] + xs[i + 1]) / 2 };
  }
  return best;
}

/** Inquadra una regione dal suo nome nel GeoJSON. Ritorna true se riuscito. */
export async function fitRegion(map, geoName, { padding = 30, maxZoom = 11, animate = false } = {}) {
  const data = await loadRegionsGeo();
  const f = data?.features?.find((x) => x.properties?.name === geoName);
  if (!f) return false;
  const maplibregl = window.maplibregl;
  const b = new maplibregl.LngLatBounds();
  const walk = (coords) => {
    if (typeof coords[0] === 'number') b.extend(coords);
    else coords.forEach(walk);
  };
  walk(f.geometry.coordinates);
  map.fitBounds(b, { padding, maxZoom, duration: animate ? 700 : 0 });
  return true;
}

/** Aggiunge/aggiorna una linea-percorso (points = [[lat,lng], ...]). */
export function setRouteLine(map, id, points, { color = '#ffb020', width = 5 } = {}) {
  const coords = points.map((p) => [p[1] ?? p.lng, p[0] ?? p.lat]); // → [lng,lat]
  const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
  const srcId = `route-${id}`;
  if (map.getSource(srcId)) {
    map.getSource(srcId).setData(data);
    return;
  }
  map.addSource(srcId, { type: 'geojson', data });
  // Alone scuro sotto per contrasto sotto il sole.
  map.addLayer({ id: `${srcId}-halo`, type: 'line', source: srcId,
    paint: { 'line-color': '#000', 'line-width': width + 4, 'line-opacity': 0.5 },
    layout: { 'line-cap': 'round', 'line-join': 'round' } });
  map.addLayer({ id: `${srcId}-line`, type: 'line', source: srcId,
    paint: { 'line-color': color, 'line-width': width },
    layout: { 'line-cap': 'round', 'line-join': 'round' } });
}

/** Marker HTML personalizzato. Ritorna il maplibregl.Marker. */
export function addMarker(map, { lat, lng, className = 'mk route', html = '', popupHtml = null, onClick } = {}) {
  const maplibregl = window.maplibregl;
  const wrap = document.createElement('div');
  const anchorPin = className.includes('mk ') || className === 'mk';
  const elMk = document.createElement('div');
  elMk.className = className;
  // I pin a goccia (.mk) sono ruotati: il contenuto va contro-ruotato con uno
  // <span> interno. Gli altri marker (dot utente, avatar amici) ricevono l'HTML
  // direttamente così le dimensioni percentuali si risolvono correttamente.
  elMk.innerHTML = html ? (anchorPin ? `<span>${html}</span>` : html) : '';
  wrap.appendChild(elMk);
  if (onClick) { wrap.style.cursor = 'pointer'; wrap.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); }
  const marker = new maplibregl.Marker({ element: wrap, anchor: anchorPin ? 'bottom' : 'center' })
    .setLngLat([lng, lat]);
  // maxWidth: il default di MapLibre (240px) taglia le schede a due colonne.
  if (popupHtml) marker.setPopup(new maplibregl.Popup({ offset: 24, closeButton: false, maxWidth: '300px' }).setHTML(popupHtml));
  marker.addTo(map);
  return marker;
}

/**
 * Inquadra un raggio (in km) attorno a un punto: la vista mostra un'area di
 * ~2×radiusKm di lato. Usa fitBounds, così il risultato è corretto su qualsiasi
 * dimensione di schermo (a differenza di uno zoom fisso).
 *
 * @param {object} map
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm  raggio desiderato
 * @param {object} [opts]    { animate, padding, maxZoom }
 */
export function fitRadius(map, lat, lng, radiusKm, { animate = true, padding = 24, maxZoom = 17 } = {}) {
  const maplibregl = window.maplibregl;
  const km = Math.max(0.2, Number(radiusKm) || 5);
  const dLat = km / 111.32;
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = km / (111.32 * cos);
  const b = new maplibregl.LngLatBounds([lng - dLng, lat - dLat], [lng + dLng, lat + dLat]);
  map.fitBounds(b, { padding, maxZoom, duration: animate ? 700 : 0 });
}

/** Adatta la vista a una lista di punti [[lat,lng],...]. */
export function fitPoints(map, points, { padding = 60, maxZoom = 15 } = {}) {
  if (!points || !points.length) return;
  const maplibregl = window.maplibregl;
  const b = new maplibregl.LngLatBounds();
  for (const p of points) b.extend([p[1] ?? p.lng, p[0] ?? p.lat]);
  map.fitBounds(b, { padding, maxZoom, duration: 600 });
}

/** Bounding box viewport corrente come "minLng,minLat,maxLng,maxLat". */
export function viewportBbox(map) {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(',');
}
