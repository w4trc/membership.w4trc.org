// Title-case a name, preserving hyphens and apostrophes (e.g. "O'Brien", "Mary-Jane")
export function normalizeName(str) {
  if (!str) return str;
  return str.trim().replace(/[^\s-]+/g, word =>
    word.toLowerCase()
        .replace(/(['-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
        .replace(/^./, ch => ch.toUpperCase())
  );
}
