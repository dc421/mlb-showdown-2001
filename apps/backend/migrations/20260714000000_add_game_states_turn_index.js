exports.shorthands = undefined;

// Every "latest state per game" lookup orders game_states by turn_number DESC (the newest turn holds
// the live atBatLog/pitcherStats). With only the existing game_id index, Postgres has to sort the
// matching rows each time. A composite (game_id, turn_number DESC) index lets those lookups — used on
// every game load, the series detail route, and the series/leaders box-score endpoints — resolve via
// a fast backward index scan. The existing game_id index is left in place.
exports.up = pgm => {
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS idx_game_states_game_turn ON game_states (game_id, turn_number DESC)'
  );
};

exports.down = pgm => {
  pgm.sql('DROP INDEX IF EXISTS idx_game_states_game_turn');
};
