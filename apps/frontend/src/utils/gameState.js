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
  const amIReadyForNext = isHome ? gameState.homePlayerReadyForNext : gameState.awayPlayerReadyForNext;

  // If the opponent is ahead and we are not, we use currentAtBat
  // because currentAtBat represents the exact state that we are trying to
  // catch up to (it holds the bases/scores *after* the previous play but
  // *before* the new play).
  // If BOTH players are synced, we also use currentAtBat, but if a mid-inning
  // outcome is hidden, we want to roll back to the state *before* the play.
  if (opponentReadyForNext && !amIReadyForNext) {
      rollbackSource = gameState.currentAtBat;
  } else if (opponentReadyForNext && !gameState.pendingStealAttempt) {
      // In the rare edge case both players are flagged ready but haven't advanced the server state?
      // Actually, if both are ready, the server would have advanced the state immediately.
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
