/**
 * catalog.js
 * ------------------------------------------------------------
 * Catalogo di BADGE e MISSIONI dell'app + `ensureCatalog(db)` che li
 * inserisce se mancanti (idempotente). Usato sia dal seed manuale
 * (seed.js) sia dall'inizializzazione dello schema (db.js), così un
 * DB nuovo — anche in produzione — ha subito il catalogo gamification
 * senza passaggi manuali.
 *
 * NB: i `code` dei badge devono combaciare con BADGE_RULES in
 * services/gamification.js; le `metric` delle missioni devono essere tra
 * quelle incrementate ('completions'|'distance_m'|'routes_created'|'events'|
 * 'regions').
 * ------------------------------------------------------------
 */

// [code, name, description, icon, tier, xp_reward, category]
export const BADGES = [
  ['first_route', 'Primo Tracciato', 'Hai creato il tuo primo percorso.', '🗺️', 'bronze', 20, 'routes'],
  ['route_maker_5', 'Cartografo', 'Hai creato 5 percorsi.', '🧭', 'silver', 50, 'routes'],
  ['route_maker_25', 'Maestro dei Percorsi', 'Hai creato 25 percorsi.', '🏗️', 'gold', 150, 'routes'],
  ['first_ride', 'Si Parte!', 'Hai completato il tuo primo percorso.', '🏁', 'bronze', 20, 'records'],
  ['record_holder', 'Detentore', 'Detieni il record ufficiale di un tuo percorso.', '⏱️', 'silver', 60, 'records'],
  ['speed_demon', 'Fulmine', 'Hai superato i 150 km/h in un completamento.', '⚡', 'gold', 80, 'records'],
  ['km_100', 'Centurione', 'Hai percorso 100 km in totale.', '💯', 'bronze', 30, 'records'],
  ['km_1000', 'Macinastrada', 'Hai percorso 1.000 km in totale.', '🛣️', 'silver', 120, 'records'],
  ['km_5000', 'Gran Viaggiatore', 'Hai percorso 5.000 km in totale.', '🌍', 'gold', 400, 'records'],
  ['first_event', 'Presente!', 'Hai partecipato al tuo primo evento.', '📍', 'bronze', 25, 'events'],
  ['event_regular', 'Habitué', 'Hai partecipato a 10 eventi.', '🎉', 'silver', 100, 'events'],
  ['event_host', 'Organizzatore', 'Hai creato un evento.', '📣', 'silver', 60, 'events'],
  ['first_friend', 'Compagno di Viaggio', 'Hai stretto la tua prima amicizia.', '🤝', 'bronze', 15, 'social'],
  ['social_butterfly', 'Anima del Gruppo', 'Hai 10 amici.', '🦋', 'silver', 80, 'social'],
  ['club_founder', 'Fondatore', 'Hai fondato un club.', '🏛️', 'gold', 90, 'social'],
  ['club_member', 'Membro', 'Ti sei unito a un club.', '👥', 'bronze', 20, 'social'],
  ['level_5', 'Esploratore', 'Hai raggiunto il livello 5.', '🌟', 'silver', 0, 'general'],
  ['level_10', 'Viaggiatore', 'Hai raggiunto il livello 10.', '✨', 'gold', 0, 'general'],
  ['level_25', 'Veterano', 'Hai raggiunto il livello 25.', '👑', 'special', 0, 'general'],
  ['streak_7', 'In Sella', 'Serie di 7 giorni consecutivi.', '🔥', 'silver', 50, 'general'],
  ['streak_30', 'Inarrestabile', 'Serie di 30 giorni consecutivi.', '🚀', 'special', 200, 'general'],
  // Aree: si sbloccano solo entrando davvero nella regione.
  ['region_beyond', 'Oltre il Confine', 'Hai sbloccato la tua prima area fuori da quella di partenza.', '🚧', 'bronze', 40, 'regions'],
  ['region_5', 'Cartografo d\'Italia', 'Hai sbloccato 5 aree.', '🗺️', 'silver', 120, 'regions'],
  ['region_10', 'Mezza Italia', 'Hai sbloccato 10 aree.', '🧭', 'gold', 300, 'regions'],
  ['region_all', 'Stivale Completo', 'Hai sbloccato tutte e 20 le aree d\'Italia.', '🏆', 'special', 1000, 'regions'],
];

// [code, name, description, period, metric, target, xp_reward]
export const MISSIONS = [
  ['daily_ride', 'Giro del Giorno', 'Completa 1 percorso oggi.', 'daily', 'completions', 1, 30],
  ['daily_distance', 'Scaldare le Gomme', 'Percorri 20 km oggi.', 'daily', 'distance_m', 20000, 40],
  ['weekly_creator', 'Esploratore Settimanale', 'Crea 2 percorsi questa settimana.', 'weekly', 'routes_created', 2, 80],
  ['weekly_distance', 'Divoratore di Asfalto', 'Percorri 100 km questa settimana.', 'weekly', 'distance_m', 100000, 120],
  ['weekly_event', 'Vita Sociale', 'Partecipa a 1 evento questa settimana.', 'weekly', 'events', 1, 60],
  ['ach_finisher', 'Finisher', 'Completa 25 percorsi.', 'achievement', 'completions', 25, 250],
  ['ach_explorer', 'Grande Esploratore', 'Crea 10 percorsi.', 'achievement', 'routes_created', 10, 200],
  ['ach_marathoner', 'Maratoneta', 'Percorri 500 km in totale.', 'achievement', 'distance_m', 500000, 300],
  ['ach_eventgoer', 'Frequentatore', 'Partecipa a 5 eventi.', 'achievement', 'events', 5, 200],
  ['weekly_region', 'Fuori Regione', 'Sblocca 1 nuova area questa settimana.', 'weekly', 'regions', 1, 150],
  ['ach_regions_5', 'Cacciatore di Aree', 'Sblocca 5 aree d\'Italia.', 'achievement', 'regions', 5, 300],
];

/**
 * Inserisce badge e missioni mancanti. Idempotente: confronta per `code`.
 * @param {import('./db.js').db} db  la facade del database
 */
export async function ensureCatalog(db) {
  for (const [code, name, description, icon, tier, xp, category] of BADGES) {
    const exists = await db.prepare('SELECT id FROM badges WHERE code = ?').get(code);
    if (!exists) {
      await db
        .prepare('INSERT INTO badges (code, name, description, icon, tier, xp_reward, category) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(code, name, description, icon, tier, xp, category);
    }
  }
  for (const [code, name, description, period, metric, target, xp] of MISSIONS) {
    const exists = await db.prepare('SELECT id FROM missions WHERE code = ?').get(code);
    if (!exists) {
      await db
        .prepare('INSERT INTO missions (code, name, description, period, metric, target, xp_reward) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(code, name, description, period, metric, target, xp);
    }
  }
}
