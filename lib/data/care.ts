import {
  CARE_NEXT_STEP_MAX,
  CARE_NOTES_MAX,
  isCareChannel,
  isCareEndedHow,
  isCareReason,
  type MessageDirection,
} from "@/lib/care-values";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** An engagement as stored (`care_engagements`). `reason`, `channel` and `ended_how` are held to their sets by CHECK constraints. */
export type CareEngagementRow = Row<"care_engagements">;

/** The slice of a member an engagement shows. Display name first, then the legal name (CLAUDE.md, "Display Names"). */
export type CareMember = { id: string; name: string; display_name: string | null };

/** An engagement with its member joined in (null when the member no longer exists). */
export type CareEngagementWithMember = CareEngagementRow & { member: CareMember | null };

/** What opening an engagement takes. */
export type NewCareEngagement = {
  memberId: string;
  reason: string;
  channel: string;
  /** The last day of the period (YYYY-MM-DD, org timezone): computed by the caller from config (`periodEndsOn`, lib/care.ts). */
  periodEndsOn: string;
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

/** The outcome of opening: the database allows one open engagement per member and channel, which is a case, not a failure. */
export type OpenResult =
  | { ok: true; engagement: CareEngagementRow }
  | { ok: false; reason: "already_open"; engagement: CareEngagementRow };

/** What renewing takes: the next period's last day, who is renewing and when. */
export type RenewInput = { periodEndsOn: string; openedBy: string | null; at: string };

/** Renewing answers with the new period, or `not_open` when the engagement was already closed, renewed or removed (a second click). */
export type RenewResult = { ok: true; engagement: CareEngagementRow } | { ok: false; reason: "not_open" };

/** What staff may change on an open or closed engagement; a key left out stays as it is. */
export type CarePatch = {
  reason?: string;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

/** Which engagements `list` returns: every open one, and the closed ones too when `includeClosed`. */
export type CareListOptions = { includeClosed?: boolean };

/**
 * Hedgie Care's engagements (`care_engagements`, docs/HEDGIE_CARE.md): staff only, the caller's client decides (RLS lets
 * admins and community managers read and write). Rows soft delete (`deleted_at`) and every method leaves deleted ones
 * out. The status is not stored: it follows from the dates and the last-message times in `lib/care.ts`. Methods throw
 * on a database error and answer a missing row with null or false, for the caller to word.
 */
export interface CareRepository {
  /** Every open engagement, and the closed ones when asked, with the member joined in, newest opened first. Paginated. */
  list(options?: CareListOptions): Promise<CareEngagementWithMember[]>;
  /** One member's engagements, open and closed, newest first. */
  forMember(memberId: string): Promise<CareEngagementRow[]>;
  /** One engagement with its member, or null. */
  byId(id: string): Promise<CareEngagementWithMember | null>;
  /** Opens an engagement. `already_open` (with the one that is) when the member has an open one on that channel. */
  open(engagement: NewCareEngagement): Promise<OpenResult>;
  /**
   * Closes an open engagement as renewed and opens the next period (`renewed_from` the old one), in one transaction.
   * Safe against a double click: the second finds nothing open and answers `not_open`.
   */
  renew(id: string, input: RenewInput): Promise<RenewResult>;
  /** Logs that the member (`member`) or staff (`staff`) wrote at `at`. The open engagement, or null when there is none such. */
  logMessage(id: string, direction: MessageDirection, at: string): Promise<CareEngagementRow | null>;
  /** Changes the reason, notes, next step or follow-up day. The engagement, or null when there is none. */
  update(id: string, patch: CarePatch): Promise<CareEngagementRow | null>;
  /** Closes an open engagement with how it ended. The closed engagement, or null when there is no open one. */
  close(id: string, endedHow: string, at: string): Promise<CareEngagementRow | null>;
  /** Marks an engagement deleted. False when there is none. */
  softDelete(id: string, at: string): Promise<boolean>;
}

const UNIQUE_VIOLATION = "23505";
const WITH_MEMBER = "*, member:members!care_engagements_member_id_fkey(id, name, display_name)";

/** PostgREST returns a to-one embed as an object, though it has been met as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

type WithMemberRow = CareEngagementRow & { member: CareMember | CareMember[] | null };

function insertOf(c: NewCareEngagement) {
  const openedAt = c.openedAt ?? new Date().toISOString();
  const memberWroteFirst = c.firstMessageFrom === "member";
  return {
    member_id: c.memberId,
    reason: c.reason,
    channel: c.channel,
    opened_by: c.openedBy,
    opened_at: openedAt,
    period_ends_on: c.periodEndsOn,
    last_staff_message_at: memberWroteFirst ? null : openedAt,
    last_member_message_at: memberWroteFirst ? openedAt : null,
    notes: c.notes ?? null,
    next_step: c.nextStep ?? null,
    follow_up_on: c.followUpOn ?? null,
  };
}

function updateOf(patch: CarePatch) {
  return {
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    ...(patch.nextStep === undefined ? {} : { next_step: patch.nextStep }),
    ...(patch.followUpOn === undefined ? {} : { follow_up_on: patch.followUpOn }),
  };
}

export class SupabaseCareRepository implements CareRepository {
  constructor(private readonly db: Db) {}

  async list(options: CareListOptions = {}) {
    const rows = await fetchAllRows<WithMemberRow>((from, to) => {
      const query = this.db.from("care_engagements").select(WITH_MEMBER).is("deleted_at", null);
      return (options.includeClosed ? query : query.is("closed_at", null)).order("opened_at", { ascending: false }).order("id").range(from, to);
    });
    return rows.map((r) => ({ ...r, member: one(r.member) }));
  }

  async forMember(memberId: string) {
    return fetchAllRows<CareEngagementRow>((from, to) =>
      this.db
        .from("care_engagements")
        .select("*")
        .eq("member_id", memberId)
        .is("deleted_at", null)
        .order("opened_at", { ascending: false })
        .order("id")
        .range(from, to)
    );
  }

  async byId(id: string) {
    const { data, error } = await this.db.from("care_engagements").select(WITH_MEMBER).eq("id", id).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { ...data, member: one(data.member) };
  }

  async open(engagement: NewCareEngagement): Promise<OpenResult> {
    const { data, error } = await this.db.from("care_engagements").insert(insertOf(engagement)).select("*").single();
    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing, error: lookupError } = await this.db
        .from("care_engagements")
        .select("*")
        .eq("member_id", engagement.memberId)
        .eq("channel", engagement.channel)
        .is("closed_at", null)
        .is("deleted_at", null)
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      // Gone between the two statements (closed or deleted by someone else): not a case worth a result of its own.
      if (!existing) throw new Error(error.message);
      return { ok: false, reason: "already_open", engagement: existing };
    }
    if (error) throw new Error(error.message);
    return { ok: true, engagement: data };
  }

  async renew(id: string, input: RenewInput): Promise<RenewResult> {
    const { data, error } = await this.db.rpc("renew_care_engagement", {
      p_id: id,
      p_period_ends_on: input.periodEndsOn,
      // The function takes a uuid; null (an import or a system caller) is what the column allows.
      p_opened_by: input.openedBy as string,
      p_at: input.at,
    });
    if (error) throw new Error(error.message);
    const next = data?.[0];
    return next ? { ok: true, engagement: next } : { ok: false, reason: "not_open" };
  }

  async logMessage(id: string, direction: MessageDirection, at: string) {
    const { data, error } = await this.db
      .from("care_engagements")
      .update(direction === "member" ? { last_member_message_at: at } : { last_staff_message_at: at })
      .eq("id", id)
      .is("closed_at", null)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, patch: CarePatch) {
    const changes = updateOf(patch);
    const query = this.db.from("care_engagements");
    // An empty patch is a read: PostgREST refuses an update with no columns.
    const { data, error } =
      Object.keys(changes).length === 0
        ? await query.select("*").eq("id", id).is("deleted_at", null).maybeSingle()
        : await query.update(changes).eq("id", id).is("deleted_at", null).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async close(id: string, endedHow: string, at: string) {
    const { data, error } = await this.db
      .from("care_engagements")
      .update({ closed_at: at, ended_how: endedHow })
      .eq("id", id)
      .is("closed_at", null)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async softDelete(id: string, at: string) {
    const { data, error } = await this.db.from("care_engagements").update({ deleted_at: at }).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** `care_` and 12 base58 characters from a counter, so the twin's ids look like the database's. */
function twinId(n: number): string {
  let rest = n;
  let out = "";
  for (let i = 0; i < 12; i++) {
    out = BASE58[rest % BASE58.length] + out;
    rest = Math.floor(rest / BASE58.length);
  }
  return `care_${out}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** In-memory twin over an `InMemoryDataset`, enforcing the constraints the database does. */
export class InMemoryCareRepository implements CareRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.careEngagements.filter((c) => c.deleted_at === null);
  }

  private withMember(c: CareEngagementRow): CareEngagementWithMember {
    const m = this.data.members.find((x) => x.id === c.member_id);
    return { ...c, member: m ? { id: m.id, name: m.name, display_name: m.displayName ?? null } : null };
  }

  private checkText(notes: string | null | undefined, nextStep: string | null | undefined) {
    if (notes && notes.length > CARE_NOTES_MAX) throw new Error("violates check constraint on notes");
    if (nextStep && nextStep.length > CARE_NEXT_STEP_MAX) throw new Error("violates check constraint on next_step");
  }

  private nextId() {
    return twinId(this.data.careEngagements.length + 1);
  }

  async list(options: CareListOptions = {}) {
    return this.live()
      .filter((c) => options.includeClosed || c.closed_at === null)
      .sort(byKeyThenId<CareEngagementRow>((c) => c.opened_at, (c) => c.id, true))
      .map((c) => this.withMember(c));
  }

  async forMember(memberId: string) {
    return this.live()
      .filter((c) => c.member_id === memberId)
      .sort(byKeyThenId<CareEngagementRow>((c) => c.opened_at, (c) => c.id, true))
      .map((c) => ({ ...c }));
  }

  async byId(id: string) {
    const row = this.live().find((c) => c.id === id);
    return row ? this.withMember(row) : null;
  }

  async open(engagement: NewCareEngagement): Promise<OpenResult> {
    if (!this.data.members.some((m) => m.id === engagement.memberId)) throw new Error("violates foreign key constraint on member_id");
    if (!isCareReason(engagement.reason)) throw new Error("violates check constraint on reason");
    if (!isCareChannel(engagement.channel)) throw new Error("violates check constraint on channel");
    if (!DAY.test(engagement.periodEndsOn)) throw new Error("invalid input syntax for type date");
    this.checkText(engagement.notes, engagement.nextStep);
    const existing = this.live().find((c) => c.member_id === engagement.memberId && c.channel === engagement.channel && c.closed_at === null);
    if (existing) return { ok: false, reason: "already_open", engagement: { ...existing } };
    const now = new Date().toISOString();
    const row: CareEngagementRow = {
      id: this.nextId(),
      ...insertOf(engagement),
      renewed_from: null,
      closed_at: null,
      ended_how: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.data.careEngagements.push(row);
    return { ok: true, engagement: { ...row } };
  }

  async renew(id: string, input: RenewInput): Promise<RenewResult> {
    const previous = this.live().find((c) => c.id === id && c.closed_at === null);
    if (!previous) return { ok: false, reason: "not_open" };
    if (!DAY.test(input.periodEndsOn)) throw new Error("invalid input syntax for type date");
    const now = new Date().toISOString();
    Object.assign(previous, { closed_at: input.at, ended_how: "renewed", updated_at: now });
    const row: CareEngagementRow = {
      id: this.nextId(),
      member_id: previous.member_id,
      opened_by: input.openedBy,
      reason: previous.reason,
      channel: previous.channel,
      opened_at: input.at,
      period_ends_on: input.periodEndsOn,
      renewed_from: previous.id,
      closed_at: null,
      ended_how: null,
      last_staff_message_at: previous.last_staff_message_at,
      last_member_message_at: previous.last_member_message_at,
      follow_up_on: null,
      next_step: null,
      notes: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.data.careEngagements.push(row);
    return { ok: true, engagement: { ...row } };
  }

  async logMessage(id: string, direction: MessageDirection, at: string) {
    const row = this.live().find((c) => c.id === id && c.closed_at === null);
    if (!row) return null;
    if (direction === "member") row.last_member_message_at = at;
    else row.last_staff_message_at = at;
    row.updated_at = new Date().toISOString();
    return { ...row };
  }

  async update(id: string, patch: CarePatch) {
    const row = this.live().find((c) => c.id === id);
    if (!row) return null;
    if (patch.reason !== undefined && !isCareReason(patch.reason)) throw new Error("violates check constraint on reason");
    this.checkText(patch.notes, patch.nextStep);
    const changes = updateOf(patch);
    if (Object.keys(changes).length > 0) Object.assign(row, changes, { updated_at: new Date().toISOString() });
    return { ...row };
  }

  async close(id: string, endedHow: string, at: string) {
    if (!isCareEndedHow(endedHow)) throw new Error("violates check constraint on ended_how");
    const row = this.live().find((c) => c.id === id && c.closed_at === null);
    if (!row) return null;
    Object.assign(row, { closed_at: at, ended_how: endedHow, updated_at: new Date().toISOString() });
    return { ...row };
  }

  async softDelete(id: string, at: string) {
    const row = this.live().find((c) => c.id === id);
    if (!row) return false;
    row.deleted_at = at;
    return true;
  }
}
