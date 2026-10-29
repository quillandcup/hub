import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseChatRepository } from "@/lib/data/chat";
import { defineChatContract } from "@/tests/helpers/chat-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `CT${RUN}`;
let counter = 0;
const createdChannels: string[] = [];

// Channels go with everything that hangs off them (ON DELETE CASCADE).
const clear = async () => {
  if (createdChannels.length === 0) return;
  const { error } = await db.from("chat_channels").delete().in("id", createdChannels.splice(0));
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineChatContract("SupabaseChatRepository", () => ({
  repo: () => new SupabaseChatRepository(db),
  unique: (label) => `${PREFIX}${label}${++counter}`,
  seedChannels: async (channels) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const c of channels) {
      const { data, error } = await db
        .from("chat_channels")
        .insert({
          kind: "channel",
          visibility: "public",
          name: `contract-${c.key}-${counter}`,
          slack_channel_id: c.slackChannelId ?? null,
          ...(c.bridgeMode ? { bridge_mode: c.bridgeMode } : {}),
          ...(c.bridgeDisabled !== undefined ? { bridge_disabled: c.bridgeDisabled } : {}),
          ...(c.bridgeStatus ? { bridge_status: c.bridgeStatus } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[c.key] = data.id;
      createdChannels.push(data.id);
    }
    return ids;
  },
}));
