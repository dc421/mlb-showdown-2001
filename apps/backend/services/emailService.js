const nodemailer = require('nodemailer');
const { pool } = require('../db');

// Configure transporter
const isGmail = (process.env.EMAIL_HOST || '').trim().toLowerCase() === 'smtp.gmail.com';
const transportConfig = {
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

if (isGmail || process.env.EMAIL_SERVICE === 'Gmail') {
    console.log('Detected Gmail configuration - enforcing service: "Gmail" (Port 465/SSL)');
    transportConfig.service = 'Gmail';
    // service: 'Gmail' automatically sets host, port (465), and secure (true)
} else {
    transportConfig.host = process.env.EMAIL_HOST;
    transportConfig.port = process.env.EMAIL_PORT;
    transportConfig.secure = process.env.EMAIL_PORT == 465; // true for 465, false for other ports
}

const transporter = nodemailer.createTransport(transportConfig);

// Verification Function
async function verifyConnection() {
    const isProduction = process.env.NODE_ENV === 'production';
    const hasEmailConfig = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS;

    if (!isProduction || !hasEmailConfig) {
        console.log("--- Email Service: Verification Skipped (Dev/Missing Config) ---");
        return;
    }

    try {
        await transporter.verify();
        console.log("✅ Email Service: SMTP Connection Established Successfully");
    } catch (error) {
        console.error("❌ Email Service: Connection Failed!");
        console.error(error);
        // We do NOT exit the process here, as the app should still run even if email is broken.
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

    const mailOptions = {
        from: `"League Commissioner" <${process.env.EMAIL_USER}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: subject,
        html: html,
    };

    const isProduction = process.env.NODE_ENV === 'production';
    const hasEmailConfig = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS;

    if (!isProduction || !hasEmailConfig) {
        console.log("--- SIMULATING EMAIL SEND ---");
        if (!hasEmailConfig && isProduction) {
            console.log("(Simulation active due to missing email configuration)");
        }
        console.log(`To: ${mailOptions.to}`);
        console.log(`Subject: ${mailOptions.subject}`);
        console.log(`Content: ${mailOptions.html.substring(0, 100)}...`);
        return;
    }

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

    const subject = `Draft Update: ${player.name} Selected!`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>The Pick Is In!</h2>
            <p><strong>${team.name}</strong> has selected <strong>${player.name}</strong> (${player.position || 'Player'}) in Round ${round}, Pick ${pickNumber}.</p>

            <hr />

            <h3>Up Next: ${nextTeam ? nextTeam.name : 'Draft Complete!'}</h3>
            ${nextTeam ? `<p>It is now <strong>${nextTeam.name}</strong>'s turn to pick.</p>` : ''}

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
        subject = `Draft Alert: 24 Hour Frown of Disapproval`;
        messageBody = `
            <h3>Frown of Disapproval ☹️</h3>
            <p>It has been over 24 hours since the last pick.</p>
            <p>The <strong>${team.name}</strong> has officially received a Frown of Disapproval Note.</p>
            <p>Please make your pick soon!</p>
        `;
    } else if (level === 2) { // 48 Hours
        subject = `Draft Alert: 48 Hour Notice of Censure`;
        messageBody = `
            <h3>Notice of Censure ⚠️</h3>
            <p>It has been over 48 hours since the last pick.</p>
            <p>The <strong>${team.name}</strong> has officially received a Notice of Censure.</p>
            <p>The league is waiting...</p>
        `;
    } else if (level === 3) { // 72 Hours
        subject = `Draft Alert: 72 Hour Threat of Pick Forfeiture`;
        messageBody = `
            <h3>Threat of Pick Forfeiture 🚨</h3>
            <p>It has been over 72 hours since the last pick.</p>
            <p>The <strong>${team.name}</strong> has officially received a Threat of Pick Forfeiture.</p>
            <p>Make your pick immediately or risk losing it!</p>
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
