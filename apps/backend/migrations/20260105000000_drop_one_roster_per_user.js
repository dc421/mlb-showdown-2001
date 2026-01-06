exports.shorthands = undefined;

exports.up = pgm => {
  // The error "duplicate key value violates unique constraint 'one_roster_per_user'"
  // indicates this constraint exists on the rosters table, likely on the user_id column.
  // This conflicts with the new multi-roster design (using roster_type).
  pgm.dropConstraint('rosters', 'one_roster_per_user');
};

exports.down = pgm => {
  // Restore the constraint if we roll back.
  // Based on the error "Key (user_id)=(1) already exists", it was unique on user_id.
  pgm.addConstraint('rosters', 'one_roster_per_user', {
    unique: 'user_id'
  });
};
