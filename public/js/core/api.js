/* =============================================================
   api.js — Client HTTP centralizzato verso le API di "4 & | 2".
   Gestisce base URL, token JWT, JSON, upload file ed errori.
   ============================================================= */
export const API_BASE = '/api';
const TOKEN_KEY = '4e2_token';

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(path, opts = {}) {
  const { method = 'GET', body, params, auth = true, isForm = false } = opts;

  let url = API_BASE + path;
  if (params && Object.keys(params).length) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += '?' + qs;
  }

  const headers = {};
  const tk = token.get();
  if (auth && tk) headers['Authorization'] = `Bearer ${tk}`;

  let payload;
  if (isForm) {
    payload = body; // FormData: il browser imposta il Content-Type
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Impossibile contattare il server. Verifica la connessione.', null);
  }

  if (res.status === 204) return null;

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Errore ${res.status}`;
    if (res.status === 401 && auth) token.clear();
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

export const api = {
  get: (path, params, opts = {}) => request(path, { ...opts, method: 'GET', params }),
  post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts = {}) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts = {}) => request(path, { ...opts, method: 'DELETE' }),
  upload: (path, formData, opts = {}) =>
    request(path, { ...opts, method: opts.method || 'POST', body: formData, isForm: true }),
};

export default api;
