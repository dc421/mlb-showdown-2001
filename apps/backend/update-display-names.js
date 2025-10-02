require('dotenv').config();
const { Pool } = require('pg');

const dbConfig = {
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
};

const pool = new Pool(dbConfig);

function formatPositions(fieldingRatings) {
  if (!fieldingRatings) return 'P';
  const positions = Object.keys(fieldingRatings);
  if (positions.length === 0) return 'DH';

  const outfield = new Set();
  const infield = new Set();

  positions.forEach(pos => {
    if (['LF', 'CF', 'RF', 'LFRF'].includes(pos)) {
      outfield.add('OF');
    } else {
      infield.add(pos);
    }
  });

  const allPos = [...infield, ...outfield];
  return allPos.sort().join('/');
}

async function updateDisplayNames() {
  console.log('Starting display name update process...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch all player cards
    const { rows: allPlayers } = await client.query('SELECT card_id, name, team, ip, control, fielding_ratings FROM cards_player');

    // 2. Identify league-wide name duplicates and same-team card duplicates
    const nameCounts = {};
    const playerTeamCounts = {};
    allPlayers.forEach(player => {
      nameCounts[player.name] = (nameCounts[player.name] || 0) + 1;
      const key = `${player.name}|${player.team}`;
      playerTeamCounts[key] = (playerTeamCounts[key] || 0) + 1;
    });

    // 3. Iterate and update each player
    for (const player of allPlayers) {
      const name = player.name;
      const team = player.team;
      const nameTeamKey = `${name}|${team}`;
      const isPitcher = player.control !== null;

      let newDisplayName;
      // Case 1: Multiple cards for the same player on one team (e.g., different series)
      if (playerTeamCounts[nameTeamKey] > 1) {
        if (isPitcher) {
          const role = player.ip > 3 ? 'SP' : 'RP';
          newDisplayName = `${name} (${role})`;
        } else {
          const posString = formatPositions(player.fielding_ratings);
          newDisplayName = `${name} (${posString})`;
        }
      // Case 2: Player name is not unique across the league
      } else if (nameCounts[name] > 1) {
        newDisplayName = `${name} (${team})`;
      // Case 3: Unique player
      } else {
        newDisplayName = name;
      }

      // 4. Execute the update
      await client.query(
        'UPDATE cards_player SET display_name = $1 WHERE card_id = $2',
        [newDisplayName, player.card_id]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Display names updated successfully for all player cards!');

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Display name update failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

updateDisplayNames();