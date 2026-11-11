"use server";

import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import {
  CARE_CHANNEL_LABELS,
  CARE_ENDED_HOW_LABELS,
  CARE_NEXT_STEP_MAX,
  CARE_NOTES_MAX,
  CARE_REASON_LABELS,
  periodEndsOn,
  isCareChannel,
  isCareId,
  isCareReason,
  isCloseOption,
  isMessageDirection,
  type CareChannel,
  type CareEndedHow,
  type CareReason,
  type CareResults,
  type MessageDirection,
} from "@/lib/care";
import { loadCareResults } from "@/lib/care-results";
import { isCareOwner } from "@/lib/care-owners";
import { clock } from "@/lib/clock";
import type { CareEngagementRow, CarePatch } from "@/lib/data/care";
import { createRepos, type Repos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { isId, isUuid } from "@/lib/ids";
import { memberSearchItem } from "@/lib/member-search-item";
import { staffCan } from "@/lib/staff-access";

/**
 * Server actions for the Hedgie Care page (docs/HEDGIE_CARE.md). Staff, not admin-only: the community manager writes
 * here, so each action starts with requireStaffAction() and then asks for the `care.write` feature (lib/staff-access.ts).
 * They run as the signed-in user, so row-level security is the second check.
 */

export type CareActionResult = { error: string } | { success: true };

const NOT_AUTHORIZED = "Not authorized";
const MISSING = "That engagement is gone.";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
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
  if (typeof value !== "string" || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    return { error: "Pick a real day for the follow-up." };
  }
  return { value };
}

function reasonLabel(reason: string, channel: string): string {
  return `${CARE_REASON_LABELS[reason as CareReason] ?? reason} · ${CARE_CHANNEL_LABELS[channel as CareChannel] ?? channel}`;
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
      description: closed ? `${reasonLabel(row.reason, row.channel)}: ${CARE_ENDED_HOW_LABELS[row.ended_how as CareEndedHow] ?? row.ended_how}` : reasonLabel(row.reason, row.channel),
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
  reason: string;
  channel: string;
  /** The member wrote first (they messaged her), rather than her reaching out. */
  memberWroteFirst?: boolean;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

async function startImpl(repos: Repos, userId: string, input: StartEngagementInput): Promise<CareActionResult> {
  if (!isId(input.memberId, "mbr")) return { error: "Pick a member." };
  if (!isCareReason(input.reason)) return { error: "Pick why you are reaching out." };
  if (!isCareChannel(input.channel)) return { error: "Pick where you are reaching out." };
  const notes = text(input.notes, CARE_NOTES_MAX, "note");
  if ("error" in notes) return notes;
  const nextStep = text(input.nextStep, CARE_NEXT_STEP_MAX, "next step");
  if ("error" in nextStep) return nextStep;
  const followUpOn = day(input.followUpOn);
  if ("error" in followUpOn) return followUpOn;

  const now = new Date(clock.now());
  let result;
  try {
    // Continuity: the member's latest engagement (newest first) keeps its owner; otherwise it is whoever starts this one.
    const latest = (await repos.care.forMember(input.memberId))[0];
    result = await repos.care.open({
      memberId: input.memberId,
      reason: input.reason,
      channel: input.channel,
      periodEndsOn: periodEndsOn(now),
      openedBy: userId,
      ownedBy: latest?.owned_by ?? userId,
      openedAt: now.toISOString(),
      firstMessageFrom: input.memberWroteFirst ? "member" : "staff",
      notes: notes.value,
      nextStep: nextStep.value,
      followUpOn: followUpOn.value,
    });
  } catch (error) {
    console.error("[care] open failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't start the engagement." };
  }
  if (!result.ok) return { error: "There is already an open engagement with them on that channel. Log a message there, or renew it." };

  await mirrorToTimeline(repos, userId, result.engagement, "started");
  revalidate();
  return { success: true };
}

async function logMessageImpl(repos: Repos, id: string, direction: string): Promise<CareActionResult> {
  if (!isCareId(id) || !isMessageDirection(direction)) return { error: MISSING };
  try {
    if (!(await repos.care.logMessage(id, direction as MessageDirection, nowIso()))) return { error: "That engagement is closed or gone." };
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

async function closeImpl(repos: Repos, userId: string, id: string, endedHow: string): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  if (!isCloseOption(endedHow)) return { error: "Pick how it ended." };
  let closed;
  try {
    closed = await repos.care.close(id, endedHow, nowIso());
  } catch (error) {
    console.error("[care] close failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't close the engagement." };
  }
  if (!closed) return { error: "That engagement is already closed or gone." };

  await mirrorToTimeline(repos, userId, closed, "closed");
  revalidate();
  return { success: true };
}

async function renewImpl(repos: Repos, userId: string, id: string, why: unknown): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  const reason = text(why, CARE_NOTES_MAX, "reason");
  if ("error" in reason) return reason;
  if (!reason.value) return { error: "Say why you are renewing: what is the plan?" };
  const now = new Date(clock.now());
  let result;
  try {
    result = await repos.care.renew(id, { periodEndsOn: periodEndsOn(now), openedBy: userId, at: now.toISOString(), reason: reason.value });
  } catch (error) {
    console.error("[care] renew failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't renew the engagement." };
  }
  if (!result.ok) return { error: "That engagement is already renewed, closed or gone. Refresh the list." };

  await mirrorToTimeline(repos, userId, result.engagement, "renewed");
  revalidate();
  return { success: true };
}

async function reassignImpl(repos: Repos, id: string, ownerId: unknown): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  if (typeof ownerId !== "string" || !isUuid(ownerId)) return { error: "Pick who it goes to." };
  try {
    // Only staff who work Hedgie Care may own one; the profile's role says so (read with the service role: a community
    // manager's own client cannot read other users' profiles).
    if (!(await isCareOwner(getServiceRepos(), ownerId))) return { error: "Pick someone on the team." };
    if (!(await repos.care.reassign(id, ownerId))) return { error: MISSING };
  } catch (error) {
    console.error("[care] reassign failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't hand it over." };
  }
  revalidate();
  return { success: true };
}

async function deleteImpl(repos: Repos, id: string): Promise<CareActionResult> {
  if (!isCareId(id)) return { error: MISSING };
  try {
    if (!(await repos.care.softDelete(id, nowIso()))) return { error: MISSING };
  } catch (error) {
    console.error("[care] delete failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't remove the engagement." };
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

/** Starts an engagement with a member (she reached out, or they wrote to her). One open engagement per member and channel. */
export async function startEngagement(input: StartEngagementInput): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_started", () => startImpl(createRepos(auth.supabase), auth.user.id, input), (r) => ({ ok: "success" in r }));
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

/** Renews an engagement: closes this period as renewed and opens the next, in one step. `reason` (what is the plan) is required and becomes the new period's note. */
export async function renewEngagement(id: string, reason: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_renewed", () => renewImpl(createRepos(auth.supabase), auth.user.id, id, reason), (r) => ({ ok: "success" in r }));
}

/** Hands an engagement (open or closed) to another staff member. */
export async function reassignEngagement(id: string, ownerId: string): Promise<CareActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "care.write")) return { error: NOT_AUTHORIZED };
  return withAction("care_engagement_reassigned", () => reassignImpl(createRepos(auth.supabase), id, ownerId), (r) => ({ ok: "success" in r }));
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
