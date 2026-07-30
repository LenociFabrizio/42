/* =============================================================
   tracking.js — Sessione di tracciamento "in background" (best-effort web).

   LIMITE IMPORTANTE: una web app NON può tracciare il GPS con lo schermo
   spento o con il processo terminato, come farebbe un'app nativa: il browser
   sospende l'esecuzione. Qui facciamo il massimo possibile lato web:
     - Screen Wake Lock: mantiene attiva l'app (schermo acceso) durante la
       sessione, riacquisendolo quando la pagina torna visibile.
     - Notifica persistente: segnala che il tracciamento è attivo, utile
       quando l'app va in secondo piano.
     - watchPosition continua finché la pagina è viva; si ferma quando la
       pagina viene chiusa / il processo killato (evento pagehide).
   Attivo di default; l'utente può disattivare il "background" da Impostazioni.
   ============================================================= */

const BG_KEY = '4e2_bg_tracking';

/** Tracciamento in background attivo? (default: sì) */
export function bgEnabled() {
  try {
    const v = localStorage.getItem(BG_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}
export function setBgEnabled(on) {
  try { localStorage.setItem(BG_KEY, on ? '1' : '0'); } catch {}
}

/** Il dispositivo supporta il segnale di background (notifiche)? */
export function bgSupported() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

async function ensureNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

async function showTrackingNotif(body) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && 'showNotification' in reg) {
      await reg.showNotification('4 & | 2 — tracciamento attivo', {
        body,
        tag: 'tracking',
        renotify: false,
        silent: true,
        requireInteraction: true,
        icon: '/icons/icon.svg',
        badge: '/favicon.svg',
        data: { type: 'tracking' },
      });
    }
  } catch {}
}
async function clearTrackingNotif() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const ns = (await reg?.getNotifications?.({ tag: 'tracking' })) || [];
    ns.forEach((n) => n.close());
  } catch {}
}

/**
 * Sessione di tracciamento. Uso:
 *   const s = new TrackingSession({ label: 'Registrazione percorso in corso' });
 *   await s.start();  // all'avvio del tracciamento (da un gesto utente)
 *   ...
 *   await s.stop();   // alla fine / all'uscita
 */
export class TrackingSession {
  constructor({ label = 'La tua posizione è in tracciamento.' } = {}) {
    this.label = label;
    this.active = false;
    this.wakeLock = null;
    this._onVis = this._onVis.bind(this);
    this._onHide = this._onHide.bind(this);
  }

  async _acquireWake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch { /* wake lock non disponibile/negato */ }
  }
  _releaseWake() {
    try { this.wakeLock?.release?.(); } catch {}
    this.wakeLock = null;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    await this._acquireWake();
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('pagehide', this._onHide);
    window.addEventListener('beforeunload', this._onHide);

    // Notifica di background solo se abilitata dall'utente.
    if (bgEnabled()) {
      const ok = await ensureNotifPermission();
      if (ok) await showTrackingNotif(this.label);
    }
  }

  async _onVis() {
    if (document.visibilityState === 'visible') {
      await this._acquireWake(); // il wake lock si rilascia in background: riacquisisci
    } else if (this.active && bgEnabled()) {
      // In secondo piano: assicura che la notifica sia presente.
      const ok = ('Notification' in window) && Notification.permission === 'granted';
      if (ok) showTrackingNotif(this.label);
    }
  }
  _onHide() { this.stop(); }

  async stop() {
    if (!this.active) return;
    this.active = false;
    this._releaseWake();
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('pagehide', this._onHide);
    window.removeEventListener('beforeunload', this._onHide);
    await clearTrackingNotif();
  }
}

export default TrackingSession;
