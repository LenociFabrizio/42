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

// Quanto vale l'ultimo battito di posizione prima di considerare un utente non
// più "in strada". Il client, con l'app in primo piano, ne manda uno almeno ogni
// 45s: 180s sono quattro battiti di margine (rete ballerina, timer strozzati),
// ma anche il tempo massimo in cui si resta visibili dopo aver chiuso l'app.
// Più corto sarebbe fragile, più lungo lascerebbe fantasmi sulla mappa.
export const LIVE_STALE_SECONDS = 180;

// Lunghezza minima di un percorso creato (metri). Deve restare allineata a
// MIN_ROUTE_DISTANCE_M in public/js/core/constants.js.
export const MIN_ROUTE_DISTANCE_M = 2000;

/* --- Tentativo cronometrato su un percorso esistente ---
   Un tempo entra in classifica solo se è un giro VERO: si parte dalla partenza
   del percorso e il cronometro si chiude all'arrivo. Il client blocca l'avvio
   fuori dal raggio e ferma il tempo da sé sul traguardo, ma la regola la fa
   rispettare il server (mai fidarsi del client).
   Devono restare allineate a public/js/core/constants.js. */

// Raggio dei "cancelletti" di partenza e arrivo (metri). Largo quanto basta per
// il margine d'errore del GPS (i campioni oltre 40 m di accuratezza sono già
// scartati), non tanto da poter tagliare il percorso.
export const ATTEMPT_GATE_RADIUS_M = 100;

// Frazione della lunghezza del percorso da coprire davvero prima che l'arrivo
// possa chiudere il tempo. Serve soprattutto agli anelli, dove partenza e
// arrivo coincidono: senza questa soglia basterebbe restare fermi allo start.
export const ATTEMPT_MIN_COVERAGE = 0.7;

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
  DISCOVER_REGION: 70, // nuova area sbloccata entrandoci davvero: vale un viaggio
  // Bonus per distanza percorsa: 1 XP ogni N metri completati.
  METERS_PER_XP: 500,
  STREAK_BONUS_PER_DAY: 5, // XP extra per ogni giorno consecutivo (cap gestito nel servizio)
  STREAK_BONUS_CAP: 50,
};
