/**
 * constants.js
 * ------------------------------------------------------------
 * Costanti condivise del dominio "4 & | 2".
 * ------------------------------------------------------------
 */

export const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
};

export const ROUTE_CATEGORIES = ['strada', 'montagna', 'panoramico', 'offroad', 'circuito', 'misto'];
export const ROUTE_DIFFICULTIES = ['facile', 'media', 'difficile', 'estrema'];
export const VEHICLE_TYPES = ['car', 'moto'];
export const ROUTE_VEHICLE_TYPES = ['car', 'moto', 'both'];
export const PRIVACY = ['public', 'private'];
// Visibilità estesa: i percorsi possono essere pubblici, privati o riservati a
// un club; gli eventi pubblici o riservati a un club.
export const ROUTE_PRIVACY = ['public', 'private', 'club'];
export const EVENT_PRIVACY = ['public', 'club'];

export const EVENT_STATUS = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  ENDED: 'ended',
  CANCELLED: 'cancelled',
};

export const CLUB_ROLES = {
  CREATOR: 'creator',
  MODERATOR: 'moderator',
  MEMBER: 'member',
};

export const FRIEND_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  BLOCKED: 'blocked',
};

// Livello minimo per sbloccare la Live Map multiplayer (anti-spam / progressione).
export const LIVE_MAP_MIN_LEVEL = 5;

// Ricompense XP di base per ogni azione (il "cuore" della gamification).
// Mai pay-to-win: solo attività reale genera XP.
export const XP = {
  REGISTER: 100,
  DAILY_LOGIN: 10,
  CREATE_ROUTE: 60,
  COMPLETE_ROUTE: 40,
  PERSONAL_BEST: 25,
  NEW_OFFICIAL_RECORD: 80, // il creatore migliora il proprio record ufficiale
  CREATE_EVENT: 50,
  JOIN_EVENT: 20,
  EVENT_CHECKIN: 30, // presenza verificata via GPS nel raggio
  CREATE_CLUB: 70,
  JOIN_CLUB: 15,
  ADD_FRIEND: 10,
  ADD_POI: 8,
  // Bonus per distanza percorsa: 1 XP ogni N metri completati.
  METERS_PER_XP: 500,
  STREAK_BONUS_PER_DAY: 5, // XP extra per ogni giorno consecutivo (cap gestito nel servizio)
  STREAK_BONUS_CAP: 50,
};
