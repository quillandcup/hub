"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { safeUrl } from "@/lib/url";
import { validateBookInput } from "@/lib/bookValidation";
import { getMyBooks, type BookInput, type MyBookRow } from "@/app/(member)/bookshelf/actions";
import {
  WRITING_MEASURES,
  computeCumulativeTotal,
  computeCumulativeSeries,
  computeGoalProgress,
  computeHabitGoalProgress,
  derivePrickleHabitEntries,
  type WritingMeasure,
  type EntryMode,
  type HabitPeriod,
  type PrickleAttendanceRow,
} from "@/lib/writing-projects";
import { computePrickleStreaks, seriesKeyFor } from "@/lib/streaks";
import { getUserTimezonePreference } from "@/lib/timezone";
import { DAY_NAMES, formatScheduleLabel, getMonthStart, getNextMonthStart } from "@/lib/prickle-schedules";

const PHASES = ["planning", "drafting", "revising", "on_hold", "complete", "published", "abandoned"] as const;
type Phase = (typeof PHASES)[number];

const HABIT_PERIODS: HabitPeriod[] = ["day", "week", "month"];
const ORG_TIMEZONE = "America/New_York"; // mirrors the same fallback convention used in app/(member)/dashboard/page.tsx

export interface WritingProjectRow {
  id: string;
  title: string;
  phase: Phase;
  createdAt: string;
  showOnProfile: boolean;
  totalsByMeasure: Partial<Record<WritingMeasure, number>>;
  goals: GoalRow[];
  /** The linked Bookshelf entry once this project has been published, else null. */
  book: MyBookRow | null;
}

export interface EntryRow {
  id: string;
  projectId: string;
  entryDate: string;
  measure: WritingMeasure;
  mode: EntryMode;
  amount: number;
  note: string | null;
  tags: string[];
  createdAt: string;
  prickleId: string | null;
}

interface GoalRowBase {
  id: string;
  projectId: string;
  measure: WritingMeasure;
  isStarred: boolean;
  /** e.g. "<host>'s Progress Prickle" -- only set for measure='prickles' goals with an anchor. */
  anchorLabel: string | null;
}

export interface TargetGoalRow extends GoalRowBase {
  kind: "target";
  targetAmount: number;
  startDate: string | null;
  endDate: string | null;
  current: number;
  percent: number;
  parTarget: number | null;
  onPace: boolean | null;
}

export interface HabitGoalRow extends GoalRowBase {
  kind: "habit";
  habitPeriod: HabitPeriod;
  habitThreshold: number | null;
  currentStreak: number;
  longestStreak: number;
  typicalStreak: number;
  hitRatePercent: number;
}

export type GoalRow = TargetGoalRow | HabitGoalRow;

type IdentityContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      effectiveIdentity: NonNullable<Awaited<ReturnType<typeof getEffectiveIdentity>>>;
    };

async function requireIdentity(): Promise<IdentityContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  return { supabase, effectiveIdentity };
}

/** All of the acting member's projects, each with a per-measure cumulative total and its goals' live progress. */
/**
 * This member's attendance at writing-purpose prickles, reduced to local calendar dates --
 * the raw material derivePrickleHabitEntries filters per goal-anchor. purpose='writing' is
 * enforced here, at the query, not in app code downstream (see Writing-only scope in the plan).
 */
export async function getMyPrickleAttendance(): Promise<PrickleAttendanceRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const tzPref = await getUserTimezonePreference();
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;

  const { data } = await supabase
    .from("prickle_attendance")
    .select("prickles!inner(type_id, host, start_time, prickle_types!inner(purpose))")
    .eq("member_id", effectiveIdentity.memberId)
    .eq("prickles.prickle_types.purpose", "writing");

  return ((data ?? []) as any[])
    .map((r) => {
      const prickle = Array.isArray(r.prickles) ? r.prickles[0] : r.prickles;
      if (!prickle?.type_id || !prickle?.start_time) return null;
      return {
        typeId: prickle.type_id as string,
        hostId: (prickle.host as string | null) ?? null,
        localDate: new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(prickle.start_time as string)),
      };
    })
    .filter((r): r is PrickleAttendanceRow => r !== null);
}

export interface AnchorOption {
  scheduleId: string;
  label: string; // formatScheduleLabel(...) + host name, e.g. "Progress Prickle · every Monday · 5:00 PM ET — hosted by <host>"
  reasons: { kind: "hosting" | "streak" | "lostStreak"; tooltip: string[] }[];
}

/**
 * Ranked, badge-annotated options for the prickles-measure anchor picker -- mirrors the exact
 * priority scheme app/(member)/dashboard/page.tsx already uses for its "Upcoming Prickles" list
 * (hosting first, then active streaks longest-first, then lost streaks longest-first, then
 * everything else), reusing computePrickleStreaks/seriesKeyFor so this doesn't duplicate that
 * ranking logic. Search is client-side (see UI) -- this just returns every confirmed
 * writing-purpose schedule for the current/next month, ranked.
 */
export async function getPrickleAnchorOptions(): Promise<AnchorOption[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  const tzPref = await getUserTimezonePreference();
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;

  const [{ data: schedules }, { data: myAttendanceRows }] = await Promise.all([
    supabase
      .from("prickle_schedules")
      .select(
        "id, host_id, day_of_week, recurrence_anchor_date, week_of_month, event_date, recurrence_type, start_time_local, timezone, prickle_types!inner(name, purpose), members:host_id(name)"
      )
      .in("month", [currentMonth, nextMonth])
      .eq("status", "confirmed")
      .eq("prickle_types.purpose", "writing")
      .is("deleted_at", null),
    supabase
      .from("prickle_attendance")
      .select("join_time, prickles!inner(start_time, type_id, prickle_types!inner(name, purpose))")
      .eq("member_id", effectiveIdentity.memberId)
      .eq("prickles.prickle_types.purpose", "writing"),
  ]);

  const prickleStreaks = computePrickleStreaks(
    ((myAttendanceRows ?? []) as any[])
      .map((r) => {
        const prickle = Array.isArray(r.prickles) ? r.prickles[0] : r.prickles;
        const type = prickle ? (Array.isArray(prickle.prickle_types) ? prickle.prickle_types[0] : prickle.prickle_types) : null;
        return type?.name && prickle?.start_time
          ? { prickleTypeName: type.name as string, joinTime: r.join_time as string, prickleStartTime: prickle.start_time as string }
          : null;
      })
      .filter((r): r is { prickleTypeName: string; joinTime: string; prickleStartTime: string } => r !== null),
    now,
    timeZone
  );

  const activeStreakBySeries = new Map<string, number>();
  const lostStreakBySeries = new Map<string, number>();
  for (const s of prickleStreaks) {
    const key = seriesKeyFor(s.prickleTypeName, s.dayOfWeek, s.startHour);
    if (s.currentStreak > 0) activeStreakBySeries.set(key, s.currentStreak);
    else if (s.longestStreak >= 2) lostStreakBySeries.set(key, s.longestStreak);
  }

  type Ranked = { option: AnchorOption; priority: number; sortValue: number };

  const ranked: Ranked[] = ((schedules ?? []) as any[]).map((row) => {
    const type = Array.isArray(row.prickle_types) ? row.prickle_types[0] : row.prickle_types;
    const host = Array.isArray(row.members) ? row.members[0] : row.members;
    const typeName = type?.name ?? "Prickle";
    const hostName = host?.name ?? "someone";
    const label = `${formatScheduleLabel(typeName, {
      recurrenceType: row.recurrence_type,
      dayOfWeek: row.day_of_week,
      recurrenceAnchorDate: row.recurrence_anchor_date,
      weekOfMonth: row.week_of_month,
      eventDate: row.event_date,
      startTimeLocal: row.start_time_local,
      timezone: row.timezone,
    })} — hosted by ${hostName}`;

    const reasons: AnchorOption["reasons"] = [];
    let priority = 3;
    let sortValue = typeName.localeCompare(hostName);

    if (row.host_id === effectiveIdentity.memberId) {
      reasons.push({ kind: "hosting", tooltip: ["You're hosting this one"] });
      priority = 0;
      sortValue = 0;
    }

    if (row.day_of_week != null) {
      const startHour = parseInt(String(row.start_time_local).slice(0, 2), 10);
      const seriesKey = seriesKeyFor(typeName, DAY_NAMES[row.day_of_week], startHour);

      const streakWeeks = activeStreakBySeries.get(seriesKey);
      if (streakWeeks && priority > 1) {
        reasons.push({ kind: "streak", tooltip: [`${streakWeeks}-week streak here`] });
        priority = 1;
        sortValue = -streakWeeks;
      }

      const lostStreakWeeks = lostStreakBySeries.get(seriesKey);
      if (lostStreakWeeks && priority > 2) {
        reasons.push({ kind: "lostStreak", tooltip: [`Lost a ${lostStreakWeeks}-week streak here`] });
        priority = 2;
        sortValue = -lostStreakWeeks;
      }
    }

    return { option: { scheduleId: row.id, label, reasons }, priority, sortValue };
  });

  ranked.sort((a, b) => a.priority - b.priority || a.sortValue - b.sortValue);
  return ranked.map((r) => r.option);
}

export async function getMyProjects(): Promise<WritingProjectRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: projects }, { data: entries }, { data: goals }, attendance, books] = await Promise.all([
    supabase
      .from("writing_projects")
      .select("id, title, phase, created_at, show_on_profile")
      .eq("member_id", effectiveIdentity.memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at")
      .eq("member_id", effectiveIdentity.memberId),
    supabase
      .from("writing_goals")
      .select(GOAL_SELECT_COLUMNS)
      .eq("member_id", effectiveIdentity.memberId)
      .is("archived_at", null),
    getMyPrickleAttendance(),
    getMyBooks(),
  ]);

  return buildProjectRows(projects ?? [], entries ?? [], (goals ?? []) as unknown as RawGoal[], attendance, books);
}

export async function getProject(
  projectId: string
): Promise<{ project: WritingProjectRow; entries: EntryRow[] } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: projectRow }, { data: entryRows }, { data: goalRows }, attendance, books] = await Promise.all([
    supabase
      .from("writing_projects")
      .select("id, title, phase, created_at, show_on_profile")
      .eq("id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .single(),
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at, prickle_id")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("writing_goals")
      .select(GOAL_SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .is("archived_at", null),
    getMyPrickleAttendance(),
    getMyBooks(),
  ]);

  if (!projectRow) return { error: "Project not found" };

  const [project] = buildProjectRows([projectRow], entryRows ?? [], (goalRows ?? []) as unknown as RawGoal[], attendance, books);
  const entries: EntryRow[] = (entryRows ?? []).map(toEntryRow);

  return { project, entries };
}

interface RawProject {
  id: string;
  title: string;
  phase: string;
  created_at: string;
  show_on_profile: boolean;
}

interface RawEntry {
  id: string;
  project_id: string;
  entry_date: string;
  measure: string;
  mode: string;
  amount: number;
  note: string | null;
  tags: string[] | null;
  created_at: string;
  prickle_id?: string | null;
}

interface RawGoal {
  id: string;
  project_id: string;
  goal_type: string;
  measure: string;
  target_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  habit_period: string | null;
  habit_threshold: number | null;
  is_starred: boolean;
  anchor_type_id: string | null;
  anchor_host_id: string | null;
  anchor_day_of_week: number | null;
  anchor_type?: { name: string } | { name: string }[] | null;
  anchor_host?: { name: string } | { name: string }[] | null;
}

const GOAL_SELECT_COLUMNS =
  "id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred, anchor_type_id, anchor_host_id, anchor_day_of_week, anchor_type:anchor_type_id(name), anchor_host:anchor_host_id(name)";

function singleRelation<T>(rel: T | T[] | null | undefined): T | null {
  return Array.isArray(rel) ? rel[0] ?? null : rel ?? null;
}

function buildAnchorLabel(g: RawGoal): string | null {
  if (g.measure !== "prickles") return null;
  const typeName = singleRelation(g.anchor_type)?.name;
  const hostName = singleRelation(g.anchor_host)?.name;
  if (typeName && hostName) return `${hostName}'s ${typeName}`;
  if (typeName) return typeName;
  if (hostName) return `Hosted by ${hostName}`;
  return null;
}

function buildGoalRow(
  g: RawGoal,
  projectEntries: RawEntry[],
  now: Date,
  attendance: PrickleAttendanceRow[]
): GoalRow {
  const measureEntries =
    g.measure === "prickles"
      ? derivePrickleHabitEntries(attendance, {
          typeId: g.anchor_type_id,
          hostId: g.anchor_host_id,
          dayOfWeek: g.anchor_day_of_week,
        }).map((e) => ({ entryDate: e.entryDate, amount: e.amount, createdAt: e.entryDate, mode: "delta" as EntryMode }))
      : projectEntries
          .filter((e) => e.measure === g.measure)
          .map((e) => ({ entryDate: e.entry_date, amount: e.amount, createdAt: e.created_at, mode: e.mode as EntryMode }));

  const base = {
    id: g.id,
    projectId: g.project_id,
    measure: g.measure as WritingMeasure,
    isStarred: g.is_starred,
    anchorLabel: buildAnchorLabel(g),
  };

  if (g.goal_type === "habit") {
    const progress = computeHabitGoalProgress({
      entries: measureEntries.map((e) => ({ entryDate: e.entryDate, amount: e.amount })),
      period: (g.habit_period as HabitPeriod) ?? "week",
      threshold: g.habit_threshold,
      now,
    });
    return {
      ...base,
      kind: "habit",
      habitPeriod: (g.habit_period as HabitPeriod) ?? "week",
      habitThreshold: g.habit_threshold,
      ...progress,
    };
  }

  const progress = computeGoalProgress({
    entries: measureEntries,
    targetAmount: g.target_amount ?? 0,
    startDate: g.start_date,
    endDate: g.end_date,
    now,
  });
  return {
    ...base,
    kind: "target",
    targetAmount: g.target_amount ?? 0,
    startDate: g.start_date,
    endDate: g.end_date,
    ...progress,
  };
}

function buildProjectRows(
  projects: RawProject[],
  entries: RawEntry[],
  goals: RawGoal[],
  attendance: PrickleAttendanceRow[],
  books: MyBookRow[]
): WritingProjectRow[] {
  const now = new Date();

  return projects.map((project) => {
    const projectEntries = entries.filter((e) => e.project_id === project.id);

    const totalsByMeasure: Partial<Record<WritingMeasure, number>> = {};
    for (const measure of WRITING_MEASURES) {
      const measureEntries = projectEntries.filter((e) => e.measure === measure);
      if (measureEntries.length === 0) continue;
      totalsByMeasure[measure] = computeCumulativeTotal(
        measureEntries.map((e) => ({
          entryDate: e.entry_date,
          createdAt: e.created_at,
          mode: e.mode as EntryMode,
          amount: e.amount,
        }))
      );
    }

    const projectGoals = goals
      .filter((g) => g.project_id === project.id)
      .map((g) => buildGoalRow(g, projectEntries, now, attendance));

    return {
      id: project.id,
      title: project.title,
      phase: project.phase as Phase,
      createdAt: project.created_at,
      showOnProfile: project.show_on_profile,
      totalsByMeasure,
      goals: projectGoals,
      book: books.find((b) => b.projectId === project.id) ?? null,
    };
  });
}

function toEntryRow(e: RawEntry): EntryRow {
  return {
    id: e.id,
    projectId: e.project_id,
    entryDate: e.entry_date,
    measure: e.measure as WritingMeasure,
    mode: e.mode as EntryMode,
    amount: e.amount,
    note: e.note,
    tags: e.tags ?? [],
    createdAt: e.created_at,
    prickleId: e.prickle_id ?? null,
  };
}

export async function createProject(
  title: string,
  phase: Phase = "drafting"
): Promise<{ success: true; id: string } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = title.trim();
  if (!trimmed) return { error: "Title is required" };
  if (!PHASES.includes(phase)) return { error: "Invalid phase" };

  const { data, error } = await supabase
    .from("writing_projects")
    .insert({ member_id: effectiveIdentity.memberId, title: trimmed, phase })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create project" };

  revalidatePath("/projects");
  return { success: true, id: data.id };
}

export async function toggleProjectVisibility(
  projectId: string,
  showOnProfile: boolean
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { error } = await supabase
    .from("writing_projects")
    .update({ show_on_profile: showOnProfile })
    .eq("id", projectId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

export interface LogProgressInput {
  projectId: string;
  entryDate: string;
  measure: WritingMeasure;
  mode: EntryMode;
  amount: number;
  note?: string;
  tags?: string[];
  prickleId?: string;
}

async function assertOwnsProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("writing_projects")
    .select("id")
    .eq("id", projectId)
    .eq("member_id", memberId)
    .single();
  return data ? null : "Project not found";
}

/**
 * Marks a project published in the same step as collecting its Bookshelf details -- the
 * "Publish" action on the Projects UI. A project can never end up phase='published' without a
 * linked member_books row: there's no other way to set this phase (see PHASES/the plan doc).
 */
export async function publishProject(
  projectId: string,
  book: BookInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const ownershipError = await assertOwnsProject(supabase, effectiveIdentity.memberId, projectId);
  if (ownershipError) return { error: ownershipError };

  const validationError = validateBookInput(book);
  if (validationError) return { error: validationError };

  const { error: insertError } = await supabase.from("member_books").insert({
    member_id: effectiveIdentity.memberId,
    project_id: projectId,
    title: book.title.trim(),
    description: book.description?.trim() || null,
    cover_url: safeUrl(book.coverUrl),
    purchase_url: safeUrl(book.purchaseUrl),
    published_date: book.publishedDate,
    price: book.price ?? null,
    genre: book.genre?.trim() || null,
    format: book.format,
  });

  if (insertError) {
    if (insertError.code === "23505") return { error: "This project has already been published." };
    return { error: insertError.message };
  }

  const { error: updateError } = await supabase
    .from("writing_projects")
    .update({ phase: "published" })
    .eq("id", projectId)
    .eq("member_id", effectiveIdentity.memberId);

  if (updateError) return { error: updateError.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/bookshelf");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

function validateEntryInput(input: {
  projectId?: string;
  entryDate?: string;
  measure?: string;
  mode?: string;
  amount?: number;
}): string | null {
  if (!input.projectId) return "projectId is required";
  if (!input.entryDate) return "entryDate is required";
  if (!input.measure || !WRITING_MEASURES.includes(input.measure as WritingMeasure)) {
    return "measure must be one of: " + WRITING_MEASURES.join(", ");
  }
  if (input.mode !== "delta" && input.mode !== "set_total") return "mode must be 'delta' or 'set_total'";
  if (input.amount === undefined || Number.isNaN(input.amount)) return "amount is required";
  return null;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export async function logProgress(
  input: LogProgressInput
): Promise<{ success: true; id: string } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const validationError = validateEntryInput(input);
  if (validationError) return { error: validationError };

  const ownershipError = await assertOwnsProject(supabase, effectiveIdentity.memberId, input.projectId);
  if (ownershipError) return { error: ownershipError };

  const { data, error } = await supabase
    .from("writing_progress_entries")
    .insert({
      project_id: input.projectId,
      member_id: effectiveIdentity.memberId,
      entry_date: input.entryDate,
      measure: input.measure,
      mode: input.mode,
      amount: input.amount,
      note: input.note?.trim() || null,
      tags: normalizeTags(input.tags),
      prickle_id: input.prickleId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to log progress" };

  // Phase 1, item 11: every progress entry is also an engagement signal -- see the identical
  // insert in app/api/webhooks/slack/interactions/route.ts's writing_quick_log flow, which
  // is a different entry point into the same writing_progress_entries table. Best-effort: a
  // failure here must never fail the entry that was already successfully saved.
  const { error: activityError } = await supabase.from("member_activities").insert({
    member_id: effectiveIdentity.memberId,
    activity_type: "writing_progress_logged",
    activity_category: "writing",
    title: "Logged writing progress",
    related_id: data.id,
    engagement_value: 5,
    occurred_at: new Date().toISOString(),
    source: "writing_progress",
  });
  if (activityError) console.error("logProgress: failed to insert member_activities row", activityError);

  revalidatePath("/projects");
  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath("/dashboard");
  return { success: true, id: data.id };
}

export type UpdateEntryInput = Partial<
  Pick<LogProgressInput, "entryDate" | "measure" | "mode" | "amount" | "note" | "tags">
>;

export async function updateEntry(
  entryId: string,
  patch: UpdateEntryInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_progress_entries")
    .select("id, project_id, member_id")
    .eq("id", entryId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Entry not found" };
  }

  const validationError = validateEntryInput({
    projectId: existing.project_id,
    entryDate: patch.entryDate,
    measure: patch.measure,
    mode: patch.mode,
    amount: patch.amount,
  });
  if (validationError) return { error: validationError };

  const updates: Record<string, unknown> = {};
  if (patch.entryDate !== undefined) updates.entry_date = patch.entryDate;
  if (patch.measure !== undefined) updates.measure = patch.measure;
  if (patch.mode !== undefined) updates.mode = patch.mode;
  if (patch.amount !== undefined) updates.amount = patch.amount;
  if (patch.note !== undefined) updates.note = patch.note.trim() || null;
  if (patch.tags !== undefined) updates.tags = normalizeTags(patch.tags);

  const { error } = await supabase
    .from("writing_progress_entries")
    .update(updates)
    .eq("id", entryId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteEntry(entryId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_progress_entries")
    .select("id, project_id, member_id")
    .eq("id", entryId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Entry not found" };
  }

  const { error } = await supabase
    .from("writing_progress_entries")
    .delete()
    .eq("id", entryId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  // Phase 1, item 11: don't let a deleted (e.g. bogus) entry permanently inflate engagement.
  // Best-effort: the entry itself is already gone, so a failure here must not turn this into
  // an error response.
  const { error: activityDeleteError } = await supabase
    .from("member_activities")
    .delete()
    .eq("related_id", entryId)
    .eq("source", "writing_progress");
  if (activityDeleteError) console.error("deleteEntry: failed to delete member_activities row", activityDeleteError);

  revalidatePath("/projects");
  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export interface CreateGoalInput {
  projectId: string;
  measure: WritingMeasure;
  goalType: "target" | "habit";
  // target
  targetAmount?: number;
  startDate?: string | null;
  endDate?: string | null;
  // habit
  habitPeriod?: HabitPeriod;
  habitThreshold?: number | null;
  // prickles anchor -- id of a confirmed prickle_schedules row, or null/omitted for "any writing prickle"
  anchorScheduleId?: string | null;
}

interface ResolvedAnchor {
  scheduleId: string | null;
  typeId: string | null;
  hostId: string | null;
  dayOfWeek: number | null;
}

const NULL_ANCHOR: ResolvedAnchor = { scheduleId: null, typeId: null, hostId: null, dayOfWeek: null };

/**
 * Resolves anchorScheduleId server-side into a snapshot -- never trusts client-provided
 * type/host/day directly (same principle app/(member)/hosting/actions.ts already applies to
 * status/confirmed_by). Only a currently-confirmed schedule is a valid anchor target.
 */
async function resolveAnchor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  anchorScheduleId: string | null | undefined
): Promise<ResolvedAnchor | { error: string }> {
  if (!anchorScheduleId) return NULL_ANCHOR;

  const { data } = await supabase
    .from("prickle_schedules")
    .select("id, type_id, host_id, day_of_week")
    .eq("id", anchorScheduleId)
    .eq("status", "confirmed")
    .is("deleted_at", null)
    .single();

  if (!data) return { error: "That schedule isn't a currently-confirmed prickle" };

  return { scheduleId: data.id, typeId: data.type_id, hostId: data.host_id, dayOfWeek: data.day_of_week };
}

function anchorsMatch(a: ResolvedAnchor, b: ResolvedAnchor): boolean {
  return a.typeId === b.typeId && a.hostId === b.hostId && a.dayOfWeek === b.dayOfWeek;
}

interface GoalFieldValues {
  goal_type: "target" | "habit";
  measure: WritingMeasure;
  target_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  habit_period: HabitPeriod | null;
  habit_threshold: number | null;
  anchor_schedule_id: string | null;
  anchor_type_id: string | null;
  anchor_host_id: string | null;
  anchor_day_of_week: number | null;
}

/** Shared validation + field-shaping for both createGoal and updateGoal's archive-and-fork insert. */
function buildGoalFields(
  goalType: "target" | "habit",
  measure: WritingMeasure,
  fields: Pick<CreateGoalInput, "targetAmount" | "startDate" | "endDate" | "habitPeriod" | "habitThreshold">,
  anchor: ResolvedAnchor
): GoalFieldValues | { error: string } {
  const base = {
    goal_type: goalType,
    measure,
    anchor_schedule_id: measure === "prickles" ? anchor.scheduleId : null,
    anchor_type_id: measure === "prickles" ? anchor.typeId : null,
    anchor_host_id: measure === "prickles" ? anchor.hostId : null,
    anchor_day_of_week: measure === "prickles" ? anchor.dayOfWeek : null,
  };

  if (goalType === "habit") {
    if (!fields.habitPeriod || !HABIT_PERIODS.includes(fields.habitPeriod)) {
      return { error: "habitPeriod must be one of: " + HABIT_PERIODS.join(", ") };
    }
    return {
      ...base,
      habit_period: fields.habitPeriod,
      habit_threshold: fields.habitThreshold || null,
      target_amount: null,
      start_date: null,
      end_date: null,
    };
  }

  if (!fields.targetAmount || fields.targetAmount <= 0) return { error: "targetAmount must be greater than 0" };
  return {
    ...base,
    target_amount: fields.targetAmount,
    start_date: fields.startDate || null,
    end_date: fields.endDate || null,
    habit_period: null,
    habit_threshold: null,
  };
}

export async function createGoal(
  input: CreateGoalInput
): Promise<{ success: true; id: string } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  if (!input.projectId) return { error: "projectId is required" };
  if (!WRITING_MEASURES.includes(input.measure)) return { error: "Invalid measure" };

  const ownershipError = await assertOwnsProject(supabase, effectiveIdentity.memberId, input.projectId);
  if (ownershipError) return { error: ownershipError };

  const anchor = await resolveAnchor(supabase, input.anchorScheduleId);
  if ("error" in anchor) return anchor;

  const fields = buildGoalFields(input.goalType, input.measure, input, anchor);
  if ("error" in fields) return fields;

  const { data, error } = await supabase
    .from("writing_goals")
    .insert({ member_id: effectiveIdentity.memberId, project_id: input.projectId, ...fields })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create goal" };

  revalidatePath("/projects");
  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath("/dashboard");
  return { success: true, id: data.id };
}

export type UpdateGoalInput = Partial<
  Pick<
    CreateGoalInput,
    "measure" | "goalType" | "targetAmount" | "startDate" | "endDate" | "habitPeriod" | "habitThreshold" | "anchorScheduleId"
  >
>;

/**
 * Changing a prickles-measure goal's anchor (or moving it away from measure='prickles' entirely)
 * is never an in-place update -- see "Archiving on anchor change" in the plan. In-place update
 * would make computeHabitGoalProgress recompute the goal's full history against the new anchor,
 * silently erasing an already-earned streak the instant the anchor changes. Instead: archive the
 * existing row (frozen exactly as earned) and insert a fresh one under the new anchor. Any other
 * edit (threshold/period, or a non-anchor-changing tweak) stays a plain in-place update.
 */
export async function updateGoal(
  goalId: string,
  patch: UpdateGoalInput
): Promise<{ success: true; newGoalId?: string } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_goals")
    .select(
      "id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred, anchor_schedule_id, anchor_type_id, anchor_host_id, anchor_day_of_week"
    )
    .eq("id", goalId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Goal not found" };
  }

  const goalType = patch.goalType ?? (existing.goal_type as "target" | "habit");
  const measure = patch.measure ?? (existing.measure as WritingMeasure);
  if (!WRITING_MEASURES.includes(measure)) return { error: "Invalid measure" };

  // anchorScheduleId absent from the patch entirely means "this edit didn't touch the anchor" --
  // carry the existing snapshot forward as-is, rather than treating an omitted field as "clear
  // it" (which would silently fork every threshold/period-only edit on an anchored goal).
  // Explicitly passing null clears it; passing a new id re-resolves it.
  const anchor: ResolvedAnchor | { error: string } =
    patch.anchorScheduleId === undefined
      ? {
          scheduleId: existing.anchor_schedule_id,
          typeId: existing.anchor_type_id,
          hostId: existing.anchor_host_id,
          dayOfWeek: existing.anchor_day_of_week,
        }
      : await resolveAnchor(supabase, patch.anchorScheduleId);
  if ("error" in anchor) return anchor;

  const fields = buildGoalFields(
    goalType,
    measure,
    {
      targetAmount: patch.targetAmount !== undefined ? patch.targetAmount : existing.target_amount ?? undefined,
      startDate: patch.startDate !== undefined ? patch.startDate : existing.start_date,
      endDate: patch.endDate !== undefined ? patch.endDate : existing.end_date,
      habitPeriod: patch.habitPeriod ?? (existing.habit_period as HabitPeriod | null) ?? undefined,
      habitThreshold: patch.habitThreshold !== undefined ? patch.habitThreshold : existing.habit_threshold,
    },
    anchor
  );
  if ("error" in fields) return fields;

  const existingAnchor: ResolvedAnchor = {
    scheduleId: null, // not compared -- provenance only, see resolveAnchor/anchorsMatch
    typeId: existing.anchor_type_id,
    hostId: existing.anchor_host_id,
    dayOfWeek: existing.anchor_day_of_week,
  };
  const newAnchor: ResolvedAnchor = {
    scheduleId: null,
    typeId: fields.anchor_type_id,
    hostId: fields.anchor_host_id,
    dayOfWeek: fields.anchor_day_of_week,
  };
  const anchorChanged = existing.measure === "prickles" && !anchorsMatch(existingAnchor, newAnchor);

  if (anchorChanged) {
    const { error: archiveError } = await supabase
      .from("writing_goals")
      .update({ archived_at: new Date().toISOString(), is_starred: false })
      .eq("id", goalId)
      .eq("member_id", effectiveIdentity.memberId);
    if (archiveError) return { error: archiveError.message };

    const { data: inserted, error: insertError } = await supabase
      .from("writing_goals")
      .insert({
        member_id: effectiveIdentity.memberId,
        project_id: existing.project_id,
        is_starred: existing.is_starred,
        ...fields,
      })
      .select("id")
      .single();
    if (insertError || !inserted) return { error: insertError?.message ?? "Failed to create new goal" };

    revalidatePath("/projects");
    revalidatePath(`/projects/${existing.project_id}`);
    revalidatePath("/dashboard");
    return { success: true, newGoalId: inserted.id };
  }

  const { error } = await supabase
    .from("writing_goals")
    .update(fields)
    .eq("id", goalId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteGoal(goalId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_goals")
    .select("id, project_id, member_id")
    .eq("id", goalId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Goal not found" };
  }

  const { error } = await supabase
    .from("writing_goals")
    .delete()
    .eq("id", goalId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * General "mark as done" -- available on any goal, any measure, met or not. Unlike deleteGoal
 * (hard delete, for genuine mistakes), this preserves the goal and its final computed
 * streak/progress forever, just removed from the active lists. Also used automatically by
 * updateGoal when a prickles-measure goal's anchor changes (see below) -- same mechanism, two
 * call sites.
 */
export async function archiveGoal(goalId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_goals")
    .select("id, project_id, member_id")
    .eq("id", goalId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Goal not found" };
  }

  const { error } = await supabase
    .from("writing_goals")
    .update({ archived_at: new Date().toISOString(), is_starred: false })
    .eq("id", goalId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

/** Archived goals for one project (both manually-archived and auto-archived-via-anchor-change), any measure -- read-only display in the "Past goals" section. */
export async function getArchivedGoals(projectId: string): Promise<GoalRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: goalRows }, { data: entryRows }, attendance] = await Promise.all([
    supabase
      .from("writing_goals")
      .select(GOAL_SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .not("archived_at", "is", null),
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId),
    getMyPrickleAttendance(),
  ]);

  const now = new Date();
  return ((goalRows ?? []) as unknown as RawGoal[]).map((g) => buildGoalRow(g, entryRows ?? [], now, attendance));
}

export async function toggleGoalStar(
  goalId: string,
  isStarred: boolean
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { error } = await supabase
    .from("writing_goals")
    .update({ is_starred: isStarred })
    .eq("id", goalId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { success: true };
}

/** Starred goals for the acting member, across all their projects -- used by the dashboard widget. */
export async function getStarredGoals(): Promise<(GoalRow & { projectTitle: string })[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const { data: goals } = await supabase
    .from("writing_goals")
    .select(`${GOAL_SELECT_COLUMNS}, writing_projects(title)`)
    .eq("member_id", effectiveIdentity.memberId)
    .eq("is_starred", true)
    .is("archived_at", null);

  if (!goals || goals.length === 0) return [];

  const projectIds = [...new Set(goals.map((g) => g.project_id))];
  const [{ data: entries }, attendance] = await Promise.all([
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at")
      .eq("member_id", effectiveIdentity.memberId)
      .in("project_id", projectIds),
    getMyPrickleAttendance(),
  ]);

  const now = new Date();

  return (goals as unknown as (RawGoal & { writing_projects: { title: string } | { title: string }[] | null })[]).map((g) => {
    const project = singleRelation(g.writing_projects);
    const projectEntries = (entries ?? []).filter((e) => e.project_id === g.project_id);
    return { ...buildGoalRow(g, projectEntries, now, attendance), projectTitle: project?.title ?? "Untitled project" };
  });
}

/** Cumulative-total series for a project's measure, for the project detail page's chart. */
export async function getProjectSeries(
  projectId: string,
  measure: WritingMeasure
): Promise<{ entryDate: string; total: number }[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const { data: entries } = await supabase
    .from("writing_progress_entries")
    .select("entry_date, mode, amount, created_at")
    .eq("project_id", projectId)
    .eq("member_id", effectiveIdentity.memberId)
    .eq("measure", measure);

  return computeCumulativeSeries(
    (entries ?? []).map((e) => ({
      entryDate: e.entry_date,
      createdAt: e.created_at,
      mode: e.mode as EntryMode,
      amount: e.amount,
    }))
  );
}

/** A member's opted-in project (highest total, if more than one) for surfacing on their public profile. */
export async function getProfileWritingSummary(
  memberId: string
): Promise<{ projectTitle: string; measure: WritingMeasure; total: number } | null> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("writing_projects")
    .select("id, title")
    .eq("member_id", memberId)
    .eq("show_on_profile", true)
    .is("archived_at", null);

  if (!projects || projects.length === 0) return null;

  const projectIds = projects.map((p) => p.id);
  const { data: entries } = await supabase
    .from("writing_progress_entries")
    .select("project_id, entry_date, measure, mode, amount, created_at")
    .in("project_id", projectIds);

  let best: { projectTitle: string; measure: WritingMeasure; total: number } | null = null;
  for (const project of projects) {
    for (const measure of WRITING_MEASURES) {
      const measureEntries = (entries ?? []).filter((e) => e.project_id === project.id && e.measure === measure);
      if (measureEntries.length === 0) continue;
      const total = computeCumulativeTotal(
        measureEntries.map((e) => ({
          entryDate: e.entry_date,
          createdAt: e.created_at,
          mode: e.mode as EntryMode,
          amount: e.amount,
        }))
      );
      if (!best || total > best.total) best = { projectTitle: project.title, measure, total };
    }
  }
  return best;
}
