/**
 * Pasted text that names people ("@Ania Ray @Sam Lee") becomes real mentions, as in Slack. Pure: the caller looks the
 * candidate names up (one search each) and hands back who was found.
 */

const NAME_WORD = "\\p{L}+(?:['’.-]\\p{L}+)*";
const MENTION_RUN = new RegExp(`(?<![\\w@])@(${NAME_WORD}(?: ${NAME_WORD}){0,4})`, "gu");

/** Every name worth looking up: for each `@Words Words`, all its word prefixes ("Ania Ray lives" -> that, "Ania Ray", "Ania"). */
export function pastedNameCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RUN)) {
    const words = m[1].split(" ");
    for (let n = words.length; n >= 1; n--) out.add(words.slice(0, n).join(" "));
  }
  return [...out];
}

/** A person a name lookup found: the shown label (`@Ania Ray`) and what Slack needs for it. */
export type KnownPerson = { label: string; token: string };

/**
 * Replace each `@Full Name` that matches exactly one known person (longest name first, ignoring case) by the shown label,
 * remembering its token. A name two people share, or no one, stays plain text.
 */
export function applyPastedMentions(text: string, people: KnownPerson[]): { text: string; picked: Map<string, string> } {
  const byLabel = new Map<string, KnownPerson[]>();
  for (const p of people) {
    const key = p.label.toLowerCase();
    byLabel.set(key, [...(byLabel.get(key) ?? []), p]);
  }
  const picked = new Map<string, string>();
  const out = text.replace(MENTION_RUN, (whole, run: string) => {
    const words = run.split(" ");
    for (let n = words.length; n >= 1; n--) {
      const found = byLabel.get(`@${words.slice(0, n).join(" ")}`.toLowerCase());
      if (!found) continue;
      if (found.length !== 1) return whole; // ambiguous: leave it for the member
      picked.set(found[0].label, found[0].token);
      const rest = words.slice(n).join(" ");
      return rest ? `${found[0].label} ${rest}` : found[0].label;
    }
    return whole;
  });
  return { text: out, picked };
}
