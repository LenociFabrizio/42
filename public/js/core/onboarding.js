/* =============================================================
   onboarding.js — Tutorial guidato mostrato dopo la registrazione
   (e ripetibile dalle Impostazioni). Slide a tutto schermo con
   avanti/indietro, punti di avanzamento e "salta".
   ============================================================= */
import { el, svg } from './ui.js';

const DONE_KEY = '4e2_tutorial_done';
const PENDING_KEY = '4e2_tutorial_pending';

const SLIDES = [
  {
    ic: 'route',
    title: 'Benvenuto in 4 & | 2',
    text: 'La community di chi ama viaggiare su 4 e 2 ruote. In un minuto ti mostriamo come funziona.',
  },
  {
    ic: 'map',
    title: 'La Mappa è la tua base',
    text: 'Attorno a te trovi percorsi, eventi e punti di interesse. Usa il pulsante in basso a destra per centrarti sulla tua posizione.',
  },
  {
    ic: 'plus',
    title: 'Il pulsante CREA',
    text: 'Il tasto centrale in basso apre la creazione: registra un nuovo Percorso col GPS oppure organizza un Evento.',
  },
  {
    ic: 'trophy',
    title: 'Percorsi e Record',
    text: 'Registra un tracciato mentre guidi. Il record ufficiale appartiene a chi crea il percorso; tu conservi il tuo miglior tempo personale e scali la classifica.',
  },
  {
    ic: 'megaphone',
    title: 'Eventi live',
    text: 'Organizza o partecipa a raduni. Il check-in avviene via GPS: risulti presente solo se sei davvero sul luogo del ritrovo.',
  },
  {
    ic: 'users',
    title: 'Club e Amici',
    text: 'Unisciti a un club, aggiungi amici e scalate insieme le classifiche. Le richieste di amicizia si gestiscono dalla sezione Amici.',
  },
  {
    ic: 'award',
    title: 'Livelli, XP e Badge',
    text: 'Ogni attività reale ti fa guadagnare XP e sblocca badge e livelli. La posizione live con gli amici è sempre disponibile (col tuo consenso); agli sconosciuti appari dal livello 5.',
  },
  {
    ic: 'lock',
    title: 'Privacy sotto controllo',
    text: 'La tua posizione è condivisa solo se lo attivi tu. Puoi cambiare visibilità e preferenze quando vuoi da Impostazioni. Buon viaggio!',
  },
];

/** Avvia il tutorial. */
export function startTutorial() {
  let i = 0;

  const skip = el('button', { class: 'tour-skip', text: 'Salta', onClick: () => finish() });
  const ic = el('div', { class: 'tour-ic' });
  const label = el('div', { class: 'tour-progress-label' });
  const title = el('h2', {});
  const text = el('p', { class: 'tour-text' });
  const dots = el('div', { class: 'tour-dots' }, SLIDES.map(() => el('i', {})));
  const back = el('button', { class: 'btn btn-outline', text: 'Indietro', onClick: () => go(i - 1) });
  const next = el('button', { class: 'btn btn-primary', onClick: () => (i < SLIDES.length - 1 ? go(i + 1) : finish()) });

  const card = el('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true' }, [
    skip, ic, label, title, text, dots, el('div', { class: 'tour-actions' }, [back, next]),
  ]);
  const overlay = el('div', { class: 'tour-overlay' }, [card]);
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('open'));

  function go(n) { i = Math.max(0, Math.min(SLIDES.length - 1, n)); render(); }
  function render() {
    const s = SLIDES[i];
    ic.innerHTML = svg(s.ic, 46);
    label.textContent = `${i + 1} / ${SLIDES.length}`;
    title.textContent = s.title;
    text.textContent = s.text;
    dots.querySelectorAll('i').forEach((d, idx) => d.classList.toggle('on', idx === i));
    back.style.visibility = i === 0 ? 'hidden' : 'visible';
    next.textContent = i === SLIDES.length - 1 ? 'Inizia! 🚀' : 'Avanti';
  }
  function finish() {
    try { localStorage.setItem(DONE_KEY, '1'); localStorage.removeItem(PENDING_KEY); } catch {}
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => overlay.remove(), 300);
  }

  render();
}

/** Segna che il tutorial va mostrato al prossimo caricamento (dopo la registrazione). */
export function markTutorialPending() {
  try { localStorage.setItem(PENDING_KEY, '1'); localStorage.removeItem(DONE_KEY); } catch {}
}

/** Avvia il tutorial una sola volta, se in sospeso e non già completato. */
export function maybeAutoStart() {
  try {
    if (localStorage.getItem(PENDING_KEY) && !localStorage.getItem(DONE_KEY)) startTutorial();
  } catch {}
}

export default startTutorial;
