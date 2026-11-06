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

/** The word being typed is an address: a `--` or `...` in it is part of the address, not typography. */
const IN_ADDRESS = /(?:https?:\/\/|www\.|mailto:)\S*$/i;

/** A quote after the start of the text, a space, an opening bracket, a dash or another opening quote opens; anywhere else it closes. */
const OPENS = /(?:^|[\s([{—–‘“])$/;

/** The replacement for `typed` typed right after `before` (the text before the caret in its paragraph), or null to leave it as typed. */
export function smartReplacement(before: string, typed: string): SmartReplacement | null {
  if (IN_ADDRESS.test(before)) return null;
  switch (typed) {
    case "-":
      if (before.endsWith("<")) return { remove: 1, insert: "←" };
      return before.endsWith("-") ? { remove: 1, insert: "—" } : null;
    case ">":
      return before.endsWith("-") ? { remove: 1, insert: "→" } : null;
    case ".":
      return before.endsWith("..") ? { remove: 2, insert: "…" } : null;
    case '"':
      return { remove: 0, insert: OPENS.test(before) ? "“" : "”" };
    case "'":
      // A closing single quote is also the apostrophe ("it's").
      return { remove: 0, insert: OPENS.test(before) ? "‘" : "’" };
    default:
      return null;
  }
}
