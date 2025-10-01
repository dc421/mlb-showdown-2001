/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // 1. CREATE point_sets TABLE
  pgm.createTable('point_sets', {
    point_set_id: 'id',
    name: { type: 'varchar(100)', notNull: true, unique: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // 2. CREATE player_point_values TABLE
  pgm.createTable('player_point_values', {
    player_point_value_id: 'id',
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
  });
  pgm.addConstraint('player_point_values', 'player_point_values_pkey', {
    primaryKey: ['card_id', 'point_set_id'],
  });

  // 3. ADD display_name to cards_player
  // The ingestion script will be responsible for populating this value.
  pgm.addColumns('cards_player', {
    display_name: { type: 'varchar(255)', unique: true },
  });

  // --- DATA MIGRATION ---

  // 4. GET the "Original Pts" set ID
  // We must handle the case where this script is run after the set is created.
  await pgm.sql("INSERT INTO point_sets (name) VALUES ('Original Pts') ON CONFLICT (name) DO NOTHING;");
  const { rows: [{ point_set_id }] } = await pgm.db.query("SELECT point_set_id FROM point_sets WHERE name = 'Original Pts'");

  // 5. MIGRATE existing points from `cards_player` to `player_point_values`
  // This assumes the `ingest-data.js` script has already run and populated the `points` column.
  await pgm.sql(`
    INSERT INTO player_point_values (card_id, point_set_id, points)
    SELECT card_id, ${point_set_id}, points
    FROM cards_player
    WHERE points IS NOT NULL
    ON CONFLICT (card_id, point_set_id) DO NOTHING;
  `);

  // 6. DROP the old points column from cards_player
  pgm.dropColumns('cards_player', ['points']);
};

exports.down = async (pgm) => {
  // 1. ADD back the points column to cards_player
  pgm.addColumns('cards_player', {
    points: { type: 'integer' },
  });

  // 2. MIGRATE points back from player_point_values to cards_player
  // This assumes the "Original Pts" set exists.
  const { rows } = await pgm.db.query("SELECT point_set_id FROM point_sets WHERE name = 'Original Pts'");
  if (rows.length > 0) {
    const point_set_id = rows[0].point_set_id;
    await pgm.sql(`
      UPDATE cards_player cp
      SET points = ppv.points
      FROM player_point_values ppv
      WHERE cp.card_id = ppv.card_id AND ppv.point_set_id = ${point_set_id};
    `);
  }

  // 3. DROP the display_name column
  pgm.dropColumns('cards_player', ['display_name']);

  // 4. DROP the new tables
  pgm.dropTable('player_point_values');
  pgm.dropTable('point_sets');
};