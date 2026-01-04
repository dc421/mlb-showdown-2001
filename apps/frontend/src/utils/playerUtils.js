// apps/frontend/src/utils/playerUtils.js

/**
 * Parses the last name from a full name string.
 * Handles exceptions like "Chan Ho Park" where the space separates first/middle from last.
 * Also handles Middle Initials (Mark L. Johnson -> Johnson) and parentheticals.
 */
export function getLastName(name) {
    if (!name) return '';
    if (name === 'Chan Ho Park') return 'Park';

    // Remove trailing parentheticals like (DET) or (3)
    // Regex matches space followed by parenthesis at the end of the string
    let cleanName = name.replace(/\s\([^)]+\)$/, '');
    // Repeat to handle multiple parentheticals if any, though usually just one at end
    cleanName = cleanName.replace(/\s\([^)]+\)$/, '');

    const parts = cleanName.split(' ');

    // Single name or empty
    if (parts.length < 2) return cleanName;

    // Check for Middle Initial pattern (Single letter, optionally with dot)
    // e.g. "Mark L. Johnson" -> parts[1] is "L."
    // "Alex S. Gonzalez" -> parts[1] is "S."
    const middleInitialRegex = /^[A-Z]\.?$/;

    // If we have at least 3 parts and the 2nd part looks like an initial
    if (parts.length >= 3 && middleInitialRegex.test(parts[1])) {
        // Skip the initial
        return parts.slice(2).join(' ');
    }

    // Default: Return everything after the first name
    return parts.slice(1).join(' ');
}

/**
 * Formats a name as "F.Last".
 * Special handling for Chan Ho Park -> "C.Park".
 * Respects Middle Initial removal logic.
 */
export function formatNameShort(name) {
    if (!name) return '';
    if (name === 'Chan Ho Park') return 'C.Park';

    const parts = name.split(' ');
    const firstInitial = parts[0][0];

    // Use getLastName logic to find the "Last Name" part, but we need to respect the full string structure
    // We want "M.Johnson" for "Mark L. Johnson"

    let lastName = '';

    // Re-use logic:
    // 1. Remove parentheticals (for display? Usually formatNameShort is for UI which implies clean names)
    // Actually, formatNameShort usually takes the raw name.
    // If the input is "Juan Gonzalez (DET)", we probably want "J.Gonzalez (DET)" or just "J.Gonzalez"?
    // User requirement: "For the last name that we show in the GameScorecard... 'Mark L. Johnson' should use the last name 'Johnson'"
    // This implies "M. Johnson" (or "M.Johnson").

    // Let's strip parentheticals for the "Last Name" extraction but maybe keep them if needed?
    // Actually, for "P: TBD" or "AB: J.Doe", we usually don't show (DET).
    // Let's look at getLastName implementation above.

    let cleanName = name.replace(/\s\([^)]+\)$/, ''); // Strip parenthetical for "Last Name" determination
    const cleanParts = cleanName.split(' ');

    const middleInitialRegex = /^[A-Z]\.?$/;

    if (cleanParts.length >= 3 && middleInitialRegex.test(cleanParts[1])) {
        lastName = cleanParts.slice(2).join(' ');
    } else if (cleanParts.length >= 2) {
        lastName = cleanParts.slice(1).join(' ');
    } else {
        lastName = cleanName; // Single name
    }

    return `${firstInitial}.${lastName}`;
}
