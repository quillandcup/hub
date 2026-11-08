import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseChatVideoRepository } from "@/lib/data/chat-videos";
import { defineChatVideoContract } from "@/tests/helpers/chat-video-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let channelId: string;
let courseId: string;
let messages: [string, string, string];
let lessons: [string, string];

const clear = async () => {
  if (!messages) return;
  const { error } = await db.from("chat_message_videos").delete().in("message_id", messages);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const chan = await db.from("chat_channels").insert({ kind: "channel", visibility: "public", name: `video-contract-${RUN}`, bridge_mode: "app_only" }).select("id").single();
  if (chan.error) throw new Error(chan.error.message);
  channelId = chan.data.id;
  const made = await db
    .from("chat_messages")
    .insert([0, 1, 2].map(() => ({ channel_id: channelId, origin: "app" as const, created_at: new Date().toISOString() })))
    .select("id");
  if (made.error) throw new Error(made.error.message);
  messages = made.data.map((m) => m.id) as [string, string, string];

  const course = await db.from("courses").insert({ slug: `video-contract-${RUN}`, title: `Video contract ${RUN}`, source_key: `video-contract-${RUN}` }).select("id").single();
  if (course.error) throw new Error(course.error.message);
  courseId = course.data.id;
  const less = await db
    .from("course_lessons")
    .insert([0, 1].map((i) => ({ course_id: courseId, title: `Lesson ${i}`, position: i + 1, source_key: `video-contract-${RUN}-${i}` })))
    .select("id");
  if (less.error) throw new Error(less.error.message);
  lessons = less.data.map((l) => l.id) as [string, string];
});

afterAll(async () => {
  await clear();
  // Messages go with their channel, lessons with their course.
  await db.from("chat_channels").delete().eq("id", channelId ?? "");
  await db.from("courses").delete().eq("id", courseId ?? "");
});

defineChatVideoContract("SupabaseChatVideoRepository", () => ({
  repo: () => new SupabaseChatVideoRepository(db),
  get messages() {
    return messages;
  },
  get lessons() {
    return lessons;
  },
  clear,
}));
