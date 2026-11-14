"use server";

import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import {
  CARE_ENDED_HOW_LABELS,
  CARE_NEXT_STEP_MAX,
  CARE_NOTES_MAX,
  CARE_REASON_LABELS,
  careFirstMessageInstant,
  careStartInstant,
  isRealDay,
  periodEndsOn,
  startDayProblem,
  type StartChangeRefusal,
  isCareId,
  isCareReason,
  isCloseOption,
  isMessageDirection,
  type CareEndedHow,
  type CareReason,
  type CareResults,
  type MessageDirection,
} from "@/lib/care";
import { loadCareResults } from "@/lib/care-results";
import { HANDOVER_REFUSAL_MESSAGES } from "@/lib/care-handover";
import { findOwnDmWith, projectCareFromDms, type CareDmServiceRepos, type StaffIdentity } from "@/lib/care-dm";
import { clock } from "@/lib/clock";
import { formatDateOnly } from "@/lib/formatters";
import type { CareEngagementRow, CarePatch, HandoverResult } from "@/lib/data/care";
import { createRepos, type Repos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { isId, isUuid } from "@/lib/ids";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { memberSearchItem } from "@/lib/member-search-item";
import { orgYmd } from "@/lib/org-week";
import { staffCan } from "@/lib/staff-access";

/**
 * Server actions for the Hedgie Care page (docs/HEDGIE_CARE.md). Staff, not admin-only: the community manager writes
 * here, so each action starts with requireStaffAction() and then asks for the `care.write` feature (lib/staff-access.ts).
 * They run as the signed-in user, so row-level security is the second check.
 */

export type CareActionResult = { error: string } | { success: true };

const NOT_AUTHORIZED = "Not authorized";
const MISSING = "That care plan is gone.";
const PAGES = ["/admin/care", "/admin/care/earlier"];

const nowIso = () => new Date(clock.now()).toISOString();
const revalidate = () => PAGES.forEach((path) => revalidatePath(path));

/** Trimmed text, or null when empty; an error string when it is over the limit. */
function text(value: unknown, max: number, what: string): { value: string | null } | { error: string } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `Check the ${what}.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `The ${what} can be at most ${max} characters.` };
  return { value: trimmed === "" ? null : trimmed };
}

/** A plain day (YYYY-MM-DD), null for none; an error string when it is not a real day. */
function day(value: unknown): { value: string | null } | { error: string } {
  if (value === undefined || value === null || value === "") return { value: null };
  return isRealDay(value) ? { value } : { error: "Pick a real day for the follow-up." };
}

/** The chosen start day (an Eastern calendar day): today when none is given; an error string when it is not a real day or is in the future. */
function startDay(value: unknown, now: Date): { value: string } | { error: string } {
  const chosen = value === undefined || value === null || value === "" ? orgYmd(now) : value;
  const problem = startDayProblem(chosen, now);
  if (problem === "invalid") return { error: "That isn't a real day. Pick the day it started." };
  if (problem === "future") return { error: "The start can't be in the future. Pick today or an earlier day." };
  return { value: chosen as string };
}

/** Why a start can't move, in her words (`limit` is the instant that stops it). */
function refusalMessage(reason: StartChangeRefusal, limit: string): string {
  const on = formatDateOnly(orgYmd(new Date(limit)));
  if (reason === "before_previous") return `The start can't be before the care plan this one follows on from, which started on ${on}.`;
  if (reason === "after_renewal") return `The start can't be after this care plan was renewed, on ${on}. Change the start of the next care plan first.`;
  return `The start can't be after this care plan was closed, on ${on}.`;
}

function reasonLabel(reason: string): string {
  return CARE_REASON_LABELS[reason as CareReason] ?? reason;
}

type TimelineKind = "started" | "renewed" | "closed";

/**
 * The member's timeline row for an engagement starting, being renewed or closing (like an outreach touch). Best effort,
 * log and continue: the engagement is the record. Nothing the staff member wrote goes in it.
 */
async function mirrorToTimeline(repos: Repos, userId: string, row: CareEngagementRow, kind: TimelineKind) {
  const closed = kind === "closed";
  await repos.activities
    .record({
      memberId: row.member_id,
      type: `care_${kind}`,
      category: "communication",
      title: closed ? "Hedgie Care closed" : kind === "renewed" ? "Hedgie Care renewed" : "Hedgie Care started",
      description: closed ? `${reasonLabel(row.reason)}: ${CARE_ENDED_HOW_LABELS[row.ended_how as CareEndedHow] ?? row.ended_how}` : reasonLabel(row.reason),
      actorKind: "staff",
      actorUserId: userId,
      engagementValue: 0, // our action, not the member's engagement
      occurredAt: (closed ? row.closed_at : row.opened_at) ?? nowIso(),
      source: "care",
      relatedId: row.id,
    })
    .catch((error) => console.error("Error mirroring a Hedgie Care engagement to member_activities:", error instanceof Error ? error.message : error));
}

export type StartEngagementInput = {
  memberId: string;
  /** The Eastern calendar day it started (YYYY-MM-DD), today or earlier; today when not given. */
  startedOn?: string;
  reason: string;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

/** What starting a care plan needs to find and track her DM with the member: Bronze reads (service role) and the signed-in user. */
type DmTracking = { service: CareDmServiceRepos; user: StaffIdentity };

async function startImpl(repos: Repos, userId: string, input: StartEngagementInput, dms?: DmTracking): Promise<CareActionResult> {
  if (!isId(input.memberId, "mbr")) return { error: "Pick a member." };
  if (!isCareReason(input.reason)) return { error: "Pick why you are reaching out." };
  const notes = text(input.notes, CARE_NOTES_MAX, "note");
  if ("error" in notes) return notes;
  const nextStep = text(input.nextStep, CARE_NEXT_STEP_MAX, "next step");
  if ("error" in nextStep) return nextStep;
  const followUpOn = day(input.followUpOn);
  if ("error" in followUpOn) return followUpOn;

  const now = new Date(clock.now());
  const started = startDay(input.startedOn, now);
  if ("error" in started) return started;
  // Today is now; an earlier day is noon Eastern of it (careStartInstant), and the period runs from that day.
  const openedAt = careStartInstant(started.value, now);
  let result;
  try {
    // A new care plan belongs to whoever starts it, never silently to the owner of the member's earlier plan: nobody is given a
    // member's care without agreeing (a hand-over needs both sides). A renewal keeps its owner; that is the same person.
    result = await repos.care.open({
      memberId: input.memberId,
      reason: input.reason,
      periodEndsOn: periodEndsOn(openedAt),
      openedBy: userId,
      ownedBy: userId,
      openedAt: openedAt.toISOString(),
      firstMessageAt: careFirstMessageInstant(started.value, now).toISOString(),
      notes: notes.value,
      nextStep: nextStep.value,
      followUpOn: followUpOn.value,
    });
  } catch (error) {
    console.error("[care] open failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't start the care plan." };
  }
  if (!result.ok) return { error: "There is already an open care plan with them. Log a message there, or renew it." };

  await mirrorToTimeline(repos, userId, result.engagement, "started");
  // The plan is hers, so her DM with them is read for it.
  if (dms) await trackDmWithMember(repos, dms, input.memberId);
  revalidate();
  return { success: true };
}

/**
 * A care plan is the reason a DM is tracked: starting one (or accepting one handed to her) tracks her 1:1 DM with that member, if
 * she has one in Bronze, whatever the plan is about, and brings who spoke last up to date from it. Best effort: the care plan is
 * the record, so a failure here is logged (the error message only, never anything from Slack) and the step still succeeds.
 */
async function trackDmWithMember(repos: Repos, dms: DmTracking, memberId: string) {
  try {
    const dm = await findOwnDmWith(dms.service, dms.user, memberId);
    if (!dm) return;
    await repos.careDms.track({ trackedBy: dms.user.id, channelId: dm.channelId, memberId });
    await projectCareFromDms({ care: repos.care, careDms: repos.careDms, service: dms.service }, { userId: dms.user.id });
  } catch (error) {
    console.error("[care] tracking the DM of a new care plan failed:", error instanceof Error ? error.message : error);
  }
}

async function logMessageImpl(repos: Repos, id: string, direction: string): Promise<CareActionResult> {
  if (!isCareId(id) || !isMessageDirection(direction)) return { error: MISSING };
  try {
    if (!(await repos.care.logMessage(id, direction as MessageDirection, nowIso()))) return { error: "That care plan is closed or gone." };
  } catch (error) {
    console.error("[care] log message failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save that." };
  }
  revalidate();
  return { success: true };
}

export type UpdateEngagementInput = { reason?: string; notes?: string | null; nextStep?: string | null; followUpOn?: string | null };

async function updateImpl(repos: Repos, id: string, input: UpdateEngagementInput): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  const patch: CarePatch = {};
  if (input.reason !== undefined) {
    if (!isCareReason(input.reason)) return { error: "Pick why you are reaching out." };
    patch.reason = input.reason;
  }
  if (input.notes !== undefined) {
    const notes = text(input.notes, CARE_NOTES_MAX, "note");
    if ("error" in notes) return notes;
    patch.notes = notes.value;
  }
  if (input.nextStep !== undefined) {
    const nextStep = text(input.nextStep, CARE_NEXT_STEP_MAX, "next step");
    if ("error" in nextStep) return nextStep;
    patch.nextStep = nextStep.value;
  }
  if (input.followUpOn !== undefined) {
    const followUpOn = day(input.followUpOn);
    if ("error" in followUpOn) return followUpOn;
    patch.followUpOn = followUpOn.value;
  }
  try {
    if (!(await repos.care.update(id, patch))) return { error: MISSING };
  } catch (error) {
    console.error("[care] update failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save the change." };
  }
  revalidate();
  return { success: true };
}

async function changeStartImpl(repos: Repos, service: CareDmServiceRepos & Pick<Repos, "activities">, userId: string, id: string, startedOn: unknown): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  const now = new Date(clock.now());
  const started = startDay(startedOn === "" ? undefined : startedOn, now);
  if ("error" in started) return started;
  let result;
  try {
    result = await repos.care.changeStart(id, careStartInstant(started.value, now).toISOString());
  } catch (error) {
    console.error("[care] change start failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't change the start date." };
  }
  if (!result.ok) return { error: result.reason === "not_found" ? MISSING : refusalMessage(result.reason, result.limit) };
  // The row on the member's timeline that was written when this care plan opened (its start, or the renewal that made it)
  // moves to the new day too. A community manager can insert timeline rows but not change them (RLS), so this is the service
  // role, after the staff check. Best effort like the row itself: the care plan is the record. Only this care plan's start,
  // never the member's membership.
  if (result.changed) {
    await service.activities
      .moveOccurredAt("care", id, ["care_started", "care_renewed"], result.engagement.opened_at)
      .catch((error) => console.error("[care] moving the timeline row after a start change failed:", error instanceof Error ? error.message : error));
  }
  // A start that moved earlier may bring earlier Slack DMs into reach (they count from the start of the day it opened), so
  // look at her tracked DMs again now. Best effort, and forward-only like every derivation; the page does it too when it opens.
  if (result.changed) {
    await projectCareFromDms({ care: repos.care, careDms: repos.careDms, service }, { userId }).catch((error) =>
      console.error("[care] filling in from tracked DMs after a start change failed:", error instanceof Error ? error.message : error)
    );
  }
  revalidate();
  return { success: true };
}

async function closeImpl(repos: Repos, userId: string, id: string, endedHow: string): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  if (!isCloseOption(endedHow)) return { error: "Pick how it ended." };
  let closed;
  try {
    closed = await repos.care.close(id, endedHow, nowIso());
  } catch (error) {
    console.error("[care] close failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't close the care plan." };
  }
  if (!closed) return { error: "That care plan is already closed or gone." };

  await mirrorToTimeline(repos, userId, closed, "closed");
  revalidate();
  return { success: true };
}

async function renewImpl(repos: Repos, userId: string, id: string, why: unknown): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  const reason = text(why, CARE_NOTES_MAX, "reason");
  if ("error" in reason) return reason;
  if (!reason.value) return { error: "Say why you are renewing: what will you do next?" };
  const now = new Date(clock.now());
  let result;
  try {
    result = await repos.care.renew(id, { periodEndsOn: periodEndsOn(now), openedBy: userId, at: now.toISOString(), reason: reason.value });
  } catch (error) {
    console.error("[care] renew failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't renew the care plan." };
  }
  if (!result.ok) return { error: "That care plan is already renewed, closed or gone. Refresh the list." };

  await mirrorToTimeline(repos, userId, result.engagement, "renewed");
  revalidate();
  return { success: true };
}

/** What a hand-over step does, from the repository to the words: a refusal is the page's sentence, a plan is success. */
async function handoverStep(step: string, run: () => Promise<HandoverResult>, onDone?: (plan: CareEngagementRow) => Promise<void>): Promise<CareActionResult> {
  let result;
  try {
    result = await run();
  } catch (error) {
    console.error(`[care] ${step} failed:`, error instanceof Error ? error.message : error);
    return { error: "Couldn't do that. Try again." };
  }
  if (!result.ok) return { error: HANDOVER_REFUSAL_MESSAGES[result.reason] };
  if (onDone) await onDone(result.engagement);
  revalidate();
  return { success: true };
}

async function proposeImpl(repos: Repos, id: string, toUserId: unknown): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  if (typeof toUserId !== "string" || !isUuid(toUserId)) return { error: "Pick who it goes to." };
  return handoverStep("propose a hand-over", () => repos.care.proposeHandover(id, toUserId));
}

async function acceptImpl(repos: Repos, id: string, dms?: DmTracking): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  // Becoming the owner is the reason to read her own DM with them: track it, and bring who spoke last up to date from it.
  return handoverStep("accept a hand-over", () => repos.care.acceptHandover(id), async (plan) => {
    if (dms && plan.closed_at === null) await trackDmWithMember(repos, dms, plan.member_id);
  });
}

async function declineImpl(repos: Repos, id: string): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  return handoverStep("decline a hand-over", () => repos.care.declineHandover(id));
}

async function cancelImpl(repos: Repos, id: string): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  return handoverStep("cancel a hand-over", () => repos.care.cancelHandover(id));
}

async function claimImpl(repos: Repos, id: string, dms?: DmTracking): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  return handoverStep("claim a care plan", () => repos.care.claim(id), async (plan) => {
    if (dms && plan.closed_at === null) await trackDmWithMember(repos, dms, plan.member_id);
  });
}

/** The name of whoever cared for this member before, when it is someone else (the start form says it; nothing changes hands). */
async function previousCarerOf(repos: Repos, memberId: unknown, userId: string): Promise<{ name: string | null }> {
  if (typeof memberId !== "string" || !isId(memberId, "mbr")) return { name: null };
  const previous = (await repos.care.forMember(memberId)).find((plan) => plan.owned_by !== null);
  if (!previous?.owned_by || previous.owned_by === userId) return { name: null };
  const carer = await repos.members.byUserId(previous.owned_by);
  return { name: carer ? getMemberDisplayName({ name: carer.name, display_name: carer.displayName }) : "someone else on the team" };
}

async function deleteImpl(repos: Repos, id: string): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  try {
    if (!(await repos.care.softDelete(id, nowIso()))) return { error: MISSING };
  } catch (error) {
    console.error("[care] delete failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't remove the care plan." };
  }
  revalidate();
  return { success: true };
}

/** Finds members by name or email for the "start an engagement" picker. Staff with the write feature only. */
export async function searchCareMembers(query: string) {
  const auth = await requireStaffAction();
  if (!auth.ok || !staffCan(auth.role, "care.write")) return [];
  const words = String(query).trim().slice(0, 60).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const found = await createRepos(auth.supabase).members.search({ words, limit: 10 });
  return found.map((m) => memberSearchItem(m));
}

/** Starts a care plan with a member. One open care plan per member. */
export async function startEngagement(input: StartEngagementInput): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction(
    "care_engagement_started",
    async () => {
      // Starting tracks her DM with the member if the Hub has one (a DM is only in Bronze for a member whose DMs are pulled).
      return startImpl(createRepos(auth.supabase), auth.user.id, input, { service: getServiceRepos(), user: auth.user });
    },
    (r) => ({ ok: "success" in r })
  );
}

/** Changes the day an engagement started (a conversation entered after the fact). Today or earlier; the care plan's last day moves with it. */
export async function changeEngagementStart(id: string, startedOn: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction(
    "care_start_date_changed",
    () => changeStartImpl(createRepos(auth.supabase), getServiceRepos(), auth.user.id, id, startedOn),
    (r) => ({ ok: "success" in r })
  );
}

/** Logs that the member replied (`member`) or that she did (`staff`), just now. */
export async function logCareMessage(id: string, direction: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_message_logged", () => logMessageImpl(createRepos(auth.supabase), id, direction), (r) => ({ ok: "success" in r }));
}

/** Changes an engagement's reason, notes, next step or follow-up day. */
export async function updateEngagement(id: string, input: UpdateEngagementInput): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_updated", () => updateImpl(createRepos(auth.supabase), id, input), (r) => ({ ok: "success" in r }));
}

/** Closes an engagement with how it ended. */
export async function closeEngagement(id: string, endedHow: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_closed", () => closeImpl(createRepos(auth.supabase), auth.user.id, id, endedHow), (r) => ({ ok: "success" in r }));
}

/** Renews an engagement: closes this period as renewed and opens the next, in one step. `reason` (what happens next) is required and becomes the new period's note. */
export async function renewEngagement(id: string, reason: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_renewed", () => renewImpl(createRepos(auth.supabase), auth.user.id, id, reason), (r) => ({ ok: "success" in r }));
}

/**
 * Offers a care plan (open or closed) to another staff member. Nothing changes hands until they accept: the plan keeps its owner,
 * and the database refuses any other change of owner. By the owner, or an admin acting for them.
 */
export async function proposeCareHandover(id: string, toUserId: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_handover_proposed", () => proposeImpl(createRepos(auth.supabase), id, toUserId), (r) => ({ ok: "success" in r }));
}

/** The receiver accepts a hand-over: they own the care plan now, and their own DM with the member is read for it. */
export async function acceptCareHandover(id: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_handover_accepted", () => acceptImpl(createRepos(auth.supabase), id, { service: getServiceRepos(), user: auth.user }), (r) => ({ ok: "success" in r }));
}

/** The receiver declines a hand-over: the owner stays. */
export async function declineCareHandover(id: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_handover_declined", () => declineImpl(createRepos(auth.supabase), id), (r) => ({ ok: "success" in r }));
}

/** Takes a pending hand-over back: whoever proposed it, the owner, or an admin. */
export async function cancelCareHandover(id: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_handover_cancelled", () => cancelImpl(createRepos(auth.supabase), id), (r) => ({ ok: "success" in r }));
}

/** Takes a care plan that has no owner (its owner's account was removed): the staff member who takes it accepts it. */
export async function claimCarePlan(id: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_plan_claimed", () => claimImpl(createRepos(auth.supabase), id, { service: getServiceRepos(), user: auth.user }), (r) => ({ ok: "success" in r }));
}

/** Who cared for this member before, when it is someone else: the start form says so (information, nothing changes hands). Staff with the write feature only. */
export async function loadPreviousCareOwner(memberId: string): Promise<{ name: string | null }> {
  const auth = await requireStaffAction();
  if (!auth.ok || !staffCan(auth.role, "care.write")) return { name: null };
  try {
    return await previousCarerOf(createRepos(auth.supabase), memberId, auth.user.id);
  } catch (error) {
    console.error("[care] reading the previous owner failed:", error instanceof Error ? error.message : error);
    return { name: null };
  }
}

/** Removes an engagement from the lists (kept in the database, hidden everywhere). */
export async function deleteEngagement(id: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_deleted", () => deleteImpl(createRepos(auth.supabase), id), (r) => ({ ok: "success" in r }));
}

/** An engagement's measured results (before, during, after), counted on request from the member's own activity. */
export async function getEngagementResults(id: string): Promise<{ error: string } | { results: CareResults }> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  if (!isCareId(id)) return { error: MISSING };
  const repos = createRepos(auth.supabase);
  try {
    const engagement = await repos.care.byId(id);
    if (!engagement) return { error: MISSING };
    // Membership and program enrollments come from tables her own client may not read; the derived answer is all that leaves.
    return { results: await loadCareResults(repos, getServiceRepos(), engagement, new Date(clock.now())) };
  } catch (error) {
    console.error("[care] results failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't work out the results." };
  }
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
