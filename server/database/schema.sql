-- ============================================================
--  4 & | 2 — Schema del database (libSQL / SQLite)
--  Idempotente: usa sempre "IF NOT EXISTS".
--  Convenzioni: id INTEGER PK AUTOINCREMENT, timestamp TEXT ISO (UTC)
--  via datetime('now'), coordinate come REAL (lat/lng), distanze in metri,
--  tempi in secondi (durate) o millisecondi (cronometri), booleani INTEGER 0/1.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
--  UTENTI
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname            TEXT    NOT NULL UNIQUE,        -- univoco, nome pubblico
  email               TEXT    NOT NULL UNIQUE,
  password_hash       TEXT    NOT NULL,
  avatar              TEXT    DEFAULT '/images/avatars/default.svg',
  bio                 TEXT    DEFAULT '',
  role                TEXT    NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  -- Gamification
  xp                  INTEGER NOT NULL DEFAULT 0,      -- esperienza totale accumulata
  level               INTEGER NOT NULL DEFAULT 1,
  -- Statistiche cache (aggiornate dai servizi; ricostruibili)
  total_distance_m    INTEGER NOT NULL DEFAULT 0,
  total_time_s        INTEGER NOT NULL DEFAULT 0,
  routes_count        INTEGER NOT NULL DEFAULT 0,      -- percorsi creati
  records_count       INTEGER NOT NULL DEFAULT 0,      -- record ufficiali detenuti
  events_count        INTEGER NOT NULL DEFAULT 0,      -- eventi a cui ha partecipato
  -- Streak giornaliera
  streak_days         INTEGER NOT NULL DEFAULT 0,
  streak_last_day     TEXT,                            -- 'YYYY-MM-DD' (UTC) ultimo giorno attivo
  -- Live location (multiplayer): posizione più recente condivisa
  live_enabled        INTEGER NOT NULL DEFAULT 0,      -- consenso alla condivisione live
  last_lat            REAL,
  last_lng            REAL,
  last_speed          REAL,
  last_heading        REAL,
  last_seen           TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);
CREATE INDEX IF NOT EXISTS idx_users_live ON users(live_enabled, last_seen);

-- Impostazioni utente (chiave/valore JSON-friendly, una riga per utente).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id             INTEGER PRIMARY KEY,
  theme               TEXT    NOT NULL DEFAULT 'dark',    -- 'dark' | 'light'
  language            TEXT    NOT NULL DEFAULT 'it',
  units               TEXT    NOT NULL DEFAULT 'metric',  -- 'metric' | 'imperial'
  profile_visibility  TEXT    NOT NULL DEFAULT 'public',  -- 'public' | 'friends' | 'private'
  location_visibility TEXT    NOT NULL DEFAULT 'friends', -- chi può vederti sulla live map
  notify_friends      INTEGER NOT NULL DEFAULT 1,
  notify_events       INTEGER NOT NULL DEFAULT 1,
  notify_records      INTEGER NOT NULL DEFAULT 1,
  notify_clubs        INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Veicoli dell'utente (auto e moto).
CREATE TABLE IF NOT EXISTS vehicles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  type                TEXT    NOT NULL,                 -- 'car' | 'moto'
  name                TEXT    NOT NULL,                 -- es. "La mia Panigale"
  make                TEXT    DEFAULT '',               -- marca
  model               TEXT    DEFAULT '',
  year                INTEGER,
  photo               TEXT,
  is_primary          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);

-- ------------------------------------------------------------
--  PERCORSI (routes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id          INTEGER NOT NULL,
  name                TEXT    NOT NULL,
  description         TEXT    DEFAULT '',
  photo               TEXT,
  category            TEXT    NOT NULL DEFAULT 'misto', -- 'strada'|'montagna'|'panoramico'|'offroad'|'circuito'|'misto'
  difficulty          TEXT    NOT NULL DEFAULT 'media', -- 'facile'|'media'|'difficile'|'estrema'
  vehicle_type        TEXT    NOT NULL DEFAULT 'both',  -- 'car'|'moto'|'both'
  -- Estremi
  start_lat           REAL    NOT NULL,
  start_lng           REAL    NOT NULL,
  start_name          TEXT    DEFAULT '',
  end_lat             REAL    NOT NULL,
  end_lng             REAL    NOT NULL,
  end_name            TEXT    DEFAULT '',
  -- Geometria: polyline codificata (algoritmo Google, precisione 5).
  track_polyline      TEXT    NOT NULL DEFAULT '',
  -- Metriche derivate
  distance_m          INTEGER NOT NULL DEFAULT 0,
  elevation_gain_m    INTEGER NOT NULL DEFAULT 0,
  est_time_s          INTEGER NOT NULL DEFAULT 0,
  -- Riquadro di delimitazione (per query mappa efficienti)
  bbox_min_lat        REAL,
  bbox_min_lng        REAL,
  bbox_max_lat        REAL,
  bbox_max_lng        REAL,
  privacy             TEXT    NOT NULL DEFAULT 'public', -- 'public' | 'private'
  -- Record UFFICIALE: appartiene SEMPRE al creatore del percorso.
  -- Punta alla completion del creatore scelta come record principale.
  record_completion_id INTEGER,
  -- Statistiche cache
  completions_count   INTEGER NOT NULL DEFAULT 0,
  likes_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routes_creator ON routes(creator_id);
CREATE INDEX IF NOT EXISTS idx_routes_privacy ON routes(privacy);
CREATE INDEX IF NOT EXISTS idx_routes_bbox ON routes(bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng);
CREATE INDEX IF NOT EXISTS idx_routes_category ON routes(category);

CREATE TABLE IF NOT EXISTS route_tags (
  route_id            INTEGER NOT NULL,
  tag                 TEXT    NOT NULL,
  PRIMARY KEY (route_id, tag),
  FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_route_tags_tag ON route_tags(tag);

-- "Mi piace" ai percorsi.
CREATE TABLE IF NOT EXISTS route_likes (
  route_id            INTEGER NOT NULL,
  user_id             INTEGER NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (route_id, user_id),
  FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
);

-- ------------------------------------------------------------
--  COMPLETAMENTI / RECORD
--  Ogni tentativo cronometrato di un utente su un percorso.
--  REGOLA: il record UFFICIALE del percorso è quello del CREATORE
--  (routes.record_completion_id). Gli altri utenti hanno il proprio
--  miglior tempo personale (is_personal_best) ma NON il record ufficiale.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_completions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id            INTEGER NOT NULL,
  user_id             INTEGER NOT NULL,
  time_ms             INTEGER NOT NULL,               -- tempo impiegato (cronometro)
  distance_m          INTEGER NOT NULL DEFAULT 0,
  avg_speed_kmh       REAL    NOT NULL DEFAULT 0,
  max_speed_kmh       REAL    NOT NULL DEFAULT 0,
  weather             TEXT    DEFAULT '',             -- condizioni meteo dichiarate
  vehicle_id          INTEGER,                        -- veicolo usato
  track_polyline      TEXT    DEFAULT '',             -- traccia effettivamente percorsa
  is_personal_best    INTEGER NOT NULL DEFAULT 0,     -- miglior tempo dell'utente su questo percorso
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (route_id)   REFERENCES routes(id)    ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_completions_route ON route_completions(route_id, time_ms);
CREATE INDEX IF NOT EXISTS idx_completions_user  ON route_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_completions_pb     ON route_completions(route_id, user_id, is_personal_best);

-- ------------------------------------------------------------
--  EVENTI LIVE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id          INTEGER NOT NULL,
  name                TEXT    NOT NULL,
  description         TEXT    DEFAULT '',
  photo               TEXT,
  starts_at           TEXT    NOT NULL,               -- data/ora ISO
  duration_min        INTEGER NOT NULL DEFAULT 120,
  max_participants    INTEGER NOT NULL DEFAULT 0,     -- 0 = illimitato
  route_id            INTEGER,                        -- percorso associato (opzionale)
  -- Area geografica di raduno: solo chi è entro il raggio può partecipare live.
  area_lat            REAL    NOT NULL,
  area_lng            REAL    NOT NULL,
  area_name           TEXT    DEFAULT '',
  radius_m            INTEGER NOT NULL DEFAULT 1000,
  status              TEXT    NOT NULL DEFAULT 'scheduled', -- 'scheduled'|'live'|'ended'|'cancelled'
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creator_id) REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (route_id)   REFERENCES routes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_events_creator ON events(creator_id);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id            INTEGER NOT NULL,
  user_id             INTEGER NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'joined', -- 'joined'|'checked_in'|'left'
  joined_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  checked_in_at       TEXT,                              -- primo ingresso GPS nel raggio (verificato)
  -- Posizione live durante l'evento
  last_lat            REAL,
  last_lng            REAL,
  last_seen           TEXT,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_part_user ON event_participants(user_id);

-- ------------------------------------------------------------
--  CLUB
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clubs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL UNIQUE,
  photo               TEXT,
  description         TEXT    DEFAULT '',
  creator_id          INTEGER NOT NULL,
  max_members         INTEGER NOT NULL DEFAULT 0,      -- 0 = illimitato
  privacy             TEXT    NOT NULL DEFAULT 'public', -- 'public' | 'private'
  xp                  INTEGER NOT NULL DEFAULT 0,
  level               INTEGER NOT NULL DEFAULT 1,
  -- Statistiche cache
  members_count       INTEGER NOT NULL DEFAULT 1,
  total_distance_m    INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clubs_xp ON clubs(xp DESC);

CREATE TABLE IF NOT EXISTS club_members (
  club_id             INTEGER NOT NULL,
  user_id             INTEGER NOT NULL,
  role                TEXT    NOT NULL DEFAULT 'member', -- 'creator'|'moderator'|'member'
  joined_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (club_id, user_id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members(user_id);

-- Richieste di ingresso ai club privati.
CREATE TABLE IF NOT EXISTS club_join_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id             INTEGER NOT NULL,
  user_id             INTEGER NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending', -- 'pending'|'accepted'|'declined'
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (club_id, user_id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
--  AMICIZIE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id        INTEGER NOT NULL,
  addressee_id        INTEGER NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending', -- 'pending'|'accepted'|'declined'|'blocked'
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  responded_at        TEXT,
  UNIQUE (requester_id, addressee_id),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requester ON friendships(requester_id, status);

-- ------------------------------------------------------------
--  GAMIFICATION: badge, missioni, log XP
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT    NOT NULL UNIQUE,          -- identificatore stabile
  name                TEXT    NOT NULL,
  description         TEXT    NOT NULL,
  icon                TEXT    NOT NULL DEFAULT '🏅',     -- emoji/icona
  tier                TEXT    NOT NULL DEFAULT 'bronze', -- 'bronze'|'silver'|'gold'|'special'
  xp_reward           INTEGER NOT NULL DEFAULT 0,
  category            TEXT    NOT NULL DEFAULT 'general' -- 'routes'|'records'|'events'|'social'|'general'
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id             INTEGER NOT NULL,
  badge_id            INTEGER NOT NULL,
  earned_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_id),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS missions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT    NOT NULL UNIQUE,
  name                TEXT    NOT NULL,
  description         TEXT    NOT NULL,
  period              TEXT    NOT NULL DEFAULT 'daily',  -- 'daily'|'weekly'|'achievement'
  metric              TEXT    NOT NULL,                  -- 'distance_m'|'completions'|'events'|'routes_created'|'friends'
  target              INTEGER NOT NULL DEFAULT 1,
  xp_reward           INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1
);

-- Avanzamento missioni per utente e periodo (period_key = giorno/settimana/'all').
CREATE TABLE IF NOT EXISTS user_missions (
  user_id             INTEGER NOT NULL,
  mission_id          INTEGER NOT NULL,
  period_key          TEXT    NOT NULL,                  -- 'YYYY-MM-DD' | 'YYYY-Www' | 'all'
  progress            INTEGER NOT NULL DEFAULT 0,
  completed_at        TEXT,
  PRIMARY KEY (user_id, mission_id, period_key),
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);

-- Registro (audit) di ogni assegnazione XP: fonte di verità ricostruibile.
CREATE TABLE IF NOT EXISTS xp_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  amount              INTEGER NOT NULL,
  reason              TEXT    NOT NULL,                  -- es. 'route_completed', 'badge:first_ride'
  ref_type            TEXT,                              -- 'route'|'event'|'club'|'badge'|...
  ref_id              INTEGER,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id, created_at);

-- ------------------------------------------------------------
--  NOTIFICHE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,                  -- destinatario
  type                TEXT    NOT NULL,                  -- 'friend_request'|'friend_accepted'|'event_invite'|'record_beaten'|'club_invite'|'badge'|'level_up'|...
  title               TEXT    NOT NULL,
  body                TEXT    DEFAULT '',
  data                TEXT    DEFAULT '{}',              -- JSON con riferimenti (ids, link)
  read_at             TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at);

-- ------------------------------------------------------------
--  PUNTI DI INTERESSE (POI) — mostrati sulla mappa
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pois (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id          INTEGER,
  name                TEXT    NOT NULL,
  description         TEXT    DEFAULT '',
  category            TEXT    NOT NULL DEFAULT 'panorama', -- 'benzina'|'officina'|'bar'|'panorama'|'curva'|'ritrovo'
  lat                 REAL    NOT NULL,
  lng                 REAL    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pois_bbox ON pois(lat, lng);

-- ------------------------------------------------------------
--  META applicativi (marcatori one-shot, versioni seed, ecc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
  key                 TEXT PRIMARY KEY,
  value               TEXT
);
