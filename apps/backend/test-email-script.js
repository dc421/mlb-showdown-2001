// apps/backend/test-email-script.js
// require('dotenv').config(...) // Skipped for sandbox test to avoid install overhead
const { verifyConnection } = require('./services/emailService');

console.log("Starting manual email test script...");
// Mock environment variables if needed, or rely on defaults
process.env.NODE_ENV = 'production'; // Force it to try verifying
// We won't set EMAIL_HOST so it should log the "skipped" or fail gracefully if we set it dummy

verifyConnection().then(() => {
    console.log("Test complete.");
    process.exit(0);
}).catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
