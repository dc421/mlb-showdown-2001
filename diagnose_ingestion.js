const fs = require('fs');
const csv = require('csv-parser');

const seasonMap = {
    '7/5/20': 'Early July 2020',
    '7/15/20': 'Mid July 2020',
    '7/20/20': 'Late July 2020',
    '8/1/20': 'Early August 2020',
    '8/13/20': 'Late August 2020',
    '9/9/20': 'September 2020',
    '10/1/20': 'October 2020'
};

async function diagnose(filePath) {
    console.log(`Diagnosing ${filePath}...`);
    const rows = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv({ headers: false })) // We read without headers to get raw indices
            .on('data', (row) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    // Mimic the logic in ingest-historical-data.js
    // It assumes row 1 (index 1) contains the dates.
    // "const dateRow = rows[1];"

    if (rows.length < 2) {
        console.error("File too short");
        return;
    }

    const dateRow = rows[1]; // 2nd row (0-indexed 1)
    const seasonCols = {};

    console.log("--- Date Row Detection ---");
    Object.keys(dateRow).forEach(key => {
        if (key === '0') return; // Skip first column (labels)
        const dateStr = dateRow[key] ? dateRow[key].trim() : '';

        if (seasonMap[dateStr]) {
            seasonCols[key] = seasonMap[dateStr];
            console.log(`[MATCH] Col ${key}: "${dateStr}" -> ${seasonMap[dateStr]}`);
        } else {
            if (dateStr) console.log(`[MISS]  Col ${key}: "${dateStr}"`);
        }
    });

    console.log("\n--- Data Extraction Check ---");
    // Check for Sept 2020 (9/9/20)
    const targetSeason = 'September 2020';
    const targetCol = Object.keys(seasonCols).find(k => seasonCols[k] === targetSeason);

    if (!targetCol) {
        console.error(`CRITICAL: Could not find column for ${targetSeason}`);
    } else {
        console.log(`Scanning column ${targetCol} for players...`);
        let count = 0;
        for (let i = 3; i < rows.length; i++) {
            const row = rows[i];
            // ingest-historical-data.js logic:
            // const position = row['0'];
            // const playerName = row[colIndex];

            const position = row['0'];
            const playerName = row[targetCol];

            if (playerName && playerName.trim()) {
                count++;
                if (playerName.includes('Lenny Harris')) {
                    console.log(`FOUND: Row ${i} [${position}]: ${playerName}`);
                }
            }
        }
        console.log(`Found ${count} players for ${targetSeason}`);
    }
}

diagnose('boston_debug.csv');
