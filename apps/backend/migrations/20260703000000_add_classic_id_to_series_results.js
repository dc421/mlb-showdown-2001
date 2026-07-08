/* eslint-disable camelcase */

// Ties a Classic result row to its Classic. Until now a Classic result was only identifiable by
// style='Classic' + the season name it happened to be stamped with, which can't disambiguate multiple
// Classics and can't reliably answer "which series belong to the *active* Classic". This column makes
// the association explicit so the dashboard can surface a live Classic's series and link its games.

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('series_results', {
    classic_id: {
      type: 'integer',
      references: 'classics',
      onDelete: 'SET NULL',
    },
  });

  // Backfill: every existing Classic result belongs to the one Classic that exists (Inaugural).
  pgm.sql(`
    UPDATE series_results
    SET classic_id = (SELECT id FROM classics ORDER BY id LIMIT 1)
    WHERE style = 'Classic'
  `);
};

exports.down = pgm => {
  pgm.dropColumns('series_results', ['classic_id']);
};
