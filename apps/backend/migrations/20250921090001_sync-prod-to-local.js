/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // --- ADD MISSING COLUMNS ---
  // These columns exist locally but are missing on Render.
  pgm.addColumns('users', {
    owner_first_name: { type: 'varchar(100)' },
    owner_last_name: { type: 'varchar(100)' }
  });
  pgm.addColumns('teams', {
    abbreviation: { type: 'varchar(4)', notNull: true, default: 'XXX' },
    primary_color: { type: 'varchar(7)' },
    secondary_color: { type: 'varchar(7)' }
  });
  pgm.addColumns('roster_cards', {
    assignment: { type: 'text' }
  });
  pgm.addColumns('cards_player', {
    image_url: { type: 'text' }
  });

  // --- DROP EXTRA COLUMNS ---
  // This column exists on Render but is missing locally.
  pgm.dropColumns('rosters', ['roster_name']);

  // --- ALTER MISMATCHED COLUMNS ---
  // These columns exist on both but have different types or defaults.
  pgm.alterColumn('cards_player', 'set_name', {
    type: 'text'
  });
  pgm.alterColumn('teams', 'display_format', {
    type: 'varchar(255)',
    default: '{city} {name}'
  });
};

exports.down = pgm => {
  // Revert all the changes above in reverse order
  pgm.alterColumn('teams', 'display_format', {
    type: 'varchar(50)',
    default: null
  });
  pgm.alterColumn('cards_player', 'set_name', {
    type: 'varchar(50)'
  });
  pgm.addColumns('rosters', {
    roster_name: { type: 'varchar(100)', notNull: true }
  });
  pgm.dropColumns('cards_player', ['image_url']);
  pgm.dropColumns('roster_cards', ['assignment']);
  pgm.dropColumns('teams', ['abbreviation', 'primary_color', 'secondary_color']);
  pgm.dropColumns('users', ['owner_first_name', 'owner_last_name']);
};