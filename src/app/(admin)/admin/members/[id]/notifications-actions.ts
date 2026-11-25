"use server";

import { requireActionPermission } from "@/lib/admin-auth";
import { clock } from "@/lib/clock";
import { getRepos, getServiceRepos } from "@/lib/data/server";
import { describeDevice } from "@/lib/device-label";
import { isId } from "@/lib/ids";
import { isNewcomer } from "@/lib/newcomer";
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS, effectiveChannels } from "@/lib/notifications/registry";
import type { NotificationKindRow } from "./MemberNotificationsPanel";

export type NotificationsInfo = { devices: string[]; newcomer: boolean; kinds: NotificationKindRow[] };
export type NotificationsResult = { error: string } | NotificationsInfo;

/**
 * What the member page's Notifications tab shows, read when the tab opens (a tab click never goes back to the
 * server, so the page cannot know ahead of it): the member's browser devices (service role, since the table holds
 * push credentials; only the labels leave this function) and their stored choices against the defaults. A lookup
 * that fails reads as empty, so the tab still shows the defaults.
 */
export async function loadMemberNotifications(memberId: string): Promise<NotificationsResult> {
  const auth = await requireActionPermission("member.push_devices");
  if (!auth.ok) return { error: auth.error };
  if (!isId(memberId, "mbr")) return { error: "Member not found." };
  try {
    const repos = await getRepos();
    const [member, devices, stored] = await Promise.all([
      repos.members.adminView(memberId),
      getServiceRepos()
        .pushSubscriptions.devices(memberId)
        .then((rows) => rows.map((d) => describeDevice(d.userAgent)))
        .catch(() => [] as string[]),
      repos.notifications.preferencesOf(memberId).catch(() => []),
    ]);
    if (!member) return { error: "Member not found." };
    const newcomer = isNewcomer(member.firstJoinedAt, new Date(clock.now()));
    return {
      devices,
      newcomer,
      kinds: NOTIFICATION_KINDS.map((k) => {
        const channels = effectiveChannels(k.id, stored, { newcomer });
        const defaults = effectiveChannels(k.id, [], { newcomer });
        return {
          id: k.id,
          category: k.category,
          label: k.label,
          channels,
          changed: NOTIFICATION_CHANNELS.map((c) => c.id).filter((c) => channels.includes(c) !== defaults.includes(c)),
        };
      }),
    };
  } catch (error) {
    console.error("[member-notifications] load failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't load the notification settings." };
  }
}
