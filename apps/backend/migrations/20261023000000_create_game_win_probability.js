exports.shorthands = undefined;

// Cache of each completed game's computed win probability (curve, top plays, per-player WPA).
//
// Computing it means reading every game_states row for the game, and Postgres has to detoast each
// full state snapshot to pull out the few fields the model needs — ~1 s per game, ~6 s for a series,
// paid again on every page view. A completed game's result never changes, so it's stored once.
// `last_turn` and `model_generated_at` let a reader detect a stale entry (the game's states changed,
// e.g. a dev snapshot restore, or wpTable.json was regenerated) and recompute.
exports.up = pgm => {
  pgm.createTable('game_win_probability', {
    game_id: {
      type: 'integer',
      primaryKey: true,
      references: 'games(game_id)',
      onDelete: 'CASCADE',
    },
    last_turn: { type: 'integer', notNull: true },
    model_generated_at: { type: 'text' },
    data: { type: 'jsonb', notNull: true },
    computed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

exports.down = pgm => {
  pgm.dropTable('game_win_probability');
};
