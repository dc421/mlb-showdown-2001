exports.up = async (pgm) => {
    // 1. Drop the existing unique constraint on (user_id, roster_type)
    // Constraint name from 20260104120000_add-roster-type.js is 'unique_roster_type_per_user'
    pgm.dropConstraint('rosters', 'unique_roster_type_per_user');

    // 2. Add a new partial unique index for 'classic' rosters
    // This ensures a user has only ONE roster per classic_id
    // But we also need to consider 'league' rosters.
    // The previous constraint ensured 1 roster per type.
    // 'league' rosters don't have a classic_id. So (user_id, roster_type) is still valid for 'league'.

    // Strategy:
    // A. Re-add unique index for non-classic rosters: (user_id, roster_type) WHERE roster_type != 'classic'
    // B. Add unique index for classic rosters: (user_id, classic_id) WHERE roster_type = 'classic'

    // Note: pgm.createIndex allows 'where' clause.

    // Index A: Non-classic uniqueness
    pgm.createIndex('rosters', ['user_id', 'roster_type'], {
        name: 'unique_roster_type_per_user_non_classic',
        unique: true,
        where: "roster_type != 'classic'"
    });

    // Index B: Classic uniqueness
    // We want unique (user_id, classic_id).
    // Note: If classic_id is NULL (which it shouldn't be for classic rosters anymore), PG treats NULLs as distinct.
    // But our logic should enforce classic_id.
    pgm.createIndex('rosters', ['user_id', 'classic_id'], {
        name: 'unique_classic_roster_per_user',
        unique: true,
        where: "roster_type = 'classic'"
    });
};

exports.down = async (pgm) => {
    // Revert to the original state: One roster per type, disregarding classic_id distinction (or lack thereof)
    pgm.dropIndex('rosters', 'unique_classic_roster_per_user');
    pgm.dropIndex('rosters', 'unique_roster_type_per_user_non_classic');

    // Restore original constraint
    pgm.addConstraint('rosters', 'unique_roster_type_per_user', {
        unique: ['user_id', 'roster_type']
    });
};
