"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import {
  getMonthStart,
  getNextMonthStart,
  isMonthLocked,
  seedNextMonthSchedules,
  validateScheduleInput,
  type RecurrenceType,
} from "@/lib/prickle-schedules";

const DEFAULT_TIMEZONE = "America/New_York";

export interface MyScheduleRow {
  id: string;
  typeId: string;
  typeName: string;
  month: string;
  recurrenceType: RecurrenceType;
  dayOfWeek: number | null;
  recurrenceAnchorDate: string | null;
  weekOfMonth: number | null;
  eventDate: string | null;
  startTimeLocal: string;
  timezone: string;
  status: "proposed" | "confirmed" | "declined";
  notes: string | null;
  carriedForwardFrom: string | null;
}

async function getLockOverrides(supabase: Awaited<ReturnType<typeof createClient>>, months: string[]) {
  const { data } = await supabase.from("prickle_schedule_locks").select("month, locked").in("month", months);
  return data ?? [];
}

/**
 * Returns the acting member's own current + next month schedules. Re-derives
 * effectiveIdentity server-side (never trusts a client-passed member id) and
 * lazily seeds next month's continuations from this month's confirmed slots
 * on the way in, per this feature's "continuity by default" design.
 */
export async function getMySchedules(): Promise<MyScheduleRow[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return [];

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  if (!isMonthLocked(getNextMonthStart(now), await getLockOverrides(supabase, [nextMonth]), now)) {
    await seedNextMonthSchedules(supabase, currentMonth, nextMonth);
  }

  const { data } = await supabase
    .from("prickle_schedules")
    .select("*, prickle_types(name)")
    .eq("host_id", effectiveIdentity.memberId)
    .in("month", [currentMonth, nextMonth])
    .is("deleted_at", null)
    .order("month")
    .order("created_at");

  return (data ?? []).map((row: any) => ({
    id: row.id,
    typeId: row.type_id,
    typeName: row.prickle_types?.name ?? "Prickle",
    month: row.month,
    recurrenceType: row.recurrence_type,
    dayOfWeek: row.day_of_week,
    recurrenceAnchorDate: row.recurrence_anchor_date,
    weekOfMonth: row.week_of_month,
    eventDate: row.event_date,
    startTimeLocal: row.start_time_local,
    timezone: row.timezone,
    status: row.status,
    notes: row.notes,
    carriedForwardFrom: row.carried_forward_from,
  }));
}

export interface RequestToHostInput {
  month: string;
  typeId: string;
  recurrenceType: RecurrenceType;
  dayOfWeek?: number | null;
  recurrenceAnchorDate?: string | null;
  weekOfMonth?: number | null;
  eventDate?: string | null;
  startTimeLocal: string;
  timezone?: string;
  notes?: string;
}

/**
 * Members can never self-confirm -- this always inserts status: 'proposed',
 * and host_id always comes from effectiveIdentity.memberId regardless of
 * anything the client passes. Rejects with a readable message if the target
 * month is already locked (RLS would also reject it, but this gives the UI
 * something better than a raw Postgres error).
 */
export async function requestToHost(
  input: RequestToHostInput
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const validationError = validateScheduleInput({
    typeId: input.typeId,
    month: input.month,
    recurrenceType: input.recurrenceType,
    dayOfWeek: input.dayOfWeek ?? null,
    recurrenceAnchorDate: input.recurrenceAnchorDate ?? null,
    weekOfMonth: input.weekOfMonth ?? null,
    eventDate: input.eventDate ?? null,
    startTimeLocal: input.startTimeLocal,
  });
  if (validationError) return { error: validationError };

  const { data: type } = await supabase
    .from("prickle_types")
    .select("requires_host")
    .eq("id", input.typeId)
    .single();
  if (!type?.requires_host) return { error: "This prickle type doesn't take a host" };

  const monthDate = new Date(`${input.month}T00:00:00Z`);
  const overrides = await getLockOverrides(supabase, [input.month]);
  if (isMonthLocked(monthDate, overrides, new Date())) {
    return { error: "This month is locked -- ask an admin to unlock it, or request next month instead" };
  }

  const { error } = await supabase.from("prickle_schedules").insert({
    host_id: effectiveIdentity.memberId,
    type_id: input.typeId,
    month: input.month,
    recurrence_type: input.recurrenceType,
    day_of_week: input.dayOfWeek ?? null,
    recurrence_anchor_date: input.recurrenceAnchorDate ?? null,
    week_of_month: input.weekOfMonth ?? null,
    event_date: input.eventDate ?? null,
    start_time_local: input.startTimeLocal,
    timezone: input.timezone || DEFAULT_TIMEZONE,
    notes: input.notes?.trim() || null,
    status: "proposed",
    updated_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/hosting");
  return { success: true };
}

export interface UpdateScheduleInput {
  dayOfWeek?: number | null;
  recurrenceAnchorDate?: string | null;
  weekOfMonth?: number | null;
  eventDate?: string | null;
  startTimeLocal?: string;
  timezone?: string;
  notes?: string;
}

/**
 * Scoped to the acting member's own rows (re-verified here, not just trusted
 * from the UI) and to unlocked months. Never accepts status/confirmed_* --
 * those aren't parameters this function takes at all, so there's nothing to
 * strip; confirmation is admin-only, via /admin/hosts.
 */
export async function updateMySchedule(
  id: string,
  patch: UpdateScheduleInput
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const { data: existing } = await supabase
    .from("prickle_schedules")
    .select("id, host_id, month")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!existing || existing.host_id !== effectiveIdentity.memberId) {
    return { error: "Schedule not found" };
  }

  const overrides = await getLockOverrides(supabase, [existing.month]);
  if (isMonthLocked(new Date(`${existing.month}T00:00:00Z`), overrides, new Date())) {
    return { error: "This month is locked -- ask an admin to unlock it" };
  }

  const updates: Record<string, unknown> = { updated_by: user.id, updated_at: new Date().toISOString() };
  if (patch.dayOfWeek !== undefined) updates.day_of_week = patch.dayOfWeek;
  if (patch.recurrenceAnchorDate !== undefined) updates.recurrence_anchor_date = patch.recurrenceAnchorDate;
  if (patch.weekOfMonth !== undefined) updates.week_of_month = patch.weekOfMonth;
  if (patch.eventDate !== undefined) updates.event_date = patch.eventDate;
  if (patch.startTimeLocal !== undefined) updates.start_time_local = patch.startTimeLocal;
  if (patch.timezone !== undefined) updates.timezone = patch.timezone;
  if (patch.notes !== undefined) updates.notes = patch.notes.trim() || null;

  const { error } = await supabase
    .from("prickle_schedules")
    .update(updates)
    .eq("id", id)
    .eq("host_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/hosting");
  return { success: true };
}

/** Soft delete, scoped to the acting member's own unlocked-month rows. */
export async function withdrawMySchedule(id: string): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const { data: existing } = await supabase
    .from("prickle_schedules")
    .select("id, host_id, month")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!existing || existing.host_id !== effectiveIdentity.memberId) {
    return { error: "Schedule not found" };
  }

  const overrides = await getLockOverrides(supabase, [existing.month]);
  if (isMonthLocked(new Date(`${existing.month}T00:00:00Z`), overrides, new Date())) {
    return { error: "This month is locked -- ask an admin to unlock it" };
  }

  const { error } = await supabase
    .from("prickle_schedules")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq("id", id)
    .eq("host_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/hosting");
  return { success: true };
}
