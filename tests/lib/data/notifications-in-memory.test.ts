import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryNotificationRepository } from "@/lib/data/notifications";
import { defineNotificationContract, type InAppSeed, type PreferenceSeed } from "@/tests/helpers/notification-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;
const BASE = Date.parse("2097-03-01T10:00:00Z");

defineNotificationContract("InMemoryNotificationRepository", () => {
  let data = new InMemoryDataset();
  return {
    memberIds,
    repo: () => new InMemoryNotificationRepository(data),
    seed: async ({ preferences = [], inApp = [] }: { preferences?: PreferenceSeed[]; inApp?: InAppSeed[] }) => {
      const rows = inApp.map((n, i) => ({
        id: `ntf_${String(i).padStart(12, "A")}`,
        memberId: memberIds[n.member],
        kind: n.kind,
        ref: n.ref ?? null,
        text: n.text ?? `Notification ${i}`,
        url: null,
        bannerUntil: n.bannerUntil ?? null,
        readAt: n.read ? new Date(BASE).toISOString() : null,
        createdAt: new Date(BASE + n.minute * 60_000).toISOString(),
      }));
      data = new InMemoryDataset({
        notificationPreferences: preferences.map((p) => ({ memberId: memberIds[p.member], kind: p.kind, channel: p.channel, enabled: p.enabled })),
        inAppNotifications: rows,
      });
      return rows.map((r) => r.id);
    },
  };
});
