// A substitution can be reversed until the next play commits the removed players.
// Keep the original position separate from the slot: position swaps can change the
// replacement's position while the removed player is still on the bench.
function getReturningPlayerPosition(team, playerId, requestedPosition) {
    if (!(team.transient_used_player_ids || []).includes(Number(playerId))) {
        return requestedPosition;
    }
    return team.transient_lineup_positions?.[playerId] ?? requestedPosition;
}

function isDefensivePitchingChange(isOffensiveSub, atBatPitcher, playerOutId, playerInCard, position) {
    if (isOffensiveSub) return false;
    const replacesActivePitcher = atBatPitcher != null &&
        Number(atBatPitcher.card_id) === Number(playerOutId);
    const fillsPitcherSlot = playerInCard.control !== null &&
        ['P', 'PH', 'PR'].includes(position);
    return replacesActivePitcher || fillsPitcherSlot;
}

// A defensive sub for the pitcher on the mound must bring in a card with a control rating.
function isIllegalMoundEntry(isOffensiveSub, atBatPitcher, playerOutId, playerInCard) {
    if (isOffensiveSub || atBatPitcher == null) return false;
    const replacesActivePitcher = Number(atBatPitcher.card_id) === Number(playerOutId);
    return replacesActivePitcher && (playerInCard.control === null || playerInCard.control === undefined);
}

module.exports = { getReturningPlayerPosition, isDefensivePitchingChange, isIllegalMoundEntry };
