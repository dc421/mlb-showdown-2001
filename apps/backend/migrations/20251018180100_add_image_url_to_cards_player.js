/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('cards_player', {
    image_url: { type: 'text' },
  });
};

exports.down = pgm => {
  pgm.dropColumn('cards_player', 'image_url');
};