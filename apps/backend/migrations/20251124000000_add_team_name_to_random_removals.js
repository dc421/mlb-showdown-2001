exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('random_removals', {
    team_name: { type: 'varchar(255)' },
  });
};

exports.down = pgm => {
  pgm.dropColumn('random_removals', 'team_name');
};
