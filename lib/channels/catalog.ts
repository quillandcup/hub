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
export const CHANNELS = [
  { id: "slack", label: "Slack", description: "A direct message from Billie Bot" },
  // Behind the in_app_notifications feature flag: members without it can't be reached on it and
  // don't see it in settings (lib/channels/in-app.ts).
  { id: "in_app", label: "In the Hub", description: "In the Hub's notification inbox, and as a banner while it's time-sensitive" },
  // The address on the member record. Off by default for every kind: members opt in in settings (see the default-flip note in lib/notifications/registry.ts).
  { id: "email", label: "Email", description: "An email to the address on your Hub account" },
] as const;

export type ChannelId = (typeof CHANNELS)[number]["id"];

export function isChannelId(id: unknown): id is ChannelId {
  return CHANNELS.some((c) => c.id === id);
}
