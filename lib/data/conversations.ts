import {
  CONVERSATION_NEXT_STEP_MAX,
  CONVERSATION_NOTES_MAX,
  isConversationChannel,
  isConversationOutcome,
  isConversationReason,
  type MessageDirection,
} from "@/lib/conversations";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A conversation as stored (`conversations`). `reason`, `channel` and `outcome` are held to their sets by CHECK constraints. */
export type ConversationRow = Row<"conversations">;

/** The slice of a member a conversation shows. Display name first, then the legal name (CLAUDE.md, "Display Names"). */
export type ConversationMember = { id: string; name: string; display_name: string | null };

/** A conversation with its member joined in (null when the member no longer exists). */
export type ConversationWithMember = ConversationRow & { member: ConversationMember | null };

/** What opening a conversation takes. */
export type NewConversation = {
  memberId: string;
  reason: string;
  channel: string;
  /** The staff member's auth user id; null for an import or a system caller. */
  openedBy: string | null;
  /** When it started; now when not given. */
  openedAt?: string;
  /** Who wrote the first message, which is the moment it was opened: she did, unless the member wrote to her first. */
  firstMessageFrom?: MessageDirection;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

/** The outcome of opening: the database allows one open conversation per member and channel, which is a case, not a failure. */
export type OpenResult =
  | { ok: true; conversation: ConversationRow }
  | { ok: false; reason: "already_open"; conversation: ConversationRow };

/** What staff may change on an open or closed conversation; a key left out stays as it is. */
export type ConversationPatch = {
  reason?: string;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

/** Which conversations `list` returns: every open one, and those closed since this instant (none closed when not given). */
export type ConversationListOptions = { closedSince?: string };

/**
 * The community manager's conversations with members (`conversations`, docs/CONVERSATIONS.md): staff only, the
 * caller's client decides (RLS lets admins and community managers read and write). Rows soft delete (`deleted_at`) and
 * every method leaves deleted ones out. The status (needs reply, waiting, gone quiet) is not stored: it follows from
 * the last-message times in `lib/conversations.ts`. Methods throw on a database error and answer a missing row with
 * null or false, for the caller to word.
 */
export interface ConversationRepository {
  /** Every open conversation and those closed since `closedSince`, with the member joined in, newest opened first. Paginated. */
  list(options?: ConversationListOptions): Promise<ConversationWithMember[]>;
  /** One member's conversations, open and closed, newest first. */
  forMember(memberId: string): Promise<ConversationRow[]>;
  /** One conversation with its member, or null. */
  byId(id: string): Promise<ConversationWithMember | null>;
  /** Opens a conversation. `already_open` (with the one that is) when the member has an open one on that channel. */
  open(conversation: NewConversation): Promise<OpenResult>;
  /** Logs that the member (`member`) or staff (`staff`) wrote at `at`. The open conversation, or null when there is none such. */
  logMessage(id: string, direction: MessageDirection, at: string): Promise<ConversationRow | null>;
  /** Changes the reason, notes, next step or follow-up day. The conversation, or null when there is none. */
  update(id: string, patch: ConversationPatch): Promise<ConversationRow | null>;
  /** Closes an open conversation with its outcome. The closed conversation, or null when there is no open one. */
  close(id: string, outcome: string, at: string): Promise<ConversationRow | null>;
  /** Marks a conversation deleted. False when there is none. */
  softDelete(id: string, at: string): Promise<boolean>;
}

const UNIQUE_VIOLATION = "23505";
const WITH_MEMBER = "*, member:members!conversations_member_id_fkey(id, name, display_name)";

/** PostgREST returns a to-one embed as an object, though it has been met as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

type WithMemberRow = ConversationRow & { member: ConversationMember | ConversationMember[] | null };

function insertOf(c: NewConversation) {
  const openedAt = c.openedAt ?? new Date().toISOString();
  const memberWroteFirst = c.firstMessageFrom === "member";
  return {
    member_id: c.memberId,
    reason: c.reason,
    channel: c.channel,
    opened_by: c.openedBy,
    opened_at: openedAt,
    last_staff_message_at: memberWroteFirst ? null : openedAt,
    last_member_message_at: memberWroteFirst ? openedAt : null,
    notes: c.notes ?? null,
    next_step: c.nextStep ?? null,
    follow_up_on: c.followUpOn ?? null,
  };
}

function updateOf(patch: ConversationPatch) {
  return {
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    ...(patch.nextStep === undefined ? {} : { next_step: patch.nextStep }),
    ...(patch.followUpOn === undefined ? {} : { follow_up_on: patch.followUpOn }),
  };
}

export class SupabaseConversationRepository implements ConversationRepository {
  constructor(private readonly db: Db) {}

  async list(options: ConversationListOptions = {}) {
    const rows = await fetchAllRows<WithMemberRow>(
      (from, to) => {
        const query = this.db.from("conversations").select(WITH_MEMBER).is("deleted_at", null);
        return (options.closedSince ? query.or(`closed_at.is.null,closed_at.gte.${options.closedSince}`) : query.is("closed_at", null))
          .order("opened_at", { ascending: false })
          .order("id")
          .range(from, to);
      },
    );
    return rows.map((r) => ({ ...r, member: one(r.member) }));
  }

  async forMember(memberId: string) {
    return fetchAllRows<ConversationRow>(
      (from, to) =>
        this.db
          .from("conversations")
          .select("*")
          .eq("member_id", memberId)
          .is("deleted_at", null)
          .order("opened_at", { ascending: false })
          .order("id")
          .range(from, to),
    );
  }

  async byId(id: string) {
    const { data, error } = await this.db.from("conversations").select(WITH_MEMBER).eq("id", id).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { ...data, member: one(data.member) };
  }

  async open(conversation: NewConversation): Promise<OpenResult> {
    const { data, error } = await this.db.from("conversations").insert(insertOf(conversation)).select("*").single();
    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing, error: lookupError } = await this.db
        .from("conversations")
        .select("*")
        .eq("member_id", conversation.memberId)
        .eq("channel", conversation.channel)
        .is("closed_at", null)
        .is("deleted_at", null)
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      // Gone between the two statements (closed or deleted by someone else): not a case worth a result of its own.
      if (!existing) throw new Error(error.message);
      return { ok: false, reason: "already_open", conversation: existing };
    }
    if (error) throw new Error(error.message);
    return { ok: true, conversation: data };
  }

  async logMessage(id: string, direction: MessageDirection, at: string) {
    const { data, error } = await this.db
      .from("conversations")
      .update(direction === "member" ? { last_member_message_at: at } : { last_staff_message_at: at })
      .eq("id", id)
      .is("closed_at", null)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, patch: ConversationPatch) {
    const changes = updateOf(patch);
    const query = this.db.from("conversations");
    // An empty patch is a read: PostgREST refuses an update with no columns.
    const { data, error } =
      Object.keys(changes).length === 0
        ? await query.select("*").eq("id", id).is("deleted_at", null).maybeSingle()
        : await query.update(changes).eq("id", id).is("deleted_at", null).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async close(id: string, outcome: string, at: string) {
    const { data, error } = await this.db
      .from("conversations")
      .update({ closed_at: at, outcome })
      .eq("id", id)
      .is("closed_at", null)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async softDelete(id: string, at: string) {
    const { data, error } = await this.db.from("conversations").update({ deleted_at: at }).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }
}

/** In-memory twin over an `InMemoryDataset`, enforcing the constraints the database does. */
export class InMemoryConversationRepository implements ConversationRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.conversations.filter((c) => c.deleted_at === null);
  }

  private withMember(c: ConversationRow): ConversationWithMember {
    const m = this.data.members.find((x) => x.id === c.member_id);
    return { ...c, member: m ? { id: m.id, name: m.name, display_name: m.displayName ?? null } : null };
  }

  private checkText(notes: string | null | undefined, nextStep: string | null | undefined) {
    if (notes && notes.length > CONVERSATION_NOTES_MAX) throw new Error("violates check constraint on notes");
    if (nextStep && nextStep.length > CONVERSATION_NEXT_STEP_MAX) throw new Error("violates check constraint on next_step");
  }

  async list(options: ConversationListOptions = {}) {
    const { closedSince } = options;
    return this.live()
      .filter((c) => c.closed_at === null || (closedSince !== undefined && c.closed_at >= closedSince))
      .sort(byKeyThenId<ConversationRow>((c) => c.opened_at, (c) => c.id, true))
      .map((c) => this.withMember(c));
  }

  async forMember(memberId: string) {
    return this.live()
      .filter((c) => c.member_id === memberId)
      .sort(byKeyThenId<ConversationRow>((c) => c.opened_at, (c) => c.id, true))
      .map((c) => ({ ...c }));
  }

  async byId(id: string) {
    const row = this.live().find((c) => c.id === id);
    return row ? this.withMember(row) : null;
  }

  async open(conversation: NewConversation): Promise<OpenResult> {
    if (!this.data.members.some((m) => m.id === conversation.memberId)) throw new Error("violates foreign key constraint on member_id");
    if (!isConversationReason(conversation.reason)) throw new Error("violates check constraint on reason");
    if (!isConversationChannel(conversation.channel)) throw new Error("violates check constraint on channel");
    this.checkText(conversation.notes, conversation.nextStep);
    const existing = this.live().find((c) => c.member_id === conversation.memberId && c.channel === conversation.channel && c.closed_at === null);
    if (existing) return { ok: false, reason: "already_open", conversation: { ...existing } };
    const now = new Date().toISOString();
    const row: ConversationRow = {
      id: `conv_${String(this.data.conversations.length + 1).padStart(12, "A")}`,
      ...insertOf(conversation),
      closed_at: null,
      outcome: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.data.conversations.push(row);
    return { ok: true, conversation: { ...row } };
  }

  async logMessage(id: string, direction: MessageDirection, at: string) {
    const row = this.live().find((c) => c.id === id && c.closed_at === null);
    if (!row) return null;
    if (direction === "member") row.last_member_message_at = at;
    else row.last_staff_message_at = at;
    row.updated_at = new Date().toISOString();
    return { ...row };
  }

  async update(id: string, patch: ConversationPatch) {
    const row = this.live().find((c) => c.id === id);
    if (!row) return null;
    if (patch.reason !== undefined && !isConversationReason(patch.reason)) throw new Error("violates check constraint on reason");
    this.checkText(patch.notes, patch.nextStep);
    const changes = updateOf(patch);
    if (Object.keys(changes).length > 0) Object.assign(row, changes, { updated_at: new Date().toISOString() });
    return { ...row };
  }

  async close(id: string, outcome: string, at: string) {
    if (!isConversationOutcome(outcome)) throw new Error("violates check constraint on outcome");
    const row = this.live().find((c) => c.id === id && c.closed_at === null);
    if (!row) return null;
    Object.assign(row, { closed_at: at, outcome, updated_at: new Date().toISOString() });
    return { ...row };
  }

  async softDelete(id: string, at: string) {
    const row = this.live().find((c) => c.id === id);
    if (!row) return false;
    row.deleted_at = at;
    return true;
  }
}
