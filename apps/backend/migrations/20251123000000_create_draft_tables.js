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

  // Log specific actions (removals, adds, drops)
  pgm.createTable('draft_history', {
    id: 'id',
    season_name: { type: 'varchar(255)', notNull: true },
    round: { type: 'varchar(50)' }, // 'Removal', 'Round 1', 'Round 2', 'Round 3', 'Round 4'
    team_id: { type: 'integer', references: 'teams(team_id)', onDelete: 'CASCADE' },
    player_id: { type: 'integer', references: 'cards_player(card_id)', onDelete: 'CASCADE' },
    action: { type: 'varchar(20)' }, // 'DROPPED', 'ADDED', 'REMOVED_RANDOM'
    timestamp: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

exports.down = pgm => {
  pgm.dropTable('draft_history');
  pgm.dropTable('draft_state');
};
