exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('historical_rosters', {
    id: 'id',
    season: { type: 'varchar(255)', notNull: true },
    team_name: { type: 'varchar(255)', notNull: true },
    player_name: { type: 'varchar(255)', notNull: true },
    position: { type: 'varchar(50)' },
    points: { type: 'integer' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable('draft_history', {
    id: 'id',
    season: { type: 'varchar(255)', notNull: true },
    round: { type: 'varchar(50)' },
    pick_number: { type: 'integer' },
    team_name: { type: 'varchar(255)', notNull: true },
    player_name: { type: 'varchar(255)', notNull: true },
    notes: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

exports.down = pgm => {
  pgm.dropTable('draft_history');
  pgm.dropTable('historical_rosters');
};
