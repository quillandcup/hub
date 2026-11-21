/**
 * Slack's "Enable smart quotes and symbols" (Preferences, Advanced, Input options), as the message box does it: typing `"` or
 * `'` makes a curly quote, `--` an em-dash, `...` an ellipsis, and `->` and `<-` arrows. Pure: given the text before the caret
 * and the character just typed, what to put in place of the last `remove` characters before it (with the typed character
 * itself replaced too when `insert` includes it; see below). The editor decides where it applies (not in code).
 */

export interface SmartReplacement {
  /** How many characters just before the caret the typed character replaces (0 for a quote, which only turns curly). */
  remove: number;
  /** What takes their place, along with the typed character. */
  insert: string;
}

/**
 * The word being typed is an address, so a `--` or `...` in it is part of the address, not typography: one with a scheme or
 * `www.` (`https://x.test/a--b`), or a bare domain with a path (`example.com/a--b`). A bare domain on its own
 * (`example.com--yes`) is not, there the dash is the writer's.
 */
const IN_ADDRESS = /(?:https?:\/\/|www\.|mailto:)\S*$|\S*[a-z0-9-]\.[a-z]{2,}\/\S*$/i;

/** A quote after the start of the text, a space, an opening bracket, a dash or another opening quote opens; anywhere else it closes. */
const OPENS = /(?:^|[\s([{—–‘“])$/;

/** The replacement for `typed` typed right after `before` (the text before the caret in its paragraph), or null to leave it as typed. */
export function smartReplacement(before: string, typed: string): SmartReplacement | null {
  // A quote is never part of an address: one typed right after it closes the quote around it (`"https://x.test"`), so quotes
  // turn curly wherever they are. A closing single quote is also the apostrophe ("it's").
  if (typed === '"') return { remove: 0, insert: OPENS.test(before) ? "\u201C" : "\u201D" };
  if (typed === "'") return { remove: 0, insert: OPENS.test(before) ? "\u2018" : "\u2019" };
  if (IN_ADDRESS.test(before)) return null;
  switch (typed) {
    case "-":
      if (before.endsWith("<")) return { remove: 1, insert: "\u2190" };
      return before.endsWith("-") ? { remove: 1, insert: "\u2014" } : null;
    case ">":
      return before.endsWith("-") ? { remove: 1, insert: "\u2192" } : null;
    case ".":
      return before.endsWith("..") ? { remove: 2, insert: "\u2026" } : null;
    default:
      return null;
  }
}
