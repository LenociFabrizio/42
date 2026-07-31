/* =============================================================
   auth.js — Stato di autenticazione lato client.
   ============================================================= */
import api, { token } from './api.js';

const USER_KEY = '4e2_user';
const USER_AT_KEY = '4e2_user_at';
// Oltre questo tempo la copia locale dell'utente è considerata vecchia e viene
// riallineata in background: senza questo, flag come live_enabled (attivato in
// Impostazioni) restavano indietro e la posizione live non partiva più.
const USER_STALE_MS = 60 * 1000;

export const auth = {
  _user: null,

  get user() {
    if (this._user) return this._user;
    try {
      const raw = localStorage.getItem(USER_KEY);
      this._user = raw ? JSON.parse(raw) : null;
    } catch { this._user = null; }
    return this._user;
  },
  set user(u) {
    this._user = u;
    if (u) {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      localStorage.setItem(USER_AT_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(USER_AT_KEY);
    }
  },

  /** Aggiorna solo alcuni campi della copia locale (es. dopo un toggle). */
  patchUser(patch) {
    if (!this.user) return null;
    this.user = { ...this.user, ...patch };
    return this.user;
  },

  /** Vero se la copia locale dell'utente è più vecchia di USER_STALE_MS. */
  isStale() {
    const at = Number(localStorage.getItem(USER_AT_KEY) || 0);
    return !at || Date.now() - at > USER_STALE_MS;
  },

  isLogged() { return !!token.get(); },
  isAdmin() { return this.user?.role === 'admin'; },

  setSession({ token: t, user }) {
    if (t) token.set(t);
    this.user = user;
  },

  async refresh() {
    if (!token.get()) { this.user = null; return null; }
    try {
      const data = await api.get('/auth/me');
      this.user = data.user || data;
      this._unread = data.unread ?? 0;
      return this.user;
    } catch (err) {
      // Solo un token rifiutato chiude la sessione: offline o server giù
      // teniamo la copia locale (siamo una PWA, deve funzionare senza rete).
      if (err?.status === 401) { this.logout(false); return null; }
      return this.user;
    }
  },

  async login(email, password) {
    const data = await api.post('/auth/login', { email, password }, { auth: false });
    this.setSession(data);
    return data.user;
  },

  async register(payload) {
    const data = await api.post('/auth/register', payload, { auth: false });
    this.setSession(data);
    return data.user;
  },

  logout(redirect = true) {
    token.clear();
    this.user = null;
    if (redirect) window.location.href = '/login.html';
  },
};

/**
 * Guardia per pagine protette. Reindirizza al login se non autenticato.
 * @returns {Promise<user|null>}
 */
export async function guard({ minLevel = 0 } = {}) {
  if (!auth.isLogged()) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
    return null;
  }
  let user = auth.user;
  if (!user) user = await auth.refresh();
  // C'è già una copia locale: la pagina parte subito, ma se è vecchia la
  // riallineiamo in background (livello, XP, consenso alla posizione live…).
  else if (auth.isStale()) auth.refresh();
  if (!user) { location.href = '/login.html'; return null; }
  return user;
}

export default auth;
