// Helper to handle Franchise matching logic
// This solves the problem where "Boston" might be ID 1 locally but ID 3 on Prod,
// and we want to link history based on the "Franchise Identity" (Owner + Team Name History).

const ALIASES = {
    'Boston': ['San Diego'], // Boston (Drew) used to be San Diego
    'New York': ['Montreal'], // New York (Scott) used to be Montreal
    'NY South': [], // Alex
    'Detroit': [], // Chris
    'Ann Arbor': [] // Ben
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
    const fullCurrentName = `${currentCity} ${currentTeamName}`;

    // 1. Check Known Aliases
    // If the record name matches a known alias for this team, it's a match.
    // We check if the alias is contained in the record name (fuzzy match on alias).
    const teamAliases = ALIASES[currentTeamName] || [];
    for (const alias of teamAliases) {
        if (recordName.includes(alias)) return true;
    }

    // 2. Exclusion Logic: Does the name match ANOTHER active team better?
    // If the record name matches "New York South", and we are "New York", we must reject it.
    const isFalsePositive = allTeams.some(other => {
        if (other.team_id === currentTeam.team_id) return false; // Skip self

        // Only care if the other team's name is causing ambiguity with OUR name.
        // e.g. Our Name="New York", Other="New York South".
        // If record="New York South", it contains "New York".
        if (other.name.includes(currentTeamName) || other.city.includes(currentTeamName)) {
            // If the record name contains the OTHER team's full identifier, it belongs to them.
            // e.g. Record="New York South", Other="New York South" -> Match.
            // We check if the other team's specific name/city is found in the record.
            // We use the most specific part that differentiates them.
            if (recordName.includes(other.name) && other.name.length > currentTeamName.length) return true;
            if (recordName.includes(other.city) && other.city.length > currentCity.length) return true;

            // Explicit check for known collision: "New York South" vs "New York"
            if (recordName.includes('South') && currentTeamName === 'New York' && !currentTeamName.includes('South')) return true;
        }
        return false;
    });

    if (isFalsePositive) return false;

    // 3. Name Match (Fuzzy)
    // If the record name contains our current name (and wasn't excluded above), it's a match.
    if (recordName.includes(currentTeamName)) return true;
    if (recordName.includes(currentCity)) return true; // e.g. "Boston" match in "Boston Red Sox"

    // 4. ID Match (with Name Safeguard)
    // If the ID matches one of our mapped IDs, we assume it's ours,
    // UNLESS the name explicitly matches another active team (Exclusion).
    // Note: We already ran Exclusion check above on the name.
    // But we should double check: if ID matches, but Name is "New York South" and we are "Boston" (Local ID collision),
    // then exclusion logic wouldn't have caught it yet if "Boston" isn't in "New York South".
    // Wait, the "False Positive" check above only checked against "My Name".
    // We need a broader safeguard: If ID matches, but Name belongs to ANY other team.

    const idMatch = recordId && mappedIds.map(String).includes(String(recordId));

    if (idMatch) {
        // Strict Name Safeguard:
        // Does this name belong to ANY other team?
        const nameBelongsToOther = allTeams.some(other => {
            if (other.team_id === currentTeam.team_id) return false;
            // Check if recordName strictly matches another team's identity
            // e.g. Record="New York South", Other="New York South".
            // If I am Boston, and I see ID 1 (which is Boston Local), but name is "New York South" (Prod ID 1),
            // I should reject it.

            // How to detect?
            // If recordName contains Other.name or Other.city AND doesn't contain My.name/My.city/Aliases?
            // If I am Boston, "New York South" does not contain "Boston".

            if (recordName.includes(other.name) || recordName.includes(other.city)) {
                // It matches someone else. Does it also match me?
                const matchesMe = recordName.includes(currentTeamName) ||
                                  recordName.includes(currentCity) ||
                                  teamAliases.some(a => recordName.includes(a));

                if (!matchesMe) return true; // Matches them, not me -> It's theirs.
            }
            return false;
        });

        if (!nameBelongsToOther) return true;
    }

    return false;
}

module.exports = {
    matchesFranchise
};
