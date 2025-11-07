const { pool } = require('./db');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const REPLACEMENT_HITTER_CARD = {
    card_id: -1, name: 'Replacement Hitter', display_name: 'Replacement Hitter', on_base: -10, speed: 'B',
    points: 0,
    fielding_ratings: { 'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0, 'LF': 0, 'CF': 0, 'RF': 0 },
    chart_data: { '1-2': 'SO', '3-20': 'GB' },
    control: null,
    image_url: `${BACKEND_URL}/images/replacement.jpg`
};
const REPLACEMENT_PITCHER_CARD = {
    card_id: -2, name: 'Replacement Pitcher', display_name: 'Replacement Pitcher', control: -1, ip: 1,
    points: 0,
    chart_data: { '1-3': 'PU', '4-8': 'SO', '9-12': 'GB', '13-16': 'FB', '17':'BB', '18-19':'1B','20':'2B'},
    fielding_ratings: {},
    image_url: `${BACKEND_URL}/images/replacement.jpg`
};

async function getActivePlayers(gameId, currentState) {
    try {
        const participantsResult = await pool.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        const game = await pool.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);

        const homeParticipant = participantsResult.rows.find(p => p.user_id === game.rows[0].home_team_user_id);
        const awayParticipant = participantsResult.rows.find(p => p.user_id !== game.rows[0].home_team_user_id);

        const offensiveParticipant = currentState.isTopInning ? awayParticipant : homeParticipant;
        const defensiveParticipant = currentState.isTopInning ? homeParticipant : awayParticipant;

        if (!offensiveParticipant?.lineup || !defensiveParticipant?.lineup) {
          return { batter: null, pitcher: null, offensiveTeam: {}, defensiveTeam: {} };
        }

        const offensiveTeamState = currentState.isTopInning ? currentState.awayTeam : currentState.homeTeam;

        const batterInfo = offensiveParticipant.lineup.battingOrder[offensiveTeamState.battingOrderPosition];
        let batter;
        if (batterInfo.card_id === -1) {
            batter = REPLACEMENT_HITTER_CARD;
        } else if (batterInfo.card_id === -2) {
            batter = REPLACEMENT_PITCHER_CARD;
        } else {
            const batterQuery = await pool.query('SELECT * FROM cards_player WHERE card_id = $1', [batterInfo.card_id]);
            batter = batterQuery.rows[0];
        }

        const pitcher = currentState.isTopInning ? currentState.currentHomePitcher : currentState.currentAwayPitcher;

        return {
            batter: batter,
            pitcher: pitcher,
            offensiveTeam: offensiveParticipant,
            defensiveTeam: defensiveParticipant,
        };
    } catch (error) {
        console.error('--- CRITICAL ERROR inside getActivePlayers ---', error);
        throw error;
    }
}

async function getOutfieldDefense(defensiveParticipant) {
    if (!defensiveParticipant?.lineup?.battingOrder) return 0;
    const lineup = defensiveParticipant.lineup.battingOrder;
    const outfielders = lineup.filter(spot => ['LF', 'CF', 'RF'].includes(spot.position));
    if (outfielders.length === 0) return 0;

    const outfielderCardIds = outfielders.map(spot => spot.card_id);
    const cardsResult = await pool.query('SELECT card_id, fielding_ratings FROM cards_player WHERE card_id = ANY($1::int[])', [outfielderCardIds]);
    const cardsById = cardsResult.rows.reduce((acc, card) => {
        acc[card.card_id] = card;
        return acc;
    }, {});

    let totalDefense = 0;
    outfielders.forEach(spot => {
        const card = cardsById[spot.card_id];
        if (card && card.fielding_ratings) {
            if (card.fielding_ratings[spot.position] !== undefined) {
                totalDefense += card.fielding_ratings[spot.position];
            }
            else if ((spot.position === 'LF' || spot.position === 'RF') && card.fielding_ratings['LFRF'] !== undefined) {
                totalDefense += card.fielding_ratings['LFRF'];
            }
        }
    });
    return totalDefense;
}

async function getCatcherArm(defensiveParticipant) {
    if (!defensiveParticipant?.lineup?.battingOrder) return 0;
    const lineup = defensiveParticipant.lineup.battingOrder;
    const catcher = lineup.find(spot => spot.position === 'C');
    if (!catcher) return 0;

    const cardResult = await pool.query('SELECT fielding_ratings FROM cards_player WHERE card_id = $1', [catcher.card_id]);
    if (cardResult.rows.length === 0 || !cardResult.rows[0].fielding_ratings) return 0;

    return cardResult.rows[0].fielding_ratings['C'] || 0;
}

async function getInfieldDefense(defensiveParticipant) {
    if (!defensiveParticipant?.lineup?.battingOrder) return 0;
    const lineup = defensiveParticipant.lineup.battingOrder;
    const infielders = lineup.filter(spot => ['1B', '2B', 'SS', '3B'].includes(spot.position));
    if (infielders.length === 0) return 0;

    const infielderCardIds = infielders.map(spot => spot.card_id);
    const cardsResult = await pool.query('SELECT card_id, fielding_ratings FROM cards_player WHERE card_id = ANY($1::int[])', [infielderCardIds]);
    const cardsById = cardsResult.rows.reduce((acc, card) => {
        acc[card.card_id] = card;
        return acc;
    }, {});

    let totalDefense = 0;
    infielders.forEach(spot => {
        const card = cardsById[spot.card_id];
        if (card && card.fielding_ratings) {
            if (spot.position === '1B') {
                if (card.fielding_ratings['1B'] !== undefined) {
                    totalDefense += card.fielding_ratings['1B'];
                } else {
                    const isDH = Object.keys(card.fielding_ratings).length === 0 ||
                               (Object.keys(card.fielding_ratings).length === 1 && card.fielding_ratings.hasOwnProperty('DH'));
                    if (isDH) {
                        totalDefense -= 2;
                    } else {
                        totalDefense -= 1;
                    }
                }
            } else {
                if (card.fielding_ratings[spot.position] !== undefined) {
                    totalDefense += card.fielding_ratings[spot.position];
                }
            }
        }
    });
    return totalDefense;
}

const getSpeedValue = (runner) => {
  if (runner.control !== null && typeof runner.control !== 'undefined') {
    return 10;
  }
  const speed = runner.speed;
  if (speed === 'A') return 20;
  if (speed === 'B') return 15;
  if (speed === 'C') return 10;
  return speed;
};

function getEffectiveControl(pitcher, pitcherStats, inning) {
    if (!pitcher || typeof pitcher.control !== 'number') return null;
    if (!pitcherStats) return pitcher.control;

    const pitcherId = pitcher.card_id;
    const stats = pitcherStats[pitcherId] || { runs: 0, innings_pitched: [], fatigue_modifier: 0 };
    const inningsPitched = stats.innings_pitched || [];
    const inningsPitchedCount = inningsPitched.length;

    let controlPenalty = 0;
    const modifiedIp = pitcher.ip + (stats.fatigue_modifier || 0);
    const fatigueThreshold = modifiedIp - Math.floor((stats.runs || 0) / 3);

    if (inningsPitchedCount > fatigueThreshold) {
        controlPenalty = inningsPitchedCount - fatigueThreshold;
    }

    return pitcher.control - controlPenalty;
}

function processPlayers(playersToProcess) {
    playersToProcess.forEach(p => {
        if (!p) return;
        p.displayName = p.display_name;
        if (p.control !== null) {
            p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
        } else {
            const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
            p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
        }
    });
    return playersToProcess;
};

async function getAndProcessGameData(gameId, dbClient) {
  const allCardsResult = await dbClient.query('SELECT name, team FROM cards_player');
  const gameResult = await dbClient.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
  if (gameResult.rows.length === 0) {
    return null;
  }
  const game = gameResult.rows[0];
  let series = null;
  if (game.series_id) {
      const seriesResult = await dbClient.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
      series = seriesResult.rows[0];
  }

  const participantsResult = await dbClient.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
  const teamsData = {};
  for (const p of participantsResult.rows) {
    const teamResult = await dbClient.query('SELECT * FROM teams WHERE user_id = $1', [p.user_id]);
    if (p.user_id === game.home_team_user_id) {
      teamsData.home = teamResult.rows[0];
    } else {
      teamsData.away = teamResult.rows[0];
    }
  }

  if (game.status === 'pending') {
    return { game, series, gameState: null, gameEvents: [], batter: null, pitcher: null, lineups: {}, rosters: {}, teams: teamsData };
  }

  const stateResult = await dbClient.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
  if (stateResult.rows.length === 0) {
    return { game, series, gameState: null, gameEvents: [], batter: null, pitcher: null, lineups: {}, rosters: {}, teams: teamsData };
  }
  const currentState = stateResult.rows[0];

  const eventsResult = await dbClient.query('SELECT * FROM game_events WHERE game_id = $1 ORDER BY "timestamp" ASC', [gameId]);
  let batter = null, pitcher = null, lineups = { home: null, away: null }, rosters = { home: [], away: [] };

  if (game.status === 'in_progress') {
    const activePlayers = await getActivePlayers(gameId, currentState.state_data);
    batter = activePlayers.batter;
    pitcher = activePlayers.pitcher;
    const homeParticipant = participantsResult.rows.find(p => p.user_id === game.home_team_user_id);
    const awayParticipant = participantsResult.rows.find(p => p.user_id !== game.home_team_user_id);

    for (const p of participantsResult.rows) {
      const rosterResult = await dbClient.query('SELECT roster_data FROM game_rosters WHERE game_id = $1 AND user_id = $2', [gameId, p.user_id]);
      const fullRosterCards = rosterResult.rows[0]?.roster_data || [];
      if (p.lineup?.battingOrder) {
        const lineupWithDetails = p.lineup.battingOrder.map(spot => {
            let playerCard;
            if (spot.card_id === -1) {
                playerCard = REPLACEMENT_HITTER_CARD;
            } else if (spot.card_id === -2) {
                playerCard = REPLACEMENT_PITCHER_CARD;
            } else {
                playerCard = fullRosterCards.find(c => c.card_id === spot.card_id);
            }
            return { ...spot, player: playerCard };
        });

        let spCard;
        const spId = p.lineup.startingPitcher;
        if (spId === -1) {
            spCard = REPLACEMENT_HITTER_CARD;
        } else if (spId === -2) {
            spCard = REPLACEMENT_PITCHER_CARD;
        } else {
            spCard = fullRosterCards.find(c => c.card_id === spId);
        }

        processPlayers(lineupWithDetails.map(l => l.player));
        processPlayers(fullRosterCards);
        if (spCard) processPlayers([spCard]);

        if (p.user_id === game.home_team_user_id) {
          lineups.home = { battingOrder: lineupWithDetails, startingPitcher: spCard };
          rosters.home = fullRosterCards;
        } else {
          lineups.away = { battingOrder: lineupWithDetails, startingPitcher: spCard };
          rosters.away = fullRosterCards;
        }
      }
    }
    if (batter) processPlayers([batter]);
    if (pitcher) {
        processPlayers([pitcher]);
        pitcher.effectiveControl = getEffectiveControl(pitcher, currentState.state_data.pitcherStats, currentState.state_data.inning);
    }

    const processRosterFatigue = (roster, pitcherStats, inning) => {
        if (!roster) return;
        roster.forEach(player => {
            if (player.ip <= 3) {
                const stats = pitcherStats ? pitcherStats[player.card_id] : null;
                if (stats?.fatigue_modifier && stats.fatigue_modifier < 0) {
                    player.fatigueStatus = 'tired';
                } else {
                    const effectiveControl = getEffectiveControl(player, pitcherStats, inning);
                    if (effectiveControl < player.control) {
                         player.fatigueStatus = 'tired';
                    } else {
                         player.fatigueStatus = 'rested';
                    }
                }
            }
        });
    };

    if (currentState?.state_data?.pitcherStats) {
        processRosterFatigue(rosters.home, currentState.state_data.pitcherStats, currentState.state_data.inning);
        processRosterFatigue(rosters.away, currentState.state_data.pitcherStats, currentState.state_data.inning);
    }
  }

  return { game, series, gameState: currentState, gameEvents: eventsResult.rows, batter, pitcher, lineups, rosters, teams: teamsData };
}

module.exports = {
  REPLACEMENT_HITTER_CARD,
  REPLACEMENT_PITCHER_CARD,
  getActivePlayers,
  getOutfieldDefense,
  getCatcherArm,
  getInfieldDefense,
  getSpeedValue,
  getEffectiveControl,
  processPlayers,
  getAndProcessGameData
};
