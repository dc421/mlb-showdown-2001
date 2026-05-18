exports.up = (pgm) => {
  pgm.renameColumn('series_results', 'tgoaat', 'tgaoot');
};

exports.down = (pgm) => {
  pgm.renameColumn('series_results', 'tgaoot', 'tgoaat');
};
