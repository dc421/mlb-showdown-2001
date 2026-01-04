exports.up = pgm => {
  pgm.addColumns('draft_state', {
    notification_level: { type: 'integer', notNull: true, default: 0 },
  });
};

exports.down = pgm => {
  pgm.dropColumns('draft_state', ['notification_level']);
};
