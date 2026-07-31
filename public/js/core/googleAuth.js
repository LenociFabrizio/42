/* =============================================================
   googleAuth.js — Accesso/registrazione con Google (GIS).
   Carica Google Identity Services solo se il server espone un
   Client ID (/api/config). Il pulsante ufficiale restituisce un ID
   token ("credential") che inviamo a POST /api/auth/google: la
   verifica della firma avviene lato server.
   ============================================================= */
import api from './api.js';
import { auth } from './auth.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise = null;

/** Carica lo script GIS una sola volta. */
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Impossibile caricare Google Sign-In.'));
    document.head.append(s);
  });
  return scriptPromise;
}

/** Client ID pubblico dal server (null se l'accesso Google non è configurato). */
async function googleClientId() {
  try {
    const cfg = await api.get('/config', {}, { auth: false });
    return cfg?.google?.clientId || null;
  } catch {
    return null;
  }
}

/**
 * Monta il pulsante "Continua con Google" dentro `slot`.
 * Se Google non è configurato lato server, nasconde il blocco e non fa nulla.
 *
 * @param {object} o
 * @param {HTMLElement} o.slot          contenitore del pulsante
 * @param {HTMLElement} [o.wrapper]     blocco da nascondere se non configurato
 * @param {(user:object, created:boolean)=>void} o.onSuccess
 * @param {(err:Error)=>void} [o.onError]
 */
export async function mountGoogleButton({ slot, wrapper = null, onSuccess, onError }) {
  if (!slot) return false;
  const hide = () => { if (wrapper) wrapper.style.display = 'none'; };

  const clientId = await googleClientId();
  if (!clientId) { hide(); return false; }

  try {
    await loadGis();
  } catch (err) {
    hide();
    onError?.(err);
    return false;
  }

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: async (response) => {
      try {
        const data = await api.post('/auth/google', { credential: response.credential }, { auth: false });
        auth.setSession(data);
        onSuccess?.(data.user, !!data.created);
      } catch (err) {
        onError?.(err);
      }
    },
  });

  window.google.accounts.id.renderButton(slot, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    logo_alignment: 'left',
    locale: 'it',
    width: Math.min(Math.max(slot.offsetWidth || 320, 200), 400),
  });

  if (wrapper) wrapper.style.display = '';
  return true;
}

export default mountGoogleButton;
