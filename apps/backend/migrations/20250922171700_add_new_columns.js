/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE "teams"
      ADD COLUMN IF NOT EXISTS "abbreviation" varchar(10),
      ADD COLUMN IF NOT EXISTS "primary_color" varchar(7),
      ADD COLUMN IF NOT EXISTS "secondary_color" varchar(7);
  `);
  pgm.sql(`
    ALTER TABLE "cards_player"
      ADD COLUMN IF NOT EXISTS "image_url" text;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    ALTER TABLE "teams"
      DROP COLUMN IF EXISTS "abbreviation",
      DROP COLUMN IF EXISTS "primary_color",
      DROP COLUMN IF EXISTS "secondary_color";
  `);
  pgm.sql(`
    ALTER TABLE "cards_player"
      DROP COLUMN IF EXISTS "image_url";
  `);
};
