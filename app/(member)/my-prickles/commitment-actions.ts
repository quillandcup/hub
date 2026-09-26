"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import {
  buildAttendedSet,
  commitmentEndDate,
  commitmentsFetchWindow,
  computeCommitmentProgress,
  effectiveCommitmentStatus,
  formatCommitmentLabel,
  prickleMatchesSlot,
  validateCommitmentInput,
  type Commitment,
  type CommitmentInput,
  type CommitmentProgress,
  type CommitmentStatus,
  type SlotPrickle,
} from "@/lib/commitments";

const BATCH_SIZE = 1000;
const PRICKLE_ID_BATCH = 100;
/** How far ahead createCommitment looks for a real prickle in the requested slot. */
const SLOT_LOOKAHEAD_DAYS = 21;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface MyCommitment {
  id: string;
  typeId: string;
  typeName: string;
  label: string;
  dayOfWeek: number;
  startTimeLocal: string;
  timezone: string;
  startDate: string;
  endDate: string;
  weeks: number;
  status: CommitmentStatus;
  progress: CommitmentProgress;
}

interface CommitmentRow {
  id: string;
  type_id: string;
  day_of_week: number;
  start_time_local: string;
  timezone: string;
  start_date: string;
  weeks: number;
  status: CommitmentStatus;
  cancelled_at: string | null;
  prickle_types: { name: string } | { name: string }[] | null;
}

function toCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    typeId: row.type_id,
    dayOfWeek: row.day_of_week,
    startTimeLocal: row.start_time_local,
    timezone: row.timezone,
    startDate: row.start_date,
    weeks: row.weeks,
    status: row.status,
    cancelledAt: row.cancelled_at,
  };
}

async function fetchAllPaginated<T>(queryFn: (offset: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  let all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await queryFn(offset);
    const batch = (data as T[] | null) ?? [];
    if (batch.length > 0) {
      all = all.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}

type RawPrickle = { id: string; type_id: string | null; start_time: string; end_time: string };

function toSlotPrickle(p: RawPrickle): SlotPrickle {
  return { id: p.id, typeId: p.type_id, startTime: p.start_time, endTime: p.end_time };
}

/**
 * The acting member's commitments (newest first) with kept/missed progress. Re-derives the
 * member from effectiveIdentity (sudo-aware), never from a client-passed id. Paginated per
 * CLAUDE.md -- prickles and prickle_attendance can each exceed 1000 rows. Also flips any
 * 'active' commitment whose window has passed to 'completed' (best-effort; the status is
 * derived on read either way).
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
    .select("id, type_id, day_of_week, start_time_local, timezone, start_date, weeks, status, cancelled_at, prickle_types(name)")
    .eq("member_id", memberId)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getMyCommitments: failed to load prickle_commitments", error);
    return [];
  }
  const commitmentRows = (rows ?? []) as unknown as CommitmentRow[];
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
  const typeIds = [...new Set(commitments.map((c) => c.typeId))];
  const prickles = (
    await fetchAllPaginated<RawPrickle>((offset) =>
      supabase
        .from("prickles")
        .select("id, type_id, start_time, end_time")
        .in("type_id", typeIds)
        .gte("start_time", window.from)
        .lte("start_time", window.to)
        .order("start_time")
        .range(offset, offset + BATCH_SIZE - 1)
    )
  ).map(toSlotPrickle);

  // Only prickles that have started can have attendance; batched by id, each batch paginated.
  let attendanceRows: { prickle_id: string }[] = [];
  const prickleIds = prickles.filter((p) => new Date(p.startTime).getTime() <= now.getTime()).map((p) => p.id);
  for (let i = 0; i < prickleIds.length; i += PRICKLE_ID_BATCH) {
    const idBatch = prickleIds.slice(i, i + PRICKLE_ID_BATCH);
    const rowsBatch = await fetchAllPaginated<{ prickle_id: string }>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("prickle_id")
        .eq("member_id", memberId)
        .in("prickle_id", idBatch)
        .range(offset, offset + BATCH_SIZE - 1)
    );
    attendanceRows = attendanceRows.concat(rowsBatch);
  }
  const attended = buildAttendedSet(attendanceRows);

  return commitmentRows.map((row, i) => {
    const c = commitments[i];
    const type = Array.isArray(row.prickle_types) ? row.prickle_types[0] : row.prickle_types;
    const typeName = type?.name ?? "Prickle";
    const progress = computeCommitmentProgress(c, prickles, attended, now);
    return {
      id: c.id,
      typeId: c.typeId,
      typeName,
      label: formatCommitmentLabel(typeName, c),
      dayOfWeek: c.dayOfWeek,
      startTimeLocal: c.startTimeLocal.slice(0, 5),
      timezone: c.timezone,
      startDate: c.startDate,
      endDate: commitmentEndDate(c.startDate, c.weeks),
      weeks: c.weeks,
      status: progress.effectiveStatus,
      progress,
    };
  });
}

async function slotExists(supabase: SupabaseClient, input: CommitmentInput, now: Date): Promise<boolean> {
  const { data } = await supabase
    .from("prickles")
    .select("id, type_id, start_time, end_time")
    .eq("type_id", input.typeId)
    .gte("start_time", now.toISOString())
    .lte("start_time", new Date(now.getTime() + SLOT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString())
    .limit(BATCH_SIZE);
  return ((data ?? []) as RawPrickle[]).some((p) => prickleMatchesSlot(toSlotPrickle(p), input));
}

/**
 * Commits the acting member to a recurring slot. member_id always comes from effectiveIdentity.
 * Only slots that actually exist on the upcoming schedule are accepted (checked against real
 * prickles, not trusted from the client), and a member can hold one active commitment per slot.
 */
export async function createCommitment(
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

  if (!(await slotExists(supabase, input, now))) {
    return { error: "That prickle isn't on the upcoming schedule -- pick one from the list" };
  }

  const startTimeLocal = input.startTimeLocal.slice(0, 5);
  const { data: existing } = await supabase
    .from("prickle_commitments")
    .select("id, type_id, day_of_week, start_time_local, timezone, start_date, weeks, status, cancelled_at")
    .eq("member_id", effectiveIdentity.memberId)
    .eq("type_id", input.typeId)
    .eq("day_of_week", input.dayOfWeek)
    .eq("start_time_local", startTimeLocal)
    .eq("timezone", input.timezone)
    .eq("status", "active");
  for (const row of (existing ?? []) as unknown as CommitmentRow[]) {
    const c = toCommitment(row);
    if (effectiveCommitmentStatus(c, now) === "active") {
      return {
        error: `You're already committed to this prickle through ${commitmentEndDate(c.startDate, c.weeks)}`,
      };
    }
    // Window already over but not yet flipped -- clear it so the partial unique index allows the new row.
    await supabase
      .from("prickle_commitments")
      .update({ status: "completed", updated_at: now.toISOString() })
      .eq("id", c.id)
      .eq("member_id", effectiveIdentity.memberId);
  }

  const { data: inserted, error } = await supabase
    .from("prickle_commitments")
    .insert({
      member_id: effectiveIdentity.memberId,
      type_id: input.typeId,
      day_of_week: input.dayOfWeek,
      start_time_local: startTimeLocal,
      timezone: input.timezone,
      start_date: input.startDate,
      weeks: input.weeks,
      status: "active",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: error?.message ?? "Failed to save commitment" };

  // Append-only activity signal (docs/ACTIVITY_AND_AUDIT_LOG.md): best-effort, never fails the
  // commitment that was already saved. Under sudo it's an admin acting on the member's behalf.
  const { error: activityError } = await supabase.from("member_activities").insert({
    member_id: effectiveIdentity.memberId,
    activity_type: "prickle_commitment_created",
    activity_category: "event",
    title: `Committed to ${input.weeks} week${input.weeks === 1 ? "" : "s"} of a prickle`,
    related_id: inserted.id,
    engagement_value: 3,
    occurred_at: now.toISOString(),
    source: "prickle_commitments",
    actor_kind: effectiveIdentity.isSudo ? "staff" : "member",
    actor_user_id: effectiveIdentity.isSudo ? user.id : null,
    data: {
      type_id: input.typeId,
      day_of_week: input.dayOfWeek,
      start_time_local: startTimeLocal,
      timezone: input.timezone,
      start_date: input.startDate,
      weeks: input.weeks,
    },
  });
  if (activityError) console.error("createCommitment: failed to insert member_activities row", activityError);

  revalidatePath("/my-prickles");
  return { success: true, id: inserted.id };
}

/** Cancels one of the acting member's own active commitments (never a hard delete). */
export async function cancelCommitment(id: string): Promise<{ success: true } | { error: string }> {
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

  revalidatePath("/my-prickles");
  return { success: true };
}
