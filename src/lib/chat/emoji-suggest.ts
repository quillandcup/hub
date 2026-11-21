import { buildCatalog, searchStandard, type StandardEntry } from "@/lib/chat/emoji-catalog";
import type { CustomEmoji } from "@/lib/chat/emoji";
import { tonedUnicode } from "@/lib/chat/skin-tone";

/** The emoji data is big: fetched when the picker or the message box first needs it, then kept. */
let catalogPromise: Promise<StandardEntry[]> | null = null;
export function loadCatalog(): Promise<StandardEntry[]> {
  catalogPromise ??= Promise.all([import("emojibase-data/en/data.json"), import("emojibase-data/en/shortcodes/iamcal.json")])
    .then(([data, codes]) => buildCatalog(data.default as never, codes.default as never))
    .catch((error) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
}

/** One `:name` choice: the shortcode and what to draw for it (a Unicode emoji or a custom image). */
export type EmojiChoice = { name: string; emoji: CustomEmoji; /** A standard emoji: picked as its character. A custom one (or an alias of one) is picked as an emoji named `name`. */ standard?: boolean };

export const MAX_EMOJI_CHOICES = 6;

/**
 * What to offer for `:que`: the exact name first, then names that start with it (the workspace's custom emoji ahead of the
 * standard ones, as in Slack), then names or keywords that merely contain it.
 */
export function emojiChoices(query: string, standard: StandardEntry[], custom: EmojiChoice[], tone: number | null = null): EmojiChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const std = searchStandard(standard, q).map((e): EmojiChoice => ({ name: e.name, emoji: { text: tone && e.tonable ? tonedUnicode(e.unicode, tone) : e.unicode }, standard: true }));
  const taken = new Set<string>();
  const out: EmojiChoice[] = [];
  const add = (list: EmojiChoice[]) => {
    for (const c of list) {
      if (taken.has(c.name)) continue;
      taken.add(c.name);
      out.push(c);
    }
  };
  add([...custom, ...std].filter((c) => c.name === q));
  add(custom.filter((c) => c.name.startsWith(q)));
  add(std.filter((c) => c.name.startsWith(q)));
  add(custom);
  add(std);
  return out.slice(0, MAX_EMOJI_CHOICES);
}
