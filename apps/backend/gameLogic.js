const getSpeedValue = (runner) => {
  // Pitchers always have C/10 speed
  if (runner.control !== null && typeof runner.control !== 'undefined') {
    return 10;
  }
  const speed = runner.speed;
  if (speed === 'A') return 20;
  if (speed === 'B') return 15;
  if (speed === 'C') return 10;
  return speed; // Assume it's already a number if not A/B/C
};

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function applyOutcome(state, outcome, batter, pitcher, infieldDefense = 0, outfieldDefense = 0) {
  const newState = JSON.parse(JSON.stringify(state));
  const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
  const events = [];

  const runnerData = {
    ...batter,
    pitcherOfRecordId: pitcher.card_id
  };

  const scoreRun = (runnerOnBase) => {
    if (!runnerOnBase) return;
    newState[scoreKey]++;
    events.push(`${runnerOnBase.name} scores!`);
    const pitcherId = runnerOnBase.pitcherOfRecordId;
    if (newState.pitcherStats[pitcherId]) {
      newState.pitcherStats[pitcherId].runs++;
    } else {
      newState.pitcherStats[pitcherId] = { ip: 0, runs: 1 };
    }
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
    if (state.infieldIn && newState.outs < 2 && newState.bases.third) {
        events.push(`${batter.displayName} hits a ground ball with the infield in...`);
        newState.currentPlay = { type: 'INFIELD_IN_PLAY', payload: { runner: newState.bases.third, batter: runnerData } };
    }
    else if (newState.outs <= 1 && newState.bases.first) {
        newState.awaitingDoublePlayRoll = true;
    } else {
        events.push(`${batter.displayName} grounds out.`);
        newState.outs++;
        if (newState.outs < 3 && !state.infieldIn) {
            if (newState.bases.third) { scoreRun(newState.bases.third); }
            if (newState.bases.second) { newState.bases.third = newState.bases.second; }
            newState.bases.second = null;
        }
    }
  }
  else if (outcome.includes('FB')) {
    newState.outs++;
    const initialEvent = `${batter.displayName} flies out.`;
    if (newState.outs < 3 && (state.bases.first || state.bases.second || state.bases.third)) {
        const decisions = [
            { runner: state.bases.third, from: 3 },
            { runner: state.bases.second, from: 2 },
            { runner: state.bases.first, from: 1 },
        ].filter(d => d.runner);

        let allDecisionsAutomatic = decisions.length > 0;
        const automaticOutcomes = [];

        if (allDecisionsAutomatic) {
            for (const decision of decisions) {
                const { runner, from } = decision;
                const toBase = from + 1;
                const runnerSpeed = getSpeedValue(runner);

                let effectiveSpeed = runnerSpeed;
                if (toBase === 4) effectiveSpeed += 5; // going home
                if (toBase === 2) effectiveSpeed -= 5; // going to 2nd on tag

                // Per user, use >= for auto-advance.
                const isAutoAdvance = effectiveSpeed >= (outfieldDefense + 20);
                const isAutoHold = (runnerSpeed === 10 && (toBase === 2 || toBase === 3)) || (runnerSpeed === 15 && toBase === 2);

                if (isAutoAdvance) {
                    automaticOutcomes.push({ ...decision, advance: true });
                } else if (isAutoHold) {
                    automaticOutcomes.push({ ...decision, advance: false });
                } else {
                    allDecisionsAutomatic = false;
                    break;
                }
            }
        }

        if (allDecisionsAutomatic) {
            for (const outcome of automaticOutcomes) {
                if (outcome.advance) {
                    const toBase = outcome.from + 1;
                    const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
                    if (toBase === 4) {
                        scoreRun(outcome.runner);
                        events.push(`${outcome.runner.name} tags up and scores without a throw.`);
                    } else {
                        newState.bases[baseMap[toBase]] = outcome.runner;
                        events.push(`${outcome.runner.name} tags up and advances without a throw.`);
                    }
                    newState.bases[baseMap[outcome.from]] = null;
                } else {
                    events.push(`${outcome.runner.name} holds.`);
                }
            }
        } else {
            newState.currentPlay = { type: 'TAG_UP', payload: { decisions, initialEvent } };
        }
    } else {
        events.push(initialEvent);
    }
  }
  else if (outcome === 'SINGLE' || outcome === '1B' || outcome === '1B+') {
      const initialEvent = `${batter.displayName} hits a SINGLE!`;

      const runnerFrom3 = state.bases.third;
      const runnerFrom2 = state.bases.second;
      const runnerFrom1 = state.bases.first;

      if (runnerFrom3) {
          scoreRun(runnerFrom3);
      }

      const potentialDecisions = [
        { runner: runnerFrom2, from: 2 }, // try for home
        { runner: runnerFrom1, from: 1 },  // try for third
      ].filter(d => d.runner);

      let allDecisionsAutomatic = potentialDecisions.length > 0;
      const automaticOutcomes = [];

      if (allDecisionsAutomatic) {
          for (const decision of potentialDecisions) {
              const { runner, from } = decision;
              const toBase = from + 2; // trying for the extra base
              const runnerSpeed = getSpeedValue(runner);

              let effectiveSpeed = runnerSpeed;
              if (toBase === 4) effectiveSpeed += 5; // going home
              if (newState.outs === 2) effectiveSpeed += 5;

              const isAutoAdvance = effectiveSpeed >= (outfieldDefense + 20);
              // With less than 2 outs, a runner with 10 speed will always be held.
              // A runner with 15 speed will be held if they are trying for 3rd.
              const isAutoHold = runnerSpeed === 10 && toBase === 3;

              if (isAutoAdvance) {
                  automaticOutcomes.push({ ...decision, advance: true });
              } else if (isAutoHold) {
                  automaticOutcomes.push({ ...decision, advance: false });
              } else {
                  allDecisionsAutomatic = false;
                  break;
              }
          }
      }

      // Clear all bases, then rebuild based on decisions
      newState.bases = { first: null, second: null, third: null };

      if (allDecisionsAutomatic) {
          events.push(initialEvent);
          let baseAheadIsOccupied = false;

          // Process lead runner (from 2nd) first
          const decisionR2 = automaticOutcomes.find(d => d.from === 2);
          if (decisionR2) {
              if (decisionR2.advance) {
                  scoreRun(runnerFrom2);
                  events.push(`${runnerFrom2.name} scores from second without a throw!`);
                  baseAheadIsOccupied = false;
              } else {
                  newState.bases.third = runnerFrom2;
                  events.push(`${runnerFrom2.name} holds at third.`);
                  baseAheadIsOccupied = true;
              }
          } else if (runnerFrom2) {
              newState.bases.third = runnerFrom2; // Default move
              baseAheadIsOccupied = true;
          }

          // Process trail runner (from 1st)
          const decisionR1 = automaticOutcomes.find(d => d.from === 1);
          if (decisionR1) {
              if (decisionR1.advance && !baseAheadIsOccupied) {
                  newState.bases.third = runnerFrom1;
                  events.push(`${runnerFrom1.name} takes third without a throw!`);
              } else {
                  if(decisionR1.advance && baseAheadIsOccupied) {
                      events.push(`${runnerFrom1.name} holds at second.`);
                  } else {
                      events.push(`${runnerFrom1.name} holds at second.`);
                  }
                  newState.bases.second = runnerFrom1;
              }
          } else if (runnerFrom1) {
              newState.bases.second = runnerFrom1; // Default move
          }

          newState.bases.first = runnerData;
      } else {
          // Not automatic, so do standard advancement and ask user
          if (runnerFrom2) { newState.bases.third = runnerFrom2; }
          if (runnerFrom1) { newState.bases.second = runnerFrom1; }
          newState.bases.first = runnerData;
          if (potentialDecisions.length > 0) {
              newState.currentPlay = { type: 'ADVANCE', payload: { decisions: potentialDecisions, hitType: '1B', initialEvent } };
          } else {
              events.push(initialEvent);
          }
      }

      // Handle 1B+ for the batter
      if (outcome === '1B+' && !newState.bases.second) {
          newState.bases.second = newState.bases.first;
          newState.bases.first = null;
          events.push(`${batter.displayName} takes second on the throw!`);
      }
  }
  else if (outcome === '2B') {
      const initialEvent = `${batter.displayName} hits a DOUBLE!`;

      if (state.bases.third) { scoreRun(state.bases.third); }
      if (state.bases.second) { scoreRun(state.bases.second); }
      newState.bases.third = null;
      newState.bases.second = null;

      const runnerFrom1 = state.bases.first;
      const potentialDecisions = runnerFrom1 ? [{ runner: runnerFrom1, from: 1 }] : [];

      let isAutomatic = false;
      let autoAdvance = false;

      if (potentialDecisions.length > 0) {
          const decision = potentialDecisions[0];
          const toBase = 4; // trying for home
          const runnerSpeed = getSpeedValue(decision.runner);

          let effectiveSpeed = runnerSpeed;
          effectiveSpeed += 5; // going home
          if (newState.outs === 2) effectiveSpeed += 5;

          if (effectiveSpeed >= (outfieldDefense + 20)) {
              isAutomatic = true;
              autoAdvance = true;
          }
      }

      if (isAutomatic) {
          events.push(initialEvent);
          if (autoAdvance) {
              scoreRun(runnerFrom1);
              events.push(`${runnerFrom1.name} scores from first without a throw!`);
          }
          newState.bases.first = null;
      } else {
          if (runnerFrom1) {
              newState.bases.third = runnerFrom1;
              newState.currentPlay = { type: 'ADVANCE', payload: { decisions: potentialDecisions, hitType: '2B', initialEvent } };
          } else {
              events.push(initialEvent);
          }
          newState.bases.first = null;
      }

      newState.bases.second = runnerData;
  }
  else if (outcome === 'IBB') {
    events.push(`${batter.displayName} is intentionally walked.`);
    if (newState.bases.first && newState.bases.second && newState.bases.third) { scoreRun(newState.bases.third); }
    if (newState.bases.first && newState.bases.second) { newState.bases.third = newState.bases.second; }
    if (newState.bases.first) { newState.bases.second = newState.bases.first; }
    newState.bases.first = runnerData;
  }
  else if (outcome === 'BB') {
    events.push(`${batter.displayName} walks.`);
    if (newState.bases.first && newState.bases.second && newState.bases.third) { scoreRun(newState.bases.third); }
    if (newState.bases.first && newState.bases.second) { newState.bases.third = newState.bases.second; }
    if (newState.bases.first) { newState.bases.second = newState.bases.first; }
    newState.bases.first = runnerData;
  }
  else if (outcome === '3B') {
    events.push(`${batter.displayName} hits a TRIPLE!`);
    if (newState.bases.third) { scoreRun(newState.bases.third); }
    if (newState.bases.second) { scoreRun(newState.bases.second); }
    if (newState.bases.first) { scoreRun(newState.bases.first); }
    newState.bases.third = runnerData;
    newState.bases.second = null;
    newState.bases.first = null;
  }
  else if (outcome === 'HR') {
    events.push(`${batter.displayName} hits a HOME RUN!`);
    if (newState.bases.third) { scoreRun(newState.bases.third); }
    if (newState.bases.second) { scoreRun(newState.bases.second); }
    if (newState.bases.first) { scoreRun(newState.bases.first); }
    scoreRun(runnerData);
    newState.bases = { first: null, second: null, third: null };
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
  if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
    newState.gameOver = true;
    newState.winningTeam = 'home';
    events.push(`HOME TEAM WINS! WALK-OFF!`);
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
      // It's just an inning change, not the end of the game
      newState.inningChanged = true; // Signal to the server
      const wasTop = newState.isTopInning;
      
      if (newState.isTopInning) { // Away team finished batting
      newState.isBetweenHalfInningsAway = true;
    } else { // Home team finished batting
      newState.isBetweenHalfInningsHome = true;
    }
    newState.isTopInning = !newState.isTopInning;
    if (newState.isTopInning) newState.inning++;
    newState.outs = 0;
    newState.bases = { first: null, second: null, third: null };
    // The inning change event itself is now created in server.js
    }
  }
  
  return { newState, events };
}

function resolveThrow(state, throwTo, outfieldDefense) {
  let newState = JSON.parse(JSON.stringify(state));
  const { type } = newState.currentPlay;
  const events = [];
  const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
  const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';

  const fromBaseOfThrow = throwTo - 1;
  const runnerToChallenge = newState.bases[baseMap[fromBaseOfThrow]];

  if (runnerToChallenge) {
    const d20Roll = Math.floor(Math.random() * 20) + 1;
    let speed = getSpeedValue(runnerToChallenge);
    let defenseRoll = outfieldDefense + d20Roll;

    if (type === 'ADVANCE') {
      if (throwTo === 4) speed += 5;
      if (newState.outs === 2) speed += 5;
    } else if (type === 'TAG_UP') {
      if (throwTo === 4) speed += 5;
      if (throwTo === 2) speed -= 5;
    }

    const isSafe = type === 'ADVANCE' ? speed >= defenseRoll : speed > defenseRoll;

    newState.throwRollResult = {
        roll: d20Roll,
        defense: outfieldDefense,
        target: speed,
        outcome: isSafe ? 'SAFE' : 'OUT',
        runner: runnerToChallenge.name,
        throwToBase: throwTo
    };

    if (isSafe) {
      if (throwTo === 4) {
        newState[scoreKey]++;
        events.push(`${runnerToChallenge.name} is SAFE at home!`);
      } else {
        newState.bases[baseMap[throwTo]] = runnerToChallenge;
        events.push(`${runnerToChallenge.name} is SAFE at ${getOrdinal(throwTo)}!`);
      }
      newState.bases[baseMap[fromBaseOfThrow]] = null;
    } else {
      newState.outs++;
      newState.bases[baseMap[fromBaseOfThrow]] = null;
      // Return a fragment now, not a full event
      events.push(`${runnerToChallenge.name} is THROWN OUT at ${getOrdinal(throwTo)}!`);
    }
  }

  return { newState, events };
}

module.exports = { applyOutcome, resolveThrow };