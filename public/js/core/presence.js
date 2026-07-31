/* =============================================================
   presence.js — Avvisi "amico online". Interrogando /friends/online
   riconosce chi è appena entrato e mostra una notifica breve con un
   suono dedicato (diverso da campanello, countdown e clacson).

   Lo stato vive in sessionStorage perché l'app è multi-pagina: senza
   ricordare chi era già online, a ogni cambio pagina avviseremmo di
   nuovo per tutti.
   ============================================================= */
import { toast } from './ui.js';
import { auth } from './auth.js';
import { initSound, playFriendOnline } from './sound.js';
import api from './api.js';

const KEY = '4e2_presence';
// Non ripetiamo l'avviso per lo stesso amico entro questo intervallo: evita
// il ping-pong quando la presenza oscilla attorno alla soglia dei 5 minuti.
const REPEAT_MS = 15 * 60 * 1000;
// Oltre questo numero di nuovi arrivi mostriamo un solo avviso riassuntivo.
const MAX_TOASTS = 2;

function loadState() {
  try {
    const raw = sessionStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && Array.isArray(s.ids) && s.notified) return s;
  } catch { /* stato illeggibile: si riparte */ }
  return null;
}

function saveState(s) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota piena */ }
}

/** Ripulisce le notifiche vecchie per non far crescere lo stato all'infinito. */
function prune(notified) {
  const now = Date.now();
  const out = {};
  for (const [id, ts] of Object.entries(notified)) {
    if (now - ts < REPEAT_MS) out[id] = ts;
  }
  return out;
}

function announce(arrivals) {
  if (arrivals.length <= MAX_TOASTS) {
    for (const f of arrivals) toast(`${f.nickname} è online`, 'success', { duration: 4200 });
  } else {
    toast(`${arrivals.length} amici sono online`, 'success', { duration: 4200 });
  }
  playFriendOnline();
}

/**
 * Confronta gli amici online con quelli dell'ultimo controllo e avvisa dei
 * nuovi arrivi. Al primo giro registra soltanto la situazione di partenza.
 */
export async function checkFriendsOnline() {
  if (!auth.isLogged()) return;
  let friends;
  try {
    ({ friends } = await api.get('/friends/online'));
  } catch { return; /* rete assente: riproviamo al prossimo giro */ }
  if (!Array.isArray(friends)) return;

  const ids = friends.map((f) => f.id);
  const prev = loadState();
  if (!prev) { saveState({ ids, notified: {} }); return; }

  const known = new Set(prev.ids);
  const notified = prune(prev.notified);
  const now = Date.now();
  const arrivals = friends.filter((f) => !known.has(f.id) && !notified[f.id]);
  for (const f of arrivals) notified[f.id] = now;

  saveState({ ids, notified });
  if (arrivals.length) announce(arrivals);
}

/** Aggancia il controllo alla shell (chiamata una volta per pagina). */
export function initPresence() {
  if (!auth.isLogged()) return;
  initSound(); // il suono richiede un gesto dell'utente: prepariamo lo sblocco
  checkFriendsOnline();
}

export default { initPresence, checkFriendsOnline };
