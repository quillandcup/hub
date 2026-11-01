"use server";

import { getMemberDisplayName } from "@/lib/member-display-name";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import {
  generateScheduleInstanceDates,
  getMonthEnd,
  getMonthStart,
  getNextMonthStart,
  isMonthLocked,
  seedNextMonthSchedules,
  validateScheduleInput,
  zonedTimeToUtc,
  type RecurrenceType,
} from "@/lib/prickle-schedules";
import { computeHostingStats, type HostingStats } from "@/lib/hosting-stats";
import { fetchHostedPrickleRecords } from "@/lib/hosted-prickles";
import { fetchHostEligibilityByMember, hostEligibilityMessage, type HostEligibility } from "@/lib/host-eligibility";
import { ORG_TIMEZONE } from "@/lib/config";
import type { Update } from "@/lib/data/db";

import { withAction } from "@/lib/analytics/server";
const DEFAULT_TIMEZONE = ORG_TIMEZONE;

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
  return createRepos(supabase).prickleSchedules.locksOf(months);
}

/**
 * Returns the acting member's own current + next month schedules. Re-derives
 * effectiveIdentity server-side (never trusts a client-passed member id) and
 * lazily seeds next month's continuations from this month's confirmed slots
 * on the way in, per this feature's "continuity by default" design.
 */
export async function getMySchedules(): Promise<MyScheduleRow[]> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return [];

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return [];

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  if (!isMonthLocked(getNextMonthStart(now), await getLockOverrides(supabase, [nextMonth]), now)) {
    await seedNextMonthSchedules(createRepos(supabase), currentMonth, nextMonth);
  }

  const rows = await createRepos(supabase).prickleSchedules.ofHostInMonths(effectiveIdentity.memberId, [currentMonth, nextMonth]);

  return rows.map((row) => ({
    id: row.id,
    typeId: row.type_id,
    typeName: row.typeName ?? "Prickle",
    month: row.month,
    recurrenceType: row.recurrence_type as RecurrenceType,
    dayOfWeek: row.day_of_week,
    recurrenceAnchorDate: row.recurrence_anchor_date,
    weekOfMonth: row.week_of_month,
    eventDate: row.event_date,
    startTimeLocal: row.start_time_local,
    timezone: row.timezone,
    status: row.status as MyScheduleRow["status"],
    notes: row.notes,
    carriedForwardFrom: row.carried_forward_from,
  }));
}

/**
 * Whether the acting member has been a member long enough to be invited to
 * host (see lib/host-eligibility.ts). Used to swap the "Want to host?" invite
 * for a friendlier not-yet message for brand-new members. Returns null when
 * there's no acting member.
 */
export async function getMyHostEligibility(): Promise<HostEligibility | null> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return null;

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return null;

  const byMember = await fetchHostEligibilityByMember(createRepos(supabase), [effectiveIdentity.memberId], new Date());
  return byMember.get(effectiveIdentity.memberId) ?? null;
}

/**
 * Server-side enforcement of the one-full-month rule for member self-signup.
 * Returns a friendly error when `memberId` may not request to host yet, or
 * null when they may. Members who are already hosts -- they've hosted a
 * prickle, or an admin has confirmed a schedule for them (admins can assign
 * hosts directly regardless of tenure) -- are exempt, matching the UI, which
 * only shows "Settle in first" to members with no hosting history.
 */
async function selfServeHostingBlock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  now: Date
): Promise<string | null> {
  const eligibility = (await fetchHostEligibilityByMember(createRepos(supabase), [memberId], now)).get(memberId) ?? {
    eligible: false,
    tenureStartDate: null,
    eligibleOn: null,
  };
  if (eligibility.eligible) return null;

  const repos = createRepos(supabase);
  const [hostedCount, confirmedCount] = await Promise.all([repos.prickles.countHostedBy(memberId), repos.prickleSchedules.confirmedCountOf(memberId)]);
  if (hostedCount > 0 || confirmedCount > 0) return null;

  return hostEligibilityMessage(eligibility);
}

export interface HostingCalendarPrickle {
  id: string;
  host: string;
  start_time: string;
  end_time: string;
  prickle_type: string;
  attendance_count: number;
}

export interface HostingProposedSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  status: "proposed" | "confirmed";
}

export interface HostingCalendarContext {
  prickles: HostingCalendarPrickle[];
  proposedSlots: HostingProposedSlot[];
}

const DEFAULT_SLOT_DURATION_MINUTES = 60;

/**
 * Calendar context for `month`, used by the hosting-request slot picker so
 * members can see what's already taken before requesting a time. Combines
 * two sources: real calendar prickles (from Google Calendar sync, source of
 * truth for what's actually happening) and other hosts' proposed/confirmed
 * prickle_schedules for the month, expanded into concrete dates. Proposed
 * schedules don't carry a duration, so their blocks default to one hour --
 * informational only, not used for any conflict enforcement.
 */
export async function getHostingCalendarContext(month: string): Promise<HostingCalendarContext> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { prickles: [], proposedSlots: [] };

  const monthStart = new Date(`${month}T00:00:00Z`);
  const monthEnd = getMonthEnd(monthStart);
  const rangeEnd = new Date(monthEnd.getTime() + 24 * 60 * 60 * 1000);

  const repos = createRepos(supabase);
  const [monthPrickles, scheduleRows] = await Promise.all([
    repos.prickles.startingBetween({ from: monthStart.toISOString(), to: rangeEnd.toISOString() }),
    repos.prickleSchedules.slotsOfMonth(month),
  ]);

  const prickles: HostingCalendarPrickle[] = monthPrickles.map((p) => ({
    id: p.id,
    host: p.host ? getMemberDisplayName({ name: p.host.name, display_name: p.host.displayName }) : "",
    start_time: p.startTime,
    end_time: p.endTime,
    prickle_type: p.type?.name ?? "Prickle",
    attendance_count: 0,
  }));

  const proposedSlots: HostingProposedSlot[] = [];
  for (const row of scheduleRows) {
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: row.recurrence_type as RecurrenceType,
        dayOfWeek: row.day_of_week,
        recurrenceAnchorDate: row.recurrence_anchor_date,
        weekOfMonth: row.week_of_month,
        eventDate: row.event_date,
        startTimeLocal: row.start_time_local,
        timezone: row.timezone,
      },
      monthStart,
      monthEnd
    );
    for (const date of dates) {
      const dateStr = date.toISOString().slice(0, 10);
      const start = zonedTimeToUtc(dateStr, row.start_time_local.slice(0, 5), row.timezone);
      const end = new Date(start.getTime() + DEFAULT_SLOT_DURATION_MINUTES * 60000);
      proposedSlots.push({
        id: `${row.id}-${dateStr}`,
        label: `${row.typeName ?? "Prickle"} — ${row.host ? getMemberDisplayName(row.host) : "a host"}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: row.status as HostingProposedSlot["status"],
      });
    }
  }

  return { prickles, proposedSlots };
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
async function requestToHostImpl(
  input: RequestToHostInput
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
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

  const type = (await createRepos(supabase).prickles.types()).find((t) => t.id === input.typeId);
  if (!type?.requiresHost) return { error: "This prickle type doesn't take a host" };

  const monthDate = new Date(`${input.month}T00:00:00Z`);
  const overrides = await getLockOverrides(supabase, [input.month]);
  if (isMonthLocked(monthDate, overrides, new Date())) {
    return { error: "This month is locked -- ask an admin to unlock it, or request next month instead" };
  }

  const eligibilityError = await selfServeHostingBlock(supabase, effectiveIdentity.memberId, new Date());
  if (eligibilityError) return { error: eligibilityError };

  try {
    await createRepos(supabase).prickleSchedules.insert([
      {
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
      },
    ]);
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/my-prickles", "layout");
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
async function updateMyScheduleImpl(
  id: string,
  patch: UpdateScheduleInput
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const schedules = createRepos(supabase).prickleSchedules;
  const existing = await schedules.liveById(id);

  if (!existing || existing.host_id !== effectiveIdentity.memberId) {
    return { error: "Schedule not found" };
  }

  const overrides = await getLockOverrides(supabase, [existing.month]);
  if (isMonthLocked(new Date(`${existing.month}T00:00:00Z`), overrides, new Date())) {
    return { error: "This month is locked -- ask an admin to unlock it" };
  }

  const updates: Update<"prickle_schedules"> = { updated_by: user.id, updated_at: new Date().toISOString() };
  if (patch.dayOfWeek !== undefined) updates.day_of_week = patch.dayOfWeek;
  if (patch.recurrenceAnchorDate !== undefined) updates.recurrence_anchor_date = patch.recurrenceAnchorDate;
  if (patch.weekOfMonth !== undefined) updates.week_of_month = patch.weekOfMonth;
  if (patch.eventDate !== undefined) updates.event_date = patch.eventDate;
  if (patch.startTimeLocal !== undefined) updates.start_time_local = patch.startTimeLocal;
  if (patch.timezone !== undefined) updates.timezone = patch.timezone;
  if (patch.notes !== undefined) updates.notes = patch.notes.trim() || null;

  try {
    await schedules.update(id, updates, { hostId: effectiveIdentity.memberId });
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/my-prickles", "layout");
  return { success: true };
}

/** Soft delete, scoped to the acting member's own unlocked-month rows. */
async function withdrawMyScheduleImpl(id: string): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const schedules = createRepos(supabase).prickleSchedules;
  const existing = await schedules.liveById(id);

  if (!existing || existing.host_id !== effectiveIdentity.memberId) {
    return { error: "Schedule not found" };
  }

  const overrides = await getLockOverrides(supabase, [existing.month]);
  if (isMonthLocked(new Date(`${existing.month}T00:00:00Z`), overrides, new Date())) {
    return { error: "This month is locked -- ask an admin to unlock it" };
  }

  try {
    await schedules.update(id, { deleted_at: new Date().toISOString(), deleted_by: user.id }, { hostId: effectiveIdentity.memberId });
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/my-prickles", "layout");
  return { success: true };
}

/**
 * All-time hosting attendance stats for the acting member -- how many prickles they've hosted,
 * on-time vs. late (>5 min, same threshold as the admin calendar) vs. no-show, and a 12-month
 * trend. Re-derives effectiveIdentity server-side, same as getMySchedules. The paginated fetch
 * lives in lib/hosted-prickles.ts, shared with the public member profile.
 */
export async function getMyHostingStats(): Promise<HostingStats> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return computeHostingStats([]);

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return computeHostingStats([]);

  const records = await fetchHostedPrickleRecords(supabase, effectiveIdentity.memberId);
  return computeHostingStats(records);
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function requestToHost(...args: Parameters<typeof requestToHostImpl>): ReturnType<typeof requestToHostImpl> {
  return withAction("host_requested", () => requestToHostImpl(...args));
}

export async function updateMySchedule(...args: Parameters<typeof updateMyScheduleImpl>): ReturnType<typeof updateMyScheduleImpl> {
  return withAction("hosting_schedule_updated", () => updateMyScheduleImpl(...args));
}

export async function withdrawMySchedule(...args: Parameters<typeof withdrawMyScheduleImpl>): ReturnType<typeof withdrawMyScheduleImpl> {
  return withAction("hosting_schedule_withdrawn", () => withdrawMyScheduleImpl(...args));
}
