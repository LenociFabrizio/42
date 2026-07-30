/* =============================================================
   routes.js — Elenco/ricerca percorsi.
   Ricerca testuale (debounce), filtri per categoria e difficoltà,
   griglia di card percorso. Link al dettaglio e alla registrazione.
   ============================================================= */
import '../core/theme.js';
import { guard } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { ROUTE_CATEGORIES, ROUTE_DIFFICULTIES, DIFF_LEVEL, catLabel, catIcon } from '../core/constants.js';
import { $, $$, svg, loader, toast, fmtDistance, fmtDuration, debounce, esc } from '../core/ui.js';
import { privacyFrameClass, privacyBadge } from '../core/visibility.js';
import api from '../core/api.js';

const state = { q: '', category: '', difficulty: '' };
let reqId = 0;

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: 'routes' });
  buildUi();
  loader.hide();
  fetchRoutes();
}

/** Monta l'intestazione, i controlli di ricerca/filtro e il contenitore risultati. */
function buildUi() {
  const catChips = [{ v: '', l: 'Tutti' }, ...ROUTE_CATEGORIES]
    .map((c) => `<button class="chip ${c.v === state.category ? 'active' : ''}" data-cat="${c.v}">${c.icon ? svg(c.icon, 16) + ' ' : ''}${c.l}</button>`)
    .join('');
  const diffSeg = [{ v: '', l: 'Tutte' }, ...ROUTE_DIFFICULTIES]
    .map((d) => `<button class="${d.v === state.difficulty ? 'active' : ''}" data-diff="${d.v}">${d.l}</button>`)
    .join('');

  $('#root').innerHTML = `
    <h1 class="mb-2">Percorsi</h1>
    <p class="text-lo mb-4">Esplora gli itinerari della community e sfida i loro record.</p>

    <a class="btn btn-primary btn-block mb-4" href="/record.html">${svg('route', 20)} Registra un percorso</a>

    <div style="position:relative;margin-bottom:var(--sp-3)">
      <span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--text-lo);pointer-events:none;display:flex">${svg('search', 20)}</span>
      <input class="input" id="q" type="search" inputmode="search" autocomplete="off" placeholder="Cerca percorsi…" style="padding-left:44px" />
    </div>

    <div class="chip-scroll mb-3" id="cats">${catChips}</div>

    <div class="segmented block mb-4" id="diffs">${diffSeg}</div>

    <div id="results"></div>
  `;

  $('#q').addEventListener('input', debounce((e) => {
    state.q = e.target.value.trim();
    fetchRoutes();
  }, 300));

  $('#cats').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.category = btn.dataset.cat;
    $$('#cats .chip').forEach((c) => c.classList.toggle('active', c === btn));
    fetchRoutes();
  });

  $('#diffs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-diff]');
    if (!btn) return;
    state.difficulty = btn.dataset.diff;
    $$('#diffs button').forEach((b) => b.classList.toggle('active', b === btn));
    fetchRoutes();
  });
}

/** Scarica i percorsi con i filtri correnti; ignora le risposte obsolete. */
async function fetchRoutes() {
  const mine = ++reqId;
  showLoading();
  try {
    const { routes } = await api.get('/routes', {
      q: state.q || undefined,
      category: state.category || undefined,
      difficulty: state.difficulty || undefined,
      limit: 60,
    });
    if (mine !== reqId) return; // una richiesta più recente è già partita
    renderRoutes(routes || []);
  } catch (err) {
    if (mine !== reqId) return;
    $('#results').innerHTML = `<div class="empty"><div class="ic">${svg('alert', 46)}</div><p>Impossibile caricare i percorsi.</p></div>`;
    toast.error(err.message || 'Errore di rete.');
  }
}

function showLoading() {
  const one = `<div class="tile"><div class="cover skeleton"></div><div class="body"><div class="skeleton" style="height:16px;width:70%;margin-bottom:8px"></div><div class="skeleton" style="height:12px;width:50%"></div></div></div>`;
  $('#results').innerHTML = `<div class="grid grid-auto">${one.repeat(6)}</div>`;
}

function renderRoutes(routes) {
  if (!routes.length) {
    $('#results').innerHTML = `
      <div class="empty">
        <div class="ic">${svg('route', 46)}</div>
        <p>Nessun percorso trovato.</p>
        <p class="text-lo" style="font-size:.85rem">Prova a cambiare categoria o termine di ricerca.</p>
      </div>`;
    return;
  }
  $('#results').innerHTML = `<div class="grid grid-auto">${routes.map(tileHtml).join('')}</div>`;
  // Inserisce il badge privacy (nodo) nella riga badge di ogni tile, in ordine.
  const tiles = $$('#results .tile');
  routes.forEach((r, i) => {
    tiles[i]?.querySelector('.badges')?.append(privacyBadge(r.privacy));
  });
}

/** Card percorso: copertina con icona categoria, tacche difficoltà, nome e riga sintetica. */
function tileHtml(r) {
  const lvl = DIFF_LEVEL[r.difficulty] || 0;
  const diffCls = r.difficulty === 'estrema' ? 'diff estrema' : 'diff';
  const dots = [1, 2, 3, 4].map((i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
  const cover = r.photo ? `background-image:url('${esc(r.photo)}');background-size:cover;background-position:center` : '';
  return `
  <a class="tile ${privacyFrameClass(r.privacy)}" href="/route.html?id=${r.id}">
    <div class="cover" style="${cover}">
      <div class="overlay"></div>
      <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${r.photo ? 'opacity:.35' : ''}">${svg(catIcon(r.category), 44)}</span>
      <div class="badges">
        <span class="chip sm">${svg(catIcon(r.category), 14)} ${esc(catLabel(r.category))}</span>
        <span class="${diffCls}" title="${esc(r.difficulty || '')}">${dots}</span>
      </div>
    </div>
    <div class="body">
      <h3 class="truncate">${esc(r.name)}</h3>
      <div class="text-lo" style="font-size:.82rem;margin-top:4px">
        ${fmtDistance(r.distance_m)} · ${fmtDuration(r.est_time_s)} · ${svg('heart', 14)} ${r.likes_count ?? 0}
      </div>
    </div>
  </a>`;
}

main();
