/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.addColumn('games', {
        committed_player_ids: {
            type: 'jsonb',
            notNull: true,
            default: '[]'
        }
    });
};

exports.down = pgm => {
    pgm.dropColumn('games', 'committed_player_ids');
};
