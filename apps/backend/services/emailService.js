const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const https = require('https');
const { pool } = require('../db');

// Helper to create transport config
function getTransportConfig(overridePort = null) {
    const isGmailHost = (process.env.EMAIL_HOST || '').trim().toLowerCase() === 'smtp.gmail.com';
    const isGmailService = process.env.EMAIL_SERVICE === 'Gmail';

    const baseConfig = {
        family: 4, // Force IPv4 to prevent IPv6 connection issues on some platforms
        connectionTimeout: 60000, // 60 seconds
        greetingTimeout: 30000, // 30 seconds
        socketTimeout: 60000, // 60 seconds
        debug: process.env.EMAIL_DEBUG === 'true', // Enable debug output if configured
        logger: process.env.EMAIL_DEBUG === 'true', // Log to console if configured
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    };

    // Use overridePort if provided, otherwise use env var
    const explicitPort = overridePort !== null ? overridePort : process.env.EMAIL_PORT;

    // Improved configuration logic:
    // If it is Gmail, and we are either explicitly asking for 465 (fallback) or have no preference,
    // we use the 'Gmail' service preset which is generally more robust for Nodemailer+Gmail.
    // We also use it if the user explicitly set EMAIL_SERVICE=Gmail.
    // We AVOID it if the user explicitly requested port 587 (STARTTLS) to respect their config,
    // unless this is a fallback attempt (overridePort is set).
    const shouldUseGmailService = (isGmailHost || isGmailService) &&
                                  (!explicitPort || parseInt(explicitPort) === 465 || (overridePort !== null));

    if (shouldUseGmailService) {
        console.log('Detected Gmail configuration - using service: "Gmail" (Port 465/SSL)');
        baseConfig.service = 'Gmail';
        // Note: 'service' option sets host, port, and secure automatically.
    } else {
        baseConfig.host = process.env.EMAIL_HOST;
        if (isGmailHost && !baseConfig.host) {
            baseConfig.host = 'smtp.gmail.com';
        }

        baseConfig.port = explicitPort ? parseInt(explicitPort) : 587; // Default to 587 if not set
        baseConfig.secure = baseConfig.port === 465; // true for 465, false for other ports (587, 2525)

        // Log configuration (excluding credentials)
        console.log(`Configuring Email: Host=${baseConfig.host || '(Service default)'}, Port=${baseConfig.port}, Secure=${baseConfig.secure}`);
    }

    return baseConfig;
}

// Initial transporter setup
let transporter = nodemailer.createTransport(getTransportConfig());

// NEW: Brevo (formerly Sendinblue) HTTP API Transport
async function sendViaBrevo(to, subject, html) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            return reject(new Error('Missing BREVO_API_KEY'));
        }

        // Brevo requires sender info. We default to EMAIL_USER if available.
        const senderEmail = process.env.EMAIL_USER;
        const senderName = "Roger Goodell";

        if (!senderEmail) {
             return reject(new Error('Missing EMAIL_USER (needed for sender address in Brevo)'));
        }

        const toAddresses = Array.isArray(to) ? to : [to];
        const recipients = toAddresses.map(email => ({ email }));

        const data = JSON.stringify({
            sender: { email: senderEmail, name: senderName },
            to: recipients,
            subject: subject,
            htmlContent: html
        });

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(body);
                        resolve(parsed); // Returns { messageId: '...' }
                    } catch (e) {
                         // Fallback if response isn't JSON
                        resolve({ messageId: 'unknown-brevo-id', raw: body });
                    }
                } else {
                    reject(new Error(`Brevo API Error (${res.statusCode}): ${body}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(data);
        req.end();
    });
}


// Verification Function
async function verifyConnection() {
    const isProduction = process.env.NODE_ENV === 'production';

    // Check for Brevo API Key
    if (process.env.BREVO_API_KEY) {
        console.log("✅ Email Service: BREVO_API_KEY detected. Switching to HTTP API mode.");
        console.log("   (Skipping SMTP verification as it is blocked on this environment)");
        return; // Skip SMTP checks
    }

    const hasEmailConfig = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS;

    if (!isProduction || !hasEmailConfig) {
        console.log("--- Email Service: Verification Skipped (Dev/Missing Config) ---");
        return;
    }

    // 1. DNS Resolution Check
    if (process.env.EMAIL_HOST) {
        try {
            console.log(`Attempting DNS resolution for ${process.env.EMAIL_HOST}...`);
            const addresses = await dns.resolve4(process.env.EMAIL_HOST);
            console.log(`✅ DNS Resolution Success: ${process.env.EMAIL_HOST} -> ${addresses.join(', ')}`);
        } catch (dnsErr) {
            console.error(`❌ DNS Resolution Failed for ${process.env.EMAIL_HOST}:`, dnsErr.message);
            console.log("Proceeding with connection attempt anyway...");
        }
    }

    // 2. SMTP Connection Check
    try {
        await transporter.verify();
        console.log("✅ Email Service: SMTP Connection Established Successfully");
    } catch (error) {
        console.error(`❌ Email Service: Connection Failed on initial configuration! Error: ${error.message}`);

        // Fallback Logic
        // If we haven't already tried the 'Gmail' service preset (implied by port 465), try it now.
        // Even if we aren't using Gmail, we can try to switch ports if we were on 587.

        const currentPort = transporter.options.port;
        // Check if we should fallback.
        // If we are on Gmail and failed, we force the 'Gmail' service preset (Port 465)
        const isGmail = (process.env.EMAIL_HOST || '').includes('gmail');

        if (isGmail || (currentPort && parseInt(currentPort) === 587)) {
            console.log("⚠️  Attempting fallback configuration (Gmail Service / Port 465)...");
            try {
                // Passing 465 to getTransportConfig triggers the 'Gmail' service preset logic
                const newConfig = getTransportConfig(465);
                transporter = nodemailer.createTransport(newConfig);
                await transporter.verify();
                console.log("✅ Email Service: SMTP Connection Established Successfully (Fallback Configuration)");
            } catch (fallbackError) {
                console.error("❌ Email Service: Fallback Connection Failed!");
                console.error(fallbackError);
                // We do NOT exit the process here, as the app should still run even if email is broken.
            }
        } else {
             console.error(error);
        }
    }
}

// Helper: Get all user emails
async function getLeagueEmails(client) {
    try {
        // Just fetch all users for now. In a real multi-league app, we'd filter by league/team.
        // Assuming single league context based on current codebase structure.
        const res = await client.query('SELECT email FROM users WHERE email IS NOT NULL');
        return res.rows.map(r => r.email);
    } catch (error) {
        console.error("Error fetching league emails:", error);
        return [];
    }
}

// Record one send attempt in email_log. Best-effort: a logging failure must never
// take down the caller (a cron job or a request handler that already did its work),
// so this swallows its own errors after complaining to stdout.
async function recordEmailAttempt(kind, to, subject, outcome) {
    const recipients = Array.isArray(to) ? to : [to];
    try {
        await pool.query(
            `INSERT INTO email_log (kind, recipients, subject, status, provider, message_id, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                kind,
                recipients,
                subject,
                outcome.status,
                outcome.provider || null,
                outcome.messageId || null,
                outcome.error || null,
            ]
        );
    } catch (err) {
        console.error(`[email] Could not write email_log row for "${subject}":`, err.message);
    }
}

// Send an email and REPORT WHAT HAPPENED.
//
// Returns { ok, status, provider, messageId?, error? } and never throws — callers
// are mid-request or mid-cron and must not fail because mail is down. But every
// outcome is now loud on stdout and persisted to email_log, so a dead provider is
// visible instead of being swallowed. `kind` is a short slug identifying the
// template (used to query the log later).
async function sendEmail(to, subject, html, kind = 'unknown') {
    if (!to || to.length === 0) {
        console.warn(`[email] ⚠️  No recipients for "${subject}" (${kind}) — nothing sent.`);
        const outcome = { status: 'skipped', provider: 'none', error: 'no recipients' };
        await recordEmailAttempt(kind, [], subject, outcome);
        return { ok: false, ...outcome };
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const recipientList = Array.isArray(to) ? to : [to];

    // Priority: API if available
    if (process.env.BREVO_API_KEY) {
        try {
            console.log(`[email] Sending "${subject}" (${kind}) via Brevo to ${recipientList.join(', ')}`);
            const result = await sendViaBrevo(to, subject, html);
            const outcome = { status: 'sent', provider: 'brevo', messageId: result.messageId || null };
            console.log(`[email] ✅ Sent via Brevo (${kind}): ${outcome.messageId || 'ok'}`);
            await recordEmailAttempt(kind, recipientList, subject, outcome);
            return { ok: true, ...outcome };
        } catch (error) {
            // Deliberately NO SMTP fallback: BREVO_API_KEY being set means SMTP is
            // blocked on this host, so falling back would just burn the 60s timeout.
            // Fail fast, but fail *visibly*.
            const outcome = { status: 'failed', provider: 'brevo', error: error.message };
            console.error(`[email] ❌ EMAIL FAILED (${kind}) "${subject}" -> ${recipientList.join(', ')}: ${error.message}`);
            await recordEmailAttempt(kind, recipientList, subject, outcome);
            return { ok: false, ...outcome };
        }
    }

    const hasEmailConfig = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS;

    if (!isProduction || !hasEmailConfig) {
        // Nothing was actually delivered. In production this is a misconfiguration,
        // not a normal state, so say so at error level and log it as 'simulated'
        // rather than 'sent' — the two must never look alike after the fact.
        if (!hasEmailConfig && isProduction) {
            console.error(`[email] ❌ NOT SENT (${kind}) "${subject}": no email configuration in production (need BREVO_API_KEY, or EMAIL_HOST + EMAIL_USER + EMAIL_PASS).`);
        } else {
            console.log(`--- SIMULATING EMAIL SEND (${kind}) ---`);
            console.log(`To: ${recipientList.join(', ')}`);
            console.log(`Subject: ${subject}`);
            console.log(`Content: ${html.substring(0, 100)}...`);
        }

        const outcome = {
            status: 'simulated',
            provider: 'none',
            error: !hasEmailConfig && isProduction ? 'missing email configuration in production' : null,
        };
        await recordEmailAttempt(kind, recipientList, subject, outcome);
        return { ok: false, ...outcome };
    }

    const mailOptions = {
        from: `"League Commissioner" <${process.env.EMAIL_USER}>`,
        to: recipientList.join(', '),
        subject: subject,
        html: html,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        const outcome = { status: 'sent', provider: 'smtp', messageId: info.messageId || null };
        console.log(`[email] ✅ Sent via SMTP (${kind}): ${outcome.messageId || 'ok'}`);
        await recordEmailAttempt(kind, recipientList, subject, outcome);
        return { ok: true, ...outcome };
    } catch (error) {
        const outcome = { status: 'failed', provider: 'smtp', error: error.message };
        console.error(`[email] ❌ EMAIL FAILED (${kind}) "${subject}" -> ${recipientList.join(', ')}: ${error.message}`);
        await recordEmailAttempt(kind, recipientList, subject, outcome);
        return { ok: false, ...outcome };
    }
}

// Template: Pick Confirmation
async function sendPickConfirmation(pickDetails, nextTeam, client) {
    const recipients = await getLeagueEmails(client);
    const { player, team, round, pickNumber, addedPlayers, droppedPlayers } = pickDetails;

    const subject = nextTeam ? `${nextTeam.name} ON THE CLOCK` : `Draft Complete!`;

    const teamLogoImg = team.logo_url ? `<img src="${team.logo_url}" style="height: 30px; width: auto; object-fit: contain; vertical-align: middle; margin-right: 8px;" />` : '';
    const nextTeamLogoImg = (nextTeam && nextTeam.logo_url) ? `<img src="${nextTeam.logo_url}" style="height: 30px; width: auto; object-fit: contain; vertical-align: middle; margin-right: 8px;" />` : '';

    let messageBody = '';
    let title = 'The Pick Is In!';

    if (addedPlayers && addedPlayers.length > 0) {
        title = 'Roster Submitted';
        let addedHtml = '<h4>Players Added:</h4><ul>';
        addedPlayers.forEach(p => addedHtml += `<li>${p}</li>`);
        addedHtml += '</ul>';

        let droppedHtml = '';
        if (droppedPlayers && droppedPlayers.length > 0) {
            droppedHtml = '<h4>Players Dropped:</h4><ul>';
            droppedPlayers.forEach(p => droppedHtml += `<li>${p}</li>`);
            droppedHtml += '</ul>';
        }

        messageBody = `
            <p><strong>${team.name}</strong> has submitted their roster moves for Round ${round}, Pick ${pickNumber}.</p>
            ${addedHtml}
            ${droppedHtml}
        `;
    } else if (player.position === 'Multi') {
        messageBody = `<p><strong>${team.name}</strong> has confirmed current roster with no changes.</p>`;
    } else {
        messageBody = `<p><strong>${team.name}</strong> has selected <strong>${player.name}</strong> (${player.position || 'Player'}) in Round ${round}, Pick ${pickNumber}.</p>`;
    }

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                ${teamLogoImg}
                <h2 style="margin: 0;">${title}</h2>
            </div>

            ${messageBody}

            <hr />

            <div style="display: flex; align-items: center; margin-top: 15px; margin-bottom: 10px;">
                 ${nextTeamLogoImg}
                 <h3 style="margin: 0;">Up Next: ${nextTeam ? nextTeam.name : 'Draft Complete!'}</h3>
            </div>

            <p>
                <a href="${process.env.FRONTEND_URL}/draft" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Draft Board</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'pick_confirmation');
}

// Template: Classic Roster Submission
async function sendClassicRosterSubmissionEmail(userWhoSubmitted, missingUsers, client) {
    const recipients = await getLeagueEmails(client);

    const submitterName = userWhoSubmitted.owner_name || userWhoSubmitted.email;
    const missingNames = missingUsers.map(u => u.owner_name || u.email).join(', ');

    const subject = `Classic Roster Submitted: ${submitterName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Roster Submission Update</h2>
            <p><strong>${submitterName}</strong> has submitted their Classic roster.</p>

            <hr />

            <h3>Still Need To Submit:</h3>
            <p>${missingNames || "Everyone has submitted! Ready to reveal!"}</p>

            <p>
                <a href="${process.env.FRONTEND_URL}/classic" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Classic League</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'classic_roster_submission');
}

// Template: Stalled Draft Notification
async function sendStalledDraftNotification(level, team, client) {
    const recipients = await getLeagueEmails(client);

    let subject = '';
    let messageBody = '';

    if (level === 1) { // 24 Hours
        subject = `${team.name} Receives 24 Hour Frown of Disapproval Note`;
        messageBody = `
            <h3>Frown of Disapproval Note ☹️</h3>
            <p>It has been over 24 hours since the last pick.</p>
            <p><strong>${team.name}</strong> has officially received a Frown of Disapproval Note.</p>
            <p>Your Friend, Roger</p>
        `;
    } else if (level === 2) { // 48 Hours
        subject = `${team.name} Receives 48 Hour Notice of Censure`;
        messageBody = `
            <h3>48 Hour Notice of Censure ⚠️</h3>
            <p>It has been over 48 hours since the last pick.</p>
            <p><strong>${team.name}</strong> has officially received a Notice of Censure.</p>
            <p>The league is waiting...</p>
            <p>Your Friend, Roger</p>
        `;
    } else if (level === 3) { // 72 Hours
        subject = `${team.name} Receives 72 Hour Threat of Pick Forfeiture`;
        messageBody = `
            <h3>Threat of Pick Forfeiture 🚨</h3>
            <p>It has been over 72 hours since the last pick.</p>
            <p><strong>${team.name}</strong> has officially received a 72 Hour Threat of Pick Forfeiture.</p>
            <p>Make your pick immediately or risk losing it!</p>
            <p>Your Friend, Roger is worried about you<p>
        `;
    }

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            ${messageBody}
            <p>
                <a href="${process.env.FRONTEND_URL}/draft" style="background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Draft</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'stalled_draft');
}

// Template: Random Removals Email
async function sendRandomRemovalsEmail(removalsByTeam, firstPickTeamName, client) {
    const recipients = await getLeagueEmails(client);

    let removalsHtml = '';
    // Sort teams alphabetically for display
    const teamNames = Object.keys(removalsByTeam).sort();

    for (const teamName of teamNames) {
        const players = removalsByTeam[teamName];
        removalsHtml += `<h3>${teamName}</h3><ul>`;
        players.forEach(p => {
            removalsHtml += `<li>${p}</li>`;
        });
        removalsHtml += `</ul>`;
    }

    const subject = "Random Removals Complete - Draft Started!";
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Random Removals Performed</h2>
            <p>The following players have been removed from rosters:</p>
            ${removalsHtml}
            <hr />
            <h3>Draft Order Set!</h3>
            <p><strong>${firstPickTeamName}</strong> has the first pick!</p>
            <p>
                <a href="${process.env.FRONTEND_URL}/draft" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Draft Board</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'random_removals');
}

// Template: Roster Update Notification (Manual Edits)
async function sendRosterUpdateEmail(teamName, added, dropped, client) {
    const recipients = await getLeagueEmails(client);

    let addedHtml = '';
    if (added && added.length > 0) {
        addedHtml = '<h4>Added:</h4><ul>';
        added.forEach(p => addedHtml += `<li>${p.name || p}</li>`);
        addedHtml += '</ul>';
    }

    let droppedHtml = '';
    if (dropped && dropped.length > 0) {
        droppedHtml = '<h4>Dropped:</h4><ul>';
        dropped.forEach(p => droppedHtml += `<li>${p.name || p}</li>`);
        droppedHtml += '</ul>';
    }

    const subject = `Roster Update: ${teamName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${teamName} has updated their roster.</h2>
            ${addedHtml}
            ${droppedHtml}
            <hr />
            <p>
                <a href="${process.env.FRONTEND_URL}/league" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View League Page</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'roster_update');
}

// Helper: format a Date for phantom emails (e.g. "July 9, 2026")
function formatPhantomDate(date) {
    try {
        return new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
        return String(date);
    }
}

// Helper: render a team row with optional logo for phantom emails
function phantomTeamRow(team) {
    const logoImg = team.logo_url
        ? `<img src="${team.logo_url}" style="height: 22px; width: auto; object-fit: contain; vertical-align: middle; margin-right: 8px;" />`
        : '';
    const lossWord = team.count === 1 ? 'loss' : 'losses';
    return `<li style="margin-bottom: 6px;">${logoImg}<strong>${team.city}</strong> — ${team.count} phantom ${lossWord}</li>`;
}

// Template: Phantom Loss Warning (one week out)
// teamsAtRisk: [{ city, logo_url, count }]  count = phantom losses they'll receive if they don't play
async function sendPhantomWarningEmail(teamsAtRisk, markDate, client) {
    if (!teamsAtRisk || teamsAtRisk.length === 0) return;
    const recipients = await getLeagueEmails(client);

    const dateStr = formatPhantomDate(markDate);
    const teamsHtml = teamsAtRisk.map(phantomTeamRow).join('');

    const subject = `⏳ One Week Warning: Phantom Losses Loom (${dateStr})`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="margin-top: 0;">👻 Phantom Loss Warning</h2>
            <p>One week from now, on <strong>${dateStr}</strong>, the Phantoms come calling. The following teams will be charged a phantom loss unless they get a series in before then:</p>
            <ul style="list-style: none; padding-left: 0;">
                ${teamsHtml}
            </ul>
            <p>Play your series and avoid the haunting.</p>
            <p>Your Friend, Roger</p>
            <p>
                <a href="${process.env.FRONTEND_URL}/league" style="background-color: #6c757d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Standings</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'phantom_warning');
}

// Template: Phantom Losses Assigned (on the mark date)
// assignments: [{ city, logo_url, count }]  count = phantom losses just assigned
async function sendPhantomLossesEmail(assignments, markDate, client) {
    if (!assignments || assignments.length === 0) return;
    const recipients = await getLeagueEmails(client);

    const dateStr = formatPhantomDate(markDate);
    const teamsHtml = assignments.map(phantomTeamRow).join('');

    const subject = `👻 Phantom Losses Assigned (${dateStr})`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="margin-top: 0;">👻 The Phantoms Have Struck</h2>
            <p>As of <strong>${dateStr}</strong>, the following teams had not played their required series in time and have been charged phantom losses:</p>
            <ul style="list-style: none; padding-left: 0;">
                ${teamsHtml}
            </ul>
            <p>These losses count in the standings. Get your series played to avoid more.</p>
            <p>Your Friend, Roger</p>
            <p>
                <a href="${process.env.FRONTEND_URL}/league" style="background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Standings</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'phantom_losses');
}

// Template: Postseason Stall (Spaceship / Wooden Spoon left unplayed)
//
// series: [{ round, seasonName, teams: [{ city, logo_url }], deadline, months, kind }]
// kind is 'warning' (one week out) or 'overdue' (the deadline has arrived). A
// single email covers every stalled series; if both the Spaceship and the Spoon
// are dragging, one notice names both rather than two arriving together.
async function sendPostseasonStallEmail(series, client) {
    if (!series || series.length === 0) return;
    const recipients = await getLeagueEmails(client);

    const anyOverdue = series.some(s => s.kind === 'overdue');

    const blocks = series.map(s => {
        const teamsHtml = s.teams.map(t => {
            const logoImg = t.logo_url
                ? `<img src="${t.logo_url}" style="height: 22px; width: auto; object-fit: contain; vertical-align: middle; margin-right: 8px;" />`
                : '';
            return `<li style="margin-bottom: 6px;">${logoImg}<strong>${t.city}</strong></li>`;
        }).join('');
        const when = formatPhantomDate(s.deadline);
        const line = s.kind === 'overdue'
            ? `has now gone <strong>${s.months} month${s.months === 1 ? '' : 's'}</strong> unplayed as of <strong>${when}</strong>.`
            : `must be played by <strong>${when}</strong> — one week from now.`;
        return `
            <div style="margin-bottom: 18px;">
                <p style="margin-bottom: 6px;">The <strong>${s.round}</strong> (${s.seasonName}) ${line}</p>
                <ul style="list-style: none; padding-left: 0; margin-top: 6px;">${teamsHtml}</ul>
            </div>
        `;
    }).join('');

    const subject = anyOverdue
        ? `🏆 Postseason Overdue: The ${series.map(s => s.round).join(' & ')} Is Still Unplayed`
        : `⏳ One Week Warning: Postseason Series Unplayed`;

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="margin-top: 0;">🏆 The Postseason Is Waiting</h2>
            ${blocks}
            <p>Teams that leave a postseason series unplayed <strong>each drop a spot in the next draft</strong>. Get it on the calendar.</p>
            <p>Your Friend, Roger</p>
            <p>
                <a href="${process.env.FRONTEND_URL}/league" style="background-color: ${anyOverdue ? '#dc3545' : '#6c757d'}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Schedule</a>
            </p>
        </div>
    `;

    return sendEmail(recipients, subject, html, 'postseason_stall');
}

// Template: Provider Keep-Alive
//
// Brevo deactivates an API key after 90 days with no activity, which is what
// silently killed all league email over the 2026 offseason. This goes to the
// commissioner rather than the league — nobody else needs to see it — purely so
// the account clock resets. Sent only when nothing else has gone out recently
// (see jobs/emailKeepalive.js), so an active season never triggers it.
async function sendKeepaliveEmail(daysSinceLastSend) {
    const to = process.env.KEEPALIVE_RECIPIENT || process.env.EMAIL_USER;
    if (!to) {
        console.error('[email] ❌ Keep-alive has no recipient (set KEEPALIVE_RECIPIENT or EMAIL_USER).');
        return { ok: false, status: 'skipped', provider: 'none', error: 'no keepalive recipient' };
    }

    const gap = daysSinceLastSend === null
        ? 'No previous successful send is on record.'
        : `The last successful send was ${daysSinceLastSend} days ago.`;

    const subject = '🫀 Showdown League email keep-alive';
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="margin-top: 0;">Keep-alive</h2>
            <p>${gap} This message exists only to keep the Brevo API key from being
               deactivated for inactivity (Brevo drops keys after 90 days of no activity).</p>
            <p>No action needed. If you are seeing these during a season, league email
               may be failing — check <code>email_log</code> for rows with status
               <code>failed</code>.</p>
        </div>
    `;

    return sendEmail([to], subject, html, 'keepalive');
}

module.exports = {
    sendPickConfirmation,
    sendStalledDraftNotification,
    sendClassicRosterSubmissionEmail,
    sendRandomRemovalsEmail,
    sendRosterUpdateEmail,
    sendPhantomWarningEmail,
    sendPhantomLossesEmail,
    sendPostseasonStallEmail,
    sendKeepaliveEmail,
    verifyConnection
};
