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
    text: 'Si apre già centrata su di te: attorno trovi percorsi, eventi e punti di interesse. Il pulsante con il mirino ti riporta sulla tua posizione quando ti sposti a mano, e quanto "vicino" parte la mappa lo decidi dal raggio di visibilità in Impostazioni.',
  },
  {
    ic: 'navigation',
    title: 'Indicazioni in un tocco',
    text: 'Tocca un percorso o un evento sulla mappa e scegli "Indicazioni": calcoliamo il tragitto più veloce dalla tua posizione. In Impostazioni puoi chiedere di evitare pedaggi, autostrade, traghetti e ZTL.',
  },
  {
    ic: 'plus',
    title: 'Il pulsante CREA',
    text: 'Il tasto centrale in basso apre la creazione: registra un Percorso col GPS mentre guidi, disegnalo toccando la mappa, oppure organizza un Evento.',
  },
  {
    ic: 'trophy',
    title: 'Percorsi e Record',
    text: 'Un percorso deve essere lungo almeno 2 km. Se lo registri guidando, quel giro diventa il tuo primo tempo e il record ufficiale del percorso: il record resta sempre di chi lo ha creato, gli altri conservano il proprio miglior tempo personale.',
  },
  {
    ic: 'megaphone',
    title: 'Il radar di prossimità',
    text: 'Sotto la barra in alto compare un radar quando un percorso o un evento è nei paraggi: il blip mostra da che parte si trova. Sotto i 100 metri inizia a suonare piano e infittisce fino a diventare un allarme quando ci sei sopra. Toccalo per fare il check-in all\'evento o per registrare un tentativo. Il suono si disattiva da Impostazioni.',
  },
  {
    ic: 'pinUser',
    title: 'Vedersi in tempo reale',
    text: 'Il tasto col segnaposto, in basso a destra, accende la condivisione: un tocco e gli amici ti vedono muoverti sulla mappa, e tu vedi loro. Sulla mappa sei la freccia bianca, gli amici sono le frecce verdi e gli sconosciuti quelle rosse: la punta indica dove stanno andando. Tocca una freccia per sapere che auto o moto sta guidando; il numero sul tasto dice quanti sono in strada adesso.',
  },
  {
    ic: 'users',
    title: 'Amici: chi c\'è e chi no',
    text: 'Nella lista Amici vedi chi è online adesso e, per gli altri, da quanto tempo sono offline. Quando un amico entra nell\'app te lo diciamo con un avviso e un blip breve: se preferisci il silenzio, spegni i suoni da Impostazioni.',
  },
  {
    ic: 'building',
    title: 'Club, Amici e classifiche',
    text: 'In alto a destra trovi Impostazioni, Amici e Notifiche; i Club sono in fondo a destra e il tuo profilo è l\'avatar in alto. Unisciti a un club e scalate insieme le classifiche.',
  },
  {
    ic: 'award',
    title: 'Livelli, XP e Distintivi',
    text: 'Ogni attività reale ti fa guadagnare XP e sblocca distintivi e livelli. Nel profilo trovi distintivi e missioni in sezioni richiudibili, con le tue statistiche di km e tempo di guida.',
  },
  {
    ic: 'lock',
    title: 'Privacy sotto controllo',
    text: 'La tua posizione è condivisa solo se lo attivi tu, e agli sconosciuti appari solo dal livello 5. Puoi entrare con email o con Google e cambiare ogni preferenza da Impostazioni.',
  },
  {
    ic: 'alert',
    title: 'Qualcosa non va? Dillo',
    text: 'Siamo in Beta: da Impostazioni → Assistenza tocca "Segnala un bug" e scrivici cosa è andato storto. Il messaggio arriva direttamente a noi, senza aprire la posta. Buon viaggio!',
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
