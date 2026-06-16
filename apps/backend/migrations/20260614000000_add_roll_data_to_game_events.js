exports.up = (pgm) => {
  pgm.addColumns('game_events', {
    roll_data: { type: 'jsonb', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('game_events', ['roll_data']);
};
