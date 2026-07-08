/* eslint-disable camelcase */

// Bridges the two worlds that until now were disconnected: live in-app play (`series` + `games`)
// and the league record / schedule (`series_results`). See memory "series-redesign".
//
//   * series_results.status       — lifecycle of a row: 'scheduled' (on the slate, no score yet) ->
//                                   'in_progress' (being played in-app, partial score) -> 'completed'.
//                                   The unscored round-robin rows generateSchedule() creates ARE the
//                                   schedule, so they backfill to 'scheduled'; every scored row is
//                                   'completed'.
//   * series_results.result_source — how a completed row was produced: 'in_app' (played through the
//                                   app), 'offline' (admin entered the final score), or 'auto'
//                                   (phantom losses / system). Nullable while still 'scheduled'.
//   * series.series_result_id     — the scheduled series_results row a live series fulfills, so a
//                                   played-in-app series can write its result back into standings.

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('series_results', {
    // Default 'completed' because the overwhelming majority of insert paths write an already-scored
    // row; the two paths that create unscored rows (generateSchedule, playoff scheduling) set
    // 'scheduled' explicitly.
    status: { type: 'varchar(20)', notNull: true, default: 'completed' },
    result_source: { type: 'varchar(20)' },
  });

  pgm.addColumns('series', {
    series_result_id: {
      type: 'integer',
      references: 'series_results',
      onDelete: 'SET NULL',
    },
  });

  // Backfill lifecycle: the unscored schedule rows are 'scheduled'; the rest already have a result.
  pgm.sql(`UPDATE series_results SET status = 'scheduled' WHERE winning_score IS NULL`);

  // Backfill provenance for existing completed rows. Phantom rows are system-generated ('auto');
  // everything else to date was entered/imported offline.
  pgm.sql(`
    UPDATE series_results
    SET result_source = CASE
      WHEN winning_team_name = 'Phantoms' OR losing_team_name = 'Phantoms' THEN 'auto'
      ELSE 'offline'
    END
    WHERE winning_score IS NOT NULL
  `);
};

exports.down = pgm => {
  pgm.dropColumns('series', ['series_result_id']);
  pgm.dropColumns('series_results', ['status', 'result_source']);
};
