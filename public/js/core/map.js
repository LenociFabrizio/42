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
 * "Nebbia" sulle aree non ancora scoperte: le regioni che l'utente non ha mai
 * visitato restano sotto un velo scuro col bordo tratteggiato, come una mappa
 * di gioco ancora da esplorare. Quelle sbloccate tornano in chiaro.
 *
 * @param {object} map
 * @param {string[]} discoveredGeoNames nomi (campo `name` del GeoJSON) da svelare
 */
export async function setRegionFog(map, discoveredGeoNames = []) {
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
          'fill-opacity': 0.66,
          'fill-opacity-transition': { duration: 600 },
        },
      });
      map.addLayer({
        id: 'it-regions-fog-line',
        type: 'line',
        source: 'it-regions',
        paint: { 'line-color': '#ffb020', 'line-opacity': 0.22, 'line-width': 1.2, 'line-dasharray': [2, 3] },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
      // I confini "in chiaro" restano sopra il velo.
      if (map.getLayer('it-regions-line')) map.moveLayer('it-regions-line');
    }
  } catch { /* layer già presenti */ }
  if (!map.getLayer('it-regions-fog')) return;

  // Il filtro tiene il velo SOLO sulle aree non ancora scoperte.
  const filter = ['!', ['in', ['get', 'name'], ['literal', discoveredGeoNames]]];
  map.setFilter('it-regions-fog', filter);
  map.setFilter('it-regions-fog-line', filter);
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
