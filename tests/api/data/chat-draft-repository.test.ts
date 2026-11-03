import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseChatDraftRepository } from "@/lib/data/chat-drafts";
import { defineChatDraftContract } from "@/tests/helpers/chat-draft-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: [string, string];
let channels: [string, string];
let threadRoot: string;

const clear = async () => {
  if (!members) return;
  const { error } = await db.from("chat_drafts").delete().in("member_id", members);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const made = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `${i === 0 ? "Ada" : "Fern"} Example ${RUN}`, email: `draft-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (made.error) throw new Error(made.error.message);
  members = [0, 1].map((i) => made.data!.find((m) => m.email === `draft-repo-${RUN}-${i}@example.com`)!.id) as [string, string];

  const chans = await db
    .from("chat_channels")
    .insert([0, 1].map((i) => ({ kind: "channel", visibility: "public", name: `draft-contract-${RUN}-${i}`, bridge_mode: "app_only" })))
    .select("id, name");
  if (chans.error) throw new Error(chans.error.message);
  channels = [0, 1].map((i) => chans.data!.find((c) => c.name === `draft-contract-${RUN}-${i}`)!.id) as [string, string];

  const root = await db.from("chat_messages").insert({ channel_id: channels[0], origin: "app", created_at: new Date().toISOString() }).select("id").single();
  if (root.error) throw new Error(root.error.message);
  threadRoot = root.data.id;
});

afterAll(async () => {
  await clear();
  // Messages go with their channel.
  await db.from("chat_channels").delete().in("id", channels ?? []);
  await db.from("members").delete().in("id", members ?? []);
});

defineChatDraftContract("SupabaseChatDraftRepository", () => ({
  repo: () => new SupabaseChatDraftRepository(db),
  get members() {
    return members;
  },
  get places() {
    return {
      conversation: { channelId: channels[0], threadRootId: null },
      thread: { channelId: channels[0], threadRootId: threadRoot },
      other: { channelId: channels[1], threadRootId: null },
    };
  },
  clear,
}));
