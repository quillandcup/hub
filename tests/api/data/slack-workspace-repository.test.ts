import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseSlackWorkspaceRepository } from "@/lib/data/slack-workspace";
import { defineSlackWorkspaceContract } from "@/tests/helpers/slack-workspace-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const PREFIX = `UTW${Date.now()}`;
let counter = 0;

const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

// Everything the contract stores carries this run's prefix in its Slack id.
const clear = async () => {
  check((await db.schema("bronze").from("slack_channels").delete().like("channel_id", `${PREFIX}%`)).error);
  check((await db.from("ignored_slack_users").delete().like("user_id", `${PREFIX}%`)).error);
  check((await db.from("restricted_slack_channels").delete().like("channel_id", `${PREFIX}%`)).error);
};

afterAll(clear);

defineSlackWorkspaceContract("SupabaseSlackWorkspaceRepository", () => ({
  repo: () => new SupabaseSlackWorkspaceRepository(db),
  unique: (label) => `${PREFIX}${label}${++counter}`,
  seed: async ({ channels = [], ignoredUserIds = [] }) => {
    await clear();
    if (channels.length > 0) {
      check((await db.schema("bronze").from("slack_channels").insert(channels.map((c) => ({ ...c, raw_payload: {} })))).error);
    }
    if (ignoredUserIds.length > 0) {
      check((await db.from("ignored_slack_users").insert(ignoredUserIds.map((user_id) => ({ user_id })))).error);
    }
  },
}));
