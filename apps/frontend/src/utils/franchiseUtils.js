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
    const apiUrl = import.meta.env.VITE_API_URL || '';

    // Use absolute path constructed from API URL to ensure correct loading in production
    // The Vite proxy configuration handles /images -> backend/images in dev,
    // but in prod we need to point to the backend explicitly if frontend/backend are separate.

    // Detroit Historical Identities
    if (lowerName.includes('phantoms')) return `${apiUrl}/images/phantoms.png`;
    if (lowerName.includes('laramie') || lowerName.includes('lugnuts')) return `${apiUrl}/images/lugnuts.png`;
    if (lowerName.includes('cincinnati') || lowerName.includes('catastrophe')) return `${apiUrl}/images/catastrophe.png`;

    // Other deprecated identities do not have logos yet (as per user instruction).
    // If we add them later, they would go here.

    return defaultLogo;
}
