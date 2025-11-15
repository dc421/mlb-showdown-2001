/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('game_snapshots', {
    snapshot_id: 'id',
    game_id: {
      type: 'integer',
      notNull: true,
      references: '"games"(game_id)',
      onDelete: 'CASCADE',
    },
    snapshot_name: { type: 'varchar(255)', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    game_data: { type: 'jsonb', notNull: true },
    participants_data: { type: 'jsonb', notNull: true },
    latest_state_data: { type: 'jsonb', notNull: true },
    events_data: { type: 'jsonb', notNull: true },
    rosters_data: { type: 'jsonb', notNull: true },
  });
  pgm.createIndex('game_snapshots', 'game_id');
};

exports.down = pgm => {
  pgm.dropTable('game_snapshots');
};
