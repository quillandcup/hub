import { CHANNEL_ADAPTERS, type ChannelId, type OutboundMessage } from "@/lib/channels";
import { APP_URL } from "@/lib/config";
import { effectiveChannels, type NotificationKindId, type NotificationPreferenceRow } from "./registry";

/**
 * The one way server code notifies members. Notifications sit on the shared channel adapters
 * (lib/channels/) and add what's specific to the app reaching out: the member's per-kind channel
 * choices and a link to change them. Pass a service-role client (adapters read other members'
 * contact details). Built once per batch, so preferences and addresses load in a few queries
 * rather than per member:
 *
 *   const notifier = await createNotifier(supabase, "prickle_checkin", memberIds);
 *   for (const memberId of memberIds) {
 *     if (!notifier.canReach(memberId)) continue;   // opted out everywhere, or no address
 *     // ...claim the send in a dedup log...
 *     await notifier.send(memberId, { text, url, slackBlocks });
 *   }
 *
 * Check canReach before claiming a dedup row, so turning a kind back on later still sends.
 */

export const NOTIFICATION_SETTINGS_PATH = "/settings?tab=notifications";

// Keeps each `.in("member_id", ...)` URL well under PostgREST's length limit.
const MEMBER_ID_CHUNK = 200;

export interface Notifier {
  /** Channels this member gets this kind on that we can actually reach them on. */
  channelsFor(memberId: string): ChannelId[];
  canReach(memberId: string): boolean;
  /**
   * Sends to every channel in channelsFor(memberId) and returns the ones that succeeded. A channel
   * that fails is logged and skipped; it doesn't stop the others or throw.
   */
  send(memberId: string, message: OutboundMessage): Promise<ChannelId[]>;
}

export interface NotifierOptions {
  /**
   * Send on exactly these channels, ignoring preferences. Only for a send the member explicitly
   * asked for just now (e.g. an admin's "send me a test" button), never for the app reaching out.
   */
  channels?: ChannelId[];
}

export async function loadNotificationPreferences(
  supabase: any,
  kind: NotificationKindId,
  memberIds: string[]
): Promise<Map<string, NotificationPreferenceRow[]>> {
  const byMember = new Map<string, NotificationPreferenceRow[]>();
  for (let i = 0; i < memberIds.length; i += MEMBER_ID_CHUNK) {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("member_id, kind, channel, enabled")
      .eq("kind", kind)
      .in("member_id", memberIds.slice(i, i + MEMBER_ID_CHUNK));
    // Failing closed (no sends) would silently drop every notification on a transient error; the
    // defaults are what a member who never opened settings gets anyway.
    if (error) console.error(`[notifications] Loading ${kind} preferences failed; using defaults`, error);
    for (const row of data ?? []) {
      const rows = byMember.get(row.member_id) ?? [];
      rows.push(row);
      byMember.set(row.member_id, rows);
    }
  }
  return byMember;
}

export async function createNotifier(
  supabase: any,
  kind: NotificationKindId,
  memberIds: string[],
  options: NotifierOptions = {}
): Promise<Notifier> {
  const unique = [...new Set(memberIds)];
  const wanted = new Map<string, ChannelId[]>();
  if (options.channels) {
    for (const memberId of unique) wanted.set(memberId, options.channels);
  } else {
    const preferences = await loadNotificationPreferences(supabase, kind, unique);
    for (const memberId of unique) wanted.set(memberId, effectiveChannels(kind, preferences.get(memberId) ?? []));
  }

  const usedChannels = [...new Set([...wanted.values()].flat())];
  const addresses = new Map<ChannelId, Map<string, string>>(
    await Promise.all(
      usedChannels.map(async (channel) => {
        const members = unique.filter((m) => wanted.get(m)!.includes(channel));
        return [channel, await CHANNEL_ADAPTERS[channel].resolveAddresses(supabase, members)] as const;
      })
    )
  );

  const channelsFor = (memberId: string) =>
    (wanted.get(memberId) ?? []).filter((channel) => addresses.get(channel)?.has(memberId));

  return {
    channelsFor,
    canReach: (memberId) => channelsFor(memberId).length > 0,
    async send(memberId, message) {
      const withSettingsLink: OutboundMessage = {
        ...message,
        footerLinks: [
          ...(message.footerLinks ?? []),
          { label: "Notification settings", url: `${APP_URL}${NOTIFICATION_SETTINGS_PATH}` },
        ],
      };
      const delivered: ChannelId[] = [];
      for (const channel of channelsFor(memberId)) {
        try {
          await CHANNEL_ADAPTERS[channel].send(addresses.get(channel)!.get(memberId)!, withSettingsLink);
          delivered.push(channel);
        } catch (error) {
          console.error(`[notifications] ${kind} via ${channel} to member ${memberId} failed`, error);
        }
      }
      return delivered;
    },
  };
}
