import { CHANNELS, isChannelId, type ChannelId } from "@/lib/channels/catalog";
import type { FeatureKey } from "@/lib/features";

/**
 * What the app can notify a member about (kinds), on top of the shared delivery channels
 * (lib/channels/). Client-safe: the settings page renders its grid from these lists. Senders go
 * through `createNotifier` (lib/notifications/notify.ts), which honors each member's
 * notification_preferences.
 *
 * Adding a kind: add it here with its default channels, then send it with createNotifier. Adding a
 * channel happens in lib/channels/ and shows up here automatically. Neither needs a migration:
 * notification_preferences stores only a member's overrides of these defaults, keyed by these ids.
 */

/**
 * Changing a kind's defaultChannels later (e.g. turning email on for everyone) is safe: a stored
 * notification_preferences row means the member chose, even when the choice matched the default at
 * the time (setNotificationChannel always stores it), and a missing row means they never chose.
 * So only members with no row for that kind and channel see the new default; nobody's explicit
 * opt-in or opt-out is touched.
 */

/** Every channel can carry notifications today; narrow this if one ever can't. */
export const NOTIFICATION_CHANNELS = CHANNELS;
export type NotificationChannelId = ChannelId;
export const isNotificationChannel = isChannelId;

export interface NotificationKindDef {
  id: string;
  /** Settings-page grouping heading. */
  category: string;
  label: string;
  /** What it is and when it comes, as a sentence that also works after "You're getting emails about <label>." (the unsubscribe page) as well as under the label in settings. */
  description: string;
  /** Channels it goes to for a member who hasn't changed this kind's settings. */
  defaultChannels: readonly NotificationChannelId[];
  /** A feature preview this kind belongs to: members without it don't see the kind in settings or search. */
  feature?: FeatureKey;
}

export const NOTIFICATION_KINDS = [
  {
    id: "prickle_checkin",
    category: "Prickles",
    label: "Prickle check-ins",
    description: "Sent about 20 minutes before each writing prickle on your calendar: how you're feeling coming in and what you need from it.",
    defaultChannels: ["slack", "in_app", "web_push"],
  },
  {
    id: "prickle_checkout",
    category: "Prickles",
    label: "Prickle check-outs",
    description: "Sent after each writing prickle you attended: did you get what you came for, how you feel now, and a quick progress log for your goals.",
    defaultChannels: ["slack", "in_app", "web_push"],
  },
  {
    id: "intro_nudge",
    category: "Getting started",
    label: "Introduction reminders",
    description:
      "For your first 90 days, a weekly reminder to introduce yourself in #start-here on Slack, until you have.",
    defaultChannels: ["slack", "in_app"],
  },
  {
    id: "prickle_nudge",
    category: "Getting started",
    label: "Prickle reminders",
    description:
      "A reminder to put a prickle on your calendar when you don't have one coming up and haven't been to one in a while. It comes less often the longer you go without attending.",
    // Off until members opt in; flipping it later is safe (see the note on defaultChannels above).
    defaultChannels: [],
  },
  {
    id: "big_sister_match",
    category: "Big Sisters",
    label: "Big Sister introductions",
    description:
      "Sent when a new member is matched with a big sister: to the new member, who their big sister is, and to the big sister, who they're looking after.",
    defaultChannels: ["slack", "in_app", "web_push"],
    feature: "big_sisters",
  },
] as const satisfies readonly NotificationKindDef[];

export type NotificationKindId = (typeof NOTIFICATION_KINDS)[number]["id"];

export function isNotificationKind(id: unknown): id is NotificationKindId {
  return NOTIFICATION_KINDS.some((k) => k.id === id);
}

export function notificationKind(id: NotificationKindId): NotificationKindDef {
  return NOTIFICATION_KINDS.find((k) => k.id === id)!;
}

/** One stored override: this kind on this channel is on or off for the member. */
export interface NotificationPreferenceRow {
  kind: string;
  channel: string;
  enabled: boolean;
}

/**
 * The channels a kind goes to for one member: the kind's defaults, with that member's stored
 * overrides applied. Overrides for unknown kinds/channels (e.g. a channel since removed) are ignored.
 */
export function effectiveChannels(
  kind: NotificationKindId,
  overrides: readonly NotificationPreferenceRow[]
): NotificationChannelId[] {
  const defaults = new Set<string>(notificationKind(kind).defaultChannels);
  return NOTIFICATION_CHANNELS.map((c) => c.id).filter((channel) => {
    const override = overrides.find((o) => o.kind === kind && o.channel === channel);
    return override ? override.enabled : defaults.has(channel);
  });
}

/** Every kind's effective channels for one member, as the settings grid shows them. */
export function effectiveSettings(
  overrides: readonly NotificationPreferenceRow[]
): Record<NotificationKindId, NotificationChannelId[]> {
  return Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k.id, effectiveChannels(k.id, overrides)])) as Record<
    NotificationKindId,
    NotificationChannelId[]
  >;
}
