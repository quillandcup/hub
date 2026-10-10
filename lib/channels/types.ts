import type { ChannelId } from "./catalog";

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
   * Time-sensitive until this moment (ISO timestamp): worth interrupting the member for from when
   * it's sent until then, because it's about something happening now (e.g. a prickle starting).
   * Omitted = never time-sensitive. Each channel decides what that means: in-app shows a banner
   * until then and otherwise only lists it under the bell; a push channel could use the OS's
   * time-sensitive level, email could skip it once it has passed.
   */
  timeSensitiveUntil?: string;
  /**
   * For channels that keep a message around (in-app): what it's about, e.g. a prickle id, so the
   * feature can mark it read once it's dealt with (resolveInAppNotifications).
   */
  ref?: string;
}

/** What a channel knows about the send besides the message itself. */
export interface SendContext {
  /** The member being sent to. */
  memberId: string;
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
