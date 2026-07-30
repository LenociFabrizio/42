/**
 * levels.js
 * ------------------------------------------------------------
 * Curva di progressione XP → Livello. Condivisa lato server (calcolo
 * autorevole) e replicata lato client (public/js/core/gamification.js)
 * solo per la resa grafica delle barre di avanzamento.
 *
 * Curva: XP totale richiesto per RAGGIUNGERE il livello L è
 *   xpForLevel(L) = 50 * (L-1) * L        (crescita quadratica dolce)
 * → L1:0, L2:100, L3:300, L4:600, L5:1000, L10:4500, L20:19000 ...
 * Progressione appagante ma senza muri; nessun contenuto è a pagamento.
 * ------------------------------------------------------------
 */

/** XP totale necessario per raggiungere il livello dato (L >= 1). */
export function xpForLevel(level) {
  const L = Math.max(1, Math.floor(level));
  return 50 * (L - 1) * L;
}

/** Livello corrispondente a un totale di XP. */
export function levelForXp(xp) {
  const x = Math.max(0, xp);
  let level = 1;
  while (xpForLevel(level + 1) <= x) level++;
  return level;
}

/**
 * Dettaglio progresso: livello attuale, XP nel livello, XP necessario al
 * prossimo livello e percentuale (0–100).
 */
export function progress(xp) {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const into = xp - base;
  const span = next - base;
  return {
    level,
    xp,
    xpIntoLevel: into,
    xpForNextLevel: span,
    xpRemaining: span - into,
    percent: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100,
  };
}

/**
 * Titolo/rango estetico associato al livello (premio non funzionale).
 */
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
