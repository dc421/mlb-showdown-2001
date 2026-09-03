const cron = require('node-cron');
const { pool } = require('../db');
const { sendPhantomWarningEmail, sendPhantomLossesEmail, sendPostseasonStallEmail } = require('../services/emailService');

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

// The league's wall-clock timezone. Hosts run on UTC, so without this the "9 AM"
// warning fires at 5 AM Eastern and the "11:59 PM" reconciliation at 7:59 PM.
const LEAGUE_TIMEZONE = 'America/New_York';

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

// Parse a 'YYYY-MM-DD' string into a local midnight Date. series_results.date is
// a DATE (a calendar day, not an instant); letting the driver or COALESCE turn it
// into a timestamptz lands it on UTC midnight, which reads back as the PREVIOUS
// day in Eastern and slides every deadline a day early. Everything in this file
// is calendar-day based, so keep it that way from the query outward.
function parseCalendarDay(value) {
    if (value instanceof Date) return startOfDay(value);
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d);
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
        const mail = await sendPhantomLossesEmail(assignments, markDate, db);
        // The losses are already in the standings at this point; a failed email
        // just means nobody was told. Say so plainly rather than leaving the
        // preceding success line as the last word.
        if (mail && !mail.ok) {
            console.error(`[phantomMonitor] ❌ Losses were charged but the notification did NOT go out (${mail.status}): ${mail.error || 'unknown error'}`);
        }
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
        const mail = await sendPhantomWarningEmail(teamsAtRisk, nextMark, db);
        // Unlike applyPhantomLosses, this job only fires on the exact warn day and
        // never retries, so a failed send means this mark's warning is gone for
        // good. Shout about it — re-send by hand via POST /dev/phantom-check
        // { mode: 'warn', dryRun: false, force: true }.
        if (mail && !mail.ok) {
            console.error(`[phantomMonitor] ❌ WARNING NOT DELIVERED for mark ${nextMark.toDateString()} (${mail.status}): ${mail.error || 'unknown error'}. This warning will not be retried automatically.`);
        }
    }

    return { season: season.seasonName, nextMark, warnDay, teamsAtRisk };
}

// --- Postseason stalls ------------------------------------------------------
//
// The phantom cadence above only governs the regular season, and it stops
// entirely once the postseason is scheduled (getPhantomSeason treats a Golden
// Spaceship row as the end of the season). That left a hole: the championship
// and Wooden Spoon series themselves could sit unplayed forever with nobody
// nagged about it, which is exactly what happened to Spring 2026.
//
// So these two series get their own clock, independent of the phantom season.
// A scheduled Spaceship/Spoon is expected to be played within a month of being
// scheduled; the league is emailed one week before that deadline and again on
// the deadline itself, repeating each month it stays unplayed. The eventual
// penalty is both teams dropping a spot in the next draft — that is applied by
// hand when the next draft order is built, NOT by this job.
//
// Only Spaceship and Spoon are tracked, because those are the rounds the draft
// order keys off ([SpoonL, SpoonW, Neutral, ShipL, ShipW]); Silver Submarine is
// a Classic-side final and carries no draft consequence.
const STALL_ROUNDS = ['Golden Spaceship', 'Wooden Spoon'];

// Which stall notification, if any, falls on `asOf` for a series scheduled on
// `startDate`. Deadlines are monthly (start + 1mo, +2mo, ...); each one gets a
// warning 7 days out and an "overdue" notice on the day. Returns
// { kind: 'warning'|'overdue', deadline, months } or null on every other day.
function postseasonStallEvent(startDate, asOf) {
    const today = startOfDay(asOf);
    for (let k = 1; k <= MAX_MARKS; k++) {
        const deadline = addMonths(startDate, k);
        const warnDay = addDays(deadline, -7);
        if (today.getTime() === warnDay.getTime()) return { kind: 'warning', deadline, months: k };
        if (today.getTime() === deadline.getTime()) return { kind: 'overdue', deadline, months: k };
        // Ordering is warn_k < deadline_k < warn_(k+1), so once this month's
        // deadline is still ahead of us there is nothing later to match.
        if (deadline > today) break;
    }
    return null;
}

// Every Spaceship/Spoon series still sitting unplayed, with both participants.
async function getUnplayedPostseasonSeries(db) {
    const res = await db.query(
        `SELECT sr.id, sr.season_name, sr.round,
                COALESCE(sr.date, (sr.created_at AT TIME ZONE $2)::date)::text AS scheduled_on,
                wt.city AS winner_city, wt.logo_url AS winner_logo, sr.winning_team_name,
                lt.city AS loser_city,  lt.logo_url AS loser_logo,  sr.losing_team_name
         FROM series_results sr
         LEFT JOIN teams wt ON wt.team_id = sr.winning_team_id
         LEFT JOIN teams lt ON lt.team_id = sr.losing_team_id
         WHERE sr.round = ANY($1)
           AND sr.status IS DISTINCT FROM 'completed'
           AND sr.winning_score IS NULL
         ORDER BY sr.date, sr.round`,
        [STALL_ROUNDS, LEAGUE_TIMEZONE]
    );
    return res.rows.map(r => ({
        id: r.id,
        seasonName: r.season_name,
        round: r.round,
        scheduledOn: parseCalendarDay(r.scheduled_on),
        teams: [
            { city: r.winner_city || r.winning_team_name, logo_url: r.winner_logo },
            { city: r.loser_city || r.losing_team_name, logo_url: r.loser_logo },
        ].filter(t => t.city),
    }));
}

// Email the league about any postseason series that has stalled.
// Returns { series: [{ ...series, kind, deadline, months }] }.
async function sendPostseasonStallWarnings(db = pool, asOf = new Date(), opts = {}) {
    const unplayed = await getUnplayedPostseasonSeries(db);

    const due = [];
    for (const s of unplayed) {
        // force ignores the calendar and previews the first upcoming deadline,
        // so a missed send can be reissued by hand.
        const event = opts.force
            ? { kind: 'warning', deadline: addMonths(s.scheduledOn, 1), months: 1 }
            : postseasonStallEvent(s.scheduledOn, asOf);
        if (event) due.push({ ...s, ...event });
    }

    if (!opts.dryRun && due.length > 0) {
        console.log('[phantomMonitor] Postseason stall notice:',
            due.map(s => `${s.round} (${s.kind}, ${s.months}mo)`).join(', '));
        const mail = await sendPostseasonStallEmail(due, db);
        // Like the phantom warning, this fires only on exact days and is never
        // retried, so a failure means this notice is simply gone.
        if (mail && !mail.ok) {
            console.error(`[phantomMonitor] ❌ POSTSEASON STALL NOTICE NOT DELIVERED (${mail.status}): ${mail.error || 'unknown error'}. This notice will not be retried automatically.`);
        }
    }

    return { series: due };
}

function startPhantomMonitor() {
    // Apply phantom losses at 11:59 PM daily. Acts on a mark's calendar day; on
    // other days the reconciliation finds nothing new to charge.
    cron.schedule('59 23 * * *', () => {
        applyPhantomLosses().catch(err => console.error('[phantomMonitor] apply error:', err));
    }, { timezone: LEAGUE_TIMEZONE });

    // Send warnings at 9 AM daily; the function itself only emails on the exact
    // day one week before an upcoming mark.
    cron.schedule('0 9 * * *', () => {
        sendPhantomWarnings().catch(err => console.error('[phantomMonitor] warning error:', err));
        // Independent of the phantom season: the postseason has its own clock and
        // must keep being checked after the regular season ends.
        sendPostseasonStallWarnings().catch(err => console.error('[phantomMonitor] postseason stall error:', err));
    }, { timezone: LEAGUE_TIMEZONE });

    console.log(`[phantomMonitor] started (apply @ 23:59, warnings + postseason stall check @ 09:00 daily, ${LEAGUE_TIMEZONE})`);
}

module.exports = {
    startPhantomMonitor,
    applyPhantomLosses,
    sendPhantomWarnings,
    sendPostseasonStallWarnings,
    getPhantomSeason,
    getUnplayedPostseasonSeries,
    // exported for testing
    requiredSeries,
    latestMark,
    nextMarkAfter,
    postseasonStallEvent,
    addMonths,
    PHANTOM_ENFORCEMENT_START,
};
