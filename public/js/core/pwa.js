/* =============================================================
   pwa.js — Registrazione service worker + prompt d'installazione.
   ============================================================= */
export function registerPWA() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignora in dev */ });
  });

  // Prompt "Aggiungi a schermata Home" (Android/desktop).
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    window.__installPWA = async () => {
      if (!deferred) return false;
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      return outcome === 'accepted';
    };
    document.dispatchEvent(new CustomEvent('pwa-installable'));
  });
}

export default registerPWA;
