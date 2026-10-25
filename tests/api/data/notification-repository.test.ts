import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseNotificationRepository } from "@/lib/data/notifications";
import { defineNotificationContract, type InAppSeed, type PreferenceSeed } from "@/tests/helpers/notification-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const BASE = Date.parse("2097-03-01T10:00:00Z");
let memberIds: [string, string];

async function clear() {
  for (const table of ["notification_preferences", "in_app_notifications"] as const) {
    const { error } = await db.from(table).delete().in("member_id", memberIds);
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Notification Member ${i} ${RUN}`, email: `notification-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (error) throw new Error(error.message);
  memberIds = [data![0].id, data![1].id];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
});

defineNotificationContract("SupabaseNotificationRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  repo: () => new SupabaseNotificationRepository(db),
  seed: async ({ preferences = [], inApp = [] }: { preferences?: PreferenceSeed[]; inApp?: InAppSeed[] }) => {
    await clear();
    if (preferences.length > 0) {
      const { error } = await db
        .from("notification_preferences")
        .insert(preferences.map((p) => ({ member_id: memberIds[p.member], kind: p.kind, channel: p.channel, enabled: p.enabled })));
      if (error) throw new Error(error.message);
    }
    const ids: string[] = [];
    for (const n of inApp) {
      const { data, error } = await db
        .from("in_app_notifications")
        .insert({
          member_id: memberIds[n.member],
          kind: n.kind,
          ref: n.ref ?? null,
          text: n.text ?? "Notification",
          banner_until: n.bannerUntil ?? null,
          read_at: n.read ? new Date(BASE).toISOString() : null,
          created_at: new Date(BASE + n.minute * 60_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids.push(data!.id);
    }
    return ids;
  },
}));
