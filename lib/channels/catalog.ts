/**
 * The delivery systems the Hub can reach members on (Slack today; later email, SMS, WhatsApp, web
 * push, in-app). Client-safe: settings pages list channels from here. Server code sends through
 * the adapters in lib/channels/index.ts.
 *
 * Channels are shared infrastructure under both member-facing layers:
 * - Notifications (lib/notifications/): the app reaching out, governed by the member's
 *   per-kind settings. Some ask for an answer (prickle check-ins), but the app starts them.
 * - Messaging (planned; docs/TODO.md -> Notifications): two-way conversations, e.g. in-app chat
 *   bridged to Slack (docs/SLACK_BRIDGED_CHAT.md).
 * Neither layer talks to a provider directly; a new channel added here serves both.
 */
export const CHANNELS = [{ id: "slack", label: "Slack", description: "A direct message from Billie Bot" }] as const;

export type ChannelId = (typeof CHANNELS)[number]["id"];

export function isChannelId(id: unknown): id is ChannelId {
  return CHANNELS.some((c) => c.id === id);
}
