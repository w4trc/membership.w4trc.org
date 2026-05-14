// Title-case a name, preserving hyphens and apostrophes (e.g. "O'Brien", "Mary-Jane")
export function normalizeName(str) {
  if (!str) return str;
  return str.trim().replace(/[^\s-]+/g, word =>
    word.replace(/(['-])([a-z])/gi, (_, sep, ch) => sep + ch.toUpperCase())
        .replace(/^(.)/, ch => ch.toUpperCase())
  );
}
