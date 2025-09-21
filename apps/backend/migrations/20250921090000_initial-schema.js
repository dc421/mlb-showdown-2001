/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // 1. USERS TABLE
  pgm.createTable('users', {
    user_id: 'id',
    email: { type: 'varchar(255)', notNull: true, unique: true },
    hashed_password: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // 2. CARDS_PLAYER TABLE
  pgm.createTable('cards_player', {
    card_id: 'id',
    name: { type: 'varchar(255)' },
    team: { type: 'varchar(10)' },
    year: { type: 'integer' },
    points: { type: 'integer' },
    on_base: { type: 'integer' },
    control: { type: 'integer' },
    ip: { type: 'integer' },
    speed: { type: 'varchar(5)' },
    fielding_ratings: { type: 'jsonb' },
    chart_data: { type: 'jsonb' },
  });

  // 3. ROSTERS TABLE
  pgm.createTable('rosters', {
    roster_id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: '"users"(user_id)',
      onDelete: 'CASCADE',
    },
    roster_name: { type: 'varchar(100)', notNull: true },
  });
  pgm.createIndex('rosters', 'user_id');

  // 4. ROSTER_CARDS TABLE
  pgm.createTable('roster_cards', {
    roster_id: {
      type: 'integer',
      notNull: true,
      references: '"rosters"(roster_id)',
      onDelete: 'CASCADE',
    },
    card_id: {
      type: 'integer',
      notNull: true,
      references: '"cards_player"(card_id)',
      onDelete: 'CASCADE',
    },
    is_starter: { type: 'boolean', notNull: true, default: true },
  });
  pgm.addConstraint('roster_cards', 'roster_cards_pkey', { primaryKey: ['roster_id', 'card_id'] });
  pgm.createIndex('roster_cards', 'card_id');

  // 5. GAMES TABLE
  pgm.createTable('games', {
    game_id: 'id',
    status: { type: 'varchar(50)', default: 'pending' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    completed_at: { type: 'timestamptz' },
    current_turn_user_id: { type: 'integer', references: '"users"(user_id)' },
    home_team_user_id: { type: 'integer', references: '"users"(user_id)' },
    use_dh: { type: 'boolean' },
    setup_rolls: { type: 'jsonb' },
  });
  pgm.createIndex('games', 'current_turn_user_id');
  pgm.createIndex('games', 'home_team_user_id');

  // 6. GAME_PARTICIPANTS TABLE
  pgm.createTable('game_participants', {
    game_id: {
      type: 'integer',
      notNull: true,
      references: '"games"(game_id)',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'integer',
      notNull: true,
      references: '"users"(user_id)',
      onDelete: 'CASCADE',
    },
    roster_id: { type: 'integer', notNull: true, references: '"rosters"(roster_id)' },
    home_or_away: { type: 'varchar(4)', notNull: true },
    league_designation: { type: 'varchar(2)', notNull: true },
    lineup: { type: 'jsonb' },
  });
  pgm.addConstraint('game_participants', 'game_participants_pkey', { primaryKey: ['game_id', 'user_id'] });
  pgm.createIndex('game_participants', 'user_id');
  pgm.createIndex('game_participants', 'roster_id');

  // 7. GAME_STATES TABLE
  pgm.createTable('game_states', {
    game_state_id: 'id',
    game_id: {
      type: 'integer',
      notNull: true,
      references: '"games"(game_id)',
      onDelete: 'CASCADE',
    },
    turn_number: { type: 'integer', notNull: true },
    state_data: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createIndex('game_states', 'game_id');

  // 8. GAME_EVENTS TABLE
  pgm.createTable('game_events', {
    event_id: 'id',
    game_id: {
      type: 'integer',
      notNull: true,
      references: '"games"(game_id)',
      onDelete: 'CASCADE',
    },
    turn_number: { type: 'integer' },
    user_id: { type: 'integer', references: '"users"(user_id)' },
    event_type: { type: 'varchar(100)' },
    log_message: { type: 'text' },
    timestamp: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createIndex('game_events', 'game_id');
  pgm.createIndex('game_events', 'user_id');
};

exports.down = pgm => {
  pgm.dropTable('game_events');
  pgm.dropTable('game_states');
  pgm.dropTable('game_participants');
  pgm.dropTable('games');
  pgm.dropTable('roster_cards');
  pgm.dropTable('rosters');
  pgm.dropTable('cards_player');
  pgm.dropTable('users');
};
