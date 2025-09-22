/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // 1. Add columns to USERS
  pgm.addColumns('users', {
    owner_first_name: { type: 'varchar(100)' },
    owner_last_name: { type: 'varchar(100)' }
  });

  // 2. Add columns to TEAMS
  pgm.addColumns('teams', {
    abbreviation: { type: 'varchar(4)', notNull: true, default: 'XXX' }, // Added default to satisfy NOT NULL
    primary_color: { type: 'varchar(7)' },
    secondary_color: { type: 'varchar(7)' }
  });
  pgm.alterColumn('teams', 'display_format', {
    default: '{city} {name}'
  });

  // 3. Add column to ROSTERS
  pgm.addColumns('rosters', {
    roster_name: { type: 'varchar(100)', notNull: true, default: 'My Roster' } // Added default to satisfy NOT NULL
  });

  // 4. Add column to ROSTER_CARDS
  pgm.addColumns('roster_cards', {
    assignment: { type: 'text' }
  });

  // 5. Add column to CARDS_PLAYER
  pgm.addColumns('cards_player', {
    image_url: { type: 'text' }
  });
};

exports.down = pgm => {
  pgm.dropColumns('users', ['owner_first_name', 'owner_last_name']);
  pgm.dropColumns('teams', ['abbreviation', 'primary_color', 'secondary_color']);
  pgm.alterColumn('teams', 'display_format', { default: null });
  pgm.dropColumns('rosters', ['roster_name']);
  pgm.dropColumns('roster_cards', ['assignment']);
  pgm.dropColumns('cards_player', ['image_url']);
};