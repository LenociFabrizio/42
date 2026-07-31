/* =============================================================
   event.js — Dettaglio evento: mappa con geofence del ritrovo,
   check-in GPS (entro il raggio), azioni di partecipazione e
   partecipanti live (posizione aggiornata ogni 8s).
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, addMarker, fitPoints, onMapReady } from '../core/map.js';
import { getCurrentPosition } from '../core/geo.js';
import { $, el, svg, loader, toast, confirmDialog, fmtDate, fmtDistance, esc, qs } from '../core/ui.js';
import { privacyBadge } from '../core/visibility.js';
import api from '../core/api.js';

const DEFAULT_AVATAR = '/images/avatars/default.svg';
const STATUS_PILL = {
  scheduled: { cls: 'gray', label: 'In programma' },
  live: { cls: 'green', label: 'LIVE' },
  ended: { cls: 'gray', label: 'Concluso' },
};

const id = qs.get('id');
let me = null;
let map = null;
let liveTimer = null;
const friendMarkers = new Map();

async function main() {
  const user = await guard();
  if (!user) return;
  me = user;
  registerPWA();
  mountShell({ active: 'events' });
  if (!id) {
    fail('Evento non trovato.');
    return;
  }
  await render();
  loader.hide();
}

/* -------------------- Geofence (cerchio → poligono 64 lati) -------------------- */
function circleRing(lat, lng, radiusM, steps = 64) {
  const dLat = 1 / 111320;                                   // gradi lat per metro
  const dLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180)); // gradi lng per metro
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + radiusM * Math.cos(a) * dLng, lat + radiusM * Math.sin(a) * dLat]); // [lng,lat]
  }
  return ring;
}

function drawGeofence(lat, lng, radiusM) {
  const ring = circleRing(lat, lng, radiusM);
  const data = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } };
  map.addSource('geofence', { type: 'geojson', data });
  map.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofence', paint: { 'fill-color': 'rgba(255,59,48,0.15)' } });
  map.addLayer({ id: 'geofence-line', type: 'line', source: 'geofence', paint: { 'line-color': '#ff3b30', 'line-width': 2 } });
  addMarker(map, { lat, lng, className: 'mk event', html: '📣' });
  fitPoints(map, ring.map((c) => [c[1], c[0]]), { padding: 44, maxZoom: 16 });
}

/* -------------------- Render principale -------------------- */
async function render() {
  stopLive();
  if (map) { try { map.remove(); } catch { /* noop */ } map = null; }

  let data;
  try {
    data = await api.get(`/events/${id}`);
  } catch (err) {
    fail(err.message || 'Impossibile caricare l\'evento.');
    return;
  }

  const ev = data.event;
  const creator = data.creator || {};
  const route = data.route || null;
  const mp = data.my_participation || null;
  const status = data.status || ev.status;
  const joined = !!mp;
  const checkedIn = !!(mp && (mp.checked_in_at || mp.status === 'checked_in'));
  const isCreator = ev.creator_id === me.id;
  const ended = status === 'ended';
  const sp = STATUS_PILL[status] || STATUS_PILL.scheduled;

  const root = $('#root');
  root.innerHTML = '';

  // Mappa (wrapper posizionato: #map è absolute inset:0 dal layout.css).
  const mapWrap = el('div', {
    class: 'mb-4',
    style: 'position:relative;height:300px;border-radius:var(--r-lg);overflow:hidden',
  }, [el('div', { id: 'map', style: 'position:absolute;inset:0' })]);

  // Header
  const header = el('div', { class: 'card mb-4' }, [
    el('div', { class: 'flex items-center gap-2 wrap mb-2' }, [
      el('span', { class: `pill ${sp.cls}`, text: sp.label }),
      joined ? el('span', { class: 'pill accent', text: checkedIn ? '✓ Presente' : '✓ Iscritto' }) : null,
      privacyBadge(ev.privacy),
    ]),
    el('h1', { class: 'mb-3', text: ev.name }),
    el('a', { class: 'flex items-center gap-2 mb-3', href: `/profile.html?id=${creator.id || ''}` }, [
      el('img', { class: 'avatar sm', src: creator.avatar || DEFAULT_AVATAR, alt: creator.nickname || '' }),
      el('div', {}, [
        el('div', { class: 'text-hi', style: 'font-weight:600', text: creator.nickname || 'Organizzatore' }),
        el('div', { class: 'li-sub', text: creator.level != null ? `Liv. ${creator.level}` : 'Organizzatore' }),
      ]),
    ]),
    ev.description ? el('p', { class: 'text-mid mb-3', text: ev.description }) : null,
    el('div', { class: 'flex gap-2 wrap' }, [
      chip(`📅 ${fmtDate(ev.starts_at, { withTime: true })}`),
      chip(`⏱ ${fmtDur(ev.duration_min)}`),
      ev.area_name ? chip(`📍 ${ev.area_name}`) : null,
      chip(`🎯 ${fmtDistance(ev.radius_m)}`),
    ]),
    route
      ? el('a', { class: 'chip', href: `/route.html?id=${route.id}`, style: 'margin-top:12px', text: `🗺 Percorso: ${route.name}` })
      : null,
  ]);

  // Azioni di partecipazione
  const actions = el('div', { class: 'card mb-4' });
  buildActions(actions, { ev, status, joined, checkedIn, isCreator, ended });

  // Lista partecipanti
  const participants = buildParticipants(data.participants || []);

  root.append(mapWrap, header, actions, participants);

  // Crea la mappa e disegna la geofence dopo il montaggio del DOM.
  map = await createMap('map', { center: [ev.area_lng, ev.area_lat], zoom: 13 });
  onMapReady(map, () => {
    try { drawGeofence(ev.area_lat, ev.area_lng, ev.radius_m); } catch { /* noop */ }
  });

  if (checkedIn) startLive();
}

function chip(text) {
  return el('span', { class: 'chip sm', text });
}

/** duration_min (minuti) → "2 h 30 min" / "45 min". */
function fmtDur(min) {
  if (min == null || isNaN(min)) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/* -------------------- Azioni -------------------- */
function buildActions(box, { ev, status, joined, checkedIn, isCreator, ended }) {
  box.innerHTML = '';

  if (ended && !isCreator) {
    box.append(el('p', { class: 'text-lo text-center', text: 'Questo evento è concluso.' }));
  } else if (!joined) {
    const btn = el('button', { class: 'btn btn-primary btn-block btn-lg', text: 'Partecipo' });
    btn.addEventListener('click', () => doJoin(ev.id, btn));
    if (ended) { box.append(el('p', { class: 'text-lo text-center', text: 'Evento concluso.' })); }
    else box.append(btn);
  } else if (!checkedIn) {
    const checkin = el('button', { class: 'btn btn-primary btn-block btn-lg', html: `${svg('crosshair', 22)} Fai il check-in (GPS)` });
    checkin.addEventListener('click', () => doCheckin(ev.id, checkin));
    const hint = el('p', { class: 'li-sub text-center', style: 'margin:10px 0', text: 'Il check-in è possibile solo se sei entro il raggio del ritrovo.' });
    const leave = el('button', { class: 'btn btn-outline btn-block mt-2', text: 'Annulla partecipazione' });
    leave.addEventListener('click', () => doLeave(ev.id, leave));
    box.append(checkin, hint, leave);
  } else {
    const present = el('div', { class: 'flex items-center justify-center gap-2 mb-3', style: 'color:var(--success);font-weight:700;font-size:1.1rem' }, ['Presente ✓']);
    const hint = el('p', { class: 'li-sub text-center mb-3', text: 'Sei al ritrovo: la tua posizione è condivisa con gli altri partecipanti.' });
    const leave = el('button', { class: 'btn btn-outline btn-block', text: 'Esci' });
    leave.addEventListener('click', () => doLeave(ev.id, leave));
    box.append(present, hint, leave);
  }

  if (isCreator) {
    const del = el('button', { class: 'btn btn-danger btn-block mt-3', html: `${svg('trash', 20)} Elimina evento` });
    del.addEventListener('click', () => doDelete(ev.id));
    box.append(del);
  }
}

async function doJoin(eventId, btn) {
  btn.disabled = true;
  try {
    await api.post(`/events/${eventId}/join`);
    toast.success('Partecipazione confermata!');
    await render();
  } catch (err) {
    toast.error(err.message || 'Iscrizione non riuscita.');
    btn.disabled = false;
  }
}

async function doCheckin(eventId, btn) {
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = 'Rilevo posizione…';
  let pos;
  try {
    pos = await getCurrentPosition();
  } catch {
    toast.warning('Posizione non disponibile. Controlla i permessi GPS.');
    btn.disabled = false; btn.innerHTML = original;
    return;
  }
  try {
    const res = await api.post(`/events/${eventId}/checkin`, { lat: pos.lat, lng: pos.lng });
    toast.success(`Check-in effettuato! Sei a ${fmtDistance(res.distance_m)} dal ritrovo.`);
    await render();
  } catch (err) {
    // 403 → troppo lontano: mostra il messaggio del server.
    toast.error(err.message || 'Check-in non riuscito.');
    btn.disabled = false; btn.innerHTML = original;
  }
}

async function doLeave(eventId, btn) {
  btn.disabled = true;
  try {
    await api.post(`/events/${eventId}/leave`);
    toast.info('Hai lasciato l\'evento.');
    stopLive();
    await render();
  } catch (err) {
    toast.error(err.message || 'Operazione non riuscita.');
    btn.disabled = false;
  }
}

async function doDelete(eventId) {
  const ok = await confirmDialog({
    title: 'Eliminare l\'evento?',
    message: 'L\'evento verrà rimosso definitivamente per tutti i partecipanti.',
    confirmText: 'Elimina',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/events/${eventId}`);
    toast.success('Evento eliminato.');
    stopLive();
    setTimeout(() => (location.href = '/events.html'), 500);
  } catch (err) {
    toast.error(err.message || 'Eliminazione non riuscita.');
  }
}

/* -------------------- Partecipanti -------------------- */
function buildParticipants(list) {
  const box = el('div', {}, [el('div', { class: 'section-label', text: `Partecipanti (${list.length})` })]);
  if (!list.length) {
    box.append(el('div', { class: 'empty' }, [el('p', { text: 'Ancora nessun partecipante.' })]));
    return box;
  }
  const ul = el('div', { class: 'list' });
  for (const p of list) {
    const isIn = (p.status || '') === 'checked_in' || !!p.checked_in_at;
    ul.append(el('a', { class: 'list-item', href: `/profile.html?id=${p.user_id}` }, [
      el('img', { class: 'avatar sm', src: p.avatar || DEFAULT_AVATAR, alt: p.nickname || '' }),
      el('div', { class: 'li-body' }, [
        el('div', { class: 'li-title truncate', text: p.nickname || 'Rider' }),
        el('div', { class: 'li-sub', text: p.level != null ? `Liv. ${p.level}` : '' }),
      ]),
      isIn ? el('span', { class: 'pill green', text: '✓ presente' }) : null,
    ]));
  }
  box.append(ul);
  return box;
}

/* -------------------- Live (posizione + marker amici) -------------------- */
function startLive() {
  stopLive();
  pushPosition();
  refreshParticipants();
  liveTimer = setInterval(() => { pushPosition(); refreshParticipants(); }, 8000);
}

function stopLive() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  friendMarkers.forEach((m) => m.remove());
  friendMarkers.clear();
}

async function pushPosition() {
  try {
    const p = await getCurrentPosition();
    await api.post(`/events/${id}/position`, { lat: p.lat, lng: p.lng });
  } catch { /* best-effort: silenzioso */ }
}

async function refreshParticipants() {
  if (!map) return;
  try {
    const { participants = [] } = await api.get(`/events/${id}/participants`);
    const seen = new Set();
    for (const p of participants) {
      if (p.user_id === me.id) continue;
      if (p.last_lat == null || p.last_lng == null) continue;
      if ((p.status || '') !== 'checked_in') continue;
      seen.add(p.user_id);
      if (friendMarkers.has(p.user_id)) {
        friendMarkers.get(p.user_id).setLngLat([p.last_lng, p.last_lat]);
      } else {
        friendMarkers.set(p.user_id, addMarker(map, {
          lat: p.last_lat, lng: p.last_lng, className: 'mk-friend',
          html: `<img src="${esc(p.avatar || DEFAULT_AVATAR)}" alt="${esc(p.nickname || '')}">`,
          popupHtml: `<strong>${esc(p.nickname || 'Rider')}</strong>`,
        }));
      }
    }
    for (const [uid, mk] of friendMarkers) if (!seen.has(uid)) { mk.remove(); friendMarkers.delete(uid); }
  } catch { /* silenzioso */ }
}

/* -------------------- Errore -------------------- */
function fail(msg) {
  loader.hide();
  const root = $('#root');
  root.innerHTML = '';
  root.append(el('div', { class: 'empty' }, [
    el('div', { class: 'ic', text: '📣' }),
    el('p', { text: msg }),
    el('a', { class: 'btn btn-outline mt-3', href: '/events.html', text: 'Torna agli eventi' }),
  ]));
}

window.addEventListener('pagehide', stopLive);
window.addEventListener('beforeunload', stopLive);

main();
