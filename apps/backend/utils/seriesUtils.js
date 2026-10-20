// Maps a live in-app series' running game-win totals back onto the scheduled series_results row it
// fulfills (series.series_result_id -> series_results.id). Pure so it can be unit-tested without a DB;
// server.js does the actual UPDATE from the returned fields.
//
// A scheduled row has a FIXED orientation from generateSchedule(): the home team sits in the
// "winning_*" slot and the away team in the "losing_*" slot — that's just the schedule's layout, not a
// claim about who won. While a series is in progress we keep that orientation and only fill the scores
// (so standings, which score a row symmetrically, stay correct). When the series ends we normalize so
// the actual winner lands in the winning_* slot, matching how every other completed row is stored and
// how the League page renders "4-3" style results.
function resolveSeriesResultUpdate(scheduledRow, live) {
    const slotAId = scheduledRow.winning_team_id;
    const slotAName = scheduledRow.winning_team_name;
    const slotBId = scheduledRow.losing_team_id;
    const slotBName = scheduledRow.losing_team_name;

    const { homeTeamId, awayTeamId, homeGames, awayGames, isOver } = live;

    // Which schedule slot is which live team? Slot A holds the away team only if its id matches;
    // otherwise it holds the home team (the normal case, and a safe default if an id ever drifts).
    const slotAIsAway = slotAId === awayTeamId && slotAId !== homeTeamId;
    const slotAGames = slotAIsAway ? awayGames : homeGames;
    const slotBGames = slotAIsAway ? homeGames : awayGames;

    if (!isOver) {
        // Keep the schedule's orientation; just record the partial tally.
        return {
            status: 'in_progress',
            result_source: 'in_app',
            winning_team_id: slotAId,
            winning_team_name: slotAName,
            winning_score: slotAGames,
            losing_team_id: slotBId,
            losing_team_name: slotBName,
            losing_score: slotBGames,
        };
    }

    // Series over: normalize so the winner is in the winning_* slot. On a tie (only reachable via an
    // early stop at an even score) we leave slot A as the nominal winner; standings score it
    // symmetrically so the label doesn't affect records.
    const aWon = slotAGames >= slotBGames;
    return {
        status: 'completed',
        result_source: 'in_app',
        winning_team_id: aWon ? slotAId : slotBId,
        winning_team_name: aWon ? slotAName : slotBName,
        winning_score: aWon ? slotAGames : slotBGames,
        losing_team_id: aWon ? slotBId : slotAId,
        losing_team_name: aWon ? slotBName : slotAName,
        losing_score: aWon ? slotBGames : slotAGames,
    };
}

// The live-series `series_type` a scheduled series_results row should be played as, derived from its
// round (and Classic style). Regular-season rounds play all 7 games; the postseason rounds are
// best-of-7. Anything unrecognized defaults to a regular-season series.
function seriesTypeForRound(round, style) {
    if (style === 'Classic') return 'classic';
    switch (round) {
        case 'Golden Spaceship': return 'golden_spaceship';
        case 'Wooden Spoon': return 'wooden_spoon';
        case 'Silver Submarine':
        case 'Semifinal':
        case 'Semi-Final':
        case 'Play-In':
            return 'playoff';
        default:
            return 'regular_season';
    }
}

// Every point of series fatigue comes off a reliever's IP for the next game: a 2-IP reliever
// who threw 1 inning yesterday starts today at 1 IP (his buffer inning burned); after 2 innings
// he starts at 0 IP, tired from his first pitch.
function relieverCarryoverPenalty(score) {
    return Math.max(0, score);
}

// How game 1 of a series picks its home team: regular-season series always roll for it; seeded
// series (Spaceship, Spoon, Classic) give it to the higher seed; anything else (exhibitions, legacy
// playoff series) lets the players declare or roll.
function homeFieldRule(seriesType) {
    if (seriesType === 'regular_season') return 'roll';
    if (['golden_spaceship', 'wooden_spoon', 'classic'].includes(seriesType)) return 'seed';
    return 'choose';
}

// Classic seeding is ordered 5th → 1st (seed = 5 - index), so the higher seed is the later entry.
// Returns null unless both users are seeded.
function higherClassicSeedUserId(seeding, userIdA, userIdB) {
    const idx = (uid) => (seeding || []).findIndex(s => Number(s.user_id) === Number(uid));
    const a = idx(userIdA);
    const b = idx(userIdB);
    if (a === -1 || b === -1 || a === b) return null;
    return a > b ? userIdA : userIdB;
}

module.exports = { resolveSeriesResultUpdate, seriesTypeForRound, relieverCarryoverPenalty, homeFieldRule, higherClassicSeedUserId };
