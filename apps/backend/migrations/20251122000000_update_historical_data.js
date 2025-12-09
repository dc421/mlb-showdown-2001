exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('random_removals', {
    id: 'id',
    season: { type: 'varchar(255)', notNull: true },
    player_name: { type: 'varchar(255)', notNull: true },
    card_id: { type: 'integer' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addColumn('historical_rosters', {
    card_id: { type: 'integer' },
  });

  pgm.addColumn('draft_history', {
    card_id: { type: 'integer' },
  });
};

exports.down = pgm => {
  pgm.dropColumn('draft_history', 'card_id');
  pgm.dropColumn('historical_rosters', 'card_id');
  pgm.dropTable('random_removals');
};
