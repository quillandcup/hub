import {
  CARE_NEXT_STEP_MAX,
  CARE_NOTES_MAX,
  isCareEndedHow,
  isCareReason,
  type MessageDirection,
} from "@/lib/care-values";
import { orgYmd } from "@/lib/org-week";
import { clampToChain, shiftedPeriodEnd, startChangeRefusal, startOfOrgDay, type StartChangeRefusal } from "@/lib/care";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** An engagement as stored (`care_engagements`). `reason` and `ended_how` are held to their sets by CHECK constraints. */
export type CareEngagementRow = Row<"care_engagements">;

/** The slice of a member an engagement shows. Display name first, then the legal name (.claude/rules/display-names.md, "Display Names"). */
export type CareMember = { id: string; name: string; display_name: string | null };

/** An engagement with its member joined in (null when the member no longer exists). */
export type CareEngagementWithMember = CareEngagementRow & { member: CareMember | null };

/** What opening an engagement takes. */
export type NewCareEngagement = {
  memberId: string;
  reason: string;
  /** The last day of the period (YYYY-MM-DD, org timezone): computed by the caller from config (`periodEndsOn`, lib/care.ts). */
  periodEndsOn: string;
  /** The staff member's auth user id; null for an import or a system caller. */
  openedBy: string | null;
  /** Who owns it: whoever starts it, never the owner of the member's earlier plan unless that is them (a plan changes hands only through a hand-over). Whoever opened it when not given; null for none (an import). */
  ownedBy?: string | null;
  /** When it started; now when not given. */
  openedAt?: string;
  /** Who wrote the first message: she did, unless the member wrote to her first. */
  firstMessageFrom?: MessageDirection;
  /** When that first message is recorded: when it was opened, unless given (a care plan started on an earlier day puts it at the start of that day). */
  firstMessageAt?: string;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

/** The outcome of opening: the database allows one open care plan per member, which is a case, not a failure. */
export type OpenResult =
  | { ok: true; engagement: CareEngagementRow }
  | { ok: false; reason: "already_open"; engagement: CareEngagementRow };

/** What renewing takes: the next period's last day, who is renewing, when, and why (it becomes the new period's note). The owner stays. */
export type RenewInput = { periodEndsOn: string; openedBy: string | null; at: string; reason: string };

/** Renewing answers with the new period, or `not_open` when the engagement was already closed, renewed or removed (a second click). */
export type RenewResult = { ok: true; engagement: CareEngagementRow } | { ok: false; reason: "not_open" };

/** What staff may change on an open or closed engagement; a key left out stays as it is. */
export type CarePatch = {
  reason?: string;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

/**
 * Moving a start: the new opening instant is the caller's (`careStartInstant`, lib/care.ts). Answers with the changed engagement
 * (`changed: false` when it already opened on that Eastern day, so the time of day stays), `not_found` for a missing, removed or
 * just-changed engagement, or a refusal that keeps the chain of renewals in order, with the instant that limits it.
 */
export type ChangeStartResult =
  | { ok: true; engagement: CareEngagementRow; changed: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: StartChangeRefusal; limit: string };

/** Why a hand-over step was refused (the database says it: `care_handover:<reason>`), for the caller to word. */
export const HANDOVER_REFUSALS = ["not_found", "not_allowed", "receiver_not_allowed", "same_owner", "self", "already_pending", "no_handover", "has_owner", "already_yours", "plan_closed", "no_notice"] as const;
export type HandoverRefusal = (typeof HANDOVER_REFUSALS)[number];

/** A hand-over step answers with the plan as it is now, or why it was refused. */
export type HandoverResult = { ok: true; engagement: CareEngagementRow } | { ok: false; reason: HandoverRefusal };

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
  /** Opens an engagement. `already_open` (with the one that is) when the member already has an open one. */
  open(engagement: NewCareEngagement): Promise<OpenResult>;
  /**
   * Closes an open engagement as renewed and opens the next period (`renewed_from` the old one), in one transaction.
   * Safe against a double click: the second finds nothing open and answers `not_open`.
   */
  renew(id: string, input: RenewInput): Promise<RenewResult>;
  /** Logs that the member (`member`) or staff (`staff`) wrote at `at`. The open engagement, or null when there is none such. */
  logMessage(id: string, direction: MessageDirection, at: string): Promise<CareEngagementRow | null>;
  /**
   * Moves the last-message times of an open engagement FORWARD only: a time replaces the stored one only when it is later
   * (or none is stored), so applying the same or an older time changes nothing (what Slack DMs derive, docs/HEDGIE_CARE.md).
   * Returns how many of the two times moved (0 when the engagement is closed or gone, or nothing was newer).
   */
  moveMessageTimesForward(id: string, times: { staffAt?: string; memberAt?: string }): Promise<number>;
  /**
   * Moves when an engagement (open or closed) started, for a conversation entered after the fact. The last day moves with it and
   * keeps the period's own length (`shiftedPeriodEnd`); the first message's time, if it is still the one opening wrote (the
   * opening instant, or the start of its day), moves to the start of the new day; the other last-message times are left alone. Refused (see `ChangeStartResult`) when it would
   * start before the engagement it continues, after the one that continued it, or after it was closed. Opening and closing
   * dates, and so the one-open-per-member rule, are not touched. The audit log shows `opened_at` and `period_ends_on`.
   */
  changeStart(id: string, openedAt: string): Promise<ChangeStartResult>;
  /** Changes the reason, notes, next step or follow-up day. The engagement, or null when there is none. */
  update(id: string, patch: CarePatch): Promise<CareEngagementRow | null>;
  /** Closes an open engagement with how it ended. The closed engagement, or null when there is no open one. */
  close(id: string, endedHow: string, at: string): Promise<CareEngagementRow | null>;
  /** Marks an engagement deleted. False when there is none. */
  softDelete(id: string, at: string): Promise<boolean>;
  /**
   * Puts on record, in the audit log, that the signed-in admin or community manager opened this member's care plan messages (one entry per
   * reader and member per hour; it holds no text). True when it is on record, false when no entry applies (a member that does not exist, a
   * reader who is not staff). Call it with the reader's own client, before the messages are read. Throws on a database error.
   */
  logMessagesRead(memberId: string): Promise<boolean>;
  /**
   * Hand-overs need both sides (docs/HEDGIE_CARE.md, "Owners"): a plan, open or closed, changes owner only when the receiver
   * accepts, and the database refuses any other change of `owned_by`. The steps answer for the signed-in caller: the owner (or
   * an admin on their behalf) proposes to a staff member who may own plans, who accepts or declines; the proposer, the owner
   * or an admin cancels; a plan with no owner is claimed. The plan keeps its owner while an offer is pending; one offer per plan.
   * A refusal is a result (`HandoverRefusal`), not a throw. The pending offer is `handover_to` / `handover_by` / `handover_at` on the row.
   */
  proposeHandover(id: string, toUserId: string): Promise<HandoverResult>;
  /** The receiver accepts the offer: they are the owner now and the offer is gone. */
  acceptHandover(id: string): Promise<HandoverResult>;
  /** The receiver declines the offer: the owner stays and the offer is gone. */
  declineHandover(id: string): Promise<HandoverResult>;
  /** The proposer, the owner or an admin takes the offer back. */
  cancelHandover(id: string): Promise<HandoverResult>;
  /**
   * A staff member who may own plans takes a plan that has no owner (its owner's account was removed). An **admin** may also take
   * an open plan from its owner without their agreement (the one exception to "hand-overs need both sides", for an unreachable
   * owner or when an admin has to step in): any pending offer is cleared and the plan records the takeover (`taken_from`,
   * `taken_by`, `taken_at`; `taken_seen_at` null) for the previous owner's page. A community manager is refused (`has_owner`), a
   * closed plan keeps its owner (`plan_closed`), an admin who owns it already is refused (`already_yours`).
   */
  claim(id: string): Promise<HandoverResult>;
  /** The previous owner (`taken_from`) marks the notice of a takeover as seen; only they can (`no_notice` otherwise). A second call changes nothing. */
  dismissTakeoverNotice(id: string): Promise<HandoverResult>;
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
  const firstMessageAt = c.firstMessageAt ?? openedAt;
  const memberWroteFirst = c.firstMessageFrom === "member";
  return {
    member_id: c.memberId,
    reason: c.reason,
    opened_by: c.openedBy,
    owned_by: c.ownedBy === undefined ? c.openedBy : c.ownedBy,
    opened_at: openedAt,
    period_ends_on: c.periodEndsOn,
    last_staff_message_at: memberWroteFirst ? null : firstMessageAt,
    last_member_message_at: memberWroteFirst ? firstMessageAt : null,
    notes: c.notes ?? null,
    next_step: c.nextStep ?? null,
    follow_up_on: c.followUpOn ?? null,
  };
}

/** The stored row of an engagement read with its member embedded. */
function withoutMember(engagement: CareEngagementWithMember): CareEngagementRow {
  const row: Partial<CareEngagementWithMember> = { ...engagement };
  delete row.member;
  return row as CareEngagementRow;
}

function updateOf(patch: CarePatch) {
  return {
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    ...(patch.nextStep === undefined ? {} : { next_step: patch.nextStep }),
    ...(patch.followUpOn === undefined ? {} : { follow_up_on: patch.followUpOn }),
  };
}

/** What a start change writes, or a refusal, from the engagement and the engagements on either side of it in its chain. */
function startChange(
  current: CareEngagementRow,
  around: { previousOpenedAt: string | null; renewalOpenedAt: string | null },
  openedAt: string
): { refusal: { reason: StartChangeRefusal; limit: string } } | { same: true } | { changes: Pick<CareEngagementRow, "opened_at" | "period_ends_on"> & Partial<Pick<CareEngagementRow, "last_staff_message_at" | "last_member_message_at">> } {
  if (orgYmd(new Date(openedAt)) === orgYmd(new Date(current.opened_at))) return { same: true };
  const neighbours = { ...around, closedAt: current.closed_at };
  const next = clampToChain(new Date(openedAt), neighbours);
  const refusal = startChangeRefusal(next, neighbours);
  if (refusal) return { refusal };
  // The first message that opening wrote (at the opening instant, or the start of its day) moves with the start, to the start
  // of the new day; a time that came from a log or a DM is not the opening and stays.
  const placeholders = [Date.parse(current.opened_at), startOfOrgDay(orgYmd(new Date(current.opened_at))).getTime()];
  const wasOpening = (at: string | null) => at !== null && placeholders.includes(Date.parse(at));
  const newPlaceholder = startOfOrgDay(orgYmd(next)).toISOString();
  return {
    changes: {
      opened_at: next.toISOString(),
      period_ends_on: shiftedPeriodEnd(current, next),
      ...(wasOpening(current.last_staff_message_at) ? { last_staff_message_at: newPlaceholder } : {}),
      ...(wasOpening(current.last_member_message_at) ? { last_member_message_at: newPlaceholder } : {}),
    },
  };
}

const HANDOVER_PREFIX = "care_handover:";

/** What a hand-over function answers (a one-row set, or a `care_handover:<reason>` refusal) as a result; any other database error throws. */
function handoverResult(answer: { data: CareEngagementRow[] | null; error: { message: string } | null }): HandoverResult {
  if (answer.error) {
    const reason = answer.error.message.startsWith(HANDOVER_PREFIX) ? answer.error.message.slice(HANDOVER_PREFIX.length) : "";
    if ((HANDOVER_REFUSALS as readonly string[]).includes(reason)) return { ok: false, reason: reason as HandoverRefusal };
    throw new Error(answer.error.message);
  }
  const row = answer.data?.[0];
  // A function that raised nothing and returned nothing: the plan went between the steps. Said the way a missing plan is.
  return row ? { ok: true, engagement: row } : { ok: false, reason: "not_found" };
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
      p_notes: input.reason,
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

  async moveMessageTimesForward(id: string, times: { staffAt?: string; memberAt?: string }) {
    let moved = 0;
    const move = async (column: "last_staff_message_at" | "last_member_message_at", at: string) => {
      const instant = new Date(at).toISOString();
      const { data, error } = await this.db
        .from("care_engagements")
        .update(column === "last_staff_message_at" ? { last_staff_message_at: instant } : { last_member_message_at: instant })
        .eq("id", id)
        .is("closed_at", null)
        .is("deleted_at", null)
        .or(`${column}.is.null,${column}.lt.${instant}`)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) moved += 1;
    };
    if (times.staffAt) await move("last_staff_message_at", times.staffAt);
    if (times.memberAt) await move("last_member_message_at", times.memberAt);
    return moved;
  }

  async changeStart(id: string, openedAt: string): Promise<ChangeStartResult> {
    const current = await this.byId(id);
    if (!current) return { ok: false, reason: "not_found" };
    const [previous, renewal] = await Promise.all([
      current.renewed_from
        ? this.db.from("care_engagements").select("opened_at").eq("id", current.renewed_from).is("deleted_at", null).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      this.db.from("care_engagements").select("opened_at").eq("renewed_from", id).is("deleted_at", null).order("opened_at").limit(1).maybeSingle(),
    ]);
    if (previous.error) throw new Error(previous.error.message);
    if (renewal.error) throw new Error(renewal.error.message);
    const outcome = startChange(current, { previousOpenedAt: previous.data?.opened_at ?? null, renewalOpenedAt: renewal.data?.opened_at ?? null }, openedAt);
    if ("refusal" in outcome) return { ok: false, ...outcome.refusal };
    if ("same" in outcome) return { ok: true, engagement: withoutMember(current), changed: false };
    // Conditional on the start it was read with: a second change in between answers not_found rather than overwriting it.
    const { data, error } = await this.db
      .from("care_engagements")
      .update(outcome.changes)
      .eq("id", id)
      .eq("opened_at", current.opened_at)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ok: true, engagement: data, changed: true } : { ok: false, reason: "not_found" };
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

  async logMessagesRead(memberId: string) {
    const { data, error } = await this.db.rpc("care_log_messages_read", { p_member_id: memberId });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async proposeHandover(id: string, toUserId: string) {
    return handoverResult(await this.db.rpc("propose_care_handover", { p_id: id, p_to: toUserId }));
  }

  async acceptHandover(id: string) {
    return handoverResult(await this.db.rpc("accept_care_handover", { p_id: id }));
  }

  async declineHandover(id: string) {
    return handoverResult(await this.db.rpc("decline_care_handover", { p_id: id }));
  }

  async cancelHandover(id: string) {
    return handoverResult(await this.db.rpc("cancel_care_handover", { p_id: id }));
  }

  async claim(id: string) {
    return handoverResult(await this.db.rpc("claim_care_plan", { p_id: id }));
  }

  async dismissTakeoverNotice(id: string) {
    return handoverResult(await this.db.rpc("dismiss_care_takeover_notice", { p_id: id }));
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

/**
 * In-memory twin over an `InMemoryDataset`, enforcing the constraints the database does. The hand-over steps answer for the
 * signed-in caller, which the database knows from the session: the twin has none, so it is told who `signedInAs` is (an auth user
 * id whose role is in the dataset's `userProfiles`); with none, every step is refused as `not_allowed`.
 */
export class InMemoryCareRepository implements CareRepository {
  constructor(
    private readonly data: InMemoryDataset,
    private readonly signedInAs: string | null = null
  ) {}

  private roleOf(userId: string | null): string | null {
    return userId ? (this.data.userProfiles.find((p) => p.id === userId)?.role ?? "member") : null;
  }

  /** `can_own_care_plans`: an admin or a community manager; an assistant or a member is not. */
  private mayOwn(userId: string | null) {
    const role = this.roleOf(userId);
    return role === "admin" || role === "community_manager";
  }

  private handover(id: string, step: (plan: CareEngagementRow, me: string) => HandoverRefusal | null): HandoverResult {
    const me = this.signedInAs;
    if (!me || !this.mayOwn(me)) return { ok: false, reason: "not_allowed" };
    const plan = this.live().find((c) => c.id === id);
    if (!plan) return { ok: false, reason: "not_found" };
    const refusal = step(plan, me);
    if (refusal) return { ok: false, reason: refusal };
    plan.updated_at = new Date().toISOString();
    return { ok: true, engagement: { ...plan } };
  }

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
    if (!DAY.test(engagement.periodEndsOn)) throw new Error("invalid input syntax for type date");
    this.checkText(engagement.notes, engagement.nextStep);
    const existing = this.live().find((c) => c.member_id === engagement.memberId && c.closed_at === null);
    if (existing) return { ok: false, reason: "already_open", engagement: { ...existing } };
    const now = new Date().toISOString();
    const row: CareEngagementRow = {
      id: this.nextId(),
      ...insertOf(engagement),
      handover_to: null,
      handover_by: null,
      handover_at: null,
      taken_from: null,
      taken_by: null,
      taken_at: null,
      taken_seen_at: null,
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
    this.checkText(input.reason, null);
    const now = new Date().toISOString();
    // A pending hand-over follows the plan that is live: the closed one no longer shows it, the new one carries it.
    const offer = { handover_to: previous.handover_to, handover_by: previous.handover_by, handover_at: previous.handover_at };
    Object.assign(previous, { closed_at: input.at, ended_how: "renewed", updated_at: now, handover_to: null, handover_by: null, handover_at: null });
    const row: CareEngagementRow = {
      id: this.nextId(),
      member_id: previous.member_id,
      opened_by: input.openedBy,
      owned_by: previous.owned_by,
      reason: previous.reason,
      ...offer,
      taken_from: null,
      taken_by: null,
      taken_at: null,
      taken_seen_at: null,
      opened_at: input.at,
      period_ends_on: input.periodEndsOn,
      renewed_from: previous.id,
      closed_at: null,
      ended_how: null,
      last_staff_message_at: previous.last_staff_message_at,
      last_member_message_at: previous.last_member_message_at,
      follow_up_on: null,
      next_step: null,
      notes: input.reason,
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

  async moveMessageTimesForward(id: string, times: { staffAt?: string; memberAt?: string }) {
    const row = this.live().find((c) => c.id === id && c.closed_at === null);
    if (!row) return 0;
    let moved = 0;
    const later = (stored: string | null, at: string) => stored === null || Date.parse(at) > Date.parse(stored);
    if (times.staffAt && later(row.last_staff_message_at, times.staffAt)) {
      row.last_staff_message_at = new Date(times.staffAt).toISOString();
      moved += 1;
    }
    if (times.memberAt && later(row.last_member_message_at, times.memberAt)) {
      row.last_member_message_at = new Date(times.memberAt).toISOString();
      moved += 1;
    }
    if (moved > 0) row.updated_at = new Date().toISOString();
    return moved;
  }

  async changeStart(id: string, openedAt: string): Promise<ChangeStartResult> {
    const row = this.live().find((c) => c.id === id);
    if (!row) return { ok: false, reason: "not_found" };
    const previous = row.renewed_from ? this.live().find((c) => c.id === row.renewed_from) : undefined;
    const renewals = this.live().filter((c) => c.renewed_from === id).sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
    const outcome = startChange(row, { previousOpenedAt: previous?.opened_at ?? null, renewalOpenedAt: renewals[0]?.opened_at ?? null }, openedAt);
    if ("refusal" in outcome) return { ok: false, ...outcome.refusal };
    if ("same" in outcome) return { ok: true, engagement: { ...row }, changed: false };
    Object.assign(row, outcome.changes, { updated_at: new Date().toISOString() });
    return { ok: true, engagement: { ...row }, changed: true };
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

  /** The twin has no signed-in reader, so who may be logged and the once-an-hour rule are the database's (pgTAP). */
  async logMessagesRead(memberId: string) {
    return this.data.members.some((m) => m.id === memberId);
  }

  async proposeHandover(id: string, toUserId: string): Promise<HandoverResult> {
    return this.handover(id, (plan, me) => {
      if (plan.owned_by !== me && this.roleOf(me) !== "admin") return "not_allowed";
      if (!this.mayOwn(toUserId)) return "receiver_not_allowed";
      if (toUserId === plan.owned_by) return "same_owner";
      if (toUserId === me) return "self";
      if (plan.handover_to !== null) return "already_pending";
      Object.assign(plan, { handover_to: toUserId, handover_by: me, handover_at: new Date().toISOString() });
      return null;
    });
  }

  async acceptHandover(id: string): Promise<HandoverResult> {
    return this.handover(id, (plan, me) => {
      if (plan.handover_to !== me) return "no_handover";
      Object.assign(plan, { owned_by: me, handover_to: null, handover_by: null, handover_at: null });
      return null;
    });
  }

  async declineHandover(id: string): Promise<HandoverResult> {
    return this.handover(id, (plan, me) => {
      if (plan.handover_to !== me) return "no_handover";
      Object.assign(plan, { handover_to: null, handover_by: null, handover_at: null });
      return null;
    });
  }

  async cancelHandover(id: string): Promise<HandoverResult> {
    return this.handover(id, (plan, me) => {
      if (plan.handover_to === null) return "no_handover";
      if (me !== plan.handover_by && me !== plan.owned_by && this.roleOf(me) !== "admin") return "not_allowed";
      Object.assign(plan, { handover_to: null, handover_by: null, handover_at: null });
      return null;
    });
  }

  async claim(id: string): Promise<HandoverResult> {
    return this.handover(id, (plan, me) => {
      if (plan.owned_by === null) {
        Object.assign(plan, { owned_by: me, handover_to: null, handover_by: null, handover_at: null });
        return null;
      }
      // An owner is there: only an admin may take the plan, and only an open one.
      if (this.roleOf(me) !== "admin") return "has_owner";
      if (plan.owned_by === me) return "already_yours";
      if (plan.closed_at !== null) return "plan_closed";
      Object.assign(plan, { taken_from: plan.owned_by, taken_by: me, taken_at: new Date().toISOString(), taken_seen_at: null, owned_by: me, handover_to: null, handover_by: null, handover_at: null });
      return null;
    });
  }

  async dismissTakeoverNotice(id: string): Promise<HandoverResult> {
    return this.handover(id, (plan, me) => {
      if (plan.taken_from !== me) return "no_notice";
      if (plan.taken_seen_at === null) plan.taken_seen_at = new Date().toISOString();
      return null;
    });
  }

  async softDelete(id: string, at: string) {
    const row = this.live().find((c) => c.id === id);
    if (!row) return false;
    row.deleted_at = at;
    return true;
  }
}
