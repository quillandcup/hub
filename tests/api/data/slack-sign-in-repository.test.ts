import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAnalyticsEventRepository } from "@/lib/data/analytics-events";
import { SupabaseSlackSignInRepository } from "@/lib/data/slack-sign-in";
import { defineAnalyticsEventContract } from "@/tests/helpers/analytics-event-contract";
import { defineSlackSignInContract } from "@/tests/helpers/slack-sign-in-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `ssi-${Date.now()}`;
let counter = 0;
const userIds: string[] = [];

const newUserId = async () => {
  const { data, error } = await db.auth.admin.createUser({ email: `${RUN}-${++counter}@example.com`, password: `pw-${RUN}-${counter}`, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? "no user");
  userIds.push(data.user.id);
  return data.user.id;
};

// Bindings and events go with their users; credentials carry RUN in their Slack user id.
afterAll(async () => {
  await db.from("slack_sign_in_tokens").delete().like("slack_user_id", `%${RUN}%`);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

defineSlackSignInContract("SupabaseSlackSignInRepository", () => ({
  repo: () => new SupabaseSlackSignInRepository(db),
  unique: (label) => `${label}-${RUN}-${++counter}`,
  newUserId,
}));

defineAnalyticsEventContract("SupabaseAnalyticsEventRepository", () => ({
  repo: () => new SupabaseAnalyticsEventRepository(db),
  newUserId,
  stored: async (userId) => {
    const { data, error } = await db.from("analytics_events").select("message_id, source, event").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data;
  },
}));
