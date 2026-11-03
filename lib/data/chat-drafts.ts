import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { asJson } from "./json";

/** The longest draft kept: the box's own limit (`maxLength` in `Composer`), also a CHECK in the table. */
export const MAX_DRAFT_LENGTH = 4000;

/** Where a draft belongs: a conversation's box (`threadRootId` null) or one thread's reply box. */
export type DraftPlace = { channelId: string; threadRootId: string | null };

/** A file attached to a draft: its staged copy in the private bucket (`lib/chat/staging.ts`). */
export type DraftFile = { path: string; name: string; mimetype: string; size: number };

/** What is saved for a place: the text, and the files attached to it (a draft may be files only). */
export type DraftContent = { body: string; files?: DraftFile[] };

/** A member's unsent text and files for one place. */
export type ChatDraft = DraftPlace & { body: string; files: DraftFile[]; updatedAt: string };

type DraftRow = Row<"chat_drafts">;
type DraftColumns = Pick<DraftRow, "channel_id" | "thread_root_id" | "body" | "files" | "updated_at">;
const COLUMNS = "channel_id, thread_root_id, body, files, updated_at";

/** The stored files as a list, dropping anything that isn't shaped like one (the column is jsonb). */
const filesOf = (value: unknown): DraftFile[] =>
  Array.isArray(value)
    ? value.flatMap((f) =>
        f && typeof f.path === "string" && typeof f.name === "string" && typeof f.mimetype === "string" && typeof f.size === "number"
          ? [{ path: f.path, name: f.name, mimetype: f.mimetype, size: f.size }]
          : [],
      )
    : [];

const toDraft = (row: DraftColumns): ChatDraft => ({
  channelId: row.channel_id,
  threadRootId: row.thread_root_id,
  body: row.body,
  files: filesOf(row.files),
  updatedAt: row.updated_at,
});

/**
 * Unsent chat text (`chat_drafts`): one draft per member per conversation or thread, saved as they type.
 * Author-only: run it on the member's own RLS client, never to read someone else's (`stagedPaths` is the
 * one exception, for the service role). Text that is only whitespace and no files is no draft, so saving it
 * clears. Methods throw on a database error.
 */
export interface ChatDraftRepository {
  /** The member's draft for this place, or null. */
  get(memberId: string, place: DraftPlace): Promise<ChatDraft | null>;
  /** Saves (replacing any earlier) the draft for this place; blank text with no files clears it. Text over `MAX_DRAFT_LENGTH` is cut. */
  save(memberId: string, place: DraftPlace, draft: DraftContent): Promise<void>;
  /** Removes the draft for this place (nothing happens when there is none). */
  clear(memberId: string, place: DraftPlace): Promise<void>;
  /** All the member's drafts, most recently edited first. */
  list(memberId: string): Promise<ChatDraft[]>;
  /** Every staged path any member's drafts list (service role): the staging purge keeps these. */
  stagedPaths(): Promise<Set<string>>;
}

const clean = (body: string) => body.slice(0, MAX_DRAFT_LENGTH);
const isBlank = (draft: DraftContent) => draft.body.trim() === "" && (draft.files ?? []).length === 0;

export class SupabaseChatDraftRepository implements ChatDraftRepository {
  constructor(private readonly db: Db) {}

  /** Narrows a query to one place: a NULL thread needs `is`, not `eq`. */
  private place<Q extends { eq(c: string, v: string): Q; is(c: string, v: null): Q }>(query: Q, memberId: string, place: DraftPlace): Q {
    const scoped = query.eq("member_id", memberId).eq("channel_id", place.channelId);
    return place.threadRootId === null ? scoped.is("thread_root_id", null) : scoped.eq("thread_root_id", place.threadRootId);
  }

  async get(memberId: string, place: DraftPlace) {
    const { data, error } = await this.place(this.db.from("chat_drafts").select(COLUMNS), memberId, place).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toDraft(data) : null;
  }

  async save(memberId: string, place: DraftPlace, draft: DraftContent) {
    if (isBlank(draft)) return this.clear(memberId, place);
    const text = clean(draft.body);
    const files = asJson(draft.files ?? []);
    // The unique indexes are partial (a NULL thread can't be in a plain constraint), which an upsert
    // can't target: update, and insert when nothing was there. A concurrent save that wins the insert
    // makes ours a unique violation, so it updates instead.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await this.place(this.db.from("chat_drafts").update({ body: text, files }), memberId, place).select("id");
      if (error) throw new Error(error.message);
      if (data && data.length > 0) return;
      const inserted = await this.db.from("chat_drafts").insert({ member_id: memberId, channel_id: place.channelId, thread_root_id: place.threadRootId, body: text, files });
      if (!inserted.error) return;
      if (inserted.error.code !== "23505") throw new Error(inserted.error.message);
    }
    throw new Error("chat_drafts: could not save the draft");
  }

  async clear(memberId: string, place: DraftPlace) {
    const { error } = await this.place(this.db.from("chat_drafts").delete(), memberId, place);
    if (error) throw new Error(error.message);
  }

  async list(memberId: string) {
    const rows = await fetchAllRows<DraftColumns>((from, to) =>
      this.db.from("chat_drafts").select(COLUMNS).eq("member_id", memberId).order("updated_at", { ascending: false }).order("id").range(from, to),
    );
    return rows.map(toDraft);
  }

  async stagedPaths() {
    const rows = await fetchAllRows<Pick<DraftRow, "files">>((from, to) => this.db.from("chat_drafts").select("files").order("id").range(from, to));
    return new Set(rows.flatMap((r) => filesOf(r.files).map((f) => f.path)));
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryChatDraftRepository implements ChatDraftRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private find(memberId: string, place: DraftPlace) {
    return this.data.chatDrafts.find((d) => d.member_id === memberId && d.channel_id === place.channelId && d.thread_root_id === place.threadRootId);
  }

  async get(memberId: string, place: DraftPlace) {
    const row = this.find(memberId, place);
    return row ? toDraft(row) : null;
  }

  async save(memberId: string, place: DraftPlace, draft: DraftContent) {
    if (isBlank(draft)) return this.clear(memberId, place);
    const files = asJson(draft.files ?? []);
    const existing = this.find(memberId, place);
    // Rising, like now() across saves, so two saves in a row keep their order.
    const stamp = new Date(Math.max(Date.now(), ...this.data.chatDrafts.map((d) => Date.parse(d.updated_at) + 1))).toISOString();
    if (existing) {
      existing.body = clean(draft.body);
      existing.files = files;
      existing.updated_at = stamp;
      return;
    }
    this.data.chatDrafts.push({
      id: `drft_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: memberId,
      channel_id: place.channelId,
      thread_root_id: place.threadRootId,
      body: clean(draft.body),
      files,
      created_at: stamp,
      updated_at: stamp,
    });
  }

  async clear(memberId: string, place: DraftPlace) {
    this.data.chatDrafts = this.data.chatDrafts.filter((d) => d !== this.find(memberId, place));
  }

  async list(memberId: string) {
    return this.data.chatDrafts
      .filter((d) => d.member_id === memberId)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1))
      .map(toDraft);
  }

  async stagedPaths() {
    return new Set(this.data.chatDrafts.flatMap((d) => filesOf(d.files).map((f) => f.path)));
  }
}
