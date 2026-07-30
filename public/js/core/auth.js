/* =============================================================
   auth.js — Stato di autenticazione lato client.
   ============================================================= */
import api, { token } from './api.js';

const USER_KEY = '4e2_user';

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
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
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
    } catch {
      this.logout(false);
      return null;
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
  const user = auth.user || (await auth.refresh());
  if (!user) { location.href = '/login.html'; return null; }
  return user;
}

export default auth;
