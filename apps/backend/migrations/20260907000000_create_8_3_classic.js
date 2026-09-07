exports.shorthands = undefined;

exports.up = pgm => {
  // Only one Classic may receive new rosters and results at a time. The
  // Inaugural Classic remains in place as selectable, read-only history.
  pgm.sql(`
    UPDATE classics
    SET is_active = false
    WHERE is_active = true;

    INSERT INTO classics (name, description, is_active)
    VALUES (
      '8-3 Classic',
      'Only hitters with 8 OB or less and pitchers with 3 Control or less are eligible. No point maximum.',
      true
    );
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DELETE FROM classics
    WHERE name = '8-3 Classic';

    UPDATE classics
    SET is_active = true
    WHERE name = 'Inaugural Classic';
  `);
};
