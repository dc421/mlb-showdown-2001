exports.shorthands = undefined;

// Adds the deterministic playoff-scenario data (clinch/elimination "magic numbers" per upcoming
// series) to the existing odds cache. It's derived from the same result rows and the same
// `signature`, so it's recomputed alongside the Monte Carlo odds and invalidated the same way.
// Nullable so existing cache rows stay valid; the read path recomputes when it's missing.
exports.up = pgm => {
  pgm.addColumn('playoff_odds_cache', {
    scenarios: { type: 'jsonb' },
  });
};

exports.down = pgm => {
  pgm.dropColumn('playoff_odds_cache', 'scenarios');
};
