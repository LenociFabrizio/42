/* =============================================================
   club-logo.js — L'immagine di un club, trattata come la foto profilo di una
   persona: tonda, con bordo ambra, sempre della stessa forma in elenco,
   classifica e scheda.

   Senza immagine NON si mette un'icona uguale per tutti (prima era la stessa
   emoji per ogni club: nessuno riconosceva il proprio): si mostrano le iniziali
   del nome, così anche i club senza foto restano distinguibili a colpo d'occhio.
   ============================================================= */
import { el, svg } from './ui.js';

/** Iniziali del nome: fino a due lettere ("Ruote Libere" → "RL"). */
export function clubInitials(name) {
  const words = String(name || '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.map((w) => [...w].find((ch) => /\p{L}|\p{N}/u.test(ch))).filter(Boolean);
  return letters.slice(0, 2).join('').toUpperCase();
}

/**
 * Elemento immagine del club.
 * @param {object} club  serve `photo` e `name`
 * @param {object} [opts]
 * @param {number} [opts.size]     lato in px
 * @param {boolean} [opts.editable] aggiunge la pastiglia con la macchina fotografica
 * @returns {HTMLElement} il contenitore (il click lo attacca chi lo usa)
 */
export function clubLogo(club, { size = 56, editable = false } = {}) {
  const wrap = el('div', { class: 'club-logo-wrap', style: `width:${size}px;height:${size}px` });
  fill(wrap, club, size);
  if (editable) {
    wrap.classList.add('editable');
    wrap.title = 'Cambia immagine del club';
    wrap.append(el('span', { class: 'avatar-cam', html: svg('camera', 16) }));
  }
  return wrap;
}

/** Sostituisce l'immagine dopo un caricamento, senza ricaricare la pagina. */
export function setClubLogo(wrap, photo) {
  if (!wrap) return;
  const size = parseInt(wrap.style.width, 10) || 56;
  wrap.querySelector('.club-logo')?.remove();
  fill(wrap, { photo, name: wrap.dataset.name }, size);
}

function fill(wrap, club, size) {
  wrap.dataset.name = club?.name || '';
  if (club?.photo) {
    wrap.prepend(el('img', { class: 'club-logo', src: club.photo, alt: club.name || '' }));
    return;
  }
  const initials = clubInitials(club?.name);
  wrap.prepend(
    initials
      ? el('span', { class: 'club-logo fallback', style: `font-size:${Math.round(size * 0.36)}px`, text: initials })
      : el('span', { class: 'club-logo fallback', html: svg('building', Math.round(size * 0.44)) })
  );
}

export default clubLogo;
