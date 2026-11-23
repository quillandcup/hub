import { EMOJI_SHORTCODE_MAP } from "@/lib/chat/emoji-shortcodes";

/** The map moved to chat core (src/lib/chat/emoji-shortcodes.ts); this name stays for the Slack code that reads it. */
export const SLACK_EMOJI_MAP = EMOJI_SHORTCODE_MAP;

/**
 * Convert Slack emoji shortcode to Unicode emoji
 * @param shortcode - Emoji shortcode without colons (e.g., "heart", "thumbsup")
 * @returns Unicode emoji or the original shortcode with colons if not found
 */
export function slackEmojiToUnicode(shortcode: string): string {
  return SLACK_EMOJI_MAP[shortcode] || `:${shortcode}:`;
}

/**
 * Format Slack permalink URL
 * @param workspaceUrl - Base Slack workspace URL (e.g., "https://yourworkspace.slack.com")
 * @param channelId - Channel ID
 * @param messageTs - Message timestamp (with decimal point)
 * @returns Formatted Slack permalink
 */
export function formatSlackPermalink(
  workspaceUrl: string,
  channelId: string,
  messageTs: string
): string {
  // Convert timestamp format: "1234567890.123456" -> "p1234567890123456"
  const pTs = 'p' + messageTs.replace('.', '');
  return `${workspaceUrl}/archives/${channelId}/${pTs}`;
}
