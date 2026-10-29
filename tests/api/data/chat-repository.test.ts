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

// Members made for the membership tests (channels, and so their memberships and messages, are cleared first).
const createdMembers: string[] = [];
let memberIds: string[] = [];
let channelIds: Record<string, string> = {};

afterAll(async () => {
  await clear();
  if (createdMembers.length > 0) await db.from("members").delete().in("id", createdMembers);
});

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
  // --- channels and membership slice ---
  seedMembers: async (count) => {
    const stamp = ++counter;
    const { data, error } = await db
      .from("members")
      .insert(Array.from({ length: count }, (_, i) => ({ name: `Chat Contract ${RUN} ${stamp} ${i}`, email: `chat-contract-${RUN}-${stamp}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
      .select("id, email");
    if (error) throw new Error(error.message);
    memberIds = Array.from({ length: count }, (_, i) => data!.find((m) => m.email === `chat-contract-${RUN}-${stamp}-${i}@example.com`)!.id);
    createdMembers.push(...memberIds);
    return memberIds;
  },
  seedChannelRows: async (channels) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const c of channels) {
      const { data, error } = await db
        .from("chat_channels")
        .insert({
          kind: c.kind ?? "channel",
          visibility: c.visibility ?? "public",
          name: c.name === undefined ? `contract-${c.key}-${counter}` : c.name,
          slack_channel_id: c.slackChannelId ?? null,
          archived_at: c.archivedAt ?? null,
          ...(c.restricted !== undefined ? { restricted: c.restricted } : {}),
          ...(c.bridgeDisabled !== undefined ? { bridge_disabled: c.bridgeDisabled } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[c.key] = data.id;
      createdChannels.push(data.id);
    }
    channelIds = ids;
    return ids;
  },
  seedMemberships: async (rows) => {
    const { error } = await db.from("chat_channel_members").insert(
      rows.map((r) => ({
        channel_id: channelIds[r.channel],
        member_id: memberIds[r.member],
        // Every row names every column: a bulk insert sends null for one a row leaves out.
        joined_at: r.joinedAt ?? "2026-01-01T00:00:00Z",
        left_at: r.leftAt ?? null,
        last_read_at: r.lastReadAt ?? null,
        source: r.source ?? "slack",
      }))
    );
    if (error) throw new Error(error.message);
  },
  seedChannelMessages: async (rows) => {
    const ids: Record<string, string> = {};
    for (const r of rows) {
      const { data, error } = await db
        .from("chat_messages")
        .insert({
          channel_id: channelIds[r.channel],
          created_at: r.createdAt,
          author_member_id: r.author !== undefined ? memberIds[r.author] : null,
          slack_ts: r.slackTs ?? null,
          thread_root_id: r.replyTo ? ids[r.replyTo] : null,
          deleted_at: r.deleted ? r.createdAt : null,
          ...(r.origin ? { origin: r.origin } : {}),
          ...(r.syncStatus ? { slack_sync_status: r.syncStatus } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[r.key] = data.id;
    }
    return ids;
  },
  noticesIn: async (channelId) => {
    const { data, error } = await db
      .from("chat_messages")
      .select("author_member_id, system_subtype, origin, chat_message_contents(body)")
      .eq("channel_id", channelId)
      .not("system_subtype", "is", null);
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => {
      const content = m.chat_message_contents as { body: string } | { body: string }[] | null;
      return { author_member_id: m.author_member_id, system_subtype: m.system_subtype, origin: m.origin, body: (Array.isArray(content) ? content[0] : content)?.body ?? "" };
    });
  },
}));
