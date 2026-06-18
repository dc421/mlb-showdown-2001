exports.shorthands = undefined;

// Caches the Monte Carlo spaceship/spoon odds for an in-progress season so the
// league page doesn't re-run the simulation on every load. Keyed by season; the
// `signature` is a hash of that season's result rows so a stale cache is detected
// and recomputed automatically when any result changes.
exports.up = pgm => {
  pgm.createTable('playoff_odds_cache', {
    season_name: { type: 'varchar(255)', primaryKey: true },
    signature: { type: 'text', notNull: true },
    odds: { type: 'jsonb', notNull: true },
    num_sims: { type: 'integer' },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

exports.down = pgm => {
  pgm.dropTable('playoff_odds_cache');
};
