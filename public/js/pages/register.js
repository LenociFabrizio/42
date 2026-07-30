/* register.js — Registrazione utente. */
import '../core/theme.js';
import { auth } from '../core/auth.js';
import { $, toast } from '../core/ui.js';

if (auth.isLogged()) location.href = '/index.html';

const form = $('#register-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit-btn');
  const nickname = form.nickname.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;

  if (nickname.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(nickname)) { toast.error('Nickname non valido (3–24, lettere/numeri/._-).'); return; }
  if (!email) { toast.error('Inserisci un\'email valida.'); return; }
  if (password.length < 8) { toast.error('La password deve avere almeno 8 caratteri.'); return; }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Creazione…';
  try {
    await auth.register({ nickname, email, password });
    toast.success('Benvenuto in 4 & | 2! +100 XP 🎉');
    setTimeout(() => (location.href = '/index.html'), 700);
  } catch (err) {
    toast.error(err.message || 'Registrazione non riuscita.');
    btn.disabled = false;
    btn.textContent = original;
  }
});
