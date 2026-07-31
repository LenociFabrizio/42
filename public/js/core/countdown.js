/* =============================================================
   countdown.js — Countdown di partenza "3, 2, 1, VIA!".
   Overlay a tutto schermo con un bip a ogni conteggio e un segnale
   più lungo e acuto al via: si capisce a orecchio, senza guardare
   lo schermo. La promise si risolve quando parte il "via".
   ============================================================= */
import { el } from './ui.js';
import { playBeep } from './sound.js';

/**
 * Mostra il countdown e risolve quando è il momento di partire.
 * @param {object} [o]
 * @param {number} [o.from]  da quale numero partire (default 3)
 * @returns {Promise<void>}
 */
export function startCountdown({ from = 3 } = {}) {
  return new Promise((resolve) => {
    const num = el('div', { class: 'cd-num' });
    const overlay = el('div', { class: 'countdown-overlay', role: 'status', 'aria-live': 'assertive' }, [
      el('div', { class: 'cd-ring' }, [num]),
      el('div', { class: 'cd-hint', text: 'Preparati…' }),
    ]);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    let n = from;
    const hint = overlay.querySelector('.cd-hint');

    const paint = (txt, isGo) => {
      // Rimonta il nodo per far ripartire l'animazione di scala a ogni step.
      num.textContent = txt;
      num.classList.remove('pop', 'go');
      void num.offsetWidth; // forza il reflow
      num.classList.add(isGo ? 'go' : 'pop');
    };

    const step = () => {
      if (n > 0) {
        paint(String(n), false);
        playBeep(false);
        n -= 1;
        setTimeout(step, 1000);
        return;
      }
      // VIA!
      paint('VIA!', true);
      hint.textContent = 'Buon viaggio, guida con prudenza';
      playBeep(true);
      resolve(); // la registrazione parte adesso, insieme al segnale
      setTimeout(() => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 300);
      }, 700);
    };

    step();
  });
}

export default startCountdown;
