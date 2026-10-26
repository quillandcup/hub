import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabasePushSubscriptionRepository } from "@/lib/data/push-subscriptions";
import { definePushSubscriptionContract } from "@/tests/helpers/push-subscription-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];
let counter = 0;

const clear = async () => {
  const { error } = await db.from("push_subscriptions").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Push Member ${i} ${RUN}`, email: `push-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (error) throw new Error(error.message);
  memberIds = [data![0].id, data![1].id];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
});

definePushSubscriptionContract("SupabasePushSubscriptionRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  repo: () => new SupabasePushSubscriptionRepository(db),
  unique: (label) => `${label}-${RUN}-${++counter}`,
  reset: clear,
}));
