/* =============================================================
   consent.js — Banner informativo su privacy e archiviazione.
   L'app usa SOLO storage tecnico necessario (token di sessione, tema,
   consenso): niente cookie di profilazione o di terze parti. La posizione
   GPS è condivisa solo con consenso esplicito (opt-in in Impostazioni +
   permesso del browser). Il banner appare una volta e viene ricordato.
   ============================================================= */
import { el } from './ui.js';

const KEY = '4e2_consent_v1';

export function initConsent() {
  try { if (localStorage.getItem(KEY)) return; } catch { return; }

  const banner = el('div', { class: 'consent-banner', role: 'dialog', 'aria-label': 'Informativa privacy e cookie' }, [
    el('div', {
      class: 'consent-text',
      html:
        'Usiamo solo <strong>archiviazione tecnica necessaria</strong> (nessun cookie di profilazione). ' +
        'La tua <strong>posizione</strong> è condivisa solo con il tuo consenso. ' +
        'Leggi la <a href="/privacy.html">Privacy</a> e la <a href="/cookie.html">Cookie Policy</a>.',
    }),
    el('div', { class: 'consent-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-sm',
        text: 'Ho capito',
        onClick: () => { try { localStorage.setItem(KEY, new Date().toISOString()); } catch {} banner.remove(); },
      }),
    ]),
  ]);
  document.body.append(banner);
}

export default initConsent;
