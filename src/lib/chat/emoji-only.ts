/**
 * Whether a message is nothing but emoji, which Slack draws large ("jumbo"): the chat does too, and so does the
 * message box while that is all that has been typed. Pure, so it is the one rule for both.
 */

const MODIFIED = String.raw`\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?`;
const UNICODE = String.raw`(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|${MODIFIED}(?:‍${MODIFIED})*)`;
const SHORTCODE = String.raw`:[a-z0-9_+-]+(?:::skin-tone-\d)?:`;

const UNICODE_ONLY = new RegExp(`^(?:\\s*${UNICODE})+\\s*$`, "u");
const EITHER = new RegExp(`^(?:\\s*(?:${UNICODE}|${SHORTCODE}))+\\s*$`, "iu");
const EACH = new RegExp(`${UNICODE}|${SHORTCODE}`, "giu");

/** Slack's limit: more than this many and it is a line of small emoji. */
export const MAX_JUMBO_EMOJI = 23;

/**
 * True for text that is only emoji (and spaces), up to `MAX_JUMBO_EMOJI` of them. A `:shortcode:` counts only when
 * `shortcodes` is on, which is for a sent message whose names the chat can draw; in the box a shortcode is still
 * just typed letters.
 */
export function isEmojiOnly(text: string, opts: { shortcodes?: boolean } = {}): boolean {
  if (!text.trim() || text.length > 400) return false;
  if (!(opts.shortcodes ? EITHER : UNICODE_ONLY).test(text)) return false;
  return (text.match(EACH)?.length ?? 0) <= MAX_JUMBO_EMOJI;
}
