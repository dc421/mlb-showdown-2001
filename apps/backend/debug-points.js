const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const historyRes = await client.query('SELECT DISTINCT season_name FROM draft_history');
    const pointSetsRes = await client.query('SELECT point_set_id, name FROM point_sets');

    const pointSetMap = {};
    pointSetsRes.rows.forEach(ps => pointSetMap[ps.name] = ps.point_set_id);

    console.log('Available Point Sets:', Object.keys(pointSetMap));

    console.log('\nAnalyzing Season Mapping:');
    for (const row of historyRes.rows) {
        const seasonName = row.season_name;
        const mappedName = mapSeasonToPointSet(seasonName);
        const pointSetId = pointSetMap[mappedName];
        const resolvedName = pointSetId ? mappedName : "Original Pts (Fallback)";

        console.log(`Season: "${seasonName}" => Mapped: "${mappedName}" => Resolved: "${resolvedName}"`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

function mapSeasonToPointSet(seasonStr) {
    // seasonStr format: "M-D-YY Season" e.g., "10-22-20 Season"
    if (!seasonStr) return "Original Pts";

    const match = seasonStr.match(/^(\d{1,2})-(\d{1,2})-(\d{2}) Season$/);
    if (!match) return "Original Pts";

    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    const yearVal = parseInt(match[3]);
    // Assume 20xx
    const year = 2000 + yearVal;
    const date = new Date(year, month - 1, day);
    const cutoff = new Date(2020, 9, 22); // Oct 22, 2020

    if (date < cutoff) return "Original Pts";

    // Map >= Cutoff
    // Format M/D[/YY] Season
    // Rule derived from user input:
    // 2020-2024: M/D Season
    // 2025+: M/D/YY Season (e.g. 2/28/25 Season)
    // Exception? "12/23 Season" is 2022. "2/28 Season" is 2024.
    // "2/28/25 Season" is 2025.

    if (year >= 2025) {
        return `${month}/${day}/${yearVal} Season`;
    } else {
        return `${month}/${day} Season`;
    }
}

main();
