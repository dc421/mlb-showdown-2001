import re

with open('apps/backend/server.js', 'r') as f:
    content = f.read()

# First replace the sendRunner == true branch
search_block = """        if (sendRunner) {
            const infieldDefense = await getInfieldDefense(defensiveTeam);
            const runnerSpeed = getSpeedValue(runnerOnThird);
            const d20Roll = Math.floor(Math.random() * 20) + 1;
            const defenseTotal = infieldDefense + d20Roll;
            const isSafe = runnerSpeed >= defenseTotal;

            newState.throwRollResult = {
                roll: d20Roll,
                defense: infieldDefense,
                target: runnerSpeed,
                baseSpeed: runnerSpeed,
                penalty: 0,
                outcome: isSafe ? 'SAFE' : 'OUT',
                runner: runnerOnThird.name,
                throwToBase: 4 // Home plate
            };

            // Batter is safe at first in the 'send' scenario
            newState.bases.first = batter;

            if (isSafe) {
                newState[scoreKey]++;
                recordRunForPitcher(newState, runnerOnThird, newState.currentAtBat.pitcher);
                events.push(`${runnerOnThird.name} is SENT HOME... SAFE! ${batter.displayName} reaches on a fielder's choice.`);
                if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
                    newState.gameOver = true;
                    newState.winningTeam = 'home';
                }
            } else {
                recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                events.push(`${runnerOnThird.name} is THROWN OUT at the plate! ${batter.displayName} reaches on a fielder's choice.`);
            }
            newState.bases.third = null; // Runner from third is no longer there.

            // Handle other runners
            if (runnerOnSecond) {
                // Runner on 2nd holds, as per user instruction
            }
            if (runnerOnFirst) {
                newState.bases.second = runnerOnFirst;
            }

        }"""

replace_block = """        if (sendRunner) {
            // Give defense a choice to throw home or 1st
            newState.currentPlay = {
                type: 'INFIELD_IN_DEFENSE_CHOICE',
                payload: {
                    batter,
                    runnerOnThird,
                    runnerOnSecond,
                    runnerOnFirst,
                    batterPlayerId: batter.card_id
                }
            };

            await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
            await client.query('COMMIT');

            const gameData = await getAndProcessGameData(gameId, client);
            io.to(gameId).emit('game-updated', gameData);
            return res.status(200).json(gameData);
        }"""

if search_block in content:
    content = content.replace(search_block, replace_block)

    new_endpoint = """
// NEW ENDPOINT for Infield In Defense Choice
app.post('/api/games/:gameId/resolve-infield-in-defense-choice', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { throwHome } = req.body; // true or false
    const userId = req.user.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;

        if (newState.currentPlay?.type !== 'INFIELD_IN_DEFENSE_CHOICE') {
            return res.status(400).json({ message: 'Invalid game state for this action.' });
        }

        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const { batter, runnerOnThird, runnerOnSecond, runnerOnFirst } = newState.currentPlay.payload;
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
        const events = [];

        if (throwHome) {
            const infieldDefense = await getInfieldDefense(defensiveTeam);
            const runnerSpeed = getSpeedValue(runnerOnThird);
            const d20Roll = Math.floor(Math.random() * 20) + 1;
            const defenseTotal = infieldDefense + d20Roll;
            const isSafe = runnerSpeed >= defenseTotal;

            newState.throwRollResult = {
                roll: d20Roll,
                defense: infieldDefense,
                target: runnerSpeed,
                baseSpeed: runnerSpeed,
                penalty: 0,
                outcome: isSafe ? 'SAFE' : 'OUT',
                runner: runnerOnThird.name,
                throwToBase: 4 // Home plate
            };

            // Batter is safe at first in the 'send' scenario
            newState.bases.first = batter;

            if (isSafe) {
                newState[scoreKey]++;
                recordRunForPitcher(newState, runnerOnThird, newState.currentAtBat.pitcher);
                events.push(`${runnerOnThird.name} is SENT HOME... SAFE! ${batter.displayName} reaches on a fielder's choice.`);
            } else {
                recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                events.push(`${runnerOnThird.name} is THROWN OUT at the plate! ${batter.displayName} reaches on a fielder's choice.`);
            }
            newState.bases.third = null; // Runner from third is no longer there.

            // Handle other runners
            if (runnerOnSecond) {
                // Runner on 2nd holds, as per user instruction
            }
            if (runnerOnFirst) {
                newState.bases.second = runnerOnFirst;
            }
        } else {
            // Defense chooses to throw to 1st
            events.push(`${batter.displayName} grounds out to first.`);
            recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);

            // Runner from third scores
            newState[scoreKey]++;
            recordRunForPitcher(newState, runnerOnThird, newState.currentAtBat.pitcher);
            events.push(`${runnerOnThird.name} scores on the play.`);
            newState.bases.third = null;

            if (newState.outs < 3) {
                 if (runnerOnFirst && runnerOnSecond) { // 1st and 2nd
                    // This case isn't possible based on the entry condition (must have runner on 3rd)
                    // but handling defensively.
                 } else if (runnerOnFirst) { // 1st and 3rd
                    newState.bases.second = runnerOnFirst;
                 }
                 newState.bases.first = null; // Batter is out
            } else {
                 newState.bases = { first: null, second: null, third: null };
            }
        }

        newState.currentPlay = null;

        const combinedLogMessage = events.join(' ');
        if (events.length > 0) {
            const finalLogMessage = appendScoreToLog(combinedLogMessage, newState, currentState.awayScore, currentState.homeScore);
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'baserunning', finalLogMessage]);
        }

        // --- Check for Game Over ---
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
        );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };
        const gameOverEvents = [];
        checkGameOverOrInningChange(newState, gameOverEvents, teamInfo);

        if (gameOverEvents.length > 0) {
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'system', gameOverEvents[0]]);
        }

        if (newState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, newState);
              }
        }

        newState.awayPlayerReadyForNext = false;
        newState.homePlayerReadyForNext = false;

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
        await client.query('COMMIT');

        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.status(200).json(gameData);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error resolving infield in defense choice for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during infield in defense choice.' });
    } finally {
        client.release();
    }
});
"""

    content = content.replace("app.post('/api/games/:gameId/reset-rolls',", new_endpoint + "\napp.post('/api/games/:gameId/reset-rolls',")
    with open('apps/backend/server.js', 'w') as f:
        f.write(content)
    print("Replaced!")
else:
    print("Pattern not found!")
