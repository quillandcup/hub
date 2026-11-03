import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** The longest note kept: also a CHECK in the table. */
export const MAX_ADMIN_NOTE_LENGTH = 5000;

/** A staff note on a member's CRM profile. `createdBy` is the author's auth user id (null once that account is gone). */
export interface AdminNote {
  id: string;
  memberId: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
}

type NoteRow = Row<"member_admin_notes">;
const COLUMNS = "id, member_id, body, created_by, created_at";

const toNote = (row: Pick<NoteRow, "id" | "member_id" | "body" | "created_by" | "created_at">): AdminNote => ({
  id: row.id,
  memberId: row.member_id,
  body: row.body,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

/**
 * Timestamped staff notes about a member (`member_admin_notes`). Admin only (RLS), never shown to the
 * member. Written once and not edited; a mistaken note is soft deleted. Methods throw on a database error.
 */
export interface AdminNoteRepository {
  /** Adds a note. The text is trimmed; blank text or text over `MAX_ADMIN_NOTE_LENGTH` throws. */
  add(memberId: string, body: string, createdBy: string | null): Promise<AdminNote>;
  /** A member's live notes, newest first. Paginated. */
  list(memberId: string): Promise<AdminNote[]>;
  /** Soft deletes one of the member's notes. False when there is no such live note on that member. */
  remove(memberId: string, noteId: string): Promise<boolean>;
}

function checked(body: string): string {
  const text = body.trim();
  if (text === "") throw new Error("A note can't be empty");
  if (text.length > MAX_ADMIN_NOTE_LENGTH) throw new Error(`A note can be at most ${MAX_ADMIN_NOTE_LENGTH} characters`);
  return text;
}

export class SupabaseAdminNoteRepository implements AdminNoteRepository {
  constructor(private readonly db: Db) {}

  async add(memberId: string, body: string, createdBy: string | null) {
    const { data, error } = await this.db
      .from("member_admin_notes")
      .insert({ member_id: memberId, body: checked(body), created_by: createdBy })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return toNote(data);
  }

  async list(memberId: string) {
    const rows = await fetchAllRows(
      (from, to) =>
        this.db
          .from("member_admin_notes")
          .select(COLUMNS)
          .eq("member_id", memberId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
    );
    return rows.map(toNote);
  }

  async remove(memberId: string, noteId: string) {
    const { data, error } = await this.db
      .from("member_admin_notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", noteId)
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryAdminNoteRepository implements AdminNoteRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async add(memberId: string, body: string, createdBy: string | null) {
    const text = checked(body);
    if (!this.data.members.some((m) => m.id === memberId)) throw new Error("violates foreign key constraint on member_id");
    const row: NoteRow = {
      id: `mnote_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: memberId,
      body: text,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    this.data.adminNotes.push(row);
    return toNote(row);
  }

  async list(memberId: string) {
    return this.data.adminNotes
      .filter((n) => n.member_id === memberId && n.deleted_at === null)
      .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? 1 : -1))
      .map(toNote);
  }

  async remove(memberId: string, noteId: string) {
    const row = this.data.adminNotes.find((n) => n.id === noteId && n.member_id === memberId && n.deleted_at === null);
    if (!row) return false;
    row.deleted_at = new Date().toISOString();
    return true;
  }
}
