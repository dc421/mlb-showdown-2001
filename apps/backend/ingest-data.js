// ingest-data.js - DEFINITIVE FINAL VERSION
require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');

const dbConfig = process.env.NODE_ENV === 'production'
  ? { // For Render/production
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : { // For local development
      user: process.env.PGUSER,
      host: process.env.PGHOST,
      database: process.env.PGDATABASE,
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT,
    };
const pool = new Pool(dbConfig);

function createChartData(row, isPitcher = false) {
    const chart = {};
    let currentRoll = 1;
    const outcomes = isPitcher 
      ? ['PU', 'SO', 'GB', 'FB', 'BB', '1B', '2B', 'HR']
      : ['SO', 'GB', 'FB', 'BB', '1B', '1B+', '2B', '3B', 'HR'];
    outcomes.forEach(outcome => {
        const value = parseInt(row[outcome], 10);
        if (value > 0) {
        const endRoll = currentRoll + value - 1;
        chart[`${currentRoll}-${endRoll}`] = outcome;
        currentRoll = endRoll + 1;
        }
    });
    return chart;
}

async function processCsv(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath).pipe(csv()).on('data', (row) => records.push(row)).on('end', () => resolve(records)).on('error', reject);
  });
}

async function ingestData() {
  console.log('Starting data ingestion process...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // TRUNCATE all tables
    await client.query('TRUNCATE TABLE cards_player RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE teams RESTART IDENTITY CASCADE');
    
    // Process and insert teams
    const teams = await processCsv('teams.csv');
    for (const team of teams) {
      const insertQuery = `INSERT INTO teams (city, name, display_format, logo_url, abbreviation, primary_color, secondary_color) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
      const values = [team.city, team.name, team.display_format, team.logo_url, team.abbreviation, team.primary_color, team.secondary_color];
      await client.query(insertQuery, values);
    }

    const hitters = await processCsv('hitters.csv');
    const pitchers = await processCsv('pitchers.csv');
    const allPlayersRaw = [...hitters, ...pitchers];
    const uniquePlayers = new Map();

    for (const playerRow of allPlayersRaw) {
      const name = `${playerRow.First} ${playerRow.Last}`;
      const key = `${name}|${playerRow.Set}|${playerRow.Num}`;
      if (uniquePlayers.has(key)) {
        const existingPlayer = uniquePlayers.get(key);
        if (playerRow.Pos && playerRow.Fld) {
            existingPlayer.positions.push({ pos: playerRow.Pos, fld: playerRow.Fld });
        }
      } else {
        playerRow.positions = [];
        if (playerRow.Pos && playerRow.Fld) {
            playerRow.positions.push({ pos: playerRow.Pos, fld: playerRow.Fld });
        }
        uniquePlayers.set(key, playerRow);
      }
    }
    
    const playerTeamCounts = {};
    for (const player of uniquePlayers.values()) {
      const name = `${player.First} ${player.Last}`;
      const team = player.Tm;
      const key = `${name}|${team}`;
      playerTeamCounts[key] = (playerTeamCounts[key] || 0) + 1;
    }

    function formatPositions(positions) {
      if (!positions || positions.length === 0) return 'P';
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

    for (const row of uniquePlayers.values()) {
      const isPitcher = !!row.Ctl;
      const fielding_ratings = {};
      if (!isPitcher) {
          row.positions.forEach(p => {
              fielding_ratings[p.pos] = parseInt(p.fld, 10);
          });
      }

      const name = `${row.First} ${row.Last}`;
      const team = row.Tm;
      const set = row.Set;
      const nameTeamKey = `${name}|${team}`;

      let displayName;
      if (playerTeamCounts[nameTeamKey] > 1) {
        if (isPitcher) {
          // For ambiguous pitchers, use their role (SP/RP)
          const role = parseInt(row.IP, 10) > 3 ? 'SP' : 'RP';
          displayName = `${name} (${role})`;
        } else {
          // For ambiguous position players, use their positions
          const posString = formatPositions(row.positions);
          displayName = `${name} (${posString})`;
        }
      } else {
        displayName = `${name} (${team})`;
      }

      const card = {
        name: name,
        display_name: displayName,
        team: team,
        set_name: set,
        card_number: parseInt(row.Num, 10),
        year: 2001,
        on_base: isPitcher ? null : parseInt(row.OB, 10) || null,
        control: isPitcher ? (parseInt(row.Ctl, 10) || 0) : null,
        ip: isPitcher ? parseInt(row.IP, 10) || null : null,
        speed: isPitcher ? null : row.Spd,
        fielding_ratings: isPitcher ? null : fielding_ratings,
        chart_data: createChartData(row, isPitcher),
        points: parseInt(row.Pts, 10) || null, // Keep points for migration
      };
      
      const insertQuery = `INSERT INTO cards_player (name, display_name, team, set_name, card_number, year, on_base, control, ip, speed, fielding_ratings, chart_data, points) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;
      const values = [card.name, card.display_name, card.team, card.set_name, card.card_number, card.year, card.on_base, card.control, card.ip, card.speed, card.fielding_ratings, card.chart_data, card.points];
      await client.query(insertQuery, values);
    }

    // After all data is inserted, run the image updates
    const imageUpdatesSql = fs.readFileSync('image_updates.sql', 'utf8');
    await client.query(imageUpdatesSql);

    await client.query('COMMIT');
    console.log('✅ Data ingestion complete!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Data ingestion failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}
ingestData();