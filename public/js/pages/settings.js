/* =============================================================
   settings.js — Impostazioni account.
   Sezioni: Aspetto (tema/lingua/unità), Mappa, Navigazione, Privacy,
   Live Map, Tracciamento, Notifiche, Suoni, Guida, Assistenza
   (segnala un bug), Account. Ogni modifica è salvata subito
   (autosave) con conferma via toast.
   ============================================================= */
import '../core/theme.js';
import { setTheme } from '../core/theme.js';
import { guard, auth } from '../core/auth.js';
import { mountShell } from '../core/shell.js';
import { registerPWA } from '../core/pwa.js';
import { $, el, svg, loader, toast, modal, confirmDialog, debounce } from '../core/ui.js';
import { LIVE_MAP_MIN_LEVEL, MAP_RADIUS_OPTIONS, DEFAULT_MAP_RADIUS_KM } from '../core/constants.js';
import { startTutorial } from '../core/onboarding.js';
import { openBugReport } from '../core/bugreport.js';
import { bgEnabled, setBgEnabled } from '../core/tracking.js';
import { resetNavPrefs } from '../core/nav.js';
import { soundEnabled, setSoundEnabled, playNotify, playBeep, playHorn, playFriendOnline, playRadarPing, initSound } from '../core/sound.js';
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
  initSound(); // sblocca l'audio al primo tocco: le prove qui devono suonare

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
    // Solo per chi sviluppa l'app: la scheda non esiste per gli altri (e le API
    // del pannello sono comunque chiuse da requireAdmin lato server).
    me.role === 'admin' ? adminCard() : null,
    appearanceCard(s),
    mapCard(s),
    navCard(s),
    privacyCard(s),
    liveCard(me),
    trackingCard(),
    notifyCard(s),
    soundCard(),
    guideCard(),
    supportCard(),
    accountCard(me),
    el('div', { class: 'legal-footer', html: '<a href="/privacy.html">Privacy</a><a href="/cookie.html">Cookie</a><a href="/terms.html">Termini</a>' }),
  );
}

/* -------------------- Pannello sviluppatore -------------------- */
function adminCard() {
  return card('Pannello', [
    el('p', { class: 'text-mid', style: 'margin-bottom:var(--sp-3)', text: 'Numeri dell\'app: utenti, attività, contenuti creati e segnalazioni ricevute.' }),
    el('a', { class: 'btn btn-primary btn-block', href: '/admin.html', html: `${svg('gauge', 20)} Apri il pannello` }),
  ]);
}

/* -------------------- Mappa -------------------- */
/** Raggio di visibilità: quanto "vicino" si apre la mappa sulla tua posizione. */
function mapCard(s) {
  const current = Number(s.map_radius_km) || DEFAULT_MAP_RADIUS_KM;
  return card('Mappa', [
    field(
      'Raggio di visibilità',
      selectControl(MAP_RADIUS_OPTIONS, current, (v) => debouncedSave({ map_radius_km: Number(v) }, 'Raggio mappa aggiornato')),
      'Quanta area vedi quando la mappa si centra sulla tua posizione. Più piccolo = vista più ravvicinata.'
    ),
  ]);
}

/* -------------------- Navigazione -------------------- */
/** Preferenze usate quando chiedi le indicazioni verso un percorso o un evento. */
function navCard(s) {
  const items = [
    ['nav_avoid_tolls', 'Evita pedaggi'],
    ['nav_avoid_motorways', 'Evita autostrade'],
    ['nav_avoid_ztl', 'Evita ZTL (zone a traffico limitato)'],
    ['nav_avoid_ferries', 'Evita traghetti'],
  ];
  const rows = items.map(([key, label]) => checkboxRow(label, s[key], (checked) => {
    resetNavPrefs(); // il prossimo calcolo rilegge le preferenze
    debouncedSave({ [key]: checked }, 'Preferenze di navigazione aggiornate');
  }));
  return card('Navigazione', [
    el('div', { class: 'text-lo', style: 'font-size:.82rem;margin-bottom:10px', text: 'Applicate quando chiedi le indicazioni verso un percorso o un evento dalla mappa.' }),
    el('div', { class: 'flex-col', style: 'gap:4px' }, rows),
    el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:8px', text: 'Le ZTL non sono censite in modo completo nei dati stradali aperti: la preferenza viene applicata dove possibile, ma controlla sempre la segnaletica.' }),
  ]);
}

/* -------------------- Tracciamento in background -------------------- */
function trackingCard() {
  const chk = el('input', { type: 'checkbox' });
  chk.checked = bgEnabled();
  chk.addEventListener('change', () => {
    setBgEnabled(chk.checked);
    toast.success(chk.checked ? 'Tracciamento in background attivo' : 'Tracciamento in background disattivato', { duration: 1500 });
  });
  return card('Tracciamento', [
    el('label', { class: 'checkbox', style: 'padding:6px 0' }, [chk, el('span', { text: 'Continua a tracciare in background' })]),
    el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:6px', text: "Durante la registrazione di un percorso mostra una notifica e mantiene l'app attiva (Wake Lock). Nota: per limiti dei browser, con schermo spento o app chiusa il tracciamento web può interrompersi — solo un'app nativa traccia sempre in background." }),
  ]);
}

/* -------------------- Guida / Tutorial -------------------- */
function guideCard() {
  return card('Guida', [
    el('div', { class: 'text-lo', style: 'font-size:.82rem;margin-bottom:10px', text: "Ripeti il tutorial introduttivo dell'app." }),
    el('button', { class: 'btn btn-outline btn-block', text: 'Rivedi il tutorial', onClick: () => startTutorial() }),
  ]);
}

/* -------------------- Assistenza -------------------- */
/** Segnalazione di bug: il testo parte dal server, senza aprire la posta. */
function supportCard() {
  return card('Assistenza', [
    el('div', { class: 'text-lo', style: 'font-size:.82rem;margin-bottom:10px', text: "Qualcosa non funziona? Raccontacelo: la segnalazione arriva direttamente a noi, senza uscire dall'app." }),
    el('button', {
      class: 'btn btn-outline btn-block',
      html: `${svg('alert', 20)} Segnala un bug`,
      onClick: () => openBugReport(),
    }),
  ]);
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
      // Allinea la copia locale dell'utente: la mappa legge questo flag per
      // decidere se inviare la posizione, altrimenti resterebbe indietro.
      auth.patchUser({ live_enabled: want ? 1 : 0 });
      toast.success(want ? 'Condivisione live attivata' : 'Condivisione live disattivata', { duration: 1500 });
    } catch (err) {
      chk.checked = !want; // ripristina in caso di errore (es. livello insufficiente)
      toast.error(err.message || 'Operazione non riuscita.');
    }
  });
  const toggle = el('label', { class: 'checkbox', style: 'padding:6px 0' }, [chk, el('span', { text: 'Condividi la mia posizione live' })]);

  // Veicolo in uso: è quello che gli altri vedono nel popup sulla live map.
  const vehSlot = el('div', { style: 'margin-top:var(--sp-3)' });
  loadVehiclePicker(vehSlot, me);

  return card('Live Map', [
    toggle,
    el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:6px', text: `È lo stesso interruttore del tasto col segnaposto in basso a destra sulla mappa. Lo scambio è alla pari: spegnendolo sparisci dalla mappa degli altri e loro dalla tua. La condivisione con gli amici è sempre disponibile: per essere visibile anche agli sconosciuti imposta "Visibilità posizione" su "Pubblico", e accadrà solo dal livello ${LIVE_MAP_MIN_LEVEL}.` }),
    vehSlot,
  ]);
}

/** Selettore del veicolo che stai guidando (mostrato agli altri sulla mappa). */
async function loadVehiclePicker(slot, me) {
  let vehicles = [];
  try {
    ({ vehicles } = await api.get('/users/me/vehicles'));
  } catch { return; }
  if (!vehicles || vehicles.length < 2) return; // con 0/1 veicoli non c'è da scegliere

  const opts = vehicles.map((v) => ({
    v: String(v.id),
    l: `${v.type === 'car' ? 'Auto' : 'Moto'} · ${v.name || [v.make, v.model].filter(Boolean).join(' ') || '—'}`,
  }));
  const current = String(me.live_vehicle_id || vehicles.find((v) => v.is_primary)?.id || vehicles[0].id);

  slot.append(field(
    'Veicolo che sto guidando',
    selectControl(opts, current, async (v) => {
      try {
        await api.post('/live/vehicle', { vehicle_id: Number(v) });
        toast.success('Veicolo aggiornato', { duration: 1500 });
      } catch (err) {
        toast.error(err.message || 'Operazione non riuscita.');
      }
    }),
    'È il mezzo che gli altri vedono quando toccano il tuo puntino sulla mappa live.'
  ));
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

  return card('Notifiche', [
    el('div', { class: 'flex-col', style: 'gap:4px' }, rows),
  ]);
}

/* -------------------- Suoni -------------------- */
/**
 * Interruttore generale dei suoni dell'app: silenzia (o riattiva) TUTTI i
 * segnali acustici in un colpo. Preferenza locale al dispositivo.
 */
function soundCard() {
  const master = checkboxRow('Suoni dell\'app attivi', soundEnabled(), (checked) => {
    setSoundEnabled(checked);
    if (checked) playNotify(); // anteprima: si sente subito che sono tornati
    toast.success(checked ? 'Suoni attivati' : 'Tutti i suoni silenziati', { duration: 1600 });
    // Aggiorna la riga di riepilogo e lo stato dei pulsanti di prova.
    render();
  });

  const test = el('div', { class: 'flex gap-2 wrap', style: 'margin-top:10px' }, [
    el('button', { class: 'btn btn-outline btn-sm', html: `${svg('bell', 16)} Avviso`, onClick: () => playNotify() }),
    el('button', { class: 'btn btn-outline btn-sm', html: `${svg('flag', 16)} Partenza`, onClick: () => playBeep(true) }),
    el('button', { class: 'btn btn-outline btn-sm', html: `${svg('users', 16)} Clacson`, onClick: () => playHorn() }),
    el('button', { class: 'btn btn-outline btn-sm', html: `${svg('pinUser', 16)} Amico online`, onClick: () => playFriendOnline() }),
    // Prova del radar: tre ping in avvicinamento (lontano → sopra il bersaglio).
    el('button', {
      class: 'btn btn-outline btn-sm', html: `${svg('megaphone', 16)} Radar`,
      onClick: () => { [0.05, 0.4, 1].forEach((k, i) => setTimeout(() => playRadarPing(k), i * 420)); },
    }),
  ]);
  const note = el('div', { class: 'text-lo', style: 'font-size:.78rem;margin-top:8px' });

  function render() {
    const on = soundEnabled();
    note.textContent = on
      ? 'Riguarda il radar di prossimità (che infittisce avvicinandosi a un percorso o a un evento), il campanello degli avvisi, il countdown di partenza, il clacson di saluto quando incroci un altro pilota e il blip quando un amico va online. Vale solo su questo dispositivo.'
      : 'Tutti i suoni sono silenziati: radar di prossimità, campanello, countdown di partenza, clacson di saluto e blip "amico online". Vale solo su questo dispositivo.';
    test.querySelectorAll('button').forEach((b) => { b.disabled = !on; });
  }
  render();

  return card('Suoni', [master, note, test]);
}

/* -------------------- Account -------------------- */
function accountCard(me) {
  // Account creato con Google: non ha una password, la si può impostare.
  const hasPassword = me?.has_password !== false;
  return card('Account', [
    me?.google_linked
      ? el('div', { class: 'flex items-center gap-2', style: 'margin-bottom:var(--sp-3)' }, [
          el('span', { class: 'pill green', text: 'Google collegato' }),
          el('span', { class: 'text-lo', style: 'font-size:.8rem', text: me.email || '' }),
        ])
      : null,
    el('button', {
      class: 'btn btn-outline btn-block',
      text: hasPassword ? 'Cambia password' : 'Imposta una password',
      style: 'margin-bottom:var(--sp-2)',
      onClick: () => openPasswordModal(hasPassword),
    }),
    el('button', { class: 'btn btn-ghost btn-block', html: `${svg('logout', 20)} Esci`, style: 'margin-bottom:var(--sp-2)', onClick: () => auth.logout() }),
    el('hr', { class: 'divider' }),
    el('div', { class: 'section-label', text: 'Zona pericolosa' }),
    el('button', { class: 'btn btn-danger btn-block', html: `${svg('trash', 20)} Elimina account`, onClick: () => deleteAccount(me) }),
  ]);
}

function openPasswordModal(hasPassword = true) {
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password attuale' });
  const nw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: hasPassword ? 'Nuova password (min. 8)' : 'Password (min. 8)' });
  const body = el('div', {}, [
    hasPassword
      ? el('div', { class: 'field' }, [el('label', { text: 'Password attuale' }), cur])
      : el('p', { class: 'text-lo', style: 'font-size:.85rem;margin-bottom:var(--sp-3)', text: 'Il tuo account usa Google. Imposta una password per poter accedere anche con email e password.' }),
    el('div', { class: 'field' }, [el('label', { text: hasPassword ? 'Nuova password' : 'Password' }), nw]),
  ]);
  const label = hasPassword ? 'Aggiorna password' : 'Imposta password';
  const save = el('button', { class: 'btn btn-primary', text: label });
  const m = modal({ title: hasPassword ? 'Cambia password' : 'Imposta password', content: body, footer: [save] });

  save.addEventListener('click', async () => {
    if (nw.value.length < 8) { toast.error('La password deve avere almeno 8 caratteri.'); return; }
    save.disabled = true; save.textContent = 'Aggiornamento…';
    try {
      const res = await api.post('/auth/change-password', { current_password: cur.value, new_password: nw.value });
      m.close();
      toast.success(res?.message || 'Password aggiornata!');
    } catch (err) {
      toast.error(err.message || 'Operazione non riuscita.');
      save.disabled = false; save.textContent = label;
    }
  });
}

async function deleteAccount(me) {
  const ok = await confirmDialog({
    title: 'Eliminare l\'account?',
    message: 'Questa azione è permanente: percorsi, record e progressi verranno rimossi e non sarà possibile recuperarli.',
    confirmText: 'Continua',
    danger: true,
  });
  if (!ok) return;

  // Senza password (account Google) la conferma è riscrivere il nickname.
  const hasPassword = me?.has_password !== false;
  const nickname = me?.nickname || '';
  const pw = el('input', {
    class: 'input',
    type: hasPassword ? 'password' : 'text',
    autocomplete: hasPassword ? 'current-password' : 'off',
    placeholder: hasPassword ? 'La tua password' : nickname,
  });
  const body = el('div', {}, [
    el('p', { class: 'text-mid', style: 'margin-bottom:var(--sp-3)', text: hasPassword
      ? 'Inserisci la password per eliminare definitivamente il tuo account.'
      : `Il tuo account usa Google. Per confermare, riscrivi il tuo nickname: ${nickname}` }),
    el('div', { class: 'field' }, [el('label', { text: hasPassword ? 'Password' : 'Nickname' }), pw]),
  ]);
  const del = el('button', { class: 'btn btn-danger', text: 'Elimina account' });
  const m = modal({ title: 'Elimina account', content: body, footer: [del] });

  del.addEventListener('click', async () => {
    if (!pw.value) { toast.error(hasPassword ? 'Inserisci la password.' : 'Riscrivi il tuo nickname.'); return; }
    del.disabled = true; del.textContent = 'Eliminazione…';
    try {
      await api.del('/settings/account', {
        body: hasPassword ? { password: pw.value } : { confirm_nickname: pw.value },
      });
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
