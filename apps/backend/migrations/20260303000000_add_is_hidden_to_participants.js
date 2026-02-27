exports.up = async (pgm) => {
  await pgm.addColumns('game_participants', {
    is_hidden: { type: 'boolean', default: false },
  });
};

exports.down = async (pgm) => {
  await pgm.dropColumns('game_participants', ['is_hidden']);
};
