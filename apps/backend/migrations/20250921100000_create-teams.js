exports.up = pgm => {
  pgm.createTable('teams', {
    team_id: 'id',
    city: { type: 'varchar(100)', notNull: true },
    name: { type: 'varchar(100)', notNull: true },
    display_format: { type: 'varchar(50)' },
    logo_url: { type: 'text' },
  });
};

exports.down = pgm => {
  pgm.dropTable('teams');
};
