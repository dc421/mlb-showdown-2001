exports.shorthands = undefined;

exports.up = pgm => {
  // Sync the rosters_roster_id_seq with the max roster_id in the rosters table
  // This fixes the duplicate key error when inserting new rosters after manual data insertion
  pgm.sql(`
    SELECT setval(pg_get_serial_sequence('rosters', 'roster_id'), COALESCE((SELECT MAX(roster_id) FROM rosters), 0) + 1, false);
  `);
};

exports.down = pgm => {
  // No down migration needed for sequence synchronization
};
