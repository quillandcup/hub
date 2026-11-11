import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseChatLinkPreviewRepository } from "@/lib/data/chat-link-previews";
import { defineChatLinkPreviewContract } from "@/tests/helpers/chat-link-preview-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let channelId: string;
let messages: [string, string, string];

const clear = async () => {
  if (!messages) return;
  for (const table of ["chat_link_previews", "chat_hidden_unfurls"] as const) {
    const { error } = await db.from(table).delete().in("message_id", messages);
    if (error) throw new Error(error.message);
  }
};

beforeAll(async () => {
  const chan = await db.from("chat_channels").insert({ kind: "channel", visibility: "public", name: `preview-contract-${RUN}`, bridge_mode: "app_only" }).select("id").single();
  if (chan.error) throw new Error(chan.error.message);
  channelId = chan.data.id;
  const made = await db
    .from("chat_messages")
    .insert([0, 1, 2].map(() => ({ channel_id: channelId, origin: "app" as const, created_at: new Date().toISOString() })))
    .select("id");
  if (made.error) throw new Error(made.error.message);
  messages = made.data.map((m) => m.id) as [string, string, string];
});

afterAll(async () => {
  await clear();
  // Messages go with their channel.
  await db.from("chat_channels").delete().eq("id", channelId ?? "");
});

defineChatLinkPreviewContract("SupabaseChatLinkPreviewRepository", () => ({
  repo: () => new SupabaseChatLinkPreviewRepository(db),
  get messages() {
    return messages;
  },
  clear,
}));
