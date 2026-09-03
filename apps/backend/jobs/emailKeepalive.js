const cron = require('node-cron');
const { pool } = require('../db');
const { sendKeepaliveEmail } = require('../services/emailService');

// --- Provider keep-alive -----------------------------------------------------
//
// Brevo deactivates an API key after 90 days with no activity. Over the 2026
// offseason that happened silently: the key went dead, every send afterwards
// failed with 401 "API Key is not enabled", and nobody found out until someone
// happened to read the server logs months later.
//
// The naive fix is a send every 89 days, but that is a single-shot timer with no
// margin — if that one send fails, the key is deactivated the next day and there
// is no second attempt. This instead treats 90 days as a DEADLINE and keeps a
// buffer: check weekly, and if nothing has been sent successfully in
// KEEPALIVE_AFTER_DAYS, send now. That leaves ~30 days and several retries before
// the window actually closes.
//
// During a season this never fires — real league mail keeps resetting the clock.
// It only wakes up in the quiet stretch between seasons, which is exactly when
// the problem occurs.
const KEEPALIVE_AFTER_DAYS = 60;

const LEAGUE_TIMEZONE = 'America/New_York';

// Whole days since the last successful send, or null if none is on record
// (either the log is empty or the table does not exist yet).
async function daysSinceLastSuccessfulSend(db = pool) {
    try {
        const res = await db.query(
            `SELECT EXTRACT(EPOCH FROM (now() - MAX(created_at))) / 86400 AS days
             FROM email_log WHERE status = 'sent'`
        );
        const days = res.rows[0] && res.rows[0].days;
        return days === null || days === undefined ? null : Math.floor(Number(days));
    } catch (err) {
        // Most likely the migration has not run yet. Report it rather than
        // silently treating "no data" as "nothing to do".
        console.error('[emailKeepalive] Could not read email_log:', err.message);
        return null;
    }
}

// Send a keep-alive if nothing has gone out recently.
// Returns { days, due, sent, result }.
async function runKeepaliveCheck(db = pool, opts = {}) {
    const days = await daysSinceLastSuccessfulSend(db);

    // A null reading means we have no evidence of a recent send. Treat that as
    // due rather than as "fine" — the whole point is to fail safe. Worst case we
    // send one harmless email to the commissioner and establish a baseline.
    const due = days === null || days >= KEEPALIVE_AFTER_DAYS;

    if (!due) {
        console.log(`[emailKeepalive] Last successful send was ${days} day(s) ago; no keep-alive needed.`);
        return { days, due: false, sent: false };
    }

    if (opts.dryRun) {
        return { days, due: true, sent: false };
    }

    console.log(`[emailKeepalive] ${days === null ? 'No successful send on record' : `${days} days since last send`} — sending keep-alive.`);
    const result = await sendKeepaliveEmail(days);
    if (!result || !result.ok) {
        console.error(`[emailKeepalive] ❌ Keep-alive FAILED (${result && result.status}): ${(result && result.error) || 'unknown error'}. Will retry next week; the provider key is at risk.`);
    }
    return { days, due: true, sent: !!(result && result.ok), result };
}

function startEmailKeepalive() {
    // Weekly, Monday mornings. Frequent enough that a failure has several more
    // chances before the 90-day deadline, rare enough to be silent in-season.
    cron.schedule('0 10 * * 1', () => {
        runKeepaliveCheck().catch(err => console.error('[emailKeepalive] error:', err));
    }, { timezone: LEAGUE_TIMEZONE });

    console.log(`[emailKeepalive] started (Mondays @ 10:00 ${LEAGUE_TIMEZONE}, threshold ${KEEPALIVE_AFTER_DAYS}d)`);
}

module.exports = {
    startEmailKeepalive,
    runKeepaliveCheck,
    daysSinceLastSuccessfulSend,
    KEEPALIVE_AFTER_DAYS,
};
