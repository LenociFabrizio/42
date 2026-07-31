/* =============================================================
   nav.js — Indicazioni verso un percorso o un evento.
   Calcola il tragitto più veloce dalla posizione attuale alla
   destinazione, lo disegna sulla mappa e apre un riepilogo con
   distanza, tempo stimato e l'handoff alla navigazione turn-by-turn.

   Le preferenze (evita pedaggi / autostrade / traghetti / ZTL) arrivano
   da Impostazioni e sono tradotte nelle esclusioni del router.
   ============================================================= */
import api from './api.js';
import { getCurrentPosition, navRoute } from './geo.js';
import { setRouteLine, fitPoints } from './map.js';
import { el, svg, toast, modal, fmtDistance, fmtDuration } from './ui.js';

const DEFAULT_PREFS = {
  nav_avoid_tolls: 0,
  nav_avoid_motorways: 0,
  nav_avoid_ztl: 0,
  nav_avoid_ferries: 0,
  nav_profile: 'auto',
};

let _prefs = null;

/** Preferenze di navigazione dell'utente (con cache per sessione). */
export async function navPrefs({ refresh = false } = {}) {
  if (_prefs && !refresh) return _prefs;
  try {
    const { settings } = await api.get('/settings');
    _prefs = { ...DEFAULT_PREFS, ...(settings || {}) };
  } catch {
    _prefs = { ...DEFAULT_PREFS };
  }
  return _prefs;
}

/** Invalida la cache delle preferenze (dopo un salvataggio in Impostazioni). */
export function resetNavPrefs() { _prefs = null; }

/** Traduce le preferenze utente nelle opzioni del router. */
function routeOptsFor(prefs) {
  return {
    avoidTolls: !!prefs.nav_avoid_tolls,
    avoidMotorways: !!prefs.nav_avoid_motorways,
    avoidFerries: !!prefs.nav_avoid_ferries,
    // 'moto' usa il modello di costo motociclistico; 'auto'/'car' quello auto.
    costing: prefs.nav_profile === 'moto' ? 'motorcycle' : 'auto',
  };
}

/** Etichette leggibili delle preferenze attive. */
function prefLabels(prefs) {
  const out = [];
  if (prefs.nav_avoid_tolls) out.push('senza pedaggi');
  if (prefs.nav_avoid_motorways) out.push('senza autostrade');
  if (prefs.nav_avoid_ferries) out.push('senza traghetti');
  if (prefs.nav_avoid_ztl) out.push('attenzione ZTL');
  return out;
}

const LABEL_OF = {
  toll: 'pedaggi', motorway: 'autostrade', ferry: 'traghetti',
  use_tolls: 'pedaggi', use_highways: 'autostrade', use_ferry: 'traghetti',
};

/**
 * Calcola e mostra le indicazioni verso una destinazione.
 *
 * @param {object} o
 * @param {object} o.map            mappa MapLibre su cui disegnare
 * @param {{lat:number,lng:number}} o.dest  destinazione
 * @param {string} o.name           nome della destinazione (titolo)
 * @param {string} [o.openHref]     link alla scheda (percorso/evento)
 */
export async function showDirections({ map, dest, name, openHref = null }) {
  // duration:0 → resta finché non lo chiudiamo noi a calcolo finito.
  const dismiss = toast.info('Calcolo del percorso…', { duration: 0 });

  let from;
  try {
    from = await getCurrentPosition();
  } catch {
    dismiss();
    toast.error('Posizione non disponibile: attiva il GPS per avere le indicazioni.');
    return;
  }

  const prefs = await navPrefs();
  const r = await navRoute([from, dest], routeOptsFor(prefs));
  dismiss();

  if (!r || !r.points?.length) {
    toast.error('Impossibile calcolare il percorso. Riprova più tardi.');
    return;
  }

  // Traccia il tragitto sulla mappa (colore distinto da quello dei percorsi).
  setRouteLine(map, 'nav', r.points, { color: '#3da5ff', width: 5 });
  fitPoints(map, r.points, { padding: 50, maxZoom: 15 });

  const active = prefLabels(prefs);
  const chips = el('div', { class: 'flex gap-2 wrap mb-3' },
    active.length
      ? active.map((t) => el('span', { class: 'chip sm', text: t }))
      : [el('span', { class: 'chip sm', text: 'percorso più veloce' })]);

  const body = el('div', {}, [
    el('div', { class: 'stats-row mb-3' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'v accent', text: fmtDistance(r.distance_m) }),
        el('div', { class: 'k', text: 'Distanza' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'v', text: fmtDuration(r.duration_s) }),
        el('div', { class: 'k', text: 'Tempo stim.' }),
      ]),
    ]),
    chips,
    // Trasparenza: se il router non ha potuto applicare una preferenza, si dice.
    r.dropped?.length
      ? el('p', { class: 'text-lo', style: 'font-size:.8rem;margin-bottom:var(--sp-3)',
          text: `Nota: non è stato possibile evitare ${r.dropped.map((d) => LABEL_OF[d] || d).join(' e ')} su questo tragitto.` })
      : null,
    // Le ZTL non sono mappate in modo affidabile: lo diciamo invece di fingere.
    prefs.nav_avoid_ztl
      ? el('p', { class: 'text-lo flex gap-2', style: 'font-size:.8rem;margin-bottom:var(--sp-3)',
          html: `${svg('alert', 16)}<span>Le ZTL non sono sempre presenti nei dati stradali: verifica la segnaletica in loco.</span>` })
      : null,
    el('a', {
      class: 'btn btn-primary btn-block',
      href: `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`,
      target: '_blank', rel: 'noopener',
      html: `${svg('navigation', 20)} Avvia navigazione`,
    }),
    openHref
      ? el('a', { class: 'btn btn-outline btn-block', style: 'margin-top:var(--sp-2)', href: openHref, html: `${svg('expand', 20)} Apri la scheda` })
      : null,
  ]);

  const clear = el('button', { class: 'btn btn-outline', text: 'Rimuovi tragitto' });
  const m = modal({ title: `Indicazioni · ${name}`, content: body, footer: [clear] });
  clear.addEventListener('click', () => { clearDirections(map); m.close(); });
}

/** Cancella il tragitto disegnato dalla mappa. */
export function clearDirections(map) {
  if (map?.getSource?.('route-nav')) {
    map.getSource('route-nav').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  }
}

export default showDirections;
