const fs = require('fs');

let serverCode = fs.readFileSync('apps/backend/server.js', 'utf8');

const regex = /\/\/ NEW ENDPOINT for Infield In Ground Ball Choice\s+app\.post\('\/api\/games\/:gameId\/resolve-infield-in-gb', authenticateToken, async \(req, res\) => {([\s\S]*?)try {([\s\S]*?)        if \(newState\.currentPlay\?\.type !== 'INFIELD_IN_CHOICE'\) {([\s\S]*?)        const scoreKey = newState\.isTopInning \? 'awayScore' : 'homeScore';\s+const events = \[\];\s+if \(sendRunner\) {([\s\S]*?)            if \(runnerOnFirst\) {\s+newState\.bases\.second = runnerOnFirst;\s+}\s+} else { \/\/ Hold runner([\s\S]*?)            if \(newState\.outs < 3\) {([\s\S]*?)            }\s+}\s+const combinedLogMessage = events\.join\(' '\);\s+if \(events\.length > 0\) {([\s\S]*?)app\.post\('\/api\/games\/:gameId\/reset-rolls'/;

serverCode = serverCode.replace(regex, (match) => {
    return match; // Will be replaced manually via sed or python
});
