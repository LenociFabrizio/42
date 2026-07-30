/* =============================================================
   gamification.js — Mirror lato client della curva XP (solo per la
   resa grafica: barre, anelli, titoli). La verità resta lato server.
   Deve combaciare con server/utils/levels.js.
   ============================================================= */
import { el } from './ui.js';

export function xpForLevel(level) {
  const L = Math.max(1, Math.floor(level));
  return 50 * (L - 1) * L;
}
export function levelForXp(xp) {
  const x = Math.max(0, xp);
  let level = 1;
  while (xpForLevel(level + 1) <= x) level++;
  return level;
}
export function progress(xp) {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const into = xp - base, span = next - base;
  return { level, xp, xpIntoLevel: into, xpForNextLevel: span, xpRemaining: span - into, percent: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100 };
}
export function levelTitle(level) {
  if (level >= 40) return 'Leggenda della Strada';
  if (level >= 30) return 'Gran Turismo';
  if (level >= 20) return 'Veterano';
  if (level >= 12) return 'Pilota Esperto';
  if (level >= 7) return 'Viaggiatore';
  if (level >= 4) return 'Esploratore';
  if (level >= 2) return 'Apprendista';
  return 'Novizio';
}

/** Barra XP (usa .meter). Ritorna un nodo. */
export function xpMeter(xp) {
  const p = progress(xp);
  return el('div', {}, [
    el('div', { class: 'meter-row' }, [
      el('span', { text: `Liv. ${p.level} · ${levelTitle(p.level)}` }),
      el('span', { class: 'mono', text: `${p.xpIntoLevel}/${p.xpForNextLevel} XP` }),
    ]),
    el('div', { class: 'meter' }, [el('span', { style: `width:${p.percent}%` })]),
  ]);
}

/** Percentuale di riempimento dell'anello livello (per --ring su .avatar-ring). */
export function ringPercent(xp) {
  return progress(xp).percent;
}
