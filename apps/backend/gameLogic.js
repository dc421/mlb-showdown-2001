function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}


function applyOutcome(state, outcome, batter, pitcher, infieldDefense = 0, outfieldDefense = 0, getSpeedValue, swingRoll = 0, chartHolder = null) {
  const newState = JSON.parse(JSON.stringify(state));
  const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
  const events = [];
  const scorers = [];
  const originalAwayScore = state.awayScore;
  const originalHomeScore = state.homeScore;
  let hitMessage = '';

  // --- Handle Highest GB Rule ---
  if (outcome.includes('GB') && state.currentAtBat.infieldIn && chartHolder && swingRoll > 0) {
      let highestGB = -1;
      for (const range in chartHolder.chart_data) {
          const chartOutcome = chartHolder.chart_data[range];
          if (chartOutcome === 'GB' || chartOutcome === 'GB?') { // Include GB? just in case
              const [min, max] = range.split('-').map(Number);
              if (max > highestGB) {
                  highestGB = max;
              }
          }
      }
      if (swingRoll === highestGB) {
          outcome = '1B'; // Convert the outcome to a single
          hitMessage = `${batter.displayName} finds a hole through the drawn-in infield for a SINGLE!`;
      }
  }


  const runnerData = {
    ...batter,
    pitcherOfRecordId: pitcher.card_id
  };

  const scoreRun = (runnerOnBase, generateLog = true) => {
    if (!runnerOnBase) return null;
    newState[scoreKey]++;
    scorers.push(runnerOnBase.name);

    // --- Walk-off Win Check ---
    if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
        if (!newState.gameOver) {
            newState.gameOver = true;
            newState.winningTeam = 'home';
        }
    }

    const pitcherId = runnerOnBase.pitcherOfRecordId;
    if (newState.pitcherStats[pitcherId]) {
      newState.pitcherStats[pitcherId].runs++;
    } else {
      newState.pitcherStats[pitcherId] = { ip: 0, runs: 1 };
    }

    if (generateLog) {
        return `${runnerOnBase.name} scores!`;
    }
    return null;
  };
  
  // --- HANDLE OUTCOMES ---
  if (outcome === 'BUNT') {
    const { first, second, third } = state.bases;
    // Bases Loaded: Fielder's choice, out at home.
    if (first && second && third) {
      events.push(`${batter.displayName} bunts into a fielder's choice, the runner from third is out at home.`);
      newState.outs++;
      if (newState.outs < 3) {
        newState.bases.third = second;
        newState.bases.second = first;
        newState.bases.first = runnerData;
      }
    }
    // Runner on 3rd (and maybe 2nd): Runners hold.
    else if (third && second && !first) {
      events.push(`${batter.displayName} lays down a bunt, but the runners hold.`);
      newState.outs++;
      newState.bases.first = null; // Batter is out
    }
    // Runner on 3rd (and maybe 1st): Runner on 3rd holds.
    else if (third && first && !second) {
      events.push(`${batter.displayName} lays down a sacrifice bunt. The runner on first advances.`);
      newState.outs++;
      if (newState.outs < 3) {
        newState.bases.second = first;
        newState.bases.first = null; // Batter is out
      }
    }
    // Runner on 3rd only: Runner holds.
    else if (third && !first && !second) {
      events.push(`${batter.displayName} lays down a bunt, but the runner on third holds.`);
      newState.outs++;
      newState.bases.first = null; // Batter is out
    }
    // Standard sacrifice bunt cases
    else {
      events.push(`${batter.displayName} lays down a sacrifice bunt.`);
      newState.outs++;
      if (newState.outs < 3) {
        // Note: scoreRun is not possible here based on preceding logic
        if (second) { newState.bases.third = second; }
        if (first) { newState.bases.second = first; }
        newState.bases.first = null; // Batter is out
      }
    }
  }
  else if (outcome.includes('GB')) {
    const { first, second, third } = newState.bases;

    // --- NEW: Infield In Logic ---
    if (newState.currentAtBat.infieldIn && third) {
        // Case 1: Bases Loaded
        if (first && second && third) {
            events.push(`${batter.displayName} hits a grounder to the drawn-in infield. The throw comes home...`);
            events.push(`The runner from third is out at the plate!`);
            newState.outs++;
            if (newState.outs < 3) {
                newState.bases.third = second;
                newState.bases.second = first;
                newState.bases.first = runnerData;
            } else {
                newState.bases = { first: null, second: null, third: null };
            }
        }
        // Case 2: Any other situation with a runner on third.
        else {
            newState.currentPlay = {
                type: 'INFIELD_IN_CHOICE',
                payload: {
                    batter: runnerData,
                    runnerOnThird: third,
                    runnerOnSecond: second,
                    runnerOnFirst: first
                }
            };
        }
    }
    // --- End Infield In Logic ---
    else if (newState.outs <= 1 && newState.bases.first) {
        const dpRoll = Math.floor(Math.random() * 20) + 1;
        const batterSpeed = parseInt(getSpeedValue(batter), 10);
        const isDoublePlay = (infieldDefense + dpRoll) > batterSpeed;
        const dpOutcome = isDoublePlay ? 'DOUBLE_PLAY' : 'FIELDERS_CHOICE';

        let playResultDescription = '';
        if (isDoublePlay) {
          playResultDescription = `It's a DOUBLE PLAY!`;
          newState.outs += 2;
          if (newState.outs < 3 && !state.infieldIn) {
            if (newState.bases.third) { scoreRun(newState.bases.third); newState.bases.third = null; } // Score doesn't need to be logged here, server handles it
            if (newState.bases.second) { newState.bases.third = newState.bases.second; newState.bases.second = null;}
          }
          newState.bases.first = null; // Runner from first is out
        } else {
          playResultDescription = `Batter is SAFE, out at second. Fielder's choice.`;
          newState.outs++;
          if (newState.outs < 3 && !state.infieldIn) {
            if (newState.bases.third) { scoreRun(newState.bases.third); newState.bases.third = null; } // Score doesn't need to be logged here, server handles it
            if (newState.bases.second) { newState.bases.third = newState.bases.second; newState.bases.second = null;}
          }
          newState.bases.first = runnerData; // Batter is safe at first
        }
        // Suppress the initial event for DPs, as the server will create a consolidated one.
        // events.push(`${batter.displayName} hits a ground ball... ${playResultDescription}`);

        newState.doublePlayDetails = {
          roll: dpRoll,
          defense: infieldDefense,
          target: batterSpeed,
          outcome: dpOutcome
        };

    } else {
        let groundOutEvent = `${batter.displayName} grounds out.`;
        newState.outs++;
        if (newState.outs < 3 && !state.infieldIn) {
            if (newState.bases.third) {
                const scoreMsg = scoreRun(newState.bases.third);
                if (scoreMsg) groundOutEvent += ` ${scoreMsg}`;
                newState.bases.third = null;
            }
            if (newState.bases.second) { newState.bases.third = newState.bases.second; newState.bases.second = null;}
        }
        events.push(groundOutEvent);
    }
  }
  else if (outcome.includes('FB')) {
    newState.outs++;
    const initialEvent = `${batter.displayName} flies out.`;
    if (newState.outs < 3 && (state.bases.first || state.bases.second || state.bases.third)) {
        const potentialDecisions = [
            { runner: state.bases.third, from: 3 },
            { runner: state.bases.second, from: 2 },
            { runner: state.bases.first, from: 1 },
        ].filter(d => d.runner);

        let processedDecisions = potentialDecisions.map(decision => {
            const { runner, from } = decision;
            const toBase = from + 1;
            const runnerSpeed = parseInt(getSpeedValue(runner), 10);

            let effectiveSpeed = runnerSpeed;
            if (toBase === 4) effectiveSpeed += 5; // going home
            if (toBase === 2) effectiveSpeed -= 5; // going to 2nd on tag

            const isAutoAdvance = effectiveSpeed >= (outfieldDefense + 20);
            const isAutoHold = (runnerSpeed === 10 && (toBase === 2 || toBase === 3)) || (runnerSpeed === 15 && toBase === 2);

            if (isAutoAdvance) return { ...decision, type: 'auto_advance' };
            if (isAutoHold) return { ...decision, type: 'auto_hold' };
            return { ...decision, type: 'manual' };
        });

        const hasManualDecision = processedDecisions.some(d => d.type === 'manual');

        if (hasManualDecision) {
            processedDecisions = processedDecisions.map(d =>
                d.type === 'auto_hold' ? { ...d, type: 'manual' } : d
            );
        }

        const manualDecisions = processedDecisions.filter(d => d.type === 'manual');
        const autoAdvanceDecisions = processedDecisions.filter(d => d.type === 'auto_advance');
        const autoHoldDecisions = processedDecisions.filter(d => d.type === 'auto_hold');

        let combinedEvent = initialEvent;
        const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

        // Process automatic advances first
        for (const decision of autoAdvanceDecisions) {
            const toBase = decision.from + 1;
            if (toBase === 4) {
                scoreRun(decision.runner, false);
                combinedEvent += ` ${decision.runner.name} tags up and scores without a throw.`;
            } else {
                newState.bases[baseMap[toBase]] = decision.runner;
                combinedEvent += ` ${decision.runner.name} tags up and advances without a throw.`;
            }
            newState.bases[baseMap[decision.from]] = null;
        }

        // If there are manual decisions, create a play
        if (manualDecisions.length > 0) {
            newState.currentPlay = { type: 'TAG_UP', payload: { decisions: manualDecisions, autoHoldDecisions, initialEvent: combinedEvent } };
        } else {
            // Otherwise, process auto-holds and finalize the event
            events.push(combinedEvent);
        }
    } else {
        events.push(initialEvent);
    }
  }
  else if (outcome === 'SINGLE' || outcome === '1B' || outcome === '1B+') {
      let combinedEvent = hitMessage || `${batter.displayName} hits a SINGLE!`;

      const runnerFrom3 = state.bases.third;
      const runnerFrom2 = state.bases.second;
      const runnerFrom1 = state.bases.first;

      if (runnerFrom3) {
          scoreRun(runnerFrom3, false);
          combinedEvent += ` ${runnerFrom3.name} scores!`;
      }

      const potentialDecisions = [
        { runner: runnerFrom2, from: 2 }, // try for home
        { runner: runnerFrom1, from: 1 },  // try for third
      ].filter(d => d.runner);

      const processedDecisions = potentialDecisions.map(decision => {
          const { runner, from } = decision;
          const toBase = from + 2;
          const runnerSpeed = parseInt(getSpeedValue(runner), 10);

          let effectiveSpeed = runnerSpeed;
          if (toBase === 4) effectiveSpeed += 5; // going home
          if (newState.outs === 2) effectiveSpeed += 5;

          const isAutoAdvance = effectiveSpeed >= (outfieldDefense + 20);
          const isAutoHold = runnerSpeed === 10 && toBase === 3 && outcome !== '1B+';

          if (isAutoAdvance) return { ...decision, type: 'auto_advance' };
          if (isAutoHold) return { ...decision, type: 'auto_hold' };
          return { ...decision, type: 'manual' };
      });

      const manualDecisions = processedDecisions.filter(d => d.type === 'manual');
      const autoHoldDecisions = processedDecisions.filter(d => d.type === 'auto_hold');

      // --- State Update ---
      newState.bases = { first: null, second: null, third: null };

      if (manualDecisions.length > 0) {
          // --- SCENARIO 1: User decision is required ---
          const allUserDecisions = manualDecisions.concat(autoHoldDecisions.map(d => ({ ...d, type: 'manual' })));

          // Optimistic state update: runners advance one base
          if (runnerFrom2) newState.bases.third = runnerFrom2;
          if (runnerFrom1) newState.bases.second = runnerFrom1;

          // Handle auto-advances that happen before the manual decision
          const runnerFrom2Decision = processedDecisions.find(d => d.from === 2 && d.type === 'auto_advance');
          if (runnerFrom2Decision) {
              scoreRun(runnerFrom2, false);
              combinedEvent += ` ${runnerFrom2.name} scores from second without a throw.`;
              newState.bases.third = null; // He's not on third anymore
          }

          newState.bases.first = runnerData;
          newState.currentPlay = { type: 'ADVANCE', payload: { decisions: allUserDecisions, hitType: '1B', initialEvent: combinedEvent, scorers } };

      } else {
          // --- SCENARIO 2: All runner movement is automatic ---
          let baseAheadIsOccupied = false;

          // Process lead runner (from 2nd)
          const decisionR2 = processedDecisions.find(d => d.from === 2);
          if (decisionR2 && decisionR2.type === 'auto_advance') {
              scoreRun(runnerFrom2, false);
              combinedEvent += ` ${runnerFrom2.name} scores from second without a throw.`;
          } else if (runnerFrom2) { // Auto-advance one base
              newState.bases.third = runnerFrom2;
              baseAheadIsOccupied = true;
          }

          // Process trail runner (from 1st)
          const decisionR1 = processedDecisions.find(d => d.from === 1);
          if (decisionR1) {
              if (decisionR1.type === 'auto_advance' && !baseAheadIsOccupied) {
                  newState.bases.third = runnerFrom1;
                  combinedEvent += ` ${runnerFrom1.name} takes third without a throw.`;
              } else { // This covers auto_hold
                  newState.bases.second = runnerFrom1;
                  if (decisionR1.type === 'auto_hold') {
                    combinedEvent += ` ${runnerFrom1.name} holds at second.`;
                  }
              }
          } else if (runnerFrom1) { // Auto-advance one base
              newState.bases.second = runnerFrom1;
          }

          newState.bases.first = runnerData;

          if (outcome === '1B+' && !newState.bases.second) {
              newState.bases.second = newState.bases.first;
              newState.bases.first = null;
              combinedEvent += ` ${batter.displayName} steals second without a throw.`;
          }

          events.push(combinedEvent);
      }
  }
  else if (outcome === '2B') {
      let combinedEvent = `${batter.displayName} hits a DOUBLE!`;

      if (state.bases.third) {
        const runner = state.bases.third;
        const scoreMsg = scoreRun(runner);
        if (scoreMsg) combinedEvent += ` ${scoreMsg}`;
      }
      if (state.bases.second) {
        const runner = state.bases.second;
        const scoreMsg = scoreRun(runner);
        if (scoreMsg) combinedEvent += ` ${scoreMsg}`;
      }
      newState.bases.third = null;
      newState.bases.second = null;

      const runnerFrom1 = state.bases.first;
      newState.bases.first = null; // Clear first base now

      const potentialDecisions = runnerFrom1 ? [{ runner: runnerFrom1, from: 1 }] : [];

      let isAutomatic = false;
      let autoAdvance = false;
      let autoHold = false;

      if (potentialDecisions.length > 0) {
          const decision = potentialDecisions[0];
          const runnerSpeed = parseInt(getSpeedValue(decision.runner), 10);
          let effectiveSpeed = runnerSpeed;
          effectiveSpeed += 5; // bonus for going home on a double
          if (newState.outs === 2) effectiveSpeed += 5;

          if (effectiveSpeed >= (outfieldDefense + 20)) {
              isAutomatic = true;
              autoAdvance = true;
          }
      }

      if (isAutomatic) {
          if (autoAdvance) {
              scoreRun(runnerFrom1, false);
              combinedEvent += ` ${runnerFrom1.name} scores from first without a throw!`;
          }
          events.push(combinedEvent);
          newState.bases.second = runnerData; // Batter placed on second since play is resolved
      } else {
          // THIS IS THE FIX. Place the batter on second base *before* creating the
          // ADVANCE play. This ensures the frontend has the correct state.
          newState.bases.second = runnerData;
          if (runnerFrom1) {
              newState.bases.third = runnerFrom1;
              newState.currentPlay = { type: 'ADVANCE', payload: { decisions: potentialDecisions, hitType: '2B', initialEvent: combinedEvent, batter: runnerData, scorers } };
          } else {
              events.push(combinedEvent);
          }
      }
  }
  else if (outcome === 'IBB') {
    let walkEvent = `${batter.displayName} is intentionally walked.`;
    if (newState.bases.first && newState.bases.second && newState.bases.third) {
        const scoreMsg = scoreRun(newState.bases.third);
        if (scoreMsg) walkEvent += ` ${scoreMsg}`;
    }
    if (newState.bases.first && newState.bases.second) { newState.bases.third = newState.bases.second; }
    if (newState.bases.first) { newState.bases.second = newState.bases.first; }
    newState.bases.first = runnerData;
    events.push(walkEvent);
  }
  else if (outcome === 'BB') {
    let walkEvent = `${batter.displayName} walks.`;
    if (newState.bases.first && newState.bases.second && newState.bases.third) {
        const scoreMsg = scoreRun(newState.bases.third);
        if (scoreMsg) walkEvent += ` ${scoreMsg}`;
    }
    if (newState.bases.first && newState.bases.second) { newState.bases.third = newState.bases.second; }
    if (newState.bases.first) { newState.bases.second = newState.bases.first; }
    newState.bases.first = runnerData;
    events.push(walkEvent);
  }
  else if (outcome === '3B') {
    let combinedEvent = `${batter.displayName} hits a TRIPLE!`;
    if (newState.bases.third) {
        const runner = newState.bases.third;
        const scoreMsg = scoreRun(runner);
        if (scoreMsg) combinedEvent += ` ${scoreMsg}`;
    }
    if (newState.bases.second) {
        const runner = newState.bases.second;
        const scoreMsg = scoreRun(runner);
        if (scoreMsg) combinedEvent += ` ${scoreMsg}`;
    }
    if (newState.bases.first) {
        const runner = newState.bases.first;
        const scoreMsg = scoreRun(runner);
        if (scoreMsg) combinedEvent += ` ${scoreMsg}`;
    }
    // No runner advancement decisions on a triple, so we push the event.
    events.push(combinedEvent);
    // And place the batter directly on third.
    newState.bases.third = runnerData;
    newState.bases.second = null;
    newState.bases.first = null;
  }
  else if (outcome === 'HR') {
    let hrEvent = `${batter.displayName} hits a HOME RUN!`;
    if (newState.bases.third) {
        const scoreMsg = scoreRun(newState.bases.third);
        if (scoreMsg) hrEvent += ` ${scoreMsg}`;
    }
    if (newState.bases.second) {
        const scoreMsg = scoreRun(newState.bases.second);
        if (scoreMsg) hrEvent += ` ${scoreMsg}`;
    }
    if (newState.bases.first) {
        const scoreMsg = scoreRun(newState.bases.first);
        if (scoreMsg) hrEvent += ` ${scoreMsg}`;
    }
    scoreRun(runnerData, false); // Batter scores, but don't log it.
    newState.bases = { first: null, second: null, third: null };
    events.push(hrEvent);
  }
  else if (outcome === 'SO') {
    events.push(`${batter.displayName} strikes out.`);
    newState.outs++;
  }
  else if (outcome === 'PU') {
    events.push(`${batter.displayName} pops out.`);
    newState.outs++;
}
  else { 
    events.push(`${batter.displayName} is out.`);
    newState.outs++;
  }

  // --- Walk-off Win Check ---
  if (newState.gameOver && newState.winningTeam === 'home' && !newState.isTopInning) {
      const isWalkoffEventPresent = events.some(e => e.includes('WALK-OFF!'));
      if (!isWalkoffEventPresent) {
          events.push(`HOME TEAM WINS! WALK-OFF!`);
      }
  }

  // --- Handle Inning Change & Game Over Check ---
  if (newState.outs >= 3 && !newState.gameOver) {
    const isGameOver = (
      // Case 1: End of the 9th or later (bottom half), and it's not a tie.
      newState.inning >= 9 && !newState.isTopInning && newState.homeScore !== newState.awayScore
    ) || (
      // Case 2: End of the top of the 9th or later, and home team is already ahead.
      newState.inning >= 9 && newState.isTopInning && newState.homeScore > newState.awayScore
    );

    if (isGameOver) {
      newState.gameOver = true;
      newState.winningTeam = newState.homeScore > newState.awayScore ? 'home' : 'away';
      events.push(`That's the ballgame! Final Score: Away ${newState.awayScore}, Home ${newState.homeScore}.`);
    } else {
      // It's just an inning change, not the end of the game.
      // SET THE FLAGS, but do not advance the inning state here.
      if (newState.isTopInning) {
        newState.isBetweenHalfInningsAway = true;
      } else {
        newState.isBetweenHalfInningsHome = true;
      }
    }
  }

  return { newState, events, scorers, outcome };
}

function resolveThrow(state, throwTo, outfieldDefense, getSpeedValue, finalizeEvent, initialEvent = '') {
  let newState = JSON.parse(JSON.stringify(state));
  const { type } = newState.currentPlay;
  const events = [];
  const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
  const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';

  const fromBaseOfThrow = throwTo - 1;
  const runnerToChallenge = newState.bases[baseMap[fromBaseOfThrow]];

  if (runnerToChallenge) {
    const d20Roll = Math.floor(Math.random() * 20) + 1;
    const baseSpeed = parseInt(getSpeedValue(runnerToChallenge), 10);
    let speed = baseSpeed;
    const adjustments = [];
    let defenseRoll = outfieldDefense + d20Roll;

    if (type === 'ADVANCE') {
      if (throwTo === 4) {
        speed += 5;
        adjustments.push({ value: 5, reason: 'Going Home' });
      }
      if (newState.outs === 2) {
        speed += 5;
        adjustments.push({ value: 5, reason: '2 Outs' });
      }
    } else if (type === 'TAG_UP') {
      if (throwTo === 4) {
        speed += 5;
        adjustments.push({ value: 5, reason: 'Going Home' });
      }
      if (throwTo === 2) {
        speed -= 5;
        adjustments.push({ value: -5, reason: 'Tagging to 2nd' });
      }
    }

    const isSafe = speed >= defenseRoll;

    newState.throwRollResult = {
        roll: d20Roll,
        defense: outfieldDefense,
        target: speed,
        baseSpeed,
        adjustments,
        outcome: isSafe ? 'SAFE' : 'OUT',
        runner: runnerToChallenge.name,
        throwToBase: throwTo
    };

    let outcomeMessage = '';
    if (isSafe) {
      if (throwTo === 4) {
        newState[scoreKey]++;
        // --- Walk-off Win Check ---
        if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
            if (!newState.gameOver) {
                newState.gameOver = true;
                newState.winningTeam = 'home';
            }
        }
        outcomeMessage = `${runnerToChallenge.name} is SAFE at home!`;
      } else {
        newState.bases[baseMap[throwTo]] = runnerToChallenge;
        outcomeMessage = `${runnerToChallenge.name} is SAFE at ${getOrdinal(throwTo)}!`;
      }
      newState.bases[baseMap[fromBaseOfThrow]] = null;
    } else {
      if (throwTo === 4) {
        newState.outs++;
      newState.bases[baseMap[fromBaseOfThrow]] = null;
      outcomeMessage = `${runnerToChallenge.name} is THROWN OUT at home!`;
      } else{
      newState.outs++;
      newState.bases[baseMap[fromBaseOfThrow]] = null;
      outcomeMessage = `${runnerToChallenge.name} is THROWN OUT at ${getOrdinal(throwTo)}!`;
      }
    }

    // Consolidate the event message here
    const { scorers = [] } = newState.currentPlay.payload;
    let messageWithScore = finalizeEvent(newState, initialEvent, scorers, scoreKey);
    const finalMessage = messageWithScore ? `${messageWithScore} ${outcomeMessage}` : outcomeMessage;
    events.push(finalMessage);
  }

  return { newState, events };
}

function calculateStealResult(runner, toBase, catcherArm, getSpeedValue) {
    const d20Roll = Math.floor(Math.random() * 20) + 1;
    const defenseTotal = catcherArm + d20Roll;
    const originalRunnerSpeed = getSpeedValue(runner);
    let runnerSpeed = originalRunnerSpeed;
    let penalty = 0;

    if (toBase === 3) {
        runnerSpeed -= 5;
        penalty = 5;
    }

    const isSafe = runnerSpeed > defenseTotal;
    const outcome = isSafe ? 'SAFE' : 'OUT';

    return {
        outcome,
        roll: d20Roll,
        defense: catcherArm,
        target: originalRunnerSpeed,
        penalty,
        isSafe,
    };
}

module.exports = { applyOutcome, resolveThrow, calculateStealResult };