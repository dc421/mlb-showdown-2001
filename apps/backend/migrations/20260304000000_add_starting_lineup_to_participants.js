exports.up = async (pgm) => {
  await pgm.addColumns('game_participants', {
    starting_lineup: { type: 'jsonb' },
  });
};

exports.down = async (pgm) => {
  await pgm.dropColumns('game_participants', ['starting_lineup']);
};
