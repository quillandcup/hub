import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseNotificationLogRepository } from "@/lib/data/notification-log";
import { defineNotificationLogContract } from "@/tests/helpers/notification-log-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const places: string[] = [];
let memberIds: [string, string];
// Members this file made itself, to remove again. It reuses existing ones where there are some, because other
// suites read the members table unpaginated (so it must not grow while they run).
let created: string[] = [];
let n = 0;

// Only this suite's kinds: the members may be real rows of other tests.
const clear = async () => {
  const { error } = await db.from("notification_log").delete().in("member_id", memberIds).in("kind", ["digest", "other"]);
  if (error) throw new Error(error.message);
  if (places.length) {
    const { error: placeError } = await db.from("notification_log").delete().in("place", places);
    if (placeError) throw new Error(placeError.message);
  }
};

beforeAll(async () => {
  const { data: existing, error: readError } = await db.from("members").select("id").order("id").limit(2);
  if (readError) throw new Error(readError.message);
  const ids = (existing ?? []).map((m) => m.id);
  const missing = 2 - ids.length;
  if (missing > 0) {
    const { data, error } = await db
      .from("members")
      .insert(Array.from({ length: missing }, (_, i) => ({ name: `Log Member ${i} ${RUN}`, email: `notification-log-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
      .select("id");
    if (error) throw new Error(error.message);
    created = data!.map((m) => m.id);
    ids.push(...created);
  }
  memberIds = [ids[0], ids[1]];
});

afterAll(async () => {
  await clear();
  if (created.length) await db.from("members").delete().in("id", created);
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
