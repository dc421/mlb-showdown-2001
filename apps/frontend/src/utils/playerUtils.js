// apps/frontend/src/utils/playerUtils.js

/**
 * Parses the last name from a full name string.
 * Handles exceptions like "Chan Ho Park" where the space separates first/middle from last.
 * For most names (e.g., "Alex Rodriguez", "Andy Van Slyke"), it assumes standard splitting or that
 * multi-word last names are handled by taking everything after the first name?
 * Actually, standard MLB logic usually treats the last token as the last name for sorting,
 * unless it's a known compound.
 *
 * However, based on user requirements:
 * "Chan Ho Park" -> Last Name "Park".
 * "Andy Van Slyke" -> Last Name "Van Slyke"? Or "Slyke"?
 * If the user says "The only first name in the database that has a space in it is Chan Ho Park",
 * it implies that for everyone else, the first space separates First and Last.
 * So "Andy Van Slyke" -> First: "Andy", Last: "Van Slyke".
 * "Alex Rodriguez" -> First: "Alex", Last: "Rodriguez".
 */
export function getLastName(name) {
    if (!name) return '';
    if (name === 'Chan Ho Park') return 'Park';

    // For everyone else, assume the first token is the first name,
    // and everything else is the last name.
    const parts = name.split(' ');
    if (parts.length < 2) return name; // Single name like "Ichiro"?

    return parts.slice(1).join(' ');
}

/**
 * Formats a name as "F.Last".
 * Special handling for Chan Ho Park -> "C.Park".
 */
export function formatNameShort(name) {
    if (!name) return '';
    if (name === 'Chan Ho Park') return 'C.Park';

    const parts = name.split(' ');
    const firstInitial = parts[0][0];
    const lastName = parts.slice(1).join(' '); // "Van Slyke" or "Rodriguez"

    return `${firstInitial}.${lastName}`;
}
