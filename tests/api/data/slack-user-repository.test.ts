import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SLACKBOT_USER_ID } from "@/lib/slack-matching";
import { SupabaseSlackUserRepository } from "@/lib/data/slack-users";
import { defineSlackUserContract } from "@/tests/helpers/slack-user-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `UT${RUN}`;
let counter = 0;
let createdSlackbot = false;

const table = () => db.schema("bronze").from("slack_users");

// Everything the contract stores carries this run's prefix in its Slack id, except Slackbot, whose row is
// only removed again when this run was the one to create it.
const clear = async () => {
  const { error } = await table().delete().like("user_id", `${PREFIX}%`);
  if (error) throw new Error(error.message);
  if (createdSlackbot) {
    await table().delete().eq("user_id", SLACKBOT_USER_ID);
    createdSlackbot = false;
  }
};

afterAll(clear);

defineSlackUserContract("SupabaseSlackUserRepository", () => ({
  repo: () => new SupabaseSlackUserRepository(db),
  unique: (label) => `${PREFIX}${label}${++counter}`,
  seed: async (users) => {
    await clear();
    const rows = users.map((u) => ({ ...u, raw_payload: {} }));
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).filter((r) => r.user_id !== SLACKBOT_USER_ID);
      const { error } = await table().insert(batch);
      if (error) throw new Error(error.message);
    }
    if (users.some((u) => u.user_id === SLACKBOT_USER_ID)) {
      const { data } = await table().select("user_id").eq("user_id", SLACKBOT_USER_ID).maybeSingle();
      if (!data) {
        const { error } = await table().insert({ user_id: SLACKBOT_USER_ID, real_name: "Slackbot", is_bot: false, raw_payload: {} });
        if (error) throw new Error(error.message);
        createdSlackbot = true;
      }
    }
  },
}));
