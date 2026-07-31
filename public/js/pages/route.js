/* =============================================================
   route.js — Dettaglio percorso.
   Mappa del tracciato, statistiche, RECORD ufficiale del creatore,
   miglior tempo personale, azioni (completa/like/condividi/modifica/
   elimina) e classifica tempi.
   ============================================================= */
import '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { createMap, setRouteLine, addMarker, fitPoints, onMapReady } from '../core/map.js';
import { decodePolyline } from '../core/geo.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, DIFF_LEVEL, catLabel, catIcon } from '../core/constants.js';
import {
  $, svg, el, loader, toast, modal, confirmDialog,
  fmtDistance, fmtDuration, fmtChrono, fmtSpeed, fmtDate, qs, esc,
} from '../core/ui.js';
import { privacyBadge } from '../core/visibility.js';
import api from '../core/api.js';

const DEFAULT_AVATAR = '/images/avatars/default.svg';
const id = qs.get('id');

let route = null;
let creator = {};
let isMine = false;
let liked = false;
let likes = 0;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'routes' });

  if (!id) {
    toast.error('Percorso non trovato.');
    loader.hide();
    setTimeout(() => (location.href = '/routes.html'), 900);
    return;
  }

  try {
    const data = await api.get(`/routes/${id}`);
    render(data);
    initMap();
    loadLeaderboard();
  } catch (err) {
    toast.error(err.message || 'Percorso non disponibile.');
    setTimeout(() => (location.href = '/routes.html'), 1100);
  } finally {
    loader.hide();
  }
}

/* -------------------- Render principale -------------------- */
function render(data) {
  route = data.route || {};
  creator = data.creator || {};
  const tags = data.tags || [];
  const record = data.record || null;
  const myBest = data.my_best || null;
  liked = !!data.liked;
  likes = route.likes_count ?? 0;
  isMine = route.creator_id === auth.user?.id;

  const diffLbl = ROUTE_DIFFICULTIES.find((d) => d.v === route.difficulty)?.l || route.difficulty || '—';

  $('#root').innerHTML = `
    <div id="map" class="mb-4" style="height:300px;border-radius:var(--r-lg);overflow:hidden;position:relative"></div>

    <h1 class="mb-2">${esc(route.name)}</h1>

    <a class="flex items-center gap-2 mb-3" href="/profile.html?id=${creator.id}" style="width:fit-content">
      <img class="avatar sm" src="${esc(creator.avatar || DEFAULT_AVATAR)}" alt="" />
      <span class="text-mid">${esc(creator.nickname || 'Anonimo')}</span>
    </a>

    <div class="flex gap-2 wrap mb-4" id="route-chips">
      <span class="chip sm">${svg(catIcon(route.category), 14)} ${esc(catLabel(route.category))}</span>
      <span class="chip sm">${diffDots(route.difficulty)} ${esc(diffLbl)}</span>
      ${tags.map((t) => `<span class="chip sm">#${esc(t)}</span>`).join('')}
    </div>

    ${route.description ? `<p class="text-mid mb-4">${esc(route.description)}</p>` : ''}

    <div class="stats-row mb-4">
      <div class="stat"><div class="v accent">${fmtDistance(route.distance_m)}</div><div class="k">Distanza</div></div>
      <div class="stat"><div class="v">${route.elevation_gain_m ?? 0} m</div><div class="k">Dislivello</div></div>
      <div class="stat"><div class="v">${fmtDuration(route.est_time_s)}</div><div class="k">Tempo stim.</div></div>
      <div class="stat"><div class="v">${route.completions_count ?? 0}</div><div class="k">Completamenti</div></div>
    </div>

    <div class="card mb-3" style="border-color:var(--accent-dim)">
      <div class="section-label flex items-center gap-2">${svg('trophy', 16)} Record ufficiale</div>
      ${record ? `
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <img class="avatar sm" src="${esc(record.avatar || DEFAULT_AVATAR)}" alt="" />
            <div>
              <div class="li-title">${esc(record.nickname || '—')}</div>
              <div class="text-lo" style="font-size:.8rem">${fmtSpeed(record.avg_speed_kmh)} media · ${fmtDate(record.created_at)}</div>
            </div>
          </div>
          <div class="num text-accent" style="font-size:1.7rem">${fmtChrono(record.time_ms)}</div>
        </div>
      ` : `<p class="text-mid">Nessun record ancora — sii il primo!</p>`}
      <p class="text-lo mt-2" style="font-size:.8rem">Il record ufficiale appartiene al creatore del percorso.</p>
    </div>

    ${myBest ? `
      <div class="card mb-4">
        <div class="flex items-center justify-between">
          <div class="section-label" style="margin:0">Il tuo miglior tempo</div>
          <div class="num text-hi" style="font-size:1.3rem">${fmtChrono(myBest.time_ms)}</div>
        </div>
        <div class="text-lo mt-1" style="font-size:.8rem">${fmtSpeed(myBest.avg_speed_kmh)} media · ${fmtDate(myBest.created_at)}</div>
      </div>` : `<div class="mb-4"></div>`}

    <a class="btn btn-primary btn-block btn-lg" href="/record.html?route=${id}">${svg('play', 22)} Registra il tuo tempo</a>
    <p class="text-lo mb-3 mt-1" style="font-size:.8rem">Il cronometro parte solo dalla linea di partenza e si ferma da sé al traguardo.</p>

    <div class="flex gap-2 mb-3">
      <button class="btn btn-outline grow" id="like-btn"></button>
      <button class="btn btn-outline grow" id="share-btn">${svg('share', 20)} Condividi</button>
    </div>

    ${isMine ? `
      <div class="flex gap-2 mb-4">
        <button class="btn btn-outline grow" id="edit-btn">${svg('edit', 20)} Modifica</button>
        <button class="btn btn-outline grow" id="delete-btn" style="color:var(--danger)">${svg('trash', 20)} Elimina</button>
      </div>` : ''}

    <h2 class="mb-3 mt-4">Classifica tempi</h2>
    <div id="lb"><div class="empty"><div class="ic">${svg('clock', 46)}</div><p class="text-lo">Caricamento classifica…</p></div></div>
  `;

  // Badge privacy (nodo) accanto ai chip di categoria/difficoltà/tag.
  $('#route-chips')?.append(privacyBadge(route.privacy));

  renderLike();
  $('#like-btn').addEventListener('click', onLike);
  $('#share-btn').addEventListener('click', onShare);
  if (isMine) {
    $('#edit-btn').addEventListener('click', openEdit);
    $('#delete-btn').addEventListener('click', onDelete);
  }
}

/** Tacche di difficoltà (rosse per "estrema"). */
function diffDots(difficulty) {
  const lvl = DIFF_LEVEL[difficulty] || 0;
  const cls = difficulty === 'estrema' ? 'diff estrema' : 'diff';
  const dots = [1, 2, 3, 4].map((i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
  return `<span class="${cls}">${dots}</span>`;
}

/* -------------------- Mappa -------------------- */
async function initMap() {
  let map;
  try {
    map = await createMap('map', { zoom: 12 });
  } catch {
    toast.warning('Impossibile caricare la mappa.');
    return;
  }
  const points = decodePolyline(route.track_polyline || ''); // [[lat,lng], ...]
  // onMapReady e non map.on('load'): se lo stile è già pronto quell'evento non
  // scatta più e il tracciato non verrebbe mai disegnato.
  onMapReady(map, () => {
    if (points.length >= 2) {
      setRouteLine(map, 'r', points);
      const start = points[0];
      const end = points[points.length - 1];
      addMarker(map, { lat: start[0], lng: start[1], className: 'mk route', html: svg('flag', 14) });
      addMarker(map, { lat: end[0], lng: end[1], className: 'mk route', html: svg('trophy', 14) });
      fitPoints(map, points);
    } else if (route.start_lat != null) {
      addMarker(map, { lat: route.start_lat, lng: route.start_lng, className: 'mk route', html: svg('flag', 14) });
      map.jumpTo({ center: [route.start_lng, route.start_lat], zoom: 12 });
    }
    map.resize();
  });
}

/* -------------------- Like -------------------- */
function renderLike() {
  const b = $('#like-btn');
  b.innerHTML = `${svg('heart', 20)} <span>${likes}</span>`;
  b.style.color = liked ? 'var(--redline)' : '';
  b.style.borderColor = liked ? 'var(--redline)' : '';
}

async function onLike() {
  try {
    if (liked) {
      await api.del(`/routes/${id}/like`);
      liked = false; likes = Math.max(0, likes - 1);
    } else {
      await api.post(`/routes/${id}/like`);
      liked = true; likes += 1;
    }
    renderLike();
  } catch (err) {
    toast.error(err.message || 'Operazione non riuscita.');
  }
}

/* -------------------- Condivisione -------------------- */
async function onShare() {
  const url = location.href;
  const data = { title: route.name, text: `Guarda questo percorso su 4 & | 2: ${route.name}`, url };
  if (navigator.share) {
    try { await navigator.share(data); } catch { /* annullato dall'utente */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copiato negli appunti.');
  } catch {
    toast.info(url, { title: 'Copia questo link' });
  }
}

/* -------------------- Modifica (solo creatore) -------------------- */
function openEdit() {
  const catSel = ROUTE_CATEGORIES.map((c) => `<option value="${c.v}" ${c.v === route.category ? 'selected' : ''}>${c.l}</option>`).join('');
  const diffSel = ROUTE_DIFFICULTIES.map((d) => `<option value="${d.v}" ${d.v === route.difficulty ? 'selected' : ''}>${d.l}</option>`).join('');

  const form = el('div', { html: `
    <div class="field"><label>Nome del percorso</label><input class="input" id="e-name" maxlength="80" value="${esc(route.name)}" /></div>
    <div class="field"><label>Descrizione</label><textarea class="textarea" id="e-desc" maxlength="2000">${esc(route.description || '')}</textarea></div>
    <div class="grid grid-2">
      <div class="field"><label>Categoria</label><select class="select" id="e-cat">${catSel}</select></div>
      <div class="field"><label>Difficoltà</label><select class="select" id="e-diff">${diffSel}</select></div>
    </div>
    <div class="field"><label>Privacy</label><select class="select" id="e-priv">
      <option value="public" ${route.privacy === 'public' ? 'selected' : ''}>Pubblico</option>
      <option value="private" ${route.privacy === 'private' ? 'selected' : ''}>Privato</option>
    </select></div>
  ` });

  const save = el('button', { class: 'btn btn-primary', text: 'Salva modifiche' });
  const m = modal({ title: 'Modifica percorso', content: form, footer: [save] });

  save.addEventListener('click', async () => {
    const name = $('#e-name', form).value.trim();
    if (name.length < 3) { toast.error('Il nome deve avere almeno 3 caratteri.'); return; }
    save.disabled = true; save.textContent = 'Salvataggio…';
    try {
      await api.put(`/routes/${id}`, {
        name,
        description: $('#e-desc', form).value.trim(),
        category: $('#e-cat', form).value,
        difficulty: $('#e-diff', form).value,
        privacy: $('#e-priv', form).value,
      });
      toast.success('Percorso aggiornato.');
      m.close();
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      toast.error(err.message || 'Aggiornamento non riuscito.');
      save.disabled = false; save.textContent = 'Salva modifiche';
    }
  });
}

/* -------------------- Eliminazione (solo creatore) -------------------- */
async function onDelete() {
  const ok = await confirmDialog({
    title: 'Eliminare il percorso?',
    message: 'L\'azione è definitiva e rimuoverà anche la classifica dei tempi.',
    confirmText: 'Elimina',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/routes/${id}`);
    toast.success('Percorso eliminato.');
    setTimeout(() => (location.href = '/routes.html'), 600);
  } catch (err) {
    toast.error(err.message || 'Eliminazione non riuscita.');
  }
}

/* -------------------- Classifica -------------------- */
async function loadLeaderboard() {
  try {
    const { leaderboard } = await api.get(`/routes/${id}/leaderboard`);
    renderLeaderboard(leaderboard || []);
  } catch {
    $('#lb').innerHTML = `<div class="empty"><div class="ic">${svg('clock', 46)}</div><p class="text-lo">Classifica non disponibile.</p></div>`;
  }
}

function renderLeaderboard(rows) {
  if (!rows.length) {
    $('#lb').innerHTML = `
      <div class="empty">
        <div class="ic">${svg('flag', 46)}</div>
        <p>Ancora nessun tempo registrato.</p>
        <p class="text-lo" style="font-size:.85rem">Sii il primo a scalare la classifica!</p>
      </div>`;
    return;
  }
  $('#lb').innerHTML = `<div class="list">${rows.map(rowHtml).join('')}</div>`;
}

function rowHtml(r) {
  const rankCls = r.rank === 1 ? 'gold' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : '';
  const badge = (r.rank >= 1 && r.rank <= 3) ? svg('medal', 20) : r.rank;
  const creatorPill = r.is_creator ? ` <span class="pill accent">${svg('star', 14)} creatore</span>` : '';
  return `
  <a class="list-item" href="/profile.html?id=${r.user_id}">
    <div class="li-rank ${rankCls}">${badge}</div>
    <img class="avatar sm" src="${esc(r.avatar || DEFAULT_AVATAR)}" alt="" />
    <div class="li-body">
      <div class="li-title">${esc(r.nickname || '—')}${creatorPill}</div>
      <div class="li-sub">${fmtSpeed(r.avg_speed_kmh)} media · ${fmtDate(r.created_at)}</div>
    </div>
    <div class="num" style="font-size:1.1rem">${fmtChrono(r.time_ms)}</div>
  </a>`;
}

main();
