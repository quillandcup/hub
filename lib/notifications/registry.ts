import { CHANNELS, isChannelId, type ChannelId } from "@/lib/channels/catalog";

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

/** Every channel can carry notifications today; narrow this if one ever can't. */
export const NOTIFICATION_CHANNELS = CHANNELS;
export type NotificationChannelId = ChannelId;
export const isNotificationChannel = isChannelId;

export interface NotificationKindDef {
  id: string;
  /** Settings-page grouping heading. */
  category: string;
  label: string;
  description: string;
  /** Channels it goes to for a member who hasn't changed this kind's settings. */
  defaultChannels: readonly NotificationChannelId[];
}

export const NOTIFICATION_KINDS = [
  {
    id: "prickle_checkin",
    category: "Prickles",
    label: "Prickle check-ins",
    description: "About 20 minutes before a writing prickle on your calendar: how you're feeling coming in.",
    defaultChannels: ["slack"],
  },
  {
    id: "prickle_checkout",
    category: "Prickles",
    label: "Prickle check-outs",
    description: "After a writing prickle you attended: how it went, and a quick progress log for your goals.",
    defaultChannels: ["slack"],
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
