"use server";

import { createRepos } from "@/lib/data/repos";
import type { PrickleDetail } from "@/lib/data/prickles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserSecondaryTimezone, getUserTimezonePreference } from "@/lib/timezone";
import { revalidatePath } from "next/cache";
import {
  buildAttendedSet,
  commitmentEndDate,
  commitmentsFetchWindow,
  computeCommitmentProgress,
  effectiveCommitmentStatus,
  findOverlappingCommitment,
  formatCommitmentTitle,
  formatSlotLabel,
  prickleMatchesSlot,
  SCHEDULE_TIMEZONE,
  slotInTimeZone,
  validateCommitmentInput,
  type Commitment,
  type CommitmentInput,
  type CommitmentProgress,
  type CommitmentSlot,
  type CommitmentStatus,
  type ProgressCounts,
  type SlotPrickle,
} from "@/lib/commitments";

import { withAction } from "@/lib/analytics/server";
/** How far ahead createCommitment looks for a real prickle in each requested slot. */
const SLOT_LOOKAHEAD_DAYS = 21;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface MyCommitmentSlot extends CommitmentSlot {
  typeName: string;
  label: string;
  progress: ProgressCounts;
}

export interface MyCommitment {
  id: string;
  title: string;
  slots: MyCommitmentSlot[];
  startDate: string;
  endDate: string;
  weeks: number;
  status: CommitmentStatus;
  progress: CommitmentProgress;
}

interface SlotRow {
  type_id: string;
  day_of_week: number;
  start_time_local: string;
  timezone: string;
  prickle_types?: { name: string } | { name: string }[] | null;
}

interface CommitmentRow {
  id: string;
  start_date: string;
  weeks: number;
  status: CommitmentStatus;
  cancelled_at: string | null;
  prickle_commitment_slots: SlotRow[] | null;
}

function toSlot(s: SlotRow): CommitmentSlot {
  return { typeId: s.type_id, dayOfWeek: s.day_of_week, startTimeLocal: s.start_time_local, timezone: s.timezone };
}

function toCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    startDate: row.start_date,
    weeks: row.weeks,
    status: row.status,
    cancelledAt: row.cancelled_at,
    slots: (row.prickle_commitment_slots ?? []).map(toSlot),
  };
}

function typeNameOf(s: SlotRow): string {
  const type = Array.isArray(s.prickle_types) ? s.prickle_types[0] : s.prickle_types;
  return type?.name ?? "Prickle";
}

/** Chronological slot order (day, then time) so M/W/F reads in order everywhere. */
function sortSlotRows(rows: SlotRow[]): SlotRow[] {
  return [...rows].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.start_time_local.localeCompare(b.start_time_local)
  );
}

function toSlotPrickle(p: PrickleDetail): SlotPrickle {
  return { id: p.id, typeId: p.typeId, startTime: p.startTime, endTime: p.endTime };
}

const COMMITMENT_SELECT =
  "id, start_date, weeks, status, cancelled_at, prickle_commitment_slots(type_id, day_of_week, start_time_local, timezone, prickle_types(name))";

/**
 * The acting member's commitments (newest first) with kept/missed progress per occurrence,
 * summarized per commitment and per slot. Re-derives the member from effectiveIdentity
 * (sudo-aware), never from a client-passed id. Paginated per CLAUDE.md -- prickles and
 * prickle_attendance can each exceed 1000 rows. Also flips any 'active' commitment whose window
 * has passed to 'completed' (best-effort; the status is derived on read either way).
 */
export async function getMyCommitments(): Promise<MyCommitment[]> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return [];
  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return [];
  const memberId = effectiveIdentity.memberId;

  const { data: rows, error } = await supabase
    .from("prickle_commitments")
    .select(COMMITMENT_SELECT)
    .eq("member_id", memberId)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getMyCommitments: failed to load prickle_commitments", error);
    return [];
  }
  const commitmentRows = ((rows ?? []) as unknown as CommitmentRow[])
    .map((r) => ({ ...r, prickle_commitment_slots: sortSlotRows(r.prickle_commitment_slots ?? []) }))
    .filter((r) => r.prickle_commitment_slots.length > 0);
  if (commitmentRows.length === 0) return [];

  const now = new Date();
  const commitments = commitmentRows.map(toCommitment);

  const expiredIds = commitments
    .filter((c) => c.status === "active" && effectiveCommitmentStatus(c, now) === "completed")
    .map((c) => c.id);
  if (expiredIds.length > 0) {
    const { error: flipError } = await supabase
      .from("prickle_commitments")
      .update({ status: "completed", updated_at: now.toISOString() })
      .in("id", expiredIds)
      .eq("status", "active");
    if (flipError) console.error("getMyCommitments: failed to mark commitments completed", flipError);
  }

  const window = commitmentsFetchWindow(commitments)!;
  const typeIds = [...new Set(commitments.flatMap((c) => c.slots.map((s) => s.typeId)))];
  const prickles = (
    await createRepos(supabase).prickles.startingBetween({ from: window.from, to: window.to, inclusiveEnd: true, typeIds })
  ).map(toSlotPrickle);

  // Only prickles that have started can have attendance; batched by id, each batch paginated.
  const prickleIds = prickles.filter((p) => new Date(p.startTime).getTime() <= now.getTime()).map((p) => p.id);
  const attendedIds = await createRepos(supabase).attendance.attendedAmong(memberId, prickleIds);
  const attendanceRows = [...attendedIds].map((prickle_id) => ({ prickle_id }));
  const attended = buildAttendedSet(attendanceRows);
  // Slots are stored in the schedule's timezone; labels show the member's own. "browser" can't
  // be resolved server-side, so it falls back to the schedule's timezone (always named in labels).
  const [tzPref, secondaryZone] = await Promise.all([getUserTimezonePreference(), getUserSecondaryTimezone()]);
  const viewerTimeZone = tzPref === "browser" ? SCHEDULE_TIMEZONE : tzPref;
  const secondary = { secondaryZone, now };

  return commitmentRows.map((row, i) => {
    const c = commitments[i];
    const progress = computeCommitmentProgress(c, prickles, attended, now);
    const slots: MyCommitmentSlot[] = row.prickle_commitment_slots.map((s, j) => {
      const slot = c.slots[j];
      const typeName = typeNameOf(s);
      return {
        ...slot,
        startTimeLocal: slot.startTimeLocal.slice(0, 5),
        typeName,
        label: formatSlotLabel(typeName, slotInTimeZone(slot, viewerTimeZone, now), secondary),
        progress: progress.perSlot[j],
      };
    });
    return {
      id: c.id,
      title: formatCommitmentTitle(slots.map((s) => ({ ...slotInTimeZone(s, viewerTimeZone, now), typeName: s.typeName })), secondary),
      slots,
      startDate: c.startDate,
      endDate: commitmentEndDate(c.startDate, c.weeks),
      weeks: c.weeks,
      status: progress.effectiveStatus,
      progress,
    };
  });
}

/** Slots (from `slots`) with no real prickle on the upcoming schedule. */
async function findMissingSlots(
  supabase: SupabaseClient,
  slots: CommitmentSlot[],
  now: Date
): Promise<CommitmentSlot[]> {
  const typeIds = [...new Set(slots.map((s) => s.typeId))];
  const upcoming = (
    await createRepos(supabase).prickles.startingBetween({
      from: now.toISOString(),
      to: new Date(now.getTime() + SLOT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      inclusiveEnd: true,
      typeIds,
    })
  ).map(toSlotPrickle);
  return slots.filter((slot) => !upcoming.some((p) => prickleMatchesSlot(p, slot)));
}

/**
 * Commits the acting member to one or more recurring slots for N weeks. member_id always comes
 * from effectiveIdentity. Every slot must exist on the upcoming schedule (checked against real
 * prickles, not trusted from the client), and no slot may already be in another active
 * commitment of theirs with an overlapping window (the DB enforces the same rule; this gives a
 * readable message). The commitment and its slots are created atomically by the
 * create_prickle_commitment SQL function.
 */
async function createCommitmentImpl(
  input: CommitmentInput
): Promise<{ success: true; id: string } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const now = new Date();
  const validationError = validateCommitmentInput(input, now);
  if (validationError) return { error: validationError };

  const slots = input.slots.map((s) => ({ ...s, startTimeLocal: s.startTimeLocal.slice(0, 5) }));

  if ((await findMissingSlots(supabase, slots, now)).length > 0) {
    return { error: "One of those prickles isn't on the upcoming schedule -- pick from All Prickles" };
  }

  const { data: existingRows } = await supabase
    .from("prickle_commitments")
    .select(COMMITMENT_SELECT)
    .eq("member_id", effectiveIdentity.memberId)
    .eq("status", "active");
  const existing = ((existingRows ?? []) as unknown as CommitmentRow[]).map(toCommitment);
  const overlap = findOverlappingCommitment({ startDate: input.startDate, weeks: input.weeks, slots }, existing, now);
  if (overlap) {
    return {
      error: `You're already committed to one of these prickles through ${commitmentEndDate(overlap.startDate, overlap.weeks)}`,
    };
  }

  const { data: id, error } = await supabase.rpc("create_prickle_commitment", {
    p_member_id: effectiveIdentity.memberId,
    p_start_date: input.startDate,
    p_weeks: input.weeks,
    p_slots: slots.map((s) => ({
      type_id: s.typeId,
      day_of_week: s.dayOfWeek,
      start_time_local: s.startTimeLocal,
      timezone: s.timezone,
    })),
    p_created_by: user.id,
  });
  if (error || !id) {
    if (error?.code === "23505") return { error: "You're already committed to one of these prickles for those weeks" };
    return { error: error?.message ?? "Failed to save commitment" };
  }
  const commitmentId = id as string;

  // Append-only activity signal (docs/ACTIVITY_AND_AUDIT_LOG.md): best-effort, never fails the
  // commitment that was already saved. Under sudo it's an admin acting on the member's behalf.
  const sessions = slots.length;
  await createRepos(supabase)
    .activities.record({
      memberId: effectiveIdentity.memberId,
      type: "prickle_commitment_created",
      category: "event",
      title: `Committed to ${sessions} ${sessions === 1 ? "prickle" : "prickles"} a week for ${input.weeks} ${
        input.weeks === 1 ? "week" : "weeks"
      }`,
      relatedId: commitmentId,
      engagementValue: 3,
      occurredAt: now.toISOString(),
      source: "prickle_commitments",
      actorKind: effectiveIdentity.isSudo ? "staff" : "member",
      actorUserId: effectiveIdentity.isSudo ? user.id : null,
      data: {
        start_date: input.startDate,
        weeks: input.weeks,
        slots: slots.map((s) => ({
          type_id: s.typeId,
          day_of_week: s.dayOfWeek,
          start_time_local: s.startTimeLocal,
          timezone: s.timezone,
        })),
      },
    })
    .catch((activityError) => console.error("createCommitment: failed to insert member_activities row", activityError));

  revalidatePath("/my-prickles", "layout");
  return { success: true, id: commitmentId };
}

/** Cancels one of the acting member's own active commitments (never a hard delete). */
async function cancelCommitmentImpl(id: string): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const { data: existing } = await supabase
    .from("prickle_commitments")
    .select("id, member_id, status")
    .eq("id", id)
    .single();
  if (!existing || existing.member_id !== effectiveIdentity.memberId) return { error: "Commitment not found" };
  if (existing.status !== "active") return { error: "Only active commitments can be cancelled" };

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("prickle_commitments")
    .update({ status: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .eq("member_id", effectiveIdentity.memberId);
  if (error) return { error: error.message };

  revalidatePath("/my-prickles", "layout");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function createCommitment(...args: Parameters<typeof createCommitmentImpl>): ReturnType<typeof createCommitmentImpl> {
  return withAction("commitment_created", () => createCommitmentImpl(...args));
}

export async function cancelCommitment(...args: Parameters<typeof cancelCommitmentImpl>): ReturnType<typeof cancelCommitmentImpl> {
  return withAction("commitment_cancelled", () => cancelCommitmentImpl(...args));
}
