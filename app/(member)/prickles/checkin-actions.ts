"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { checkinFromRow, validateCheckin, writeCheckin, type CheckinInput } from "@/lib/prickle-checkins";
import { resolveAnsweredCheckinNotifications } from "@/lib/prickle-checkin-dms";
import { formatPrickleTitle } from "@/lib/formatters";
import { getUserTimezonePreference } from "@/lib/timezone";
import { ORG_TIMEZONE } from "@/lib/config";
import { localDateOf } from "@/lib/prickle-writing";
import { progressMeasureFor, progressQuestion, type WritingMeasure } from "@/lib/writing-projects";

export type SaveCheckinResult = { success: true } | { error: string };

/**
 * The effective member's check-in for a prickle, or null if they haven't made one. Works in sudo:
 * admins can read every check-in (migration 20261003000000), so an admin browsing as a member
 * sees that member's answers.
 */
export async function getMyCheckin(prickleId: string): Promise<CheckinInput | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("prickle_checkins")
    .select("feelings_before, need, session_rating, feelings_after")
    .eq("member_id", identity.memberId)
    .eq("prickle_id", prickleId)
    .is("deleted_at", null)
    .maybeSingle();
  return data ? checkinFromRow(data) : null;
}

const CHECKINS_BATCH = 1000;

/** Every check-in the effective member has saved, by prickle id (paginated: it grows with every prickle). */
export async function getMyCheckins(): Promise<Record<string, CheckinInput>> {
  const user = await getCurrentUser();
  if (!user) return {};
  const identity = await getEffectiveIdentity(user);
  if (!identity) return {};

  const supabase = await createClient();
  const result: Record<string, CheckinInput> = {};
  for (let offset = 0; ; offset += CHECKINS_BATCH) {
    const { data } = await supabase
      .from("prickle_checkins")
      .select("id, prickle_id, feelings_before, need, session_rating, feelings_after")
      .eq("member_id", identity.memberId)
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + CHECKINS_BATCH - 1);
    for (const row of data ?? []) result[row.prickle_id] = checkinFromRow(row);
    if ((data?.length ?? 0) < CHECKINS_BATCH) return result;
  }
}

/** One project the check-out asks "how much did you get done?" about. */
export interface CheckoutProject {
  id: string;
  title: string;
  measure: WritingMeasure;
  /** e.g. "How many words did you write on The Hedgehog's Journey during Monday Progress Prickle with Jenn P?" */
  question: string;
  /** What's already logged against this prickle for the project, e.g. "+500 Words". Nothing is asked again. */
  logged: { amount: number; measure: WritingMeasure; mode: "delta" | "set_total" }[];
}

export interface CheckModalData {
  prickleTitle: string;
  /** The prickle's local date, for the progress entries the check-out logs. */
  entryDate: string;
  hasStarted: boolean;
  checkin: CheckinInput | null;
  /** False in sudo: an admin sees the answers but nothing is saved on the member's behalf. */
  canEdit: boolean;
  projects: CheckoutProject[];
}

/** Recent entries scanned for the measure a project was last logged in (no pagination needed: it's a recency hint). */
const RECENT_ENTRIES = 50;

/**
 * Everything the check-in / check-out modal shows for one prickle: the saved answers and, for the
 * check-out, a progress question per project (worded for the measure it's tracked in). Null if the
 * prickle doesn't exist or there's no member record.
 */
export async function getCheckModalData(prickleId: string): Promise<CheckModalData | null> {
  const user = await getCurrentUser();
  if (!user || typeof prickleId !== "string" || !prickleId) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return null;

  const supabase = await createClient();
  const memberId = identity.memberId;
  const [prickleResult, checkin, projectsResult, goalsResult, recentResult, loggedResult, tzPref] = await Promise.all([
    supabase
      .from("prickles")
      .select("id, start_time, host:prickle_host(name), prickle_types:type_id(name)")
      .eq("id", prickleId)
      .maybeSingle(),
    getMyCheckin(prickleId),
    supabase
      .from("writing_projects")
      .select("id, title")
      .eq("member_id", memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("writing_goals").select("project_id, measure").eq("member_id", memberId).is("archived_at", null),
    supabase
      .from("writing_progress_entries")
      .select("project_id, measure")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(RECENT_ENTRIES),
    supabase
      .from("writing_progress_entries")
      .select("project_id, measure, mode, amount")
      .eq("member_id", memberId)
      .eq("prickle_id", prickleId)
      .order("created_at", { ascending: true }),
    getUserTimezonePreference(),
  ]);
  const prickle = prickleResult.data;
  if (!prickle) return null;

  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;
  const prickleTitle = formatPrickleTitle(prickle as Parameters<typeof formatPrickleTitle>[0]);
  const byProject = <T extends { project_id: string }>(rows: T[] | null) => {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) map.set(row.project_id, [...(map.get(row.project_id) ?? []), row]);
    return map;
  };
  const goals = byProject(goalsResult.data as { project_id: string; measure: WritingMeasure }[] | null);
  const recent = byProject(recentResult.data as { project_id: string; measure: WritingMeasure }[] | null);
  const logged = byProject(
    loggedResult.data as { project_id: string; measure: WritingMeasure; mode: "delta" | "set_total"; amount: number }[] | null
  );

  const projects = (projectsResult.data ?? []).map((p) => {
    const measure = progressMeasureFor(
      (goals.get(p.id) ?? []).map((g) => g.measure),
      (recent.get(p.id) ?? []).map((e) => e.measure)
    );
    return {
      id: p.id as string,
      title: p.title as string,
      measure,
      question: progressQuestion(measure, p.title, prickleTitle),
      logged: (logged.get(p.id) ?? []).map((e) => ({ amount: Number(e.amount), measure: e.measure, mode: e.mode })),
    };
  });

  return {
    prickleTitle,
    entryDate: localDateOf(prickle.start_time, timeZone),
    hasStarted: new Date(prickle.start_time).getTime() <= Date.now(),
    checkin,
    canEdit: !identity.isSudo,
    projects,
  };
}

/**
 * The check-in for a prickle as the Log Progress modal needs it: the saved answers (if any) and
 * whether the member may change them -- not in sudo, where saveCheckin refuses.
 */
export async function getCheckinForLogging(
  prickleId: string
): Promise<{ checkin: CheckinInput | null; canEdit: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { checkin: null, canEdit: false };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { checkin: null, canEdit: false };
  return { checkin: await getMyCheckin(prickleId), canEdit: !identity.isSudo };
}

/**
 * Save (or, when every answer is cleared, soft-delete) the signed-in member's check-in for a prickle.
 * Refused in sudo: a check-in is the member's own feelings, so nobody records them on someone's
 * behalf (RLS also keeps writes owner-only, resolving the member from the session).
 */
export async function saveCheckin(prickleId: string, input: CheckinInput): Promise<SaveCheckinResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Check-ins aren't available in sudo mode." };

  if (typeof prickleId !== "string" || !prickleId) return { error: "Invalid prickle" };
  const validationError = validateCheckin(input);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  const error = await writeCheckin(supabase, identity.memberId, prickleId, input);
  if (error) {
    console.error("[prickle-checkins] Saving check-in failed", { member: identity.memberId, prickleId, error });
    return { error: "Couldn't save your check-in — please try again." };
  }
  await resolveAnsweredCheckinNotifications(supabase, identity.memberId, prickleId, input);

  revalidateCheckinPages(prickleId);
  return { success: true };
}

/** Which half of the check-in a modal edits. */
export type CheckinHalf = "checkin" | "checkout";

/**
 * Saves one half of the check-in (check-in: feelings coming in + need; check-out: rating + feelings
 * after), merged into what's saved now so the other half, answered meanwhile in Slack or another
 * tab, isn't overwritten.
 */
export async function saveCheckinHalf(
  prickleId: string,
  half: CheckinHalf,
  answers: Partial<CheckinInput>
): Promise<SaveCheckinResult> {
  if (half !== "checkin" && half !== "checkout") return { error: "Invalid check-in" };
  const latest = (await getMyCheckin(prickleId)) ?? {
    feelingsBefore: [],
    need: null,
    sessionRating: null,
    feelingsAfter: [],
  };
  const merged: CheckinInput =
    half === "checkin"
      ? { ...latest, feelingsBefore: answers.feelingsBefore ?? [], need: answers.need ?? null }
      : { ...latest, sessionRating: answers.sessionRating ?? null, feelingsAfter: answers.feelingsAfter ?? [] };
  return saveCheckin(prickleId, merged);
}

/** The check-in/out modal lives on My Prickles' history tab; the prickle page shows a summary. */
function revalidateCheckinPages(prickleId: string) {
  revalidatePath("/my-prickles", "layout");
  revalidatePath(`/prickles/${prickleId}`);
}
