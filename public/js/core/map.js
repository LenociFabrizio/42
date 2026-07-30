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
    document.head.appendChild(css);
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
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.touchZoomRotate.disableRotation();
  // Confini delle regioni italiane, coerenti col tema (ambra tenue).
  map.on('load', () => addRegionBorders(map));
  return map;
}

/** Aggiunge il perimetro delle regioni italiane come layer di linee. */
async function addRegionBorders(map) {
  try {
    if (map.getSource('it-regions')) return;
    const res = await fetch('/data/italy-regions.geojson');
    if (!res.ok) return;
    const data = await res.json();
    if (map.getSource('it-regions')) return;
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
  if (popupHtml) marker.setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setHTML(popupHtml));
  marker.addTo(map);
  return marker;
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
