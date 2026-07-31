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
 */
function note(c, { freq, start, duration, gain = 0.18, type = 'sine' }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const vol = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
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

export default { initSound, playNotify, soundEnabled, setSoundEnabled };
