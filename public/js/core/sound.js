/* =============================================================
   sound.js — Segnali acustici brevi generati con la Web Audio API.
   Nessun file audio da scaricare: il suono è sintetizzato, quindi
   funziona anche offline e non aggiunge peso alla PWA.

   I browser bloccano l'audio finché l'utente non interagisce con la
   pagina: agganciamo un "unlock" al primo tocco/click/tasto.
   ============================================================= */

const PREF_KEY = '4e2_sound';

let ctx = null;
let unlocked = false;

/** Suoni attivi? (impostazione locale, default: sì) */
export function soundEnabled() {
  return localStorage.getItem(PREF_KEY) !== 'off';
}

/** Attiva/disattiva i suoni dell'app. */
export function setSoundEnabled(on) {
  localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
}

function audioCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

/**
 * Sblocca l'audio al primo gesto dell'utente (policy autoplay dei browser).
 * Va chiamata una volta all'avvio della pagina.
 */
export function initSound() {
  if (unlocked) return;
  const unlock = () => {
    unlocked = true;
    const c = audioCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      document.removeEventListener(ev, unlock);
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(ev, unlock, { once: false, passive: true });
  }
}

/**
 * Suona una singola nota.
 * @param {object} o
 * @param {number} o.freq       frequenza in Hz
 * @param {number} o.start      ritardo dall'istante attuale (s)
 * @param {number} o.duration   durata (s)
 * @param {number} [o.gain]     volume di picco (0-1)
 * @param {string} [o.type]     forma d'onda
 * @param {number} [o.to]       se presente, la nota "scivola" fino a questa
 *                              frequenza (glissando) invece di restare fissa
 */
function note(c, { freq, start, duration, gain = 0.18, type = 'sine', to = null }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const vol = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  // Inviluppo morbido: evita il "click" di attacco/rilascio.
  vol.gain.setValueAtTime(0.0001, t0);
  vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(vol).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/**
 * Campanello di notifica: due note ascendenti (do-sol), breve e riconoscibile
 * anche col casco. Accompagnato da una vibrazione se il dispositivo la supporta.
 */
export function playNotify() {
  if (!soundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    note(c, { freq: 880, start: 0, duration: 0.14, gain: 0.2 });
    note(c, { freq: 1318.5, start: 0.13, duration: 0.22, gain: 0.16 });
  } catch { /* audio non disponibile: silenzio */ }
  try { navigator.vibrate?.([40, 60, 40]); } catch { /* non supportato */ }
}

/**
 * Bip del countdown di partenza. I tre conteggi sono note basse e secche,
 * il "via!" è più alto e lungo: si distingue a orecchio senza guardare.
 * @param {boolean} [go] true per il segnale di partenza
 */
export function playBeep(go = false) {
  if (!soundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    if (go) note(c, { freq: 1244.5, start: 0, duration: 0.6, gain: 0.26, type: 'square' });
    else note(c, { freq: 622.25, start: 0, duration: 0.16, gain: 0.22, type: 'square' });
  } catch { /* audio non disponibile */ }
  try { navigator.vibrate?.(go ? 220 : 70); } catch { /* non supportato */ }
}

/**
 * Colpetto di clacson: saluto quando incroci un altro pilota.
 * Due note sovrapposte leggermente stonate (come un clacson vero), brevi.
 */
export function playHorn() {
  if (!soundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    // Intervallo di terza minore "sporco": timbro da clacson, non da campanello.
    note(c, { freq: 440, start: 0, duration: 0.26, gain: 0.16, type: 'sawtooth' });
    note(c, { freq: 523.25, start: 0, duration: 0.26, gain: 0.14, type: 'sawtooth' });
    // Secondo colpetto, come un "bip-bip" di saluto.
    note(c, { freq: 440, start: 0.3, duration: 0.22, gain: 0.14, type: 'sawtooth' });
    note(c, { freq: 523.25, start: 0.3, duration: 0.22, gain: 0.12, type: 'sawtooth' });
  } catch { /* audio non disponibile */ }
  try { navigator.vibrate?.([50, 70, 50]); } catch { /* non supportato */ }
}

/**
 * "Blip" di amico online: un solo tocco leggero che scivola verso l'alto
 * (timbro triangolare). Diverso da campanello, countdown e clacson: si
 * riconosce subito e non disturba mentre si guida.
 */
export function playFriendOnline() {
  if (!soundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    note(c, { freq: 587.33, to: 1174.66, start: 0, duration: 0.16, gain: 0.13, type: 'triangle' });
  } catch { /* audio non disponibile: silenzio */ }
  try { navigator.vibrate?.(25); } catch { /* non supportato */ }
}

/**
 * "Ping" del radar di prossimità: un solo bip secco da strumentazione, come il
 * radar di NFS Most Wanted. Non decide da sé quando suonare — ci pensa il radar
 * sulla mappa, che lo richiama sempre più spesso man mano che ti avvicini.
 *
 * @param {number} [intensity] 0 = appena entrato nel raggio, 1 = ci sei sopra.
 *   Alza tono e volume: da lontano è un tocco discreto, vicino è un allarme.
 */
export function playRadarPing(intensity = 0) {
  if (!soundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const k = Math.min(1, Math.max(0, intensity));
  try {
    // Tono che sale con l'avvicinarsi (880 → 1500 Hz) e seconda voce ottava
    // sopra solo nel finale: è quella che dà il senso di urgenza.
    note(c, { freq: 880 + 620 * k, start: 0, duration: 0.05 + 0.03 * k, gain: 0.05 + 0.13 * k, type: 'square' });
    if (k > 0.6) note(c, { freq: 2400, start: 0, duration: 0.04, gain: 0.05 * k, type: 'sine' });
  } catch { /* audio non disponibile: silenzio */ }
  // Vibrazione solo nell'ultimo tratto: a distanza sarebbe fastidiosa.
  if (k > 0.75) { try { navigator.vibrate?.(18); } catch { /* non supportato */ } }
}

/**
 * Fanfara di sblocco: tre note ascendenti con la coda che sale ancora, il
 * classico "hai conquistato qualcosa" dei giochi arcade. Usata quando si entra
 * in una nuova Area (regione) e la mappa si svela.
 */
export function playUnlock() {
  if (!soundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    note(c, { freq: 659.25, start: 0, duration: 0.12, gain: 0.16, type: 'triangle' });     // mi
    note(c, { freq: 880, start: 0.1, duration: 0.12, gain: 0.16, type: 'triangle' });      // la
    note(c, { freq: 1318.5, to: 1760, start: 0.2, duration: 0.34, gain: 0.18, type: 'triangle' }); // mi ↑
  } catch { /* audio non disponibile: silenzio */ }
  try { navigator.vibrate?.([30, 50, 30, 50, 90]); } catch { /* non supportato */ }
}

export default { initSound, playNotify, playBeep, playHorn, playFriendOnline, playRadarPing, playUnlock, soundEnabled, setSoundEnabled };
