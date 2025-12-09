exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('series_results', {
    id: 'id',
    date: { type: 'date', notNull: true },
    season_name: { type: 'varchar(255)' },
    style: { type: 'varchar(50)' },
    round: { type: 'varchar(50)' },
    winning_team_name: { type: 'varchar(100)' },
    losing_team_name: { type: 'varchar(100)' },
    winning_team_id: { type: 'integer', references: 'teams(team_id)', onDelete: 'SET NULL' },
    losing_team_id: { type: 'integer', references: 'teams(team_id)', onDelete: 'SET NULL' },
    winning_score: { type: 'integer' },
    losing_score: { type: 'integer' },
    notes: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

exports.down = pgm => {
  pgm.dropTable('series_results');
};
