/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // 1. Create the new tables and columns
  pgm.createTable('point_sets', {
    point_set_id: 'id',
    name: { type: 'varchar(100)', notNull: true, unique: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable(
    'player_point_values',
    {
      player_point_value_id: { type: 'serial' },
      card_id: {
        type: 'integer',
        notNull: true,
        references: '"cards_player"(card_id)',
        onDelete: 'CASCADE',
      },
      point_set_id: {
        type: 'integer',
        notNull: true,
        references: '"point_sets"(point_set_id)',
        onDelete: 'CASCADE',
      },
      points: { type: 'integer', notNull: true },
    },
    {
      constraints: {
        primaryKey: ['card_id', 'point_set_id'],
      },
    }
  );

  pgm.addColumns('cards_player', {
    display_name: { type: 'varchar(255)', unique: true },
  });

  // 2. Perform the data migration using raw SQL to ensure correct execution order
  await pgm.sql("INSERT INTO point_sets (name) VALUES ('Original Pts') ON CONFLICT (name) DO NOTHING;");

  await pgm.sql(`
    INSERT INTO player_point_values (card_id, point_set_id, points)
    SELECT
        cp.card_id,
        ps.point_set_id,
        cp.points
    FROM cards_player cp, point_sets ps
    WHERE ps.name = 'Original Pts' AND cp.points IS NOT NULL
    ON CONFLICT (card_id, point_set_id) DO NOTHING;
  `);

  // 3. Drop the old points column after data has been migrated
  pgm.dropColumns('cards_player', ['points']);
};

exports.down = async (pgm) => {
  // 1. Add back the points column
  pgm.addColumns('cards_player', {
    points: { type: 'integer' },
  });

  // 2. Migrate the points back from the "Original Pts" set
  await pgm.sql(`
    UPDATE cards_player cp
    SET points = ppv.points
    FROM player_point_values ppv
    JOIN point_sets ps ON ppv.point_set_id = ps.point_set_id
    WHERE cp.card_id = ppv.card_id AND ps.name = 'Original Pts';
  `);

  // 3. Drop the new tables and columns
  pgm.dropColumns('cards_player', ['display_name']);
  pgm.dropTable('player_point_values');
  pgm.dropTable('point_sets');
};