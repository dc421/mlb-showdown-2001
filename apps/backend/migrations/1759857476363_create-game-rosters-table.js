exports.up = pgm => {
  pgm.createTable('game_rosters', {
    game_id: {
      type: 'integer',
      notNull: true,
      references: '"games"(game_id)',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'integer',
      notNull: true,
      references: '"users"(user_id)',
      onDelete: 'CASCADE',
    },
    roster_data: {
      type: 'jsonb',
      notNull: true,
    },
  });

  pgm.addConstraint('game_rosters', 'game_rosters_pkey', {
    primaryKey: ['game_id', 'user_id'],
  });
};

exports.down = pgm => {
  pgm.dropTable('game_rosters');
};