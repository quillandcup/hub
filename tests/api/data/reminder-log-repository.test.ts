import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseReminderLogRepository } from "@/lib/data/reminder-log";
import { defineReminderLogContract } from "@/tests/helpers/reminder-log-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];

const clear = async () => {
  const { error } = await db.from("member_reminder_log").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Reminder Member ${i} ${RUN}`, email: `reminder-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (error) throw new Error(error.message);
  memberIds = [data![0].id, data![1].id];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
});

defineReminderLogContract("SupabaseReminderLogRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  repo: () => new SupabaseReminderLogRepository(db),
  reset: clear,
}));
