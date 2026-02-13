/**
 * Resolves the logo URL for a team based on its historical name.
 * Mirrors the backend logic in apps/backend/utils/franchiseUtils.js
 *
 * @param {string} name - The team name to check (e.g. "Laramie Lugnuts").
 * @param {string} defaultLogo - The default logo URL to return if no match found.
 * @returns {string} - The resolved logo URL.
 */
export function getLogoForTeam(name, defaultLogo = null) {
    if (!name) return defaultLogo;
    const lowerName = name.toLowerCase();

    // Use relative path that works with the frontend proxy (which forwards /images to backend)
    // The Vite proxy configuration should handle /images -> backend/images
    if (lowerName.includes('phantoms')) return '/images/phantoms.png';
    if (lowerName.includes('laramie') || lowerName.includes('lugnuts')) return '/images/lugnuts.png';
    if (lowerName.includes('cincinnati') || lowerName.includes('catastrophe')) return '/images/catastrophe.png';
    if (lowerName.includes('fargo') || lowerName.includes('woodchippers')) return '/images/woodchippers.png';
    if (lowerName.includes('miami') || lowerName.includes('slice')) return '/images/slice.png';
    if (lowerName.includes('yellowknife') || lowerName.includes('wraiths')) return '/images/wraiths.png';
    if (lowerName.includes('vancouver') || lowerName.includes('whalers')) return '/images/whalers.png';

    // If it's a known team name that has a standard logo URL, we might want to return that?
    // But usually standard teams have their logo_url in the DB object.
    // This helper is specifically for HISTORICAL/DEPRECATED names that don't have a current DB entry.

    return defaultLogo;
}
