import type { ChannelId } from "./catalog";

/** A span of time (ISO timestamps); no `from` means from now. */
export interface TimeWindow {
  from?: string;
  until: string;
}

/** One outbound message, with whatever each channel needs to render it. */
export interface OutboundMessage {
  /** Plain text: the whole message on text-only channels, and the fallback/preview everywhere else. */
  text: string;
  /** Where to act on it in the Hub, for channels that can't do it inline. */
  url?: string;
  /** Slack Block Kit body, when the Slack version is richer than `text` (e.g. interactive selects). */
  slackBlocks?: any[];
  /** Small trailing links (e.g. "Notification settings"); each channel renders them its own way. */
  footerLinks?: { label: string; url: string }[];
  /**
   * When it's worth interrupting the member for, because it's about something happening then
   * (e.g. a prickle starting): from `from` (ISO timestamp; omitted = as soon as it's sent) until
   * `until`. Omitted = never time-sensitive. Each channel decides what that means: in-app shows it
   * as a banner inside the window and otherwise only under the bell; a push channel could use the
   * OS's time-sensitive level, email could skip it once the window has passed.
   */
  timeSensitive?: TimeWindow;
  /**
   * For channels that keep a message around (in-app): what it's about, e.g. a prickle id, so the
   * feature can resolve it once it's dealt with (resolveInAppNotifications)...
   */
  ref?: string;
  /** ...and when it stops being worth keeping at all (ISO timestamp); omitted = kept. */
  expiresAt?: string;
}

/** What a channel knows about the send besides the message itself. */
export interface SendContext {
  /** The notification kind (lib/notifications/registry.ts). */
  kind: string;
}

/**
 * How the Hub reaches members on one delivery system. Outbound only for now: inbound replies
 * (Slack button/select answers, and later SMS/WhatsApp replies or chat messages) arrive on each
 * provider's webhook route (e.g. app/api/webhooks/slack/interactions) and are resolved back to a
 * member there. A shared inbound shape belongs here once a second two-way channel exists.
 */
export interface ChannelAdapter {
  id: ChannelId;
  /** memberId -> this channel's address (e.g. Slack user id). Members missing from the map can't be reached on it. */
  resolveAddresses(supabase: any, memberIds: string[]): Promise<Map<string, string>>;
  send(address: string, message: OutboundMessage, context: SendContext): Promise<void>;
}
