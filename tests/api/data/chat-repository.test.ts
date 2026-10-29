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
  // --- message reads ---
  seedMessages: async (channelId, messages) => {
    const ids: Record<string, string> = {};
    // Roots first: a reply points at its root's database id.
    for (const batch of [messages.filter((m) => !m.threadRootKey), messages.filter((m) => m.threadRootKey)]) {
      if (batch.length === 0) continue;
      const { data, error } = await db
        .from("chat_messages")
        .insert(
          batch.map((m) => ({
            channel_id: channelId,
            created_at: m.createdAt,
            slack_ts: m.slackTs ?? null,
            has_files: m.hasFiles ?? false,
            deleted_at: m.deleted ? m.createdAt : null,
            thread_root_id: m.threadRootKey ? ids[m.threadRootKey] : null,
          }))
        )
        .select("id");
      if (error) throw new Error(error.message);
      batch.forEach((m, i) => (ids[m.key] = data[i].id));
    }
    const contents = messages.filter((m) => m.body !== undefined).map((m) => ({ message_id: ids[m.key], body: m.body as string }));
    if (contents.length > 0) {
      const { error } = await db.from("chat_message_contents").insert(contents);
      if (error) throw new Error(error.message);
    }
    return ids;
  },
  seedReactions: async (channelId, reactions) => {
    const { error } = await db.from("chat_reactions").insert(
      reactions.map((r) => ({
        channel_id: channelId,
        message_id: r.messageId,
        emoji: r.emoji,
        slack_user_id: r.slackUserId,
        created_at: "2026-10-01T10:00:00.000Z",
        deleted_at: r.deleted ? "2026-10-01T11:00:00.000Z" : null,
      }))
    );
    if (error) throw new Error(error.message);
  },
}));
