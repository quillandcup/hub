import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseNotificationLogRepository } from "@/lib/data/notification-log";
import { defineNotificationLogContract } from "@/tests/helpers/notification-log-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const places: string[] = [];
let memberIds: [string, string];
let n = 0;

const clear = async () => {
  const { error } = await db.from("notification_log").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
  if (places.length) {
    const { error: placeError } = await db.from("notification_log").delete().in("place", places);
    if (placeError) throw new Error(placeError.message);
  }
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Log Member ${i} ${RUN}`, email: `notification-log-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (error) throw new Error(error.message);
  memberIds = [data![0].id, data![1].id];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
});

defineNotificationLogContract("SupabaseNotificationLogRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  repo: () => new SupabaseNotificationLogRepository(db),
  place: () => {
    const place = `slack:test-${RUN}-${++n}`;
    places.push(place);
    return place;
  },
  reset: clear,
}));
