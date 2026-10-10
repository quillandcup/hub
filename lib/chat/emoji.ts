import shortcodes from "emojibase-data/en/shortcodes/iamcal.json";
import compact from "emojibase-data/en/compact.json";
import { SLACK_EMOJI_MAP } from "@/lib/slack-emoji";

/**
 * Slack emoji for the chat. Standard emoji use Slack's own shortcode names (emojibase's iamcal
 * set); the workspace's custom emoji come from bronze.slack_custom_emoji (see names.ts) and win
 * over a standard emoji of the same name, as in Slack. Server-side only: the dataset is large.
 */

/** What a custom emoji name resolves to: its image, or the standard emoji it is an alias for. */
export type CustomEmoji = { url: string } | { text: string };

let standard: Map<string, string> | null = null;

function standardEmoji(): Map<string, string> {
  if (standard) return standard;
  const byHex = new Map(compact.map((e) => [e.hexcode, e.unicode]));
  standard = new Map();
  for (const [hex, names] of Object.entries(shortcodes as Record<string, string | string[]>)) {
    const unicode = byHex.get(hex);
    if (!unicode) continue;
    for (const name of [names].flat()) standard.set(name, unicode);
  }
  return standard;
}

/** The Unicode emoji for a shortcode (no colons, skin tone ignored), or null if there isn't one. */
export function unicodeEmoji(name: string): string | null {
  const key = name.toLowerCase().replace(/::skin-tone-\d$/, "");
  return standardEmoji().get(key) ?? SLACK_EMOJI_MAP[key] ?? null;
}
