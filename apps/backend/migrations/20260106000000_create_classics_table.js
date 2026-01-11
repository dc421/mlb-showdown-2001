exports.up = async (pgm) => {
    // 1. Create classics table
    pgm.createTable('classics', {
        id: 'id',
        name: { type: 'text', notNull: true },
        description: { type: 'text' },
        is_active: { type: 'boolean', default: false },
        seeding: { type: 'jsonb' },
        created_at: {
            type: 'timestamp',
            notNull: true,
            default: pgm.func('current_timestamp')
        }
    });

    // 2. Insert Inaugural Classic
    pgm.sql(`
        INSERT INTO classics (name, description, is_active)
        VALUES ('Inaugural Classic', 'Only players with less than five seasons of Showdown League experience are eligible.', true);
    `);

    // 3. Add columns
    pgm.addColumns('rosters', {
        classic_id: {
            type: 'integer',
            references: '"classics"',
            onDelete: 'SET NULL'
        }
    });

    pgm.addColumns('series', {
        classic_id: {
            type: 'integer',
            references: '"classics"',
            onDelete: 'SET NULL'
        }
    });

    // 4. Update existing data
    pgm.sql(`
        UPDATE rosters
        SET classic_id = (SELECT id FROM classics WHERE name = 'Inaugural Classic' LIMIT 1)
        WHERE roster_type = 'classic';
    `);

    pgm.sql(`
        UPDATE series
        SET classic_id = (SELECT id FROM classics WHERE name = 'Inaugural Classic' LIMIT 1)
        WHERE series_type = 'classic';
    `);
};

exports.down = async (pgm) => {
    pgm.dropColumns('series', ['classic_id']);
    pgm.dropColumns('rosters', ['classic_id']);
    pgm.dropTable('classics');
};
