/* =============================================================
   disclaimer.js — Avviso di guida responsabile all'ingresso nell'app.
   Ricorda rispetto civico, prudenza, cinture/casco e che la
   responsabilità della guida è sempre dell'utente.

   Si chiude da sé dopo 15 secondi oppure con la "x". Compare una volta
   per sessione (non a ogni cambio di pagina) per non diventare fastidioso.
   ============================================================= */
import { el, svg } from './ui.js';

const KEY = '4e2_ride_disclaimer';
const SECONDS = 15;

/**
 * Mostra l'avviso di guida responsabile.
 * @param {object} [o]
 * @param {boolean} [o.force] mostra anche se già visto in questa sessione
 */
export function showRideDisclaimer({ force = false } = {}) {
  try {
    if (!force && sessionStorage.getItem(KEY)) return null;
    sessionStorage.setItem(KEY, '1');
  } catch { /* storage non disponibile: mostriamo comunque */ }

  let timer = null;
  let raf = null;

  const close = el('button', {
    class: 'rd-close', 'aria-label': 'Chiudi avviso', html: svg('x', 18),
  });
  const bar = el('i');
  const node = el('div', {
    class: 'ride-disclaimer', role: 'alertdialog', 'aria-label': 'Avviso di guida responsabile',
  }, [
    el('div', { class: 'rd-row' }, [
      el('span', { class: 'rd-ic', html: svg('alert', 20) }),
      el('div', { class: 'rd-body' }, [
        el('strong', { text: 'Guida con la testa' }),
        el('p', {
          html: 'Rispetta il codice della strada e chi ti sta accanto: <b>prudenza</b>, '
            + '<b>cinture allacciate</b> e casco sempre. Non usare il telefono mentre guidi. '
            + 'La condotta di guida è <b>responsabilità esclusiva tua</b>: l\'app non incoraggia '
            + 'la velocità né sostituisce la segnaletica.',
        }),
      ]),
      close,
    ]),
    el('div', { class: 'rd-bar' }, [bar]),
  ]);

  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('open'));

  function dismiss() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    node.classList.remove('open');
    setTimeout(() => node.remove(), 300);
  }

  close.addEventListener('click', dismiss);
  timer = setTimeout(dismiss, SECONDS * 1000);

  // Barra di avanzamento: mostra quanto resta prima della chiusura automatica.
  const t0 = performance.now();
  const tick = (t) => {
    const left = Math.max(0, 1 - (t - t0) / (SECONDS * 1000));
    bar.style.transform = `scaleX(${left})`;
    if (left > 0) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return dismiss;
}

export default showRideDisclaimer;
