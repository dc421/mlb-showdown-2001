const seasonMap = {
    '7/5/20': 'Early July 2020',
    '7/15/20': 'Mid July 2020',
    '7/20/20': 'Late July 2020',
    '8/1/20': 'Early August 2020',
    '8/13/20': 'Late August 2020',
    '9/9/20': 'September 2020',
    '10/1/20': 'October 2020',
    '10/22/20': 'November 2020',
    '11/22/20': 'December 2020',
    '12/27/20': 'January 2021',
    '2/7/21': 'March 2021',
    '3/15/21': 'April 2021',
    '4/18/21': 'May 2021',
    '5/26/21': 'Summer 2021',
    '8/15/21': 'Fall 2021',
    '12/24/21': 'Winter 2022',
    '4/2/22': 'Summer 2022',
    '12/23/22': 'Winter 2023',
    '4/1/23': 'Summer 2023',
    '7/4/23': 'Fall 2023',
    '2/28/24': 'Spring 2024',
    '8/18/24': 'Fall 2024',
    '2/28/25': 'Spring 2025',
    '8/4/25': 'Fall 2025'
};

// Reverse map for quick lookup
const nameToDateMap = {};
for (const [date, name] of Object.entries(seasonMap)) {
    nameToDateMap[name] = date;
}

function getSeasonName(dateInput) {
    const d = new Date(dateInput);
    const month = d.getMonth(); // 0-11
    const year = d.getFullYear();

    // Winter: Nov (10), Dec (11), Jan (0). Nov/Dec -> Year+1
    // Spring: Feb (1), Mar (2), Apr (3)
    // Summer: May (4), Jun (5), Jul (6)
    // Fall: Aug (7), Sep (8), Oct (9)

    if (month === 10 || month === 11 || month === 0) {
        const seasonYear = (month === 10 || month === 11) ? year + 1 : year;
        return `Winter ${seasonYear}`;
    } else if (month >= 1 && month <= 3) {
        return `Spring ${year}`;
    } else if (month >= 4 && month <= 6) {
        return `Summer ${year}`;
    } else {
        return `Fall ${year}`;
    }
}

function getSeasonDate(seasonName) {
    if (!seasonName) return null;

    // 1. Check Legacy Map
    if (nameToDateMap[seasonName]) {
        return new Date(nameToDateMap[seasonName]);
    }

    // 2. Check "M-D-YY Season" format
    const matchMDY = seasonName.match(/^(\d{1,2})-(\d{1,2})-(\d{2}) Season$/);
    if (matchMDY) {
        const month = parseInt(matchMDY[1]);
        const day = parseInt(matchMDY[2]);
        const yearVal = parseInt(matchMDY[3]);
        const year = 2000 + yearVal;
        return new Date(year, month - 1, day);
    }

    // 3. Check "Season YYYY" format
    const matchName = seasonName.match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})$/);
    if (matchName) {
        const season = matchName[1];
        const year = parseInt(matchName[2]);

        // Assign arbitrary dates for sorting:
        // Winter -> Jan 1
        // Spring -> Feb 1
        // Summer -> May 1
        // Fall -> Aug 1
        if (season === 'Winter') return new Date(year, 0, 1);
        if (season === 'Spring') return new Date(year, 1, 1);
        if (season === 'Summer') return new Date(year, 4, 1);
        if (season === 'Fall') return new Date(year, 7, 1);
    }

    return null;
}

function sortSeasons(seasons) {
    return seasons.sort((a, b) => {
        // "Live Draft" special case (usually handled outside, but good to have)
        if (a === "Live Draft") return -1;
        if (b === "Live Draft") return 1;

        const dateA = getSeasonDate(a);
        const dateB = getSeasonDate(b);

        if (dateA && dateB) {
            return dateB - dateA; // Descending
        }
        if (dateA) return -1; // A has date (known), B doesn't -> A first? No, usually valid seasons come first?
        // Actually if A is valid and B is not, we assume A is newer or more relevant?
        // Let's stick to existing logic:
        // If dateA exists and dateB doesn't, we treat A as "greater" (newer)?
        // Wait, if descending, we want Newest first.
        // If B is unknown string, maybe it's garbage? Put it at bottom.
        if (dateA) return -1;
        if (dateB) return 1;

        // Fallback
        return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
    });
}

module.exports = {
    getSeasonName,
    sortSeasons,
    seasonMap // Exported if needed by other legacy checks
};
