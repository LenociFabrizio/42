/**
 * mailer.js
 * ------------------------------------------------------------
 * Invio email via API HTTP di Resend (https://resend.com): una sola
 * chiamata `fetch`, nessuna dipendenza SMTP da installare e funziona
 * anche in serverless (Vercel), dove le porte SMTP sono spesso chiuse.
 *
 * Configurazione (.env):
 *   RESEND_API_KEY   chiave API (se manca, l'invio è disattivato)
 *   MAIL_FROM        mittente verificato su Resend
 *   BUG_REPORT_TO    destinatario delle segnalazioni di bug
 *
 * Senza chiave l'app NON va in errore: chi chiama riceve
 * `{ sent: false, reason: 'not-configured' }` e decide come procedere
 * (le segnalazioni restano comunque salvate a database).
 * ------------------------------------------------------------
 */
import { config } from '../config/config.js';

const ENDPOINT = 'https://api.resend.com/emails';

/** Vero se l'invio email è configurato. */
export const mailEnabled = () => !!config.mail.apiKey;

/**
 * Invia una email di testo.
 * @param {object} o
 * @param {string} o.to        destinatario
 * @param {string} o.subject   oggetto
 * @param {string} o.text      corpo (testo semplice)
 * @param {string} [o.replyTo] indirizzo per la risposta
 * @returns {Promise<{sent:boolean, reason?:string, id?:string}>}
 */
export async function sendMail({ to, subject, text, replyTo }) {
  if (!mailEnabled()) return { sent: false, reason: 'not-configured' };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mail.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: [to],
        subject,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`[mailer] invio non riuscito (${res.status}): ${detail.slice(0, 300)}`);
      return { sent: false, reason: `http-${res.status}` };
    }
    const data = await res.json().catch(() => null);
    return { sent: true, id: data?.id };
  } catch (err) {
    console.warn('[mailer] invio non riuscito:', err.message);
    return { sent: false, reason: 'network' };
  }
}

export default { sendMail, mailEnabled };
