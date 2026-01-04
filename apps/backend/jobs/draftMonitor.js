const cron = require('node-cron');
const { pool } = require('../db'); // Adjust path to your db.js
const { sendStalledDraftNotification } = require('../services/emailService');

async function checkStalledDrafts() {
    const client = await pool.connect();
    try {
        console.log("Checking for stalled drafts...");
        const res = await client.query('SELECT * FROM draft_state WHERE is_active = true');

        if (res.rows.length === 0) {
            console.log("No active draft found.");
            return;
        }

        const state = res.rows[0];
        const lastUpdated = new Date(state.updated_at);
        const now = new Date();
        const diffMs = now - lastUpdated;
        const diffHours = diffMs / (1000 * 60 * 60);

        let newLevel = state.notification_level || 0;
        let shouldNotify = false;

        // Logic:
        // Level 0 -> 1 if > 24 hours
        // Level 1 -> 2 if > 48 hours
        // Level 2 -> 3 if > 72 hours
        // We ensure we don't spam by only advancing one level at a time per check,
        // or effectively handling the state transition.

        if (diffHours >= 72 && newLevel < 3) {
            newLevel = 3;
            shouldNotify = true;
        } else if (diffHours >= 48 && newLevel < 2) {
            newLevel = 2;
            shouldNotify = true;
        } else if (diffHours >= 24 && newLevel < 1) {
            newLevel = 1;
            shouldNotify = true;
        }

        if (shouldNotify) {
            const teamRes = await client.query('SELECT name, city FROM teams WHERE team_id = $1', [state.active_team_id]);
            const team = teamRes.rows[0];
            const teamName = { name: `${team.city} ${team.name}` };

            console.log(`Sending Level ${newLevel} notification to ${teamName.name}`);

            await sendStalledDraftNotification(newLevel, teamName, client);

            await client.query('UPDATE draft_state SET notification_level = $1 WHERE id = $2', [newLevel, state.id]);
        } else {
            console.log("No new notifications needed.");
        }

    } catch (error) {
        console.error("Error in draft monitor job:", error);
    } finally {
        client.release();
    }
}

function startDraftMonitor() {
    // Run every hour
    cron.schedule('0 * * * *', () => {
        checkStalledDrafts();
    });

    // Also run immediately on startup (for dev verification mainly, or remove for prod)
    if (process.env.NODE_ENV !== 'production') {
        setTimeout(checkStalledDrafts, 5000); // Wait 5s for DB connection
    }
}

module.exports = { startDraftMonitor, checkStalledDrafts };
