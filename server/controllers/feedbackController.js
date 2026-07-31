/**
 * feedbackController.js
 * ------------------------------------------------------------
 * Segnalazioni di bug inviate dall'app (tasto "Segnala un bug").
 * Ogni segnalazione viene SEMPRE salvata su bug_reports e, se
 * l'invio email è configurato (RESEND_API_KEY), spedita alla casella
 * indicata da BUG_REPORT_TO. Nessun client di posta da aprire.
 * ------------------------------------------------------------
 */
import db from '../database/db.js';
import { asyncHandler } from '../utils/helpers.js';
import * as v from '../utils/validate.js';
import { config } from '../config/config.js';
import { sendMail, mailEnabled } from '../services/mailer.js';

/** POST /api/feedback/bug — invia una segnalazione. */
export const createBugReport = asyncHandler(async (req, res) => {
  const message = v.str(req.body.message, 'Descrizione', { min: 10, max: 4000 });
  const contact = req.body.contact_email ? v.email(req.body.contact_email, 'Email di contatto') : null;
  const page = v.optStr(req.body.page, 'Schermata', { max: 300 });
  const appVersion = v.optStr(req.body.app_version, 'Versione', { max: 40 });
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 400);

  const ins = await db
    .prepare(
      `INSERT INTO bug_reports (user_id, message, contact_email, page, app_version, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, message, contact, page, appVersion, userAgent);

  const body = [
    `Nuova segnalazione da 4 & | 2`,
    '',
    `Utente:     ${req.user.nickname} (#${req.user.id})`,
    `Email:      ${req.user.email}`,
    contact ? `Contatto:   ${contact}` : null,
    `Schermata:  ${page || '—'}`,
    `Versione:   ${appVersion || '—'}`,
    `Dispositivo: ${userAgent || '—'}`,
    `Segnalazione #${ins.lastInsertRowid ?? '—'}`,
    '',
    '--- Descrizione ---',
    message,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const result = await sendMail({
    to: config.mail.bugReportTo,
    subject: `[4 & | 2] Bug segnalato da ${req.user.nickname}`,
    text: body,
    replyTo: contact || req.user.email,
  });

  if (result.sent && ins.lastInsertRowid) {
    await db.prepare('UPDATE bug_reports SET emailed = 1 WHERE id = ?').run(ins.lastInsertRowid);
  } else if (!mailEnabled()) {
    console.warn('[feedback] RESEND_API_KEY non configurata: segnalazione salvata solo a database.');
  }

  res.status(201).json({ ok: true, emailed: result.sent, id: ins.lastInsertRowid });
});

export default { createBugReport };
