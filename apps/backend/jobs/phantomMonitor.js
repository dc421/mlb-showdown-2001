const cron = require('node-cron');
const { pool } = require('../db');
const { sendPhantomWarningEmail, sendPhantomLossesEmail } = require('../services/emailService');

// --- Phantom Losses ---------------------------------------------------------
//
// The league discourages slow play with "phantom losses". A team is expected to
// have played one series per month since the draft. By the K-th monthly mark
// (draftDate + K months) a team should have played K series; any shortfall is
// recorded as a series where "Phantoms" beats the team N-0 (a single row may
// represent multiple losses via winning_score). Standings count these against
// the real team but never list "Phantoms" as a franchise.
//
// This job reconciles each phantom-eligible season daily:
//   - applyPhantomLosses runs at 11:59 PM and charges any new shortfall (and
//     emails the league). It is idempotent — re-runs assign nothing.
//   - sendPhantomWarnings runs each morning and, on the single day one week
//     before a mark, emails the league naming the teams at risk.
//
// PHANTOM_ENFORCEMENT_START gates WHEN enforcement begins: no warnings or losses
// are issued for any mark before this date (see latestMark / nextMarkAfter). It
// does NOT shrink how many series are owed. The first mark on/after the floor is
// the first enforced mark, and at it teams are held to the FULL cadence since the
// draft — a season drafted three months before the first enforced mark owes three
// series by it, collapsed into that first reconciliation. Future seasons (drafted
// after this date) are unaffected because all of their marks fall on or after it.
const PHANTOM_ENFORCEMENT_START = new Date(2026, 5, 17); // 2026-06-17, local time

const POSTSEASON_ROUNDS = ['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine'];

// --- date helpers (calendar-day based) --------------------------------------

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date, n) {
    const d = startOfDay(date);
    d.setDate(d.getDate() + n);
    return d;
}

// Add k months, clamping the day to the target month's length (e.g. Jan 31 + 1mo -> Feb 28).
function addMonths(date, k) {
    const src = new Date(date);
    const day = src.getDate();
    const result = new Date(src.getFullYear(), src.getMonth() + k, 1);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
    result.setHours(0, 0, 0, 0);
    return result;
}

const MAX_MARKS = 240; // safety cap on the monthly-mark loop

// Total monthly marks that have come due since the draft as of `asOf`
// (marks in (draftDate, asOf]). This is the full expected series count and is
// deliberately NOT reduced by the enforcement floor: when enforcement first kicks
// in at a mark on/after the floor, teams are held to the entire cadence since the
// draft. The floor only gates WHEN losses/warnings are issued (latestMark /
// nextMarkAfter), never how many series are required.
function requiredSeries(asOf, draftDate) {
    const asOfDay = startOfDay(asOf);
    let count = 0;
    for (let k = 1; k <= MAX_MARKS; k++) {
        const m = addMonths(draftDate, k);
        if (m > asOfDay) break;
        count++;
    }
    return count;
}

// The most recent enforced mark on or before `asOf`, or null.
function latestMark(asOf, draftDate, floor) {
    const asOfDay = startOfDay(asOf);
    const floorDay = startOfDay(floor);
    let last = null;
    for (let k = 1; k <= MAX_MARKS; k++) {
        const m = addMonths(draftDate, k);
        if (m > asOfDay) break;
        if (m >= floorDay) last = m;
    }
    return last;
}

// The next enforced mark strictly after `asOf`, or null.
function nextMarkAfter(asOf, draftDate, floor) {
    const asOfDay = startOfDay(asOf);
    const floorDay = startOfDay(floor);
    for (let k = 1; k <= MAX_MARKS; k++) {
        const m = addMonths(draftDate, k);
        if (m > asOfDay && m >= floorDay) return m;
    }
    return null;
}

// --- data access ------------------------------------------------------------

// Identify the current phantom-eligible season: the most recent non-Classic
// season whose regular season is still in progress (no Golden Spaceship yet).
// Returns { seasonName, draftDate, teams: [{ team_id, city, logo_url }] } or null.
async function getPhantomSeason(db) {
    const seasonRes = await db.query(`
        SELECT season_name, MIN(date) AS draft_date
        FROM series_results
        WHERE style IS DISTINCT FROM 'Classic'
          AND season_name IS NOT NULL
          AND winning_team_name IS DISTINCT FROM 'Phantoms'
        GROUP BY season_name
        ORDER BY MAX(date) DESC
        LIMIT 1
    `);
    if (seasonRes.rows.length === 0) return null;

    const seasonName = seasonRes.rows[0].season_name;
    const draftDate = seasonRes.rows[0].draft_date;
    if (!draftDate) return null;

    const overRes = await db.query(
        `SELECT 1 FROM series_results WHERE season_name = $1 AND round = 'Golden Spaceship' LIMIT 1`,
        [seasonName]
    );
    if (overRes.rows.length > 0) return null; // postseason set — season is over

    const teamsRes = await db.query(
        `SELECT team_id, city, logo_url FROM teams WHERE team_id IN (
            SELECT winning_team_id FROM series_results
                WHERE season_name = $1 AND style IS DISTINCT FROM 'Classic' AND winning_team_id IS NOT NULL
            UNION
            SELECT losing_team_id FROM series_results
                WHERE season_name = $1 AND style IS DISTINCT FROM 'Classic' AND losing_team_id IS NOT NULL
         )
         ORDER BY city`,
        [seasonName]
    );

    return { seasonName, draftDate, teams: teamsRes.rows };
}

// Completed, real (non-Classic, non-Phantoms, regular) series this team has played.
async function countRealSeries(db, seasonName, teamId) {
    const res = await db.query(
        `SELECT COUNT(*)::int AS n FROM series_results
         WHERE season_name = $1
           AND style IS DISTINCT FROM 'Classic'
           AND winning_score IS NOT NULL
           AND round IS DISTINCT FROM 'Golden Spaceship'
           AND round IS DISTINCT FROM 'Wooden Spoon'
           AND round IS DISTINCT FROM 'Silver Submarine'
           AND winning_team_name IS DISTINCT FROM 'Phantoms'
           AND losing_team_name IS DISTINCT FROM 'Phantoms'
           AND (winning_team_id = $2 OR losing_team_id = $2)`,
        [seasonName, teamId]
    );
    return res.rows[0].n;
}

// Phantom losses already charged to this team this season (summed, since one row
// can carry multiple).
async function countPhantomLosses(db, seasonName, teamId) {
    const res = await db.query(
        `SELECT COALESCE(SUM(winning_score), 0)::int AS n FROM series_results
         WHERE season_name = $1
           AND winning_team_name = 'Phantoms'
           AND losing_team_id = $2`,
        [seasonName, teamId]
    );
    return res.rows[0].n;
}

// --- core operations --------------------------------------------------------

// Reconcile and charge any new phantom losses due as of `asOf`.
// Returns { season, required, markDate, assignments: [{ teamId, city, logo_url, count }] }.
async function applyPhantomLosses(db = pool, asOf = new Date(), opts = {}) {
    const season = await getPhantomSeason(db);
    if (!season) return { season: null, assignments: [] };

    const required = requiredSeries(asOf, season.draftDate);
    const markDate = latestMark(asOf, season.draftDate, PHANTOM_ENFORCEMENT_START);
    if (required <= 0 || !markDate) {
        return { season: season.seasonName, required, markDate, assignments: [] };
    }

    const assignments = [];
    for (const team of season.teams) {
        const realSeries = await countRealSeries(db, season.seasonName, team.team_id);
        const existingPhantom = await countPhantomLosses(db, season.seasonName, team.team_id);
        const assign = Math.max(0, required - realSeries - existingPhantom);
        if (assign > 0) {
            assignments.push({ teamId: team.team_id, city: team.city, logo_url: team.logo_url, count: assign });
        }
    }

    if (!opts.dryRun && assignments.length > 0) {
        for (const a of assignments) {
            const lossWord = a.count === 1 ? 'loss' : 'losses';
            await db.query(
                `INSERT INTO series_results
                    (season_name, round, date, winning_team_id, losing_team_id,
                     winning_team_name, losing_team_name, winning_score, losing_score, notes, status, result_source)
                 VALUES ($1, 'Regular Season', $2, NULL, $3, 'Phantoms', $4, $5, 0, $6, 'completed', 'auto')`,
                [
                    season.seasonName,
                    markDate,
                    a.teamId,
                    a.city,
                    a.count,
                    `Auto-assigned phantom ${lossWord}: ${required} series required by this point in the season.`
                ]
            );
        }
        console.log(`[phantomMonitor] Charged phantom losses for ${season.seasonName}:`,
            assignments.map(a => `${a.city} (${a.count})`).join(', '));
        await sendPhantomLossesEmail(assignments, markDate, db);
    }

    return { season: season.seasonName, required, markDate, assignments };
}

// On the single day one week before the next mark, email the teams at risk.
// Returns { season, nextMark, warnDay, teamsAtRisk: [{ teamId, city, logo_url, count }] }.
async function sendPhantomWarnings(db = pool, asOf = new Date(), opts = {}) {
    const season = await getPhantomSeason(db);
    if (!season) return { season: null, teamsAtRisk: [] };

    const nextMark = nextMarkAfter(asOf, season.draftDate, PHANTOM_ENFORCEMENT_START);
    if (!nextMark) return { season: season.seasonName, nextMark: null, teamsAtRisk: [] };

    const warnDay = addDays(nextMark, -7);
    const isWarnDay = startOfDay(asOf).getTime() === warnDay.getTime();
    if (!isWarnDay && !opts.force) {
        return { season: season.seasonName, nextMark, warnDay, teamsAtRisk: [] };
    }

    const requiredAtMark = requiredSeries(nextMark, season.draftDate);
    const teamsAtRisk = [];
    for (const team of season.teams) {
        const realSeries = await countRealSeries(db, season.seasonName, team.team_id);
        const existingPhantom = await countPhantomLosses(db, season.seasonName, team.team_id);
        const projected = Math.max(0, requiredAtMark - realSeries - existingPhantom);
        if (projected > 0) {
            teamsAtRisk.push({ teamId: team.team_id, city: team.city, logo_url: team.logo_url, count: projected });
        }
    }

    if (!opts.dryRun && teamsAtRisk.length > 0) {
        console.log(`[phantomMonitor] Phantom warning for ${season.seasonName} (mark ${warnDay ? nextMark.toDateString() : ''}):`,
            teamsAtRisk.map(t => `${t.city} (${t.count})`).join(', '));
        await sendPhantomWarningEmail(teamsAtRisk, nextMark, db);
    }

    return { season: season.seasonName, nextMark, warnDay, teamsAtRisk };
}

function startPhantomMonitor() {
    // Apply phantom losses at 11:59 PM daily. Acts on a mark's calendar day; on
    // other days the reconciliation finds nothing new to charge.
    cron.schedule('59 23 * * *', () => {
        applyPhantomLosses().catch(err => console.error('[phantomMonitor] apply error:', err));
    });

    // Send warnings at 9 AM daily; the function itself only emails on the exact
    // day one week before an upcoming mark.
    cron.schedule('0 9 * * *', () => {
        sendPhantomWarnings().catch(err => console.error('[phantomMonitor] warning error:', err));
    });

    console.log('[phantomMonitor] started (apply @ 23:59, warnings @ 09:00 daily)');
}

module.exports = {
    startPhantomMonitor,
    applyPhantomLosses,
    sendPhantomWarnings,
    getPhantomSeason,
    // exported for testing
    requiredSeries,
    latestMark,
    nextMarkAfter,
    addMonths,
    PHANTOM_ENFORCEMENT_START,
};
