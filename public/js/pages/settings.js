/* =============================================================
   settings.js — Impostazioni account.
   Sezioni: Aspetto (tema/lingua/unità), Privacy, Live Map,
   Notifiche, Account. Ogni modifica è salvata subito (autosave)
   con conferma via toast.
   ============================================================= */
import '../core/theme.js';
import { setTheme } from '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, toast, modal, confirmDialog, debounce } from '../core/ui.js';
import { LIVE_MAP_MIN_LEVEL } from '../core/constants.js';
import api, { token } from '../core/api.js';

const VIS = [
  { v: 'public', l: 'Pubblico' },
  { v: 'friends', l: 'Amici' },
  { v: 'private', l: 'Privato' },
];

/* Salvataggio impostazioni (debounce leggero + toast). */
async function saveSettings(patch, okMsg = 'Salvato') {
  try {
    await api.put('/settings', patch);
    toast.success(okMsg, { duration: 1500 });
  } catch (err) {
    toast.error(err.message || 'Salvataggio non riuscito.');
  }
}
const debouncedSave = debounce((patch, msg) => saveSettings(patch, msg), 250);

async function main() {
  const user = await guard();
  if (!user) return;
  registerPWA();
  mountShell({ active: '' });

  const root = $('#root');
  root.append(el('h1', { text: 'Impostazioni', style: 'margin-bottom:var(--sp-4)' }));
  try {
    const [settingsRes, meRes] = await Promise.all([api.get('/settings'), api.get('/auth/me')]);
    build(root, settingsRes.settings || {}, meRes.user || meRes);
  } catch (err) {
    root.append(el('div', { class: 'empty' }, [
      el('div', { class: 'ic', text: '⚠️' }),
      el('p', { text: err.message || 'Impossibile caricare le impostazioni.' }),
    ]));
  } finally {
    loader.hide();
  }
}

function build(root, s, me) {
  root.append(
    appearanceCard(s),
    privacyCard(s),
    liveCard(me),
    notifyCard(s),
    accountCard(),
  );
}

/* -------------------- Helpers UI -------------------- */
function card(title, children) {
  return el('div', { class: 'card', style: 'margin-bottom:var(--sp-3)' }, [
    el('h3', { class: 'card-title', text: title }),
    ...children,
  ]);
}

function field(label, control, helper) {
  const f = el('div', { class: 'field' }, [el('label', { text: label }), control]);
  if (helper) f.append(el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:6px', text: helper }));
  return f;
}

function segmented(options, current, onChange) {
  const seg = el('div', { class: 'segmented block' });
  for (const o of options) {
    const b = el('button', { type: 'button', class: o.v === current ? 'active' : '', text: o.l });
    b.addEventListener('click', () => {
      if (b.classList.contains('active')) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onChange(o.v);
    });
    seg.append(b);
  }
  return seg;
}

function selectControl(options, current, onChange) {
  const sel = el('select', { class: 'select' });
  for (const o of options) {
    const opt = el('option', { value: o.v, text: o.l });
    if (o.v === current) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function checkboxRow(label, checked, onChange) {
  const chk = el('input', { type: 'checkbox' });
  chk.checked = !!checked;
  chk.addEventListener('change', () => onChange(chk.checked));
  return el('label', { class: 'checkbox', style: 'padding:6px 0' }, [chk, el('span', { text: label })]);
}

/* -------------------- Aspetto -------------------- */
function appearanceCard(s) {
  return card('Aspetto', [
    field('Tema', segmented([{ v: 'dark', l: 'Scuro' }, { v: 'light', l: 'Chiaro' }], s.theme || 'dark', (v) => {
      setTheme(v);
      debouncedSave({ theme: v }, 'Tema aggiornato');
    })),
    field('Lingua', segmented([{ v: 'it', l: 'IT' }, { v: 'en', l: 'EN' }], s.language || 'it', (v) => debouncedSave({ language: v }, 'Lingua aggiornata'))),
    field('Unità', segmented([{ v: 'metric', l: 'Metrico' }, { v: 'imperial', l: 'Imperiale' }], s.units || 'metric', (v) => debouncedSave({ units: v }, 'Unità aggiornate'))),
  ]);
}

/* -------------------- Privacy -------------------- */
function privacyCard(s) {
  return card('Privacy', [
    field('Visibilità profilo', selectControl(VIS, s.profile_visibility || 'public', (v) => debouncedSave({ profile_visibility: v }, 'Privacy aggiornata')), 'Chi può vedere il tuo profilo completo, i tuoi veicoli e i tuoi percorsi.'),
    field('Visibilità posizione', selectControl(VIS, s.location_visibility || 'friends', (v) => debouncedSave({ location_visibility: v }, 'Privacy aggiornata')), 'Chi può vedere la tua posizione sulla mappa live.'),
  ]);
}

/* -------------------- Live Map -------------------- */
function liveCard(me) {
  const chk = el('input', { type: 'checkbox' });
  chk.checked = !!me.live_enabled;
  chk.addEventListener('change', async () => {
    const want = chk.checked;
    try {
      await api.put('/live/settings', { live_enabled: want });
      toast.success(want ? 'Condivisione live attivata' : 'Condivisione live disattivata', { duration: 1500 });
    } catch (err) {
      chk.checked = !want; // ripristina in caso di errore (es. livello insufficiente)
      toast.error(err.message || 'Operazione non riuscita.');
    }
  });
  const toggle = el('label', { class: 'checkbox', style: 'padding:6px 0' }, [chk, el('span', { text: 'Condividi la mia posizione con gli amici' })]);
  return card('Live Map', [
    toggle,
    el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:6px', text: `La condivisione live con gli amici richiede il livello ${LIVE_MAP_MIN_LEVEL}.` }),
  ]);
}

/* -------------------- Notifiche -------------------- */
function notifyCard(s) {
  const items = [
    ['notify_friends', 'Richieste e attività degli amici'],
    ['notify_events', 'Eventi e raduni'],
    ['notify_records', 'Record battuti'],
    ['notify_clubs', 'Attività dei club'],
  ];
  const rows = items.map(([key, label]) => checkboxRow(label, s[key], (checked) => debouncedSave({ [key]: checked }, 'Notifiche aggiornate')));
  return card('Notifiche', [el('div', { class: 'flex-col', style: 'gap:4px' }, rows)]);
}

/* -------------------- Account -------------------- */
function accountCard() {
  return card('Account', [
    el('button', { class: 'btn btn-outline btn-block', text: 'Cambia password', style: 'margin-bottom:var(--sp-2)', onClick: openPasswordModal }),
    el('button', { class: 'btn btn-ghost btn-block', html: `${svg('logout', 20)} Esci`, style: 'margin-bottom:var(--sp-2)', onClick: () => auth.logout() }),
    el('hr', { class: 'divider' }),
    el('div', { class: 'section-label', text: 'Zona pericolosa' }),
    el('button', { class: 'btn btn-danger btn-block', html: `${svg('trash', 20)} Elimina account`, onClick: deleteAccount }),
  ]);
}

function openPasswordModal() {
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password attuale' });
  const nw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Nuova password (min. 8)' });
  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', { text: 'Password attuale' }), cur]),
    el('div', { class: 'field' }, [el('label', { text: 'Nuova password' }), nw]),
  ]);
  const save = el('button', { class: 'btn btn-primary', text: 'Aggiorna password' });
  const m = modal({ title: 'Cambia password', content: body, footer: [save] });

  save.addEventListener('click', async () => {
    if (nw.value.length < 8) { toast.error('La nuova password deve avere almeno 8 caratteri.'); return; }
    save.disabled = true; save.textContent = 'Aggiornamento…';
    try {
      await api.post('/auth/change-password', { current_password: cur.value, new_password: nw.value });
      m.close();
      toast.success('Password aggiornata!');
    } catch (err) {
      toast.error(err.message || 'Operazione non riuscita.');
      save.disabled = false; save.textContent = 'Aggiorna password';
    }
  });
}

async function deleteAccount() {
  const ok = await confirmDialog({
    title: 'Eliminare l\'account?',
    message: 'Questa azione è permanente: percorsi, record e progressi verranno rimossi e non sarà possibile recuperarli.',
    confirmText: 'Continua',
    danger: true,
  });
  if (!ok) return;

  const pw = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'La tua password' });
  const body = el('div', {}, [
    el('p', { class: 'text-mid', style: 'margin-bottom:var(--sp-3)', text: 'Inserisci la password per eliminare definitivamente il tuo account.' }),
    el('div', { class: 'field' }, [el('label', { text: 'Password' }), pw]),
  ]);
  const del = el('button', { class: 'btn btn-danger', text: 'Elimina account' });
  const m = modal({ title: 'Elimina account', content: body, footer: [del] });

  del.addEventListener('click', async () => {
    if (!pw.value) { toast.error('Inserisci la password.'); return; }
    del.disabled = true; del.textContent = 'Eliminazione…';
    try {
      await api.del('/settings/account', { body: { password: pw.value } });
      m.close();
      token.clear();
      auth.user = null;
      toast.success('Account eliminato.');
      setTimeout(() => (location.href = '/login.html'), 700);
    } catch (err) {
      toast.error(err.message || 'Operazione non riuscita.');
      del.disabled = false; del.textContent = 'Elimina account';
    }
  });
}

main();
