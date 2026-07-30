/* login.js — Accesso utente. */
import '../core/theme.js';
import { auth } from '../core/auth.js';
import { $, toast, qs } from '../core/ui.js';

if (auth.isLogged()) location.href = qs.get('next') || '/index.html';

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
