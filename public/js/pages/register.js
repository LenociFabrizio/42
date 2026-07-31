/* register.js — Registrazione utente. */
import '../core/theme.js';
import { auth } from '../core/auth.js';
import { $, el, toast } from '../core/ui.js';
import { initConsent } from '../core/consent.js';
import { markTutorialPending } from '../core/onboarding.js';
import { stampVersion } from '../core/version.js';
import { fetchCatalog } from '../core/areas.js';
import api from '../core/api.js';

import { mountGoogleButton } from '../core/googleAuth.js';

if (auth.isLogged()) location.href = '/index.html';
initConsent();
stampVersion();

// Aree di gioco: l'elenco arriva dal server (catalogo pubblico), così codici e
// nomi restano una sola verità. Chi entra con Google la sceglie sulla mappa.
fetchCatalog().then((regions) => {
  const sel = $('#region-select');
  if (!sel || !regions?.length) return;
  for (const r of regions) sel.append(el('option', { value: r.code, text: r.name }));
});

// Registrazione con Google (mostrata solo se configurata lato server).
mountGoogleButton({
  slot: $('#google-btn'),
  wrapper: $('#google-wrap'),
  onSuccess: (_user, created) => {
    if (created) {
      markTutorialPending();
      toast.success('Benvenuto in 4 & | 2! +100 XP 🎉');
    }
    setTimeout(() => (location.href = '/index.html'), created ? 700 : 0);
  },
  onError: (err) => toast.error(err.message || 'Registrazione con Google non riuscita.'),
});

const form = $('#register-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit-btn');
  const nickname = form.nickname.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  const region = form.region?.value || '';

  if (nickname.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(nickname)) { toast.error('Nickname non valido (3–24, lettere/numeri/._-).'); return; }
  if (!email) { toast.error('Inserisci un\'email valida.'); return; }
  if (password.length < 8) { toast.error('La password deve avere almeno 8 caratteri.'); return; }
  if (!region) { toast.error('Scegli l\'area da cui parti.'); return; }
  if (!form.consent.checked) { toast.error('Devi accettare Privacy Policy e Termini per registrarti.'); return; }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Creazione…';
  try {
    await auth.register({ nickname, email, password });
    // Area di partenza subito dopo la creazione (serve il token). Se qualcosa
    // va storto non si blocca la registrazione: la mappa la richiede all'avvio.
    try {
      await api.post('/regions/home', { region });
      auth.patchUser({ region });
    } catch { /* la chiederà la mappa */ }
    markTutorialPending(); // mostra il tutorial alla prima apertura della mappa
    toast.success('Benvenuto in 4 & | 2! +100 XP 🎉');
    setTimeout(() => (location.href = '/index.html'), 700);
  } catch (err) {
    toast.error(err.message || 'Registrazione non riuscita.');
    btn.disabled = false;
    btn.textContent = original;
  }
});
