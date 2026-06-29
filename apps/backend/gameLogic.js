function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Trim a runner/batter to the fields the UI needs to render a card.
// Used for scored runners and thrown-out runners so the frontend can show
// their cards after a play without shipping the full player object.
function toRunnerCard(r) {
  if (!r) return null;
  return {
    card_id: r.card_id,
    name: r.name,
    displayName: r.displayName,
    image_url: r.image_url,
    speed: r.speed,
  };
}

function getPitcherKey(state, pitcher) {
    if (!pitcher) return null;
    if (pitcher.pitcherOfRecordId) return pitcher.pitcherOfRecordId; // For runners
    // Idempotency guard: if card_id is already a composite "ownerId_cardId" key, return it as-is
    // instead of prefixing again. Re-prefixing was the source of malformed "4_4_614" stat keys
    // (which split a pitcher's outs_recorded across two entries). Because every pitcherOfRecordId
    // is itself a getPitcherKey result, this also stops malformed keys from propagating onto runners.
    if (typeof pitcher.card_id === 'string' && pitcher.card_id.includes('_')) {
        return pitcher.card_id;
    }
    const ownerId = state.isTopInning ? state.homeTeam.userId : state.awayTeam.userId;
    return `${ownerId}_${pitcher.card_id}`;
}

function recordBatterFaced(state, pitcher) {
    if (!pitcher) return;
    const pitcherId = getPitcherKey(state, pitcher);
    if (!state.pitcherStats[pitcherId]) {
        state.pitcherStats[pitcherId] = { ip: 0, runs: 0, outs_recorded: 0, batters_faced: 0 };
    }
    if (state.pitcherStats[pitcherId].batters_faced === undefined) {
        state.pitcherStats[pitcherId].batters_faced = 0;
    }
    state.pitcherStats[pitcherId].batters_faced += 1;
}

function checkGameOverOrInningChange(newState, events, teamInfo) {
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
      const homeTeamWon = newState.homeScore > newState.awayScore;
      newState.winningTeam = homeTeamWon ? 'home' : 'away';

      const winningAbbr = homeTeamWon ? (teamInfo.home_team_abbr || 'HOME') : (teamInfo.away_team_abbr || 'AWAY');
      const winningScore = homeTeamWon ? newState.homeScore : newState.awayScore;
      const losingAbbr = homeTeamWon ? (teamInfo.away_team_abbr || 'AWAY') : (teamInfo.home_team_abbr || 'HOME');
      const losingScore = homeTeamWon ? newState.awayScore : newState.homeScore;

      events.push(`That's the ballgame! Final Score: ${winningAbbr} ${winningScore}, ${losingAbbr} ${losingScore}.`);
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
}

function applyOutcome(state, outcome, batter, pitcher, infieldDefense = 0, outfieldDefense = 0, getSpeedValue, swingRoll = 0, chartHolder = null, teamInfo = {}) {
  const newState = JSON.parse(JSON.stringify(state));
  const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';

  // Cards for every runner who scores on this play, shown at home plate until Next Hitter.
  newState.runnersScored = [];

  // Record that the pitcher faced a batter
  recordBatterFaced(newState, pitcher);

  const recordOuts = (count) => {
    recordOutsForPitcher(newState, pitcher, count);
  };
  const events = [];
  const scorers = [];
  const originalAwayScore = state.awayScore;
  const originalHomeScore = state.homeScore;
  let hitMessage = '';
  // Set when a groundball is converted to a single specifically because the infield was in.
  let infieldInSingle = false;

  const scoreRun = (runnerOnBase, generateLog = true, rbiEligible = true) => {
    if (!runnerOnBase) return null;
    newState[scoreKey]++;
    scorers.push(runnerOnBase.name);
    newState.runnersScored.push(toRunnerCard(runnerOnBase));

    // --- Walk-off Win Check ---
    if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
        if (!newState.gameOver) {
            newState.gameOver = true;
            newState.winningTeam = 'home';
        }
    }

    // Charge the run to the pitcher of record and credit R/RBI for the box score.
    // (Double plays score a run without an RBI, hence the rbiEligible flag.)
    recordRunForPitcher(newState, runnerOnBase, pitcher, { rbiEligible });

    if (generateLog) {
        return `${runnerOnBase.name} scores!`;
    }
    return null;
  };

  // --- Box score: one atBatLog entry per plate appearance. Pushed up front (before any run
  // can score) so scoreRun and deferred baserunning resolutions can attribute R/RBI to it via
  // currentAtBat.atBatIndex. The batting result is finalized from the outcome below. ---
  if (!Array.isArray(newState.atBatLog)) newState.atBatLog = [];
  const atBatEntry = {
    inning: newState.inning,
    isTopInning: newState.isTopInning,
    batterId: batter ? batter.card_id : null,
    batterTeam: newState.isTopInning ? 'away' : 'home',
    pitcherKey: getPitcherKey(newState, pitcher),
    outcome: null,
    ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, so: 0,
    rbi: 0,
    scoredRunnerIds: [],
    advantage: (state.currentAtBat && state.currentAtBat.pitchRollResult && state.currentAtBat.pitchRollResult.advantage) || null,
  };
  newState.currentAtBat.atBatIndex = newState.atBatLog.length;
  newState.atBatLog.push(atBatEntry);

  const isWalkOffSituation = !newState.isTopInning && newState.inning >= 9 && newState.homeScore <= newState.awayScore;

  if (isWalkOffSituation && ['SINGLE', '1B', '1B+', '2B', '3B'].includes(outcome)) {
    let basesToAdvanceOnHit = 0;
    if (outcome === '1B' || outcome === 'SINGLE' || outcome === '1B+') basesToAdvanceOnHit = 1;
    if (outcome === '2B') basesToAdvanceOnHit = 2;
    if (outcome === '3B') basesToAdvanceOnHit = 3;

    const runnersOnBaseForCheck = [
        { runner: state.bases.third, from: 3 },
        { runner: state.bases.second, from: 2 },
        { runner: state.bases.first, from: 1 },
    ].filter(r => r.runner);

    let autoScoredCount = 0;
    for (const { from } of runnersOnBaseForCheck) {
        if (from + basesToAdvanceOnHit >= 4) {
            autoScoredCount++;
        }
    }
    const runsNeededToWin = newState.awayScore - newState.homeScore + 1;

    if (autoScoredCount >= runsNeededToWin) {
        const runnersOnBase = [
            { runner: state.bases.third, from: 3 },
            { runner: state.bases.second, from: 2 },
            { runner: state.bases.first, from: 1 },
        ].filter(r => r.runner);

        let basesToAdvance = 0;
        for (let b = 1; b <= 3; b++) {
            const scored = runnersOnBase.filter(r => r.from + b >= 4).length;
            if (scored >= runsNeededToWin) {
                basesToAdvance = b;
                break;
            }
        }

        if (basesToAdvance === 0) basesToAdvance = basesToAdvanceOnHit;


        let finalOutcome = '1B';
        if (basesToAdvance === 2) finalOutcome = '2B';
        if (basesToAdvance === 3) finalOutcome = '3B';

        const allRunners = [
            ...runnersOnBase,
            { runner: batter, from: 0 }
        ];

        const newBases = { first: null, second: null, third: null };
        const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
        let runnersScoredCount = 0;

        for (const { runner, from } of allRunners) {
            const toBase = from + basesToAdvance;
            if (toBase >= 4) {
                if (runnersScoredCount < runsNeededToWin) {
                    scoreRun(runner, false);
                    runnersScoredCount++;
                }
            } else {
                if (from === 0) { // Batter
                    newBases[baseMap[toBase]] = runner;
                } else { // Runner on base
                    newBases[baseMap[toBase]] = runner;
                }
            }
        }

        newState.bases = newBases;
        let hitType = 'SINGLE';
        if (finalOutcome === '2B') hitType = 'DOUBLE';
        if (finalOutcome === '3B') hitType = 'TRIPLE';

        let eventMessage = `${batter.displayName} hits a walk-off ${hitType}!`;
        const winningScorerName = scorers[scorers.length - 1];
        if (winningScorerName) {
            eventMessage += ` ${winningScorerName} scores.`;
        }

        events.push(eventMessage);

        newState.gameOver = true;
        newState.winningTeam = 'home';
        newState.walkoffAdjustedOutcome = finalOutcome;
        outcome = 'WALKOFF_HANDLED';
    }
  }


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
          infieldInSingle = true;
      }
  }


  const runnerData = {
    ...batter,
    pitcherOfRecordId: getPitcherKey(newState, pitcher)
  };

  // --- HANDLE OUTCOMES ---
  if (outcome === 'BUNT') {
    const { first, second, third } = state.bases;
    // Bases Loaded: Fielder's choice, out at home.
    if (first && second && third) {
      events.push(`${batter.displayName} bunts into a fielder's choice, the runner from third is out at home.`);
      recordOuts(1);
      if (newState.outs < 3) {
        newState.bases.third = second;
        newState.bases.second = first;
        newState.bases.first = runnerData;
      }
    }
    // Runner on 3rd (and maybe 2nd): Runners hold.
    else if (third && second && !first) {
      events.push(`${batter.displayName} lays down a bunt, but the runners hold.`);
      recordOuts(1);
      newState.bases.first = null; // Batter is out
    }
    // Runner on 3rd (and maybe 1st): Runner on 3rd holds.
    else if (third && first && !second) {
      events.push(`${batter.displayName} lays down a sacrifice bunt. The runner on first advances.`);
      recordOuts(1);
      if (newState.outs < 3) {
        newState.bases.second = first;
        newState.bases.first = null; // Batter is out
      }
    }
    // Runner on 3rd only: Runner holds.
    else if (third && !first && !second) {
      events.push(`${batter.displayName} lays down a bunt, but the runner on third holds.`);
      recordOuts(1);
      newState.bases.first = null; // Batter is out
    }
    // Standard sacrifice bunt cases
    else {
      events.push(`${batter.displayName} lays down a sacrifice bunt.`);
      recordOuts(1);
      if (newState.outs < 3) {
        if (second) { newState.bases.third = second; newState.bases.second = null; }
        if (first) { newState.bases.second = first; newState.bases.first = null; }
        else { newState.bases.first = null; }
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
            recordOuts(1);
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
                    runnerOnFirst: first,
                    batterPlayerId: batter.card_id
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
          recordOuts(2);
          if (newState.outs < 3 && !state.infieldIn) {
            if (newState.bases.third) { scoreRun(newState.bases.third, true, false); newState.bases.third = null; } // Score doesn't need to be logged here, server handles it (GIDP run is not an RBI)
            if (newState.bases.second) { newState.bases.third = newState.bases.second; newState.bases.second = null;}
          }
          newState.bases.first = null; // Runner from first is out
        } else {
          playResultDescription = `Batter is SAFE, out at second. Fielder's choice.`;
          recordOuts(1);
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
          outcome: dpOutcome,
          batterPlayerId: batter.card_id
        };

    } else {
        let groundOutEvent = `${batter.displayName} grounds out.`;
        recordOuts(1);
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
    recordOuts(1);
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
            let leadIsManual = false;
            processedDecisions = processedDecisions.map(d => {
                if (d.type === 'manual' || d.type === 'auto_hold') {
                    leadIsManual = true;
                    return { ...d, type: 'manual' };
                } else if (d.type === 'auto_advance' && leadIsManual) {
                    // Trailing behind a manual runner
                    return { ...d, type: 'manual' };
                }
                return d;
            });
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
            newState.currentPlay = { type: 'TAG_UP', payload: { decisions: manualDecisions, autoHoldDecisions, initialEvent: combinedEvent, batterPlayerId: batter.card_id } };
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
          const scoreMsg = scoreRun(runnerFrom3);
          if (scoreMsg) combinedEvent += ` ${scoreMsg}`;
      }

      const potentialDecisions = [
        { runner: runnerFrom2, from: 2 }, // try for home
        { runner: runnerFrom1, from: 1 },  // try for third
      ].filter(d => d.runner);

      let processedDecisions = potentialDecisions.map(decision => {
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

      const hasManualDecision = processedDecisions.some(d => d.type === 'manual');

      if (hasManualDecision) {
          let leadIsManual = false;
          processedDecisions = processedDecisions.map(d => {
              if (d.type === 'manual' || d.type === 'auto_hold') {
                  leadIsManual = true;
                  return { ...d, type: 'manual' };
              } else if (d.type === 'auto_advance' && leadIsManual) {
                  return { ...d, type: 'manual' };
              }
              return d;
          });
      }

      const manualDecisions = processedDecisions.filter(d => d.type === 'manual');
      const autoHoldDecisions = processedDecisions.filter(d => d.type === 'auto_hold');

      // --- State Update ---
      newState.bases = { first: null, second: null, third: null };

      if (manualDecisions.length > 0 && !newState.gameOver) {
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
          newState.currentPlay = { type: 'ADVANCE', payload: { decisions: allUserDecisions, hitType: '1B', initialEvent: combinedEvent, scorers, batterPlayerId: batter.card_id } };

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
          if (runnerFrom1 && !newState.gameOver) {
              newState.bases.third = runnerFrom1;
              newState.currentPlay = { type: 'ADVANCE', payload: { decisions: potentialDecisions, hitType: '2B', initialEvent: combinedEvent, batter: runnerData, scorers, batterPlayerId: batter.card_id } };
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
    recordOuts(1);
  }
  else if (outcome === 'PU') {
    events.push(`${batter.displayName} pops out.`);
    recordOuts(1);
}
  else if (outcome === 'WALKOFF_HANDLED') {
      // Do nothing, events are already handled
  }
  else { 
    events.push(`${batter.displayName} is out.`);
    recordOuts(1);
  }

  // --- Walk-off Win Check ---
  if (newState.gameOver && newState.winningTeam === 'home' && !newState.isTopInning) {
      const isWalkoffEventPresent = events.some(e => e.includes('WALK-OFF!'));
      if (!isWalkoffEventPresent) {
          const winningTeamName = teamInfo.home_team_abbr || 'HOME TEAM';
          // FIX: Append to the last event if possible, otherwise push a new one.
          if (events.length > 0) {
              events[events.length - 1] += ` WALK-OFF!`;
          } else {
              events.push(`WALK-OFF!`);
          }
      }
  }

  // A pitcher at the plate going deep gets its own "Pitcher HR" callout instead. It also
  // suppresses "advantage backfired": a batting pitcher almost always cedes the advantage,
  // so a HR off the mound pitcher's chart would otherwise trip the backfire taunt — which we
  // never want pointed at (or triggered by) a batting pitcher.
  const batterIsPitcher = !!batter && batter.control !== null && batter.control !== undefined;
  const pitcherHomeRun = batterIsPitcher && outcome === 'HR';

  // "Advantage backfired": the pitcher won the advantage but the swing landed a better-for-
  // the-hitter result on the pitcher's own chart than the hitter's chart would have.
  const advantageBackfired = !batterIsPitcher && chartHolder
    ? computeAdvantageBackfired(chartHolder === pitcher ? 'pitcher' : 'batter', swingRoll, pitcher, batter)
    : false;
  if (advantageBackfired) {
    events.push(`The advantage backfired on ${pitcher.displayName}!`);
  }

  // --- Handle Inning Change & Game Over Check ---
  // Replaced inline logic with reusable function call
  checkGameOverOrInningChange(newState, events, teamInfo);

  // Finalize the box-score batting result from the (possibly reassigned) outcome. A walk-off
  // hit was resolved as WALKOFF_HANDLED above, so fall back to the recorded hit type.
  const boxOutcome = outcome === 'WALKOFF_HANDLED' ? (newState.walkoffAdjustedOutcome || '1B') : outcome;
  atBatEntry.outcome = boxOutcome;
  fillBattingResult(atBatEntry, boxOutcome);

  return { newState, events, scorers, outcome, infieldInSingle, advantageBackfired, pitcherHomeRun };
}

// Rank of a chart result by how good it is for the offense (low = good for the pitcher,
// high = good for the hitter). Used to compare the two cards' charts at a given roll.
const CHART_OUTCOME_RANK = {
  PU: 0, SO: 1, GB: 2, 'GB?': 2, FB: 3, BB: 4, IBB: 4,
  '1B': 5, '1B+': 6, '2B': 7, '3B': 8, HR: 9,
};

function lookupChartOutcome(card, roll) {
  if (!card || !card.chart_data || !roll) return null;
  for (const range in card.chart_data) {
    const [min, max] = range.split('-').map(Number);
    if (roll >= min && roll <= max) return card.chart_data[range];
  }
  return null;
}

// "Advantage backfired": the pitcher won the advantage, but at the swing roll the pitcher's
// own chart yielded a better-for-the-hitter result than the hitter's chart would have — i.e.
// the pitcher would have been better off conceding the advantage. (Usually a home run.)
function computeAdvantageBackfired(advantage, swingRoll, pitcher, batter) {
  if (advantage !== 'pitcher' || !swingRoll) return false;
  const pitcherOutcome = lookupChartOutcome(pitcher, swingRoll);
  const batterOutcome = lookupChartOutcome(batter, swingRoll);
  const pr = CHART_OUTCOME_RANK[pitcherOutcome];
  const br = CHART_OUTCOME_RANK[batterOutcome];
  if (pr == null || br == null) return false;
  return pr > br;
}

function recordOutsForPitcher(state, pitcher, count) {
  state.outs += count;
  if (!pitcher) return;
  const pitcherId = getPitcherKey(state, pitcher);
  if (!state.pitcherStats[pitcherId]) {
    state.pitcherStats[pitcherId] = { ip: 0, runs: 0, outs_recorded: 0, batters_faced: 0 };
  }
  if (!state.pitcherStats[pitcherId].outs_recorded) {
    state.pitcherStats[pitcherId].outs_recorded = 0;
  }
  state.pitcherStats[pitcherId].outs_recorded += count;
}


function resolveThrow(state, throwTo, outfieldDefense, getSpeedValue, finalizeEvent, initialEvent = '', teamInfo = {}) {
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
        if (!newState.runnersScored) newState.runnersScored = [];
        newState.runnersScored.push(toRunnerCard(runnerToChallenge));
        recordRunForPitcher(newState, runnerToChallenge, newState.currentAtBat.pitcher);
        outcomeMessage = `${runnerToChallenge.name} is SAFE at home!`;
        // --- Walk-off Win Check ---
        if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
            if (!newState.gameOver) {
                newState.gameOver = true;
                newState.winningTeam = 'home';
                const winningTeamName = teamInfo.home_team_abbr || 'HOME TEAM';
                outcomeMessage += ` WALK-OFF!`;
            }
        }
      } else {
        newState.bases[baseMap[throwTo]] = runnerToChallenge;
        outcomeMessage = `${runnerToChallenge.name} is SAFE at ${getOrdinal(throwTo)}!`;
      }
      newState.bases[baseMap[fromBaseOfThrow]] = null;
    } else {
        // Outs on the bases are charged to the current pitcher (runs, by contrast, go to the
        // runner's original pitcher — handled inside recordRunForPitcher via pitcherOfRecordId).
        recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
        newState.throwRollResult.runnerOut = toRunnerCard(runnerToChallenge);
        newState.bases[baseMap[fromBaseOfThrow]] = null;
        if (throwTo === 4) {
          outcomeMessage = `${runnerToChallenge.name} is THROWN OUT at home!`;
        } else {
          outcomeMessage = `${runnerToChallenge.name} is THROWN OUT at ${getOrdinal(throwTo)}!`;
        }
    }

    const batterOnFirst = newState.bases.first;
    const rawOutcome = newState.currentAtBat.swingRollResult?.outcome;
    const outcome = typeof rawOutcome === 'string' ? rawOutcome.trim() : rawOutcome;

    if (batterOnFirst && !newState.bases.second && outcome === '1B+' && throwTo !== 2) {
        newState.bases.second = batterOnFirst;
        newState.bases.first = null;
        const stealEvent = `${batterOnFirst.displayName} steals second without a throw!`;
        if (outcomeMessage) outcomeMessage += ` ${stealEvent}`;
        else outcomeMessage = stealEvent;
    }

    // This is the fix. The initialEvent already contains the scoring messages.
    // We just need to append the outcome of this specific throw.
    const finalMessage = `${initialEvent} ${outcomeMessage}`;
    events.push(finalMessage);

    // --- Check Game Over ---
    checkGameOverOrInningChange(newState, events, teamInfo);
  }

  return { newState, events };
}

function calculateStealResult(runner, toBase, catcherArm, getSpeedValue, offensiveTeam) {
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
        runnerTeamId: offensiveTeam.team_id,
    };
}

function appendScoreToLog(logMessage, finalState, originalAwayScore, originalHomeScore) {
    const scoreChanged = finalState.awayScore > originalAwayScore || finalState.homeScore > originalHomeScore;
    if (scoreChanged && logMessage) {
        const scoreString = finalState.isTopInning
            ? `${finalState.awayScore}-${finalState.homeScore}`
            : `${finalState.homeScore}-${finalState.awayScore}`;
        return `${logMessage} <strong>(Score: ${scoreString})</strong>`;
    }
    return logMessage;
}

function recordRunForPitcher(state, runner, currentPitcher, opts = {}) {
  const pitcherId = (runner && runner.pitcherOfRecordId)
    ? runner.pitcherOfRecordId
    : getPitcherKey(state, currentPitcher);
  if (pitcherId) {
    if (!state.pitcherStats) state.pitcherStats = {};
    if (!state.pitcherStats[pitcherId]) {
      state.pitcherStats[pitcherId] = { ip: 0, runs: 0, outs_recorded: 0, batters_faced: 0 };
    }
    state.pitcherStats[pitcherId].runs++;
  }

  // --- Box score attribution ---
  // recordRunForPitcher is the single chokepoint every scored run flows through (immediate
  // outcomes via scoreRun, and deferred baserunning via resolveThrow / the server's advance &
  // tag-up handlers). Credit the run (R) to the runner who scored and an RBI to the at-bat
  // currently being resolved, so the box-score fold stays correct across deferred plays.
  const entry = currentAtBatEntry(state);
  if (entry) {
    if (runner && runner.card_id != null) entry.scoredRunnerIds.push(runner.card_id);
    if (opts.rbiEligible !== false) entry.rbi += 1;
  }
}

// The atBatLog entry for the plate appearance currently being resolved, or null. Entries are
// pushed in applyOutcome and tagged onto currentAtBat.atBatIndex so deferred resolutions can
// keep attributing runs/RBIs to the right at-bat.
function currentAtBatEntry(state) {
  const idx = state.currentAtBat && state.currentAtBat.atBatIndex;
  if (idx == null || !Array.isArray(state.atBatLog)) return null;
  return state.atBatLog[idx] || null;
}

// Fill the batting result on a freshly-pushed atBatLog entry from the (possibly reassigned)
// final outcome. PA is implicit (one entry == one plate appearance); walks and sacrifice bunts
// are not at-bats. Runs/RBIs are added separately via recordRunForPitcher.
function fillBattingResult(entry, outcome) {
  if (outcome === '1B' || outcome === '1B+' || outcome === 'SINGLE') { entry.ab = 1; entry.h = 1; }
  else if (outcome === '2B') { entry.ab = 1; entry.h = 1; entry.double = 1; }
  else if (outcome === '3B') { entry.ab = 1; entry.h = 1; entry.triple = 1; }
  else if (outcome === 'HR') { entry.ab = 1; entry.h = 1; entry.hr = 1; }
  else if (outcome === 'BB' || outcome === 'IBB') { entry.bb = 1; }
  else if (outcome === 'SO') { entry.ab = 1; entry.so = 1; }
  else if (outcome === 'BUNT') { /* sacrifice bunt: PA only, not an at-bat */ }
  else { entry.ab = 1; } // PU, FB, GB outs, double play, fielder's choice, generic OUT
}

module.exports = { applyOutcome, resolveThrow, calculateStealResult, appendScoreToLog,
  recordOutsForPitcher, recordBatterFaced, checkGameOverOrInningChange, recordRunForPitcher,
  toRunnerCard, getPitcherKey };
