import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { inChunks, must } from "./query";

/**
 * The course lesson a chat message shares (`chat_message_videos`, one per message). The row only points at the
 * lesson; playback links are minted per viewer by the token route. Reads run as the caller, so RLS shows a video only
 * on a message whose content they can read; `attach` needs the service role (the share action checks the sharer first).
 * A deleted message shares nothing: its share is not returned to anyone (the service role included), so deleting a message ends
 * every way to play its video at once, whatever the lesson was opened to. Throws on a database error.
 */
export interface ChatVideoRepository {
  /**
   * Records that `messageId` shares `lessonId`'s video, closed to members without the course unless `openToChannel`. A message shares
   * at most one: a second attach for it throws. The app shares through `chat_post_shared_video` (the message and this row in one
   * transaction, with the sharer's access checked); this is for seeding and tests, and needs the service role.
   */
  attach(messageId: string, lessonId: string, openToChannel?: boolean): Promise<void>;
  /** The lesson each given message shares; a message that shares none, or is deleted, is absent from the map. */
  lessonIdsOf(messageIds: string[]): Promise<Map<string, string>>;
  /** What one message shares, or null when it shares nothing, is deleted, or the caller can't read it. */
  shareOf(messageId: string): Promise<{ lessonId: string; openToChannel: boolean } | null>;
}

export class SupabaseChatVideoRepository implements ChatVideoRepository {
  constructor(private readonly db: Db) {}

  async attach(messageId: string, lessonId: string, openToChannel = false) {
    must(await this.db.from("chat_message_videos").insert({ message_id: messageId, lesson_id: lessonId, open_to_channel: openToChannel }));
  }

  async shareOf(messageId: string) {
    const row = must(
      await this.db.from("chat_message_videos").select("lesson_id, open_to_channel, chat_messages!inner(deleted_at)").eq("message_id", messageId).is("chat_messages.deleted_at", null).maybeSingle(),
    );
    return row ? { lessonId: row.lesson_id, openToChannel: row.open_to_channel } : null;
  }

  async lessonIdsOf(messageIds: string[]) {
    const rows = await inChunks(messageIds, 100, async (part) =>
      must(await this.db.from("chat_message_videos").select("message_id, lesson_id, chat_messages!inner(deleted_at)").in("message_id", part).is("chat_messages.deleted_at", null)) ?? [],
    );
    return new Map(rows.map((r) => [r.message_id, r.lesson_id]));
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryChatVideoRepository implements ChatVideoRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async attach(messageId: string, lessonId: string, openToChannel = false) {
    if (this.data.chatMessageVideos.some((v) => v.message_id === messageId)) throw new Error("duplicate key value violates unique constraint");
    this.data.chatMessageVideos.push({
      id: `cmv_${String(this.data.chatMessageVideos.length + 1).padStart(12, "A")}`,
      message_id: messageId,
      lesson_id: lessonId,
      open_to_channel: openToChannel,
      created_at: new Date().toISOString(),
    });
  }

  private deleted(messageId: string) {
    return Boolean(this.data.chatMessages.find((m) => m.id === messageId)?.deleted_at);
  }

  async shareOf(messageId: string) {
    const row = this.data.chatMessageVideos.find((v) => v.message_id === messageId && !this.deleted(messageId));
    return row ? { lessonId: row.lesson_id, openToChannel: row.open_to_channel } : null;
  }

  async lessonIdsOf(messageIds: string[]) {
    const wanted = new Set(messageIds);
    return new Map(this.data.chatMessageVideos.filter((v) => wanted.has(v.message_id) && !this.deleted(v.message_id)).map((v) => [v.message_id, v.lesson_id]));
  }
}
