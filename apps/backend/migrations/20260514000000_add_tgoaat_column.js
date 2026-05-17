exports.up = (pgm) => {
  pgm.addColumns('series_results', {
    tgoaat: { type: 'text', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('series_results', ['tgoaat']);
};
