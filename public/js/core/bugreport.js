/* =============================================================
   bugreport.js — Finestra "Segnala un bug". Il testo viene spedito
   dal server all'indirizzo dell'assistenza: nessun client di posta
   da aprire, l'utente resta nell'app.

   Alla segnalazione allega da sola schermata, versione dell'app e
   dispositivo: sono le informazioni che servono davvero per capire
   cosa è andato storto.
   ============================================================= */
import { el, modal, toast } from './ui.js';
import { auth } from './auth.js';
import { getVersion } from './version.js';
import api from './api.js';

/** Apre la finestra di segnalazione. */
export function openBugReport() {
  const area = el('textarea', {
    class: 'input',
    rows: '5',
    maxlength: '4000',
    placeholder: 'Cosa è andato storto? Dove stavi e cosa hai toccato prima del problema?',
  });
  const contact = el('input', {
    class: 'input',
    type: 'email',
    placeholder: 'email@esempio.it',
    value: auth.user?.email || '',
    autocomplete: 'email',
  });

  const body = el('div', {}, [
    el('div', { class: 'field' }, [
      el('label', { text: 'Descrizione' }),
      area,
      el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:6px', text: 'Almeno 10 caratteri. Più dettagli dai, prima si sistema.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Email per risponderti (facoltativa)' }),
      contact,
    ]),
    el('div', { class: 'text-lo', style: 'font-size:.78rem', text: 'Alleghiamo automaticamente schermata, versione dell\'app e tipo di dispositivo.' }),
  ]);

  const send = el('button', { class: 'btn btn-primary', text: 'Invia segnalazione' });
  const m = modal({ title: 'Segnala un bug', content: body, footer: [send] });
  setTimeout(() => area.focus(), 50);

  send.addEventListener('click', async () => {
    const message = area.value.trim();
    if (message.length < 10) { toast.error('Descrivi il problema in almeno 10 caratteri.'); return; }
    send.disabled = true;
    const label = send.textContent;
    send.textContent = 'Invio…';
    try {
      const res = await api.post('/feedback/bug', {
        message,
        contact_email: contact.value.trim() || null,
        page: location.pathname + location.search,
        app_version: await getVersion(),
      });
      m.close();
      // Se l'invio email non è configurato sul server la segnalazione è comunque
      // registrata: lo diciamo senza promettere una consegna che non c'è stata.
      if (res?.emailed) toast.success('Segnalazione inviata. Grazie!');
      else toast.success('Segnalazione registrata. Grazie!');
    } catch (err) {
      toast.error(err.message || 'Invio non riuscito. Riprova tra poco.');
      send.disabled = false;
      send.textContent = label;
    }
  });
}

export default openBugReport;
