import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { inChunks, must } from "./query";

/**
 * The course lesson a chat message shares (`chat_message_videos`, one per message). The row only points at the
 * lesson; playback links are minted per viewer by the token route. Reads run as the caller, so RLS shows a video only
 * on a message whose content they can read; `attach` needs the service role (the share action checks the sharer first).
 * Throws on a database error.
 */
export interface ChatVideoRepository {
  /** Records that `messageId` shares `lessonId`'s video. A message shares at most one: a second attach for it throws. */
  attach(messageId: string, lessonId: string): Promise<void>;
  /** The lesson each given message shares; a message that shares none is absent from the map. */
  lessonIdsOf(messageIds: string[]): Promise<Map<string, string>>;
}

export class SupabaseChatVideoRepository implements ChatVideoRepository {
  constructor(private readonly db: Db) {}

  async attach(messageId: string, lessonId: string) {
    must(await this.db.from("chat_message_videos").insert({ message_id: messageId, lesson_id: lessonId }));
  }

  async lessonIdsOf(messageIds: string[]) {
    const rows = await inChunks(messageIds, 100, async (part) =>
      must(await this.db.from("chat_message_videos").select("message_id, lesson_id").in("message_id", part)) ?? [],
    );
    return new Map(rows.map((r) => [r.message_id, r.lesson_id]));
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryChatVideoRepository implements ChatVideoRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async attach(messageId: string, lessonId: string) {
    if (this.data.chatMessageVideos.some((v) => v.message_id === messageId)) throw new Error("duplicate key value violates unique constraint");
    this.data.chatMessageVideos.push({
      id: `cmv_${String(this.data.chatMessageVideos.length + 1).padStart(12, "A")}`,
      message_id: messageId,
      lesson_id: lessonId,
      created_at: new Date().toISOString(),
    });
  }

  async lessonIdsOf(messageIds: string[]) {
    const wanted = new Set(messageIds);
    return new Map(this.data.chatMessageVideos.filter((v) => wanted.has(v.message_id)).map((v) => [v.message_id, v.lesson_id]));
  }
}
