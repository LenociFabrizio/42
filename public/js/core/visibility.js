/* =============================================================
   visibility.js — Privacy di percorsi/eventi (pubblico/privato/solo club)
   + controllo riutilizzabile per i form di creazione, con selezione del
   club (solo tra quelli di cui l'utente è admin) quando si sceglie "Solo club".
   ============================================================= */
import { el, svg } from './ui.js';
import { auth } from './auth.js';
import api from './api.js';

export const PRIVACY_ROUTE = [
  { v: 'public', l: 'Pubblico' },
  { v: 'private', l: 'Privato' },
  { v: 'club', l: 'Solo club' },
];
export const PRIVACY_EVENT = [
  { v: 'public', l: 'Pubblico' },
  { v: 'club', l: 'Solo club' },
];

const META = {
  public: { cls: 'public', icon: 'globe', label: 'Pubblico' },
  private: { cls: 'private', icon: 'lock', label: 'Privato' },
  club: { cls: 'club', icon: 'building', label: 'Solo club' },
};

/** Classe cornice per card/tile in base alla privacy. */
export function privacyFrameClass(privacy) {
  return `priv-${META[privacy]?.cls || 'public'}`;
}

/** Nodo badge privacy (icona + etichetta). */
export function privacyBadge(privacy) {
  const m = META[privacy] || META.public;
  return el('span', { class: `priv-badge ${m.cls}`, html: `${svg(m.icon, 13)} ${m.label}` });
}

/** Clubs di cui l'utente corrente è admin (creator/moderator). */
export async function adminClubs() {
  try {
    const d = await api.get(`/users/${auth.user.id}`);
    return (d.clubs || []).filter((c) => c.role === 'creator' || c.role === 'moderator');
  } catch { return []; }
}

/**
 * Controllo Privacy riutilizzabile.
 * @param {'route'|'event'} type
 * @returns {{ node: HTMLElement, value: {privacy, club_id, valid, error} }}
 */
export function buildPrivacyControl(type = 'route') {
  const options = type === 'event' ? PRIVACY_EVENT : PRIVACY_ROUTE;
  const sel = el('select', { class: 'select' }, options.map((o) => el('option', { value: o.v, text: o.l })));
  const clubSel = el('select', { class: 'select' });
  const clubWrap = el('div', { class: 'field hidden', style: 'margin-top:10px' }, [el('label', { text: 'Club' }), clubSel]);

  let loaded = false;
  let clubs = [];
  async function loadClubs() {
    if (loaded) return;
    loaded = true;
    clubs = await adminClubs();
    clubSel.replaceChildren();
    if (!clubs.length) {
      clubSel.append(el('option', { value: '', text: 'Non amministri nessun club' }));
    } else {
      for (const c of clubs) clubSel.append(el('option', { value: String(c.id), text: c.name }));
    }
  }
  sel.addEventListener('change', async () => {
    if (sel.value === 'club') { await loadClubs(); clubWrap.classList.remove('hidden'); }
    else clubWrap.classList.add('hidden');
  });

  const node = el('div', {}, [el('div', { class: 'field' }, [el('label', { text: 'Visibilità' }), sel]), clubWrap]);
  return {
    node,
    get value() {
      const privacy = sel.value;
      if (privacy === 'club') {
        const club_id = Number(clubSel.value) || null;
        return { privacy, club_id, valid: !!club_id, error: club_id ? null : 'Scegli un club che amministri (o creane uno).' };
      }
      return { privacy, club_id: null, valid: true, error: null };
    },
  };
}
