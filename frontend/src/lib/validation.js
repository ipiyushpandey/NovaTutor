/**
 * Input validation helpers for Nova Personalization and Learning Profiles.
 */
export function isMeaningfulText(text, minLen = 5, maxLen = 500) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) return false;
  const letters = trimmed.match(/[\p{L}]/gu) || [];
  if (letters.length < 3) return false;
  const distinctLetters = new Set(letters.map((c) => c.toLowerCase()));
  if (distinctLetters.size < 2) return false;
  // Requires at least one vowel or non-latin character (allows Hindi/regional scripts while rejecting consonant mashing like bcsjcgs)
  return /[aeiouy\u0080-\uFFFF]/i.test(trimmed);
}
