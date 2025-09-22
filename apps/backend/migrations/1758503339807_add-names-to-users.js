/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('users', {
    owner_first_name: { type: 'varchar(100)' },
    owner_last_name: { type: 'varchar(100)' }
  });
};

exports.down = pgm => {
  pgm.dropColumns('users', ['owner_first_name', 'owner_last_name']);
};