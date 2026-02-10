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

async function sendEmail(to, subject, html) {
    if (!to || to.length === 0) {
        console.log("No recipients for email:", subject);
        return;
    }

    const isProduction = process.env.NODE_ENV === 'production';

    // Priority: API if available
    if (process.env.BREVO_API_KEY) {
         try {
            console.log(`Sending email via Brevo API to ${Array.isArray(to) ? to.join(', ') : to}`);
            const result = await sendViaBrevo(to, subject, html);
            console.log("Message sent via Brevo:", result.messageId || 'Success');
            return;
        } catch (error) {
            console.error("Error sending email via Brevo:", error.message);
            // We could fall back to SMTP here, but if BREVO is set, it likely means SMTP is blocked.
            // Let's fallback only if explicitly requested, otherwise fail.
            // For now, let's log and try SMTP as a desperate backup?
            // No, the user goal is to avoid timeouts. SMTP will timeout.
            return;
        }
    }

    const hasEmailConfig = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS;

    if (!isProduction || !hasEmailConfig) {
        console.log("--- SIMULATING EMAIL SEND ---");
        if (!hasEmailConfig && isProduction) {
            console.log("(Simulation active due to missing email configuration)");
        }

        const recipients = Array.isArray(to) ? to.join(', ') : to;
        console.log(`To: ${recipients}`);
        console.log(`Subject: ${subject}`);
        console.log(`Content: ${html.substring(0, 100)}...`);
        return;
    }

    const mailOptions = {
        from: `"League Commissioner" <${process.env.EMAIL_USER}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: subject,
        html: html,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log("Message sent: %s", info.messageId);
    } catch (error) {
        console.error("Error sending email:", error);
    }
}

// Template: Pick Confirmation
async function sendPickConfirmation(pickDetails, nextTeam, client) {
    const recipients = await getLeagueEmails(client);
    const { player, team, round, pickNumber } = pickDetails;

    const subject = nextTeam ? `${nextTeam.name} ON THE CLOCK` : `Draft Complete!`;

    const teamLogoImg = team.logo_url ? `<img src="${team.logo_url}" style="height: 30px; vertical-align: middle; margin-right: 8px;" />` : '';
    const nextTeamLogoImg = (nextTeam && nextTeam.logo_url) ? `<img src="${nextTeam.logo_url}" style="height: 30px; vertical-align: middle; margin-right: 8px;" />` : '';

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                ${teamLogoImg}
                <h2 style="margin: 0;">The Pick Is In!</h2>
            </div>

            <p><strong>${team.name}</strong> has selected <strong>${player.name}</strong> (${player.position || 'Player'}) in Round ${round}, Pick ${pickNumber}.</p>

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

    await sendEmail(recipients, subject, html);
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

    await sendEmail(recipients, subject, html);
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

    await sendEmail(recipients, subject, html);
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

    await sendEmail(recipients, subject, html);
}

module.exports = {
    sendPickConfirmation,
    sendStalledDraftNotification,
    sendClassicRosterSubmissionEmail,
    sendRandomRemovalsEmail,
    verifyConnection
};
