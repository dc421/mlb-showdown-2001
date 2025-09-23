/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('teams', {
    abbreviation: { type: 'varchar(10)' },
    primary_color: { type: 'varchar(7)' },
    secondary_color: { type: 'varchar(7)' },
  });
  pgm.addColumns('cards_player', {
    image_url: { type: 'text' },
  });
};

exports.down = pgm => {
  pgm.dropColumns('teams', ['abbreviation', 'primary_color', 'secondary_color']);
  pgm.dropColumns('cards_player', ['image_url']);
};
