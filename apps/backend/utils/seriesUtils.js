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

module.exports = { resolveSeriesResultUpdate, seriesTypeForRound };
