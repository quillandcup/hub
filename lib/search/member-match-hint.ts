/**
 * Why a member showed up for what was typed, when the row's title doesn't already say: the legal name
 * (the title is the display name), their email, or a nickname. null when the title explains it all, so
 * a search result shows only the name unless there's a reason to show more.
 */
export function memberMatchHint(
  words: string[],
  member: {
    name: string;
    displayName?: string | null;
    email?: string | null;
    /** The nickname that matched this word, for a word that nothing else on the member contains. */
    aliasFor?: (word: string) => string | undefined;
    /** Other text a word can match without needing a hint (a bio). */
    alsoShown?: (string | null | undefined)[];
  },
): string | null {
  const has = (text: string | null | undefined, word: string) => !!text && text.toLowerCase().includes(word);
  const title = member.displayName?.trim() || member.name;
  for (const raw of words) {
    const word = raw.replace(/[\\%_,()"]/g, " ").trim().toLowerCase();
    if (!word || has(title, word)) continue;
    if (has(member.name, word)) return member.name;
    if (has(member.email, word)) return member.email!;
    if (member.alsoShown?.some((text) => has(text, word))) continue;
    const alias = member.aliasFor?.(raw);
    if (alias) return `also known as “${alias}”`;
  }
  return null;
}
