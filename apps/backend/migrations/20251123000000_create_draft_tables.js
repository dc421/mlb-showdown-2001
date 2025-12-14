exports.shorthands = undefined;

exports.up = pgm => {
  // Track the overall state of the draft
  pgm.createTable('draft_state', {
    id: 'id',
    season_name: { type: 'varchar(255)', notNull: true },
    // 0: Not Started, 1: Removal, 2: Round 1, 3: Round 2, 4: Round 3 (Add/Drop), 5: Round 4 (Add/Drop), 6: Complete
    current_round: { type: 'integer', default: 0 },
    current_pick_number: { type: 'integer', default: 1 }, // 1 to 5
    active_team_id: { type: 'integer', references: 'teams(team_id)', onDelete: 'SET NULL' },
    // Array of team_ids defining the order [SpoonL, SpoonW, Neutral, ShipL, ShipW]
    draft_order: { type: 'jsonb' },
    is_active: { type: 'boolean', default: false },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
    }
  });

  // Alter existing draft_history table to support new features
  pgm.addColumns('draft_history', {
    action: { type: 'varchar(20)' }, // 'DROPPED', 'ADDED', 'REMOVED_RANDOM'
    team_id: { type: 'integer', references: 'teams(team_id)', onDelete: 'CASCADE' },
  });

  // Rename 'season' to 'season_name' to match convention in new code
  pgm.renameColumn('draft_history', 'season', 'season_name');

  // Make legacy columns nullable as we are now using team_id and card_id
  pgm.alterColumn('draft_history', 'team_name', { notNull: false });
  pgm.alterColumn('draft_history', 'player_name', { notNull: false });

  // Add Foreign Key constraint to existing card_id column (added in 20251122)
  pgm.addConstraint('draft_history', 'draft_history_card_id_fkey', {
    foreignKeys: {
      columns: 'card_id',
      references: 'cards_player(card_id)',
      onDelete: 'CASCADE'
    }
  });
};

exports.down = pgm => {
  pgm.dropConstraint('draft_history', 'draft_history_card_id_fkey');
  pgm.alterColumn('draft_history', 'player_name', { notNull: true });
  pgm.alterColumn('draft_history', 'team_name', { notNull: true });
  pgm.renameColumn('draft_history', 'season_name', 'season');
  pgm.dropColumns('draft_history', ['action', 'team_id']);
  pgm.dropTable('draft_state');
};
