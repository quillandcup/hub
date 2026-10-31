import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseSlackMessageRepository } from "@/lib/data/slack-messages";
import { defineSlackMessageContract } from "@/tests/helpers/slack-messages-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const PREFIX = `UTM${Date.now()}`;
let counter = 0;

const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

// Everything the contract stores carries this run's prefix in its channel id.
const clear = async () => {
  check((await db.schema("bronze").from("slack_files").delete().like("channel_id", `${PREFIX}%`)).error);
  check((await db.schema("bronze").from("slack_reactions").delete().like("channel_id", `${PREFIX}%`)).error);
  check((await db.schema("bronze").from("slack_messages").delete().like("channel_id", `${PREFIX}%`)).error);
};

afterAll(clear);

defineSlackMessageContract("SupabaseSlackMessageRepository", () => ({
  repo: () => new SupabaseSlackMessageRepository(db),
  unique: (label) => `${PREFIX}${label}${++counter}`,
  stored: async (channelId, messageTs) => {
    const { data, error } = await db.schema("bronze").from("slack_messages").select("text, edited_at, reply_count, files").eq("channel_id", channelId).eq("message_ts", messageTs).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  seed: async ({ messages = [], reactions = [] }) => {
    await clear();
    for (let i = 0; i < messages.length; i += 500) {
      check((await db.schema("bronze").from("slack_messages").insert(messages.slice(i, i + 500) as never)).error);
    }
    for (let i = 0; i < reactions.length; i += 500) {
      check((await db.schema("bronze").from("slack_reactions").insert(reactions.slice(i, i + 500) as never)).error);
    }
  },
}));
