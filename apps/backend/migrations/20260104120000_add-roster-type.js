exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('rosters', {
    roster_type: { type: 'varchar(20)', default: 'league', notNull: true },
  });
  pgm.addConstraint('rosters', 'unique_roster_type_per_user', {
    unique: ['user_id', 'roster_type']
  });
};

exports.down = pgm => {
  pgm.dropConstraint('rosters', 'unique_roster_type_per_user');
  pgm.dropColumn('rosters', 'roster_type');
};
