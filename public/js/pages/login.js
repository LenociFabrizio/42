/* login.js — Accesso utente. */
import '../core/theme.js';
import { auth } from '../core/auth.js';
import { $, toast, qs } from '../core/ui.js';
import { initConsent } from '../core/consent.js';
import { stampVersion } from '../core/version.js';
import { mountGoogleButton } from '../core/googleAuth.js';
import { markTutorialPending } from '../core/onboarding.js';

if (auth.isLogged()) location.href = qs.get('next') || '/index.html';
initConsent();
stampVersion();

// Accesso con Google (mostrato solo se configurato lato server).
mountGoogleButton({
  slot: $('#google-btn'),
  wrapper: $('#google-wrap'),
  onSuccess: (_user, created) => {
    if (created) markTutorialPending(); // primo accesso: tutorial iniziale
    location.href = qs.get('next') || '/index.html';
  },
  onError: (err) => toast.error(err.message || 'Accesso con Google non riuscito.'),
});

const form = $('#login-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit-btn');
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) { toast.error('Compila email e password.'); return; }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Accesso…';
  try {
    await auth.login(email, password);
    location.href = qs.get('next') || '/index.html';
  } catch (err) {
    toast.error(err.message || 'Accesso non riuscito.');
    btn.disabled = false;
    btn.textContent = original;
  }
});
