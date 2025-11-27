export function calculateDisplayGameState(gameState, currentUserId, isSwingResultVisible) {
  if (!gameState) return null;

  const isHome = Number(currentUserId) === Number(gameState.homeTeam.userId);
  const isAway = Number(currentUserId) === Number(gameState.awayTeam.userId);

  // If spectator, return raw state
  if (!isHome && !isAway) {
    return gameState;
  }

  // Determine if we need to hide the outcome
  const currentAtBat = gameState.currentAtBat;
  if (!currentAtBat) return gameState;

  const atBatIsResolved = !!currentAtBat.batterAction && !!currentAtBat.pitcherAction;
  const isBetweenInnings = gameState.isBetweenHalfInningsAway || gameState.isBetweenHalfInningsHome;

  // Logic to determine if opponent is ready.
  const opponentReadyForNext = isHome ? gameState.awayPlayerReadyForNext : gameState.homePlayerReadyForNext;

  // Determine if we should hide the outcome.
  // We hide if:
  // 1. At-bat is resolved (mid-inning play pending reveal)
  // 2. Opponent is ready (they advanced state, we are lagging)
  // 3. Between innings (inning ended, we are lagging)

  if (!atBatIsResolved && !opponentReadyForNext && !isBetweenInnings) return gameState;

  // If I have seen the result, show raw state.
  if (isSwingResultVisible) return gameState;

  // If I am ready, I must have seen it.
  const amIReady = isHome ? gameState.homePlayerReadyForNext : gameState.awayPlayerReadyForNext;
  if (amIReady) return gameState;

  // If we are here, we must roll back.

  let rollbackSource;
  if (isBetweenInnings || opponentReadyForNext) {
      rollbackSource = gameState.lastCompletedAtBat;
  } else {
      rollbackSource = gameState.currentAtBat;
  }

  if (rollbackSource && rollbackSource.basesBeforePlay) {
    const displayOuts = rollbackSource.outsBeforePlay;

    // Inning Rollback Logic
    let inning = gameState.inning;
    let isTopInning = gameState.isTopInning;

    if (gameState.outs === 0 && displayOuts !== 0) {
        // We advanced to a new half-inning. Roll back to previous.
        if (gameState.isTopInning) {
            // Currently Top X. Previous was Bottom X-1.
            inning = Math.max(1, gameState.inning - 1);
            isTopInning = false;
        } else {
            // Currently Bottom X. Previous was Top X.
            isTopInning = true;
            // Inning number stays same.
        }
    } else if (gameState.outs === 0 && displayOuts === 0) {
       // Ambiguous/Start of game case. Keep raw.
    }

    return {
      ...gameState,
      bases: rollbackSource.basesBeforePlay,
      outs: displayOuts,
      homeScore: rollbackSource.homeScoreBeforePlay,
      awayScore: rollbackSource.awayScoreBeforePlay,
      inning,
      isTopInning,
      // Clear flags that might spoil inning change
      isBetweenHalfInningsAway: false,
      isBetweenHalfInningsHome: false,
    };
  }

  return gameState;
}
