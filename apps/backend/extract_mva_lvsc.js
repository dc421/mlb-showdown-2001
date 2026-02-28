const { pool } = require('./db');

// Helper to clean up the extracted name based on user rules
function cleanName(rawString) {
    if (!rawString) return null;

    // 1. Split by common separators that indicate trailing notes
    // We split by comma `,`, hyphen `-`, or en-dash `–`
    let parts = rawString.split(/\s+-\s+|\s+–\s+|,/);
    let namePart = parts[0].trim();
    
    // Clean up " in the Xth inning" right away so it doesn't mess with paren counts
    namePart = namePart.replace(/\s+in the.*$/, '').trim();

    // 2. Count the number of parenthetical blocks in the namePart
    const parenMatches = namePart.match(/\([^\)]+\)/g);
    const parenCount = parenMatches ? parenMatches.length : 0;

    // 3. Apply the logic:
    // If there are 2 or more parentheticals (e.g. "Manny Ramirez (CLE) (NYC)"), keep the name and the FIRST parenthetical.
    // If there is exactly 1 parenthetical (e.g. "Jose Jimenez (LAR)"), strip it out, leaving just the name.
    // If there are 0, just return the name.

    if (parenCount >= 2) {
        // Keep name and first parenthetical
        const match = namePart.match(/^([^\(]+(?:\([^\)]+\))?)/);
        if (match) {
            return match[1].trim();
        }
    } else if (parenCount === 1) {
        // Strip the single parenthetical
        const match = namePart.match(/^([^\(]+)/);
        if (match) {
            return match[1].trim();
        }
    }

    // Fallback or 0 parens
    return namePart.trim();
}


async function extractMvaLvsc() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const res = await client.query('SELECT id, notes FROM series_results WHERE notes IS NOT NULL');
        
        let updateCount = 0;

        for (const row of res.rows) {
            const { id, notes } = row;
            let mva = null;
            let lvsc = null;
            let updates = [];

            // Regex to match MVA: ... (stops at the end of the string, we'll clean it up later)
            const mvaMatch = notes.match(/MVA:\s*(.*)/i);
            if (mvaMatch) {
                // If there's an LVSC later in the same string, we need to stop before it
                let rawMva = mvaMatch[1];
                const lvscIndex = rawMva.search(/LVSC:/i);
                if (lvscIndex !== -1) {
                    rawMva = rawMva.substring(0, lvscIndex);
                }
                mva = cleanName(rawMva);
                updates.push(`mva = '${mva}'`);
            }

            // Regex to match LVSC: ... 
            const lvscMatch = notes.match(/LVSC:\s*(.*)/i);
            if (lvscMatch) {
                let rawLvsc = lvscMatch[1];
                const mvaIndex = rawLvsc.search(/MVA:/i);
                if (mvaIndex !== -1) {
                    rawLvsc = rawLvsc.substring(0, mvaIndex);
                }
                lvsc = cleanName(rawLvsc);
                updates.push(`lvsc = '${lvsc}'`);
            }

            if (mva || lvsc) {
                // Update the row
                await client.query(
                    'UPDATE series_results SET mva = COALESCE($1, mva), lvsc = COALESCE($2, lvsc) WHERE id = $3',
                    [mva, lvsc, id]
                );
                console.log(`Updated ID ${id}: MVA="${mva}", LVSC="${lvsc}" (Source: "${notes}")`);
                updateCount++;
            }
        }

        await client.query('COMMIT');
        console.log(`Successfully updated ${updateCount} rows.`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error extracting MVA/LVSC:', err);
    } finally {
        client.release();
        pool.end();
    }
}

// For local testing of the cleanName function without DB connection
if (require.main === module && process.argv.includes('--test')) {
    const tests = [
        "Roger Cedeno (BOS)",
        "Hideki Irabu in the 4th inning (LAR)",
        "Robb Nen (BOS)",
        "Vladimir Guerrero (BOS), Boston breaks unprecedented streak for first title",
        "Aaron Sele (AA)",
        "Barry Zito (LAR)",
        "Jose Jimenez (LAR) - Gave up 2 out walkoff HR to Neifi Perez",
        "Manny Ramirez (CLE) (NYC) – Manny Ramirez (BOS) horrified",
        "Vladimir Guerrero (BOS) , Boston breaks unprecedented streak for first title"
    ];
    console.log("--- TESTING cleanName() ---");
    tests.forEach(t => {
        console.log(`Input:  "${t}"`);
        console.log(`Output: "${cleanName(t)}"`);
        console.log("---");
    });
    process.exit(0);
} else {
    extractMvaLvsc();
}
