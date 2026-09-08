/**
 * Shared string-similarity primitives used for fuzzy matching across the
 * data-hygiene tooling (member-matching suggestions, duplicate detection).
 */

/**
 * Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Similarity of two strings in [0, 1], based on normalized edit distance
 */
export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Splits a name into lowercase word tokens, treating punctuation (hyphens,
 * slashes, apostrophes, accented characters normalizeName would otherwise
 * delete) as a separator rather than deleting it — so "Jelgersma/Elin" keeps
 * "jelgersma" and "elin" as distinct tokens instead of merging them.
 */
export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents: würtz -> wurtz
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
