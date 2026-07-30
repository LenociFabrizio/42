/* =============================================================
   constants.js — Costanti condivise lato client (etichette IT,
   soglie, opzioni). Devono restare coerenti con quelle del server.
   ============================================================= */
export const LIVE_MAP_MIN_LEVEL = 5;
export const LIVE_ENABLED_TIP = `La Live Map con gli amici si sblocca al livello ${LIVE_MAP_MIN_LEVEL}. Continua a macinare km!`;

export const ROUTE_CATEGORIES = [
  { v: 'strada', l: 'Strada', ic: '🛣️' },
  { v: 'montagna', l: 'Montagna', ic: '⛰️' },
  { v: 'panoramico', l: 'Panoramico', ic: '🌄' },
  { v: 'offroad', l: 'Offroad', ic: '🥾' },
  { v: 'circuito', l: 'Circuito', ic: '🏁' },
  { v: 'misto', l: 'Misto', ic: '🧭' },
];
export const ROUTE_DIFFICULTIES = [
  { v: 'facile', l: 'Facile' },
  { v: 'media', l: 'Media' },
  { v: 'difficile', l: 'Difficile' },
  { v: 'estrema', l: 'Estrema' },
];
export const VEHICLE_TYPES = [
  { v: 'moto', l: 'Moto', ic: '🏍️' },
  { v: 'car', l: 'Auto', ic: '🚗' },
];
export const ROUTE_VEHICLE_TYPES = [
  { v: 'both', l: 'Entrambi', ic: '🏍️🚗' },
  { v: 'moto', l: 'Moto', ic: '🏍️' },
  { v: 'car', l: 'Auto', ic: '🚗' },
];
export const POI_CATEGORIES = [
  { v: 'panorama', l: 'Panorama', ic: '🌄' },
  { v: 'benzina', l: 'Benzinaio', ic: '⛽' },
  { v: 'officina', l: 'Officina', ic: '🔧' },
  { v: 'bar', l: 'Bar/Sosta', ic: '☕' },
  { v: 'curva', l: 'Curva', ic: '🌀' },
  { v: 'ritrovo', l: 'Ritrovo', ic: '📍' },
];

export const DIFF_LEVEL = { facile: 1, media: 2, difficile: 3, estrema: 4 };
export const catLabel = (v) => ROUTE_CATEGORIES.find((c) => c.v === v)?.l || v;
export const catIcon = (v) => ROUTE_CATEGORIES.find((c) => c.v === v)?.ic || '🧭';
