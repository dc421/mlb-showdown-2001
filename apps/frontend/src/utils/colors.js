/**
 * Calculates the contrasting text color (black or white) for a given background color.
 * @param {string} hexColor - The background color in hexadecimal format (e.g., '#RRGGBB').
 * @returns {string} The contrasting text color ('#000000' for black or '#FFFFFF' for white).
 */
export function getContrastingTextColor(hexColor) {
  if (!hexColor) return '#000000';

  // Remove the hash at the start if it's there
  const hex = hexColor.replace('#', '');

  // Parse the R, G, B values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light colors, white for dark colors
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}