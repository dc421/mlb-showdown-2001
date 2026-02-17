exports.up = (pgm) => {
  pgm.addColumns('series_results', {
    mva: { type: 'text', notNull: false },
    lvsc: { type: 'text', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('series_results', ['mva', 'lvsc']);
};
