/* =============================================================
   constants.js — Costanti condivise lato client (etichette IT,
   soglie, opzioni, mappe icona→nome). Le icone sono nomi del set
   SVG a tema (vedi icons.js), non emoji.
   ============================================================= */
export const LIVE_MAP_MIN_LEVEL = 5;
export const LIVE_ENABLED_TIP = `La posizione live con gli amici è sempre disponibile (con consenso). Per essere visibile agli sconosciuti (visibilità "pubblica") serve il livello ${LIVE_MAP_MIN_LEVEL}.`;

export const ROUTE_CATEGORIES = [
  { v: 'strada', l: 'Strada', icon: 'road' },
  { v: 'montagna', l: 'Montagna', icon: 'mountain' },
  { v: 'panoramico', l: 'Panoramico', icon: 'eye' },
  { v: 'offroad', l: 'Offroad', icon: 'footprints' },
  { v: 'circuito', l: 'Circuito', icon: 'flag' },
  { v: 'misto', l: 'Misto', icon: 'compass' },
];
export const ROUTE_DIFFICULTIES = [
  { v: 'facile', l: 'Facile' },
  { v: 'media', l: 'Media' },
  { v: 'difficile', l: 'Difficile' },
  { v: 'estrema', l: 'Estrema' },
];
export const VEHICLE_TYPES = [
  { v: 'moto', l: 'Moto', icon: 'bike' },
  { v: 'car', l: 'Auto', icon: 'car' },
];
export const ROUTE_VEHICLE_TYPES = [
  { v: 'both', l: 'Entrambi', icon: 'route' },
  { v: 'moto', l: 'Moto', icon: 'bike' },
  { v: 'car', l: 'Auto', icon: 'car' },
];
export const POI_CATEGORIES = [
  { v: 'panorama', l: 'Panorama', icon: 'eye' },
  { v: 'benzina', l: 'Benzinaio', icon: 'fuel' },
  { v: 'officina', l: 'Officina', icon: 'wrench' },
  { v: 'bar', l: 'Bar/Sosta', icon: 'coffee' },
  { v: 'curva', l: 'Curva', icon: 'wind' },
  { v: 'ritrovo', l: 'Ritrovo', icon: 'pin' },
];

export const DIFF_LEVEL = { facile: 1, media: 2, difficile: 3, estrema: 4 };

export const catLabel = (v) => ROUTE_CATEGORIES.find((c) => c.v === v)?.l || v;
export const catIcon = (v) => ROUTE_CATEGORIES.find((c) => c.v === v)?.icon || 'compass';
export const poiIcon = (v) => POI_CATEGORIES.find((c) => c.v === v)?.icon || 'pin';
export const vehIcon = (type) => (type === 'car' ? 'car' : 'bike');

/* Badge (code → nome icona SVG). Il fallback è 'award'. */
export const BADGE_ICON = {
  first_route: 'route', route_maker_5: 'compass', route_maker_25: 'map',
  first_ride: 'flag', record_holder: 'clock', speed_demon: 'zap',
  km_100: 'gauge', km_1000: 'road', km_5000: 'globe',
  first_event: 'pin', event_regular: 'calendar', event_host: 'megaphone',
  first_friend: 'users', social_butterfly: 'users', club_founder: 'building', club_member: 'building',
  level_5: 'star', level_10: 'star', level_25: 'trophy',
  streak_7: 'fire', streak_30: 'fire',
};
export const badgeIcon = (code) => BADGE_ICON[code] || 'award';

/* Notifiche (type → nome icona SVG). */
export const NOTIF_ICON = {
  friend_request: 'users', friend_accepted: 'check',
  event_invite: 'megaphone', event_reminder: 'megaphone', event_join: 'megaphone',
  record_beaten: 'flag',
  club_invite: 'building', club_request: 'building', club_accepted: 'building',
  badge: 'award', level_up: 'star', mission: 'target',
};
export const notifIcon = (type) => NOTIF_ICON[type] || 'bell';
