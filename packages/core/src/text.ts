/** Escapes text for Telegram's HTML parse mode (also safe inside double-quoted attributes). */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// C0/C1 control characters, bidi overrides/isolates, and zero-width characters: on-chain names
// use these to spoof or break layouts.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Normalizes untrusted text (token names/symbols, user labels) for storage and display:
 * strips control and bidi characters, collapses whitespace, and truncates by code point.
 * This is not escaping — still escape before rendering as HTML.
 */
export function sanitizeDisplayText(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, ' ').replace(UNSAFE_CHARS, '').replace(/ {2,}/g, ' ').trim();
  const codePoints = Array.from(cleaned);
  return codePoints.length <= maxLength
    ? cleaned
    : `${codePoints.slice(0, maxLength - 1).join('')}…`;
}
