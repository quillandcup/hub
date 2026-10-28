import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseActivityRepository } from "@/lib/data/activities";
import { defineActivityContract } from "@/tests/helpers/activity-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];
let counter = 0;

const clear = async () => {
  const { error } = await db.from("member_activities").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Activity Member ${i} ${RUN}`, email: `activity-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (error) throw new Error(error.message);
  memberIds = [0, 1].map((i) => data!.find((m) => m.email === `activity-repo-${RUN}-${i}@example.com`)!.id) as [string, string];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
});

defineActivityContract("SupabaseActivityRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  repo: () => new SupabaseActivityRepository(db),
  unique: (label) => `${label}-${RUN}-${++counter}`,
  clear,
}));
