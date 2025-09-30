/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // 1. Create the new 'series' table
  pgm.sql(`
    CREATE TABLE public.series (
      id SERIAL PRIMARY KEY,
      series_type VARCHAR(50) NOT NULL, -- 'exhibition', 'regular_season', 'playoff'
      series_home_user_id INTEGER REFERENCES public.users(user_id),
      series_away_user_id INTEGER REFERENCES public.users(user_id),
      home_wins INTEGER DEFAULT 0,
      away_wins INTEGER DEFAULT 0,
      status VARCHAR(50) DEFAULT 'in_progress', -- 'in_progress', 'completed'
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 2. Add columns to the 'games' table
  pgm.sql(`
    ALTER TABLE public.games
      ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES public.series(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS game_in_series INTEGER;
  `);
};

exports.down = pgm => {
  // 1. Remove columns from the 'games' table
  pgm.sql(`
    ALTER TABLE public.games
      DROP COLUMN IF EXISTS series_id,
      DROP COLUMN IF EXISTS game_in_series;
  `);

  // 2. Drop the 'series' table
  pgm.sql(`
    DROP TABLE IF EXISTS public.series;
  `);
};