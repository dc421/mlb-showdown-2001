/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropConstraint('games', 'games_current_turn_user_id_fkey');
};

exports.down = pgm => {
  pgm.addConstraint('games', 'games_current_turn_user_id_fkey', {
    foreignKeys: {
      columns: 'current_turn_user_id',
      references: 'users(user_id)',
    },
  });
};
