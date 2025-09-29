/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE "game_states"
      ADD COLUMN IF NOT EXISTS "is_between_half_innings_home" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "is_between_half_innings_away" BOOLEAN DEFAULT false;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    ALTER TABLE "game_states"
      DROP COLUMN IF EXISTS "is_between_half_innings_home",
      DROP COLUMN IF EXISTS "is_between_half_innings_away";
  `);
};