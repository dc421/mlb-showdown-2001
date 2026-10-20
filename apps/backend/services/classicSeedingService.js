// Classic bracket seeding, shared by the Classic page and game setup (which auto-assigns home field
// to the higher seed). Returns seeds ordered 5th → 1st: seed number = 5 - index.

const { pool } = require('../db');

async function getClassicSeeding(classic, db = pool) {
    if (classic.seeding && Array.isArray(classic.seeding) && classic.seeding.length > 0) {
        return classic.seeding;
    }

    // Dynamic Seeding (Wooden Spoon Logic)
    // Only COMPLETED spoons determine seeding. A scheduled/in-progress Wooden Spoon (which
    // has no real loser yet) would otherwise count as the most-recent spoon and shift every
    // seed — corrupting the Classic bracket (e.g. a scheduled Spring 2026 spoon reseeding the
    // whole field).
    // Likewise, only spoons played before this Classic was created count — otherwise a later
    // season's spoon reseeds a past Classic's bracket.
    const spoonQuery = `
        SELECT losing_team_id, date
        FROM series_results
        WHERE round = 'Wooden Spoon' AND status = 'completed' AND date <= $1
    `;
    const spoonResult = await db.query(spoonQuery, [classic.created_at]);

    const sortedSpoonRows = spoonResult.rows.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA;
    });

    const seeds = [];
    const seenTeams = new Set();

    for (const row of sortedSpoonRows) {
        if (!seenTeams.has(row.losing_team_id) && row.losing_team_id) {
            seenTeams.add(row.losing_team_id);
            const teamRes = await db.query('SELECT name, city, user_id, logo_url FROM teams WHERE team_id = $1', [row.losing_team_id]);
            if (teamRes.rows.length > 0) {
                const t = teamRes.rows[0];
                seeds.push({
                    team_id: row.losing_team_id,
                    user_id: t.user_id,
                    name: `${t.city} ${t.name}`,
                    city: t.city,
                    logo_url: t.logo_url,
                    lastSpoonDate: row.date
                });
            }
        }
        if (seeds.length >= 5) break;
    }
    return seeds;
}

module.exports = { getClassicSeeding };
