// Helper to handle Franchise matching logic
// This solves the problem where "Boston" might be ID 1 locally but ID 3 on Prod,
// and we want to link history based on the "Franchise Identity" (Owner + Team Name History).

const ALIASES = {
    'Boston': ['San Diego'], // Boston (Drew) used to be San Diego
    'New York': ['no aliases'], // New York (Scott) no aliases
    'NY South': ['Fargo', 'NYDC', 'New York South'], // Alex
    'Detroit': ['Laramie', 'Cincinnati'], // Chris
    'Ann Arbor': ['Chicago', 'Redwood City'] // Ben
};

/**
 * Checks if a historical record belongs to the current team's franchise.
 *
 * @param {string} recordName - The team name in the historical record (e.g. "San Diego").
 * @param {number|string} recordId - The team ID in the historical record.
 * @param {object} currentTeam - The current team object (must have name, team_id, city).
 * @param {Array<object>} allTeams - List of all active teams (for exclusion logic).
 * @param {Array<string>} mappedIds - Array of ID strings that map to this franchise across environments.
 * @returns {boolean} - True if the record belongs to this franchise.
 */
function matchesFranchise(recordName, recordId, currentTeam, allTeams, mappedIds) {
    if (!recordName) return false;

    const currentTeamName = currentTeam.name;
    const currentCity = currentTeam.city;

    // 1. Check Known Aliases
    const nameAliases = ALIASES[currentTeamName] || [];
    const cityAliases = ALIASES[currentCity] || [];
    const teamAliases = [...new Set([...nameAliases, ...cityAliases])];

    for (const alias of teamAliases) {
        if (recordName.includes(alias)) return true;
    }

    // 2. Exclusion Logic: Does the name match ANOTHER active team better?
    const isFalsePositive = allTeams.some(other => {
        if (other.team_id === currentTeam.team_id) return false;

        const otherName = other.name;
        const otherCity = other.city;
        const otherAliases = ALIASES[otherName] || [];

        const matchesOtherName = otherName && recordName.includes(otherName);
        const matchesOtherCity = otherCity && recordName.includes(otherCity);
        const matchesOtherAlias = otherAliases.some(alias => recordName.includes(alias));

        if (matchesOtherName || matchesOtherCity || matchesOtherAlias) {
            // If matched via explicit alias of another team, it belongs to them
            if (matchesOtherAlias) return true;

            const matchesMyName = recordName.includes(currentTeamName) || recordName.includes(currentCity);

            if (matchesMyName) {
                 if (matchesOtherName && otherName.includes(currentTeamName) && otherName.length > currentTeamName.length) {
                     return true;
                 }
                 if (matchesOtherCity && otherCity.includes(currentCity) && otherCity.length > currentCity.length) {
                     return true;
                 }
                 // "South" suffix logic: If record has South, and I don't, but Other does (implicitly or explicitly)
                 if (recordName.includes('South') && !currentTeamName.includes('South')) {
                      return true;
                 }
            }
        }
        return false;
    });

    if (isFalsePositive) return false;

    // 3. Name Match (Fuzzy)
    // If the record name contains our current name (and wasn't excluded above), it's a match.
    if (recordName.includes(currentTeamName)) return true;
    if (recordName.includes(currentCity)) return true;

    // 4. ID Match (with Name Safeguard)
    const idMatch = recordId && mappedIds.map(String).includes(String(recordId));

    if (idMatch) {
        // Strict Name Safeguard:
        const nameBelongsToOther = allTeams.some(other => {
            if (other.team_id === currentTeam.team_id) return false;

            const otherName = other.name;
            const otherCity = other.city;
            const otherNameAliases = ALIASES[otherName] || [];
            const otherCityAliases = ALIASES[otherCity] || [];
            const allOtherAliases = [...new Set([...otherNameAliases, ...otherCityAliases])];

            const matchesOtherName = otherName && recordName.includes(otherName);
            const matchesOtherCity = otherCity && recordName.includes(otherCity);
            const matchesOtherAlias = allOtherAliases.some(alias => recordName.includes(alias));

            if (matchesOtherName || matchesOtherCity || matchesOtherAlias) {
                // It matches them. Does it match me?
                const matchesMe = recordName.includes(currentTeamName) ||
                                  recordName.includes(currentCity) ||
                                  teamAliases.some(a => recordName.includes(a));

                // If it matches them but NOT me, it's definitely theirs.
                if (!matchesMe) return true;

                // If it matches BOTH, we check if it matches them BETTER
                 if (matchesOtherName && otherName.includes(currentTeamName) && otherName.length > currentTeamName.length) {
                     return true;
                 }
            }
            return false;
        });

        // If the name explicitly belongs to another team, we assume the ID match is a cross-env collision
        if (nameBelongsToOther) return false;

        return true;
    }

    return false;
}

function getMappedIds(teamId) {
    const id = parseInt(teamId, 10);
    // Return mapped IDs for Boston (1), New York (3), and NY South (5) to bridge Prod/Local gaps
    if ([1, 3, 5].includes(id)) {
        return [1, 3, 5];
    }
    return [id];
}

function getFranchiseAliases(teamName) {
    const aliases = ALIASES[teamName] || [];
    return aliases.filter(a => a !== 'no aliases');
}

module.exports = {
    matchesFranchise,
    getMappedIds,
    getFranchiseAliases
};
