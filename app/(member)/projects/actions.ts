"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { safeUrl } from "@/lib/url";
import { validateBookInput } from "@/lib/bookValidation";
import { notifyStaffNewBook } from "@/lib/slack";
import { getMyBooks, type BookInput, type MyBookRow } from "@/app/(member)/bookshelf/actions";
import {
  WRITING_MEASURES,
  PROJECT_PHASES,
  MANUALLY_SETTABLE_PHASES,
  applyStartingBalance,
  computeCumulativeTotal,
  computeCumulativeSeries,
  computeGoalProgress,
  computeHabitGoalProgress,
  derivePrickleHabitEntries,
  type WritingMeasure,
  type EntryMode,
  type HabitPeriod,
  type PrickleAttendanceRow,
  type ProjectPhase,
} from "@/lib/writing-projects";
import { computePrickleStreaks, seriesKeyFor } from "@/lib/streaks";
import { getUserTimezonePreference } from "@/lib/timezone";
import { DAY_NAMES, formatScheduleLabel, getMonthStart, getNextMonthStart } from "@/lib/prickle-schedules";
import { ORG_TIMEZONE } from "@/lib/config";
import {
  formatPrickleLabel,
  localDateOf,
  sortPrickleOptions,
  type PrickleOption,
} from "@/lib/prickle-writing";

const PHASES = PROJECT_PHASES;
type Phase = ProjectPhase;

/** Measures a starting balance can be recorded against -- excludes 'prickles', which is always
 * computed live from attendance and never manually logged or carried over (see
 * writing_project_starting_balances' CHECK constraint). */
const STARTING_BALANCE_MEASURES = WRITING_MEASURES.filter((m) => m !== "prickles") as Exclude<
  WritingMeasure,
  "prickles"
>[];

const HABIT_PERIODS: HabitPeriod[] = ["day", "week", "month"];

export interface WritingProjectRow {
  id: string;
  title: string;
  phase: Phase;
  createdAt: string;
  showOnProfile: boolean;
  coverUrl: string | null;
  description: string | null;
  /** How much the member already had before tracking here, by measure -- offsets totalsByMeasure and the chart, not goal progress. */
  startingBalances: Partial<Record<WritingMeasure, number>>;
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
  /** e.g. "Tue, Oct 1 · 9:00 AM · Morning Sprint with Jo" when prickleId is set. */
  prickleLabel: string | null;
}

interface GoalRowBase {
  id: string;
  projectId: string;
  measure: WritingMeasure;
  isStarred: boolean;
  title: string | null;
  description: string | null;
  showOnProfile: boolean;
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
  status: "active" | "achieved" | "ended";
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
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  return { supabase, effectiveIdentity };
}

/** All of the acting member's projects, each with a per-measure cumulative total and its goals' live progress. */
/**
 * This member's attendance at writing-purpose prickles, reduced to local calendar dates --
 * the raw material derivePrickleHabitEntries counts. purpose='writing' is
 * enforced here, at the query, not in app code downstream (see Writing-only scope in the plan).
 */
export async function getMyPrickleAttendance(): Promise<PrickleAttendanceRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  return fetchWritingPrickleAttendance(supabase, effectiveIdentity.memberId, await viewerTimeZone());
}

async function fetchWritingPrickleAttendance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  timeZone: string
): Promise<PrickleAttendanceRow[]> {
  const { data } = await supabase
    .from("prickle_attendance")
    .select("prickles!inner(id, start_time, prickle_types!inner(purpose))")
    .eq("member_id", memberId)
    .eq("prickles.prickle_types.purpose", "writing");

  return ((data ?? []) as any[])
    .map((r) => {
      const prickle = Array.isArray(r.prickles) ? r.prickles[0] : r.prickles;
      if (!prickle?.id || !prickle?.start_time) return null;
      return {
        prickleId: prickle.id as string,
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

export async function getMyProjects(): Promise<WritingProjectRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: projects }, { data: entries }, { data: goals }, { data: startingBalances }, attendance, books] =
    await Promise.all([
      supabase
        .from("writing_projects")
        .select("id, title, phase, created_at, show_on_profile, cover_url, description")
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
      supabase
        .from("writing_project_starting_balances")
        .select("project_id, measure, amount")
        .eq("member_id", effectiveIdentity.memberId),
      getMyPrickleAttendance(),
      getMyBooks(),
    ]);

  return buildProjectRows(
    projects ?? [],
    entries ?? [],
    (goals ?? []) as unknown as RawGoal[],
    startingBalances ?? [],
    attendance,
    books
  );
}

export async function getProject(
  projectId: string
): Promise<{ project: WritingProjectRow; entries: EntryRow[] } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: projectRow }, { data: entryRows }, { data: goalRows }, { data: startingBalances }, attendance, books] =
    await Promise.all([
      supabase
        .from("writing_projects")
        .select("id, title, phase, created_at, show_on_profile, cover_url, description")
        .eq("id", projectId)
        .eq("member_id", effectiveIdentity.memberId)
        .single(),
      supabase
        .from("writing_progress_entries")
        .select(`id, project_id, entry_date, measure, mode, amount, note, tags, created_at, prickle_id, ${ENTRY_PRICKLE_EMBED}`)
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
      supabase
        .from("writing_project_starting_balances")
        .select("project_id, measure, amount")
        .eq("project_id", projectId)
        .eq("member_id", effectiveIdentity.memberId),
      getMyPrickleAttendance(),
      getMyBooks(),
    ]);

  if (!projectRow) return { error: "Project not found" };

  const [project] = buildProjectRows(
    [projectRow],
    entryRows ?? [],
    (goalRows ?? []) as unknown as RawGoal[],
    startingBalances ?? [],
    attendance,
    books
  );
  const timeZone = await viewerTimeZone();
  const entries: EntryRow[] = ((entryRows ?? []) as unknown as RawEntry[]).map((e) => toEntryRow(e, timeZone));

  return { project, entries };
}

interface RawProject {
  id: string;
  title: string;
  phase: string;
  created_at: string;
  show_on_profile: boolean;
  cover_url: string | null;
  description: string | null;
}

interface RawStartingBalance {
  project_id: string;
  measure: string;
  amount: number;
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
  prickle?: RawEmbeddedPrickle | RawEmbeddedPrickle[] | null;
}

interface RawEmbeddedPrickle {
  id: string;
  start_time: string;
  host: { name: string | null } | { name: string | null }[] | null;
  prickle_types: { name: string | null } | { name: string | null }[] | null;
}

/** Embeds the entry's prickle with what formatPrickleLabel needs. */
const ENTRY_PRICKLE_EMBED = "prickle:prickles(id, start_time, host:prickle_host(name), prickle_types:type_id(name))";

function one<T>(ref: T | T[] | null | undefined): T | null {
  return (Array.isArray(ref) ? ref[0] : ref) ?? null;
}

function labelForPrickle(p: RawEmbeddedPrickle, timeZone: string): string {
  return formatPrickleLabel(
    { startTime: p.start_time, typeName: one(p.prickle_types)?.name ?? null, hostName: one(p.host)?.name ?? null },
    timeZone
  );
}

async function viewerTimeZone(): Promise<string> {
  const tzPref = await getUserTimezonePreference();
  return tzPref === "browser" ? ORG_TIMEZONE : tzPref;
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
  title: string | null;
  description: string | null;
  show_on_profile: boolean;
}

const GOAL_SELECT_COLUMNS =
  "id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred, title, description, show_on_profile";

function singleRelation<T>(rel: T | T[] | null | undefined): T | null {
  return Array.isArray(rel) ? rel[0] ?? null : rel ?? null;
}

function buildGoalRow(
  g: RawGoal,
  projectEntries: RawEntry[],
  now: Date,
  attendance: PrickleAttendanceRow[]
): GoalRow {
  const measureEntries =
    g.measure === "prickles"
      ? derivePrickleHabitEntries(attendance).map((e) => ({ entryDate: e.entryDate, amount: e.amount, createdAt: e.entryDate, mode: "delta" as EntryMode }))
      : projectEntries
          .filter((e) => e.measure === g.measure)
          .map((e) => ({ entryDate: e.entry_date, amount: e.amount, createdAt: e.created_at, mode: e.mode as EntryMode }));

  const base = {
    id: g.id,
    projectId: g.project_id,
    measure: g.measure as WritingMeasure,
    isStarred: g.is_starred,
    title: g.title,
    description: g.description,
    showOnProfile: g.show_on_profile,
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
  startingBalances: RawStartingBalance[],
  attendance: PrickleAttendanceRow[],
  books: MyBookRow[]
): WritingProjectRow[] {
  const now = new Date();

  return projects.map((project) => {
    const projectEntries = entries.filter((e) => e.project_id === project.id);

    const projectStartingBalances: Partial<Record<WritingMeasure, number>> = {};
    for (const sb of startingBalances) {
      if (sb.project_id === project.id) projectStartingBalances[sb.measure as WritingMeasure] = sb.amount;
    }

    const totalsByMeasure: Partial<Record<WritingMeasure, number>> = {};
    for (const measure of WRITING_MEASURES) {
      const measureEntries = projectEntries.filter((e) => e.measure === measure);
      const startingBalance = projectStartingBalances[measure];
      if (measureEntries.length === 0 && startingBalance === undefined) continue;
      const loggedTotal = computeCumulativeTotal(
        measureEntries.map((e) => ({
          entryDate: e.entry_date,
          createdAt: e.created_at,
          mode: e.mode as EntryMode,
          amount: e.amount,
        }))
      );
      totalsByMeasure[measure] = applyStartingBalance(loggedTotal, startingBalance);
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
      coverUrl: project.cover_url,
      description: project.description,
      startingBalances: projectStartingBalances,
      totalsByMeasure,
      goals: projectGoals,
      book: books.find((b) => b.projectId === project.id) ?? null,
    };
  });
}

function toEntryRow(e: RawEntry, timeZone: string): EntryRow {
  const prickle = one(e.prickle);
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
    prickleLabel: prickle ? labelForPrickle(prickle, timeZone) : null,
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

export async function updateProjectDetails(
  projectId: string,
  fields: { title: string; description: string }
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return { error: "Title is required" };

  const { error } = await supabase
    .from("writing_projects")
    .update({ title: trimmedTitle, description: fields.description.trim() || null })
    .eq("id", projectId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/** Sets or clears (coverUrl: null) a project's pre-publish cover. The upload itself happens via
 * /api/bookshelf/cover (the same route/bucket/spec member_books covers use); this just saves the
 * resulting URL, same upload-then-save-URL split BookFormModal already uses. */
export async function updateProjectCover(
  projectId: string,
  coverUrl: string | null
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { error } = await supabase
    .from("writing_projects")
    .update({ cover_url: coverUrl })
    .eq("id", projectId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/** Replaces a project's starting balances -- how much the member already had before tracking
 * here, per measure. A measure omitted or set to 0/blank clears its row entirely. */
export async function setStartingBalances(
  projectId: string,
  balances: Partial<Record<Exclude<WritingMeasure, "prickles">, number>>
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const ownershipError = await assertOwnsProject(supabase, effectiveIdentity.memberId, projectId);
  if (ownershipError) return { error: ownershipError };

  const isSet = (m: (typeof STARTING_BALANCE_MEASURES)[number]) => (balances[m] ?? 0) > 0;
  const toSet = STARTING_BALANCE_MEASURES.filter(isSet);
  const toClear = STARTING_BALANCE_MEASURES.filter((m) => !isSet(m));

  if (toSet.length > 0) {
    const { error: upsertError } = await supabase.from("writing_project_starting_balances").upsert(
      toSet.map((measure) => ({
        project_id: projectId,
        member_id: effectiveIdentity.memberId,
        measure,
        amount: balances[measure]!,
      })),
      { onConflict: "project_id,measure" }
    );
    if (upsertError) return { error: upsertError.message };
  }

  if (toClear.length > 0) {
    const { error: deleteError } = await supabase
      .from("writing_project_starting_balances")
      .delete()
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .in("measure", toClear);
    if (deleteError) return { error: deleteError.message };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
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

/**
 * Manual phase change (Planning/Drafting/Revising/On hold/Complete/Abandoned). 'published' is
 * excluded here -- it can only be reached via publishProject, which links a Bookshelf entry in
 * the same step (see the comment there).
 */
export async function updateProjectPhase(
  projectId: string,
  phase: (typeof MANUALLY_SETTABLE_PHASES)[number]
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  if (!MANUALLY_SETTABLE_PHASES.includes(phase)) return { error: "Invalid phase" };

  const { error } = await supabase
    .from("writing_projects")
    .update({ phase })
    .eq("id", projectId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
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

  // Fire-and-forget: a Slack outage must never block the publish from succeeding.
  notifyStaffNewBook({
    title: book.title.trim(),
    memberId: effectiveIdentity.memberId,
    memberName: effectiveIdentity.memberName,
    purchaseUrl: safeUrl(book.purchaseUrl),
  }).catch((err) => console.error("New book Slack notification failed:", err));

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
  if (input.prickleId) revalidatePath(`/prickles/${input.prickleId}`);
  return { success: true, id: data.id };
}

export type UpdateEntryInput = Partial<
  Pick<LogProgressInput, "entryDate" | "measure" | "mode" | "amount" | "note" | "tags">
> & {
  /** null detaches the entry from its prickle. */
  prickleId?: string | null;
};

export async function updateEntry(
  entryId: string,
  patch: UpdateEntryInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_progress_entries")
    .select("id, project_id, member_id, prickle_id")
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
  if (patch.prickleId !== undefined) updates.prickle_id = patch.prickleId;

  const { error } = await supabase
    .from("writing_progress_entries")
    .update(updates)
    .eq("id", entryId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/dashboard");
  for (const id of new Set([existing.prickle_id, patch.prickleId])) {
    if (id) revalidatePath(`/prickles/${id}`);
  }
  return { success: true };
}

export async function deleteEntry(entryId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_progress_entries")
    .select("id, project_id, member_id, prickle_id")
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
  if (existing.prickle_id) revalidatePath(`/prickles/${existing.prickle_id}`);
  return { success: true };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every prickle on a calendar date (the viewer's timezone), for the "During which prickle?"
 * picker -- the ones the member attended first. Not only attended ones: attendance is imported
 * after the meeting ends and some Zoom names never match, so the member can still link a
 * prickle we have no attendance record for.
 */
export async function getPricklesOnDate(date: string): Promise<PrickleOption[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;
  const timeZone = await viewerTimeZone();

  // A UTC window wide enough for any timezone offset, narrowed to the local date below.
  const dayStartUtc = new Date(`${date}T00:00:00Z`).getTime();
  const { data: prickles } = await supabase
    .from("prickles")
    .select("id, start_time, host:prickle_host(name), prickle_types:type_id(name)")
    .gte("start_time", new Date(dayStartUtc - DAY_MS).toISOString())
    .lt("start_time", new Date(dayStartUtc + 2 * DAY_MS).toISOString())
    .order("start_time", { ascending: true });

  const onDate = ((prickles ?? []) as unknown as RawEmbeddedPrickle[]).filter(
    (p) => localDateOf(p.start_time, timeZone) === date
  );
  if (onDate.length === 0) return [];

  const { data: attendance } = await supabase
    .from("prickle_attendance")
    .select("prickle_id")
    .eq("member_id", effectiveIdentity.memberId)
    .in(
      "prickle_id",
      onDate.map((p) => p.id)
    );
  const attendedIds = new Set(((attendance ?? []) as { prickle_id: string }[]).map((a) => a.prickle_id));

  return sortPrickleOptions(
    onDate.map((p) => ({
      id: p.id,
      label: labelForPrickle(p, timeZone),
      startTime: p.start_time,
      attended: attendedIds.has(p.id),
    }))
  );
}

export interface PrickleEntryRow extends EntryRow {
  projectTitle: string;
}

/** The acting member's progress entries linked to one prickle, for the prickle page. */
export async function getMyEntriesForPrickle(prickleId: string): Promise<PrickleEntryRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const [{ data }, timeZone] = await Promise.all([
    supabase
      .from("writing_progress_entries")
      .select(
        `id, project_id, entry_date, measure, mode, amount, note, tags, created_at, prickle_id, ${ENTRY_PRICKLE_EMBED}, writing_projects!inner(title)`
      )
      .eq("member_id", effectiveIdentity.memberId)
      .eq("prickle_id", prickleId)
      .order("created_at", { ascending: true }),
    viewerTimeZone(),
  ]);

  return ((data ?? []) as unknown as (RawEntry & { writing_projects: { title: string } | { title: string }[] })[]).map(
    (e) => ({ ...toEntryRow(e, timeZone), projectTitle: one(e.writing_projects)?.title ?? "" })
  );
}

const UNLOGGED_LOOKBACK_DAYS = 14;

/**
 * Writing prickles the acting member attended in the last two weeks with no progress entry
 * linked yet -- the dashboard's "What did you write?" prompt. Newest first.
 */
export async function getUnloggedRecentPrickles(): Promise<PrickleOption[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;
  const since = new Date(Date.now() - UNLOGGED_LOOKBACK_DAYS * DAY_MS).toISOString();

  const [{ data: attendance }, { data: linked }, { data: dismissed }, timeZone] = await Promise.all([
    supabase
      .from("prickle_attendance")
      .select(
        "prickle_id, prickles!inner(id, start_time, host:prickle_host(name), prickle_types!inner(name, purpose))"
      )
      .eq("member_id", effectiveIdentity.memberId)
      .eq("prickles.prickle_types.purpose", "writing")
      .gte("prickles.start_time", since),
    supabase
      .from("writing_progress_entries")
      .select("prickle_id")
      .eq("member_id", effectiveIdentity.memberId)
      .not("prickle_id", "is", null)
      .gte("created_at", since),
    supabase
      .from("writing_prompt_dismissals")
      .select("prickle_id")
      .eq("member_id", effectiveIdentity.memberId)
      .gte("dismissed_at", since),
    viewerTimeZone(),
  ]);

  // Linked to an entry, or dismissed from this prompt: either way, nothing to ask about.
  const linkedIds = new Set(
    [...(linked ?? []), ...(dismissed ?? [])].map((e) => (e as { prickle_id: string }).prickle_id)
  );
  const byId = new Map<string, PrickleOption>();
  for (const row of (attendance ?? []) as unknown as { prickles: RawEmbeddedPrickle | RawEmbeddedPrickle[] }[]) {
    const p = one(row.prickles);
    if (!p || linkedIds.has(p.id) || byId.has(p.id)) continue;
    byId.set(p.id, { id: p.id, label: labelForPrickle(p, timeZone), startTime: p.start_time, attended: true });
  }
  return [...byId.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));
}

/**
 * Hides a prickle from the dashboard's "What did you write?" prompt for good -- for sessions the
 * member won't log (forgot to track, not a writing session for them, untracked work).
 */
export async function dismissUnloggedPrickle(prickleId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;
  if (typeof prickleId !== "string" || !prickleId) return { error: "Invalid prickle" };

  const { error } = await supabase
    .from("writing_prompt_dismissals")
    .upsert(
      { member_id: effectiveIdentity.memberId, prickle_id: prickleId },
      { onConflict: "member_id,prickle_id", ignoreDuplicates: true }
    );
  if (error) {
    console.error("dismissUnloggedPrickle: insert failed", { prickleId, error });
    return { error: "Couldn't dismiss that prickle — please try again." };
  }

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
  title?: string | null;
  description?: string | null;
  showOnProfile?: boolean;
  isStarred?: boolean;
}

const GOAL_TITLE_MAX = 200;
const GOAL_DESCRIPTION_MAX = 2000;

type GoalDetails = { title?: string | null; description?: string | null; show_on_profile?: boolean; is_starred?: boolean };

/** Trims/validates the optional title, description, profile and dashboard flags; only fields present in the input are returned. */
function buildGoalDetails(
  input: Pick<CreateGoalInput, "title" | "description" | "showOnProfile" | "isStarred">
): GoalDetails | { error: string } {
  const details: GoalDetails = {};
  if (input.title !== undefined) {
    const title = input.title?.trim() || null;
    if (title && title.length > GOAL_TITLE_MAX) return { error: `Title must be ${GOAL_TITLE_MAX} characters or fewer` };
    details.title = title;
  }
  if (input.description !== undefined) {
    const description = input.description?.trim() || null;
    if (description && description.length > GOAL_DESCRIPTION_MAX) {
      return { error: `Description must be ${GOAL_DESCRIPTION_MAX} characters or fewer` };
    }
    details.description = description;
  }
  if (input.showOnProfile !== undefined) details.show_on_profile = !!input.showOnProfile;
  if (input.isStarred !== undefined) details.is_starred = !!input.isStarred;
  return details;
}

interface GoalFieldValues {
  goal_type: "target" | "habit";
  measure: WritingMeasure;
  target_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  habit_period: HabitPeriod | null;
  habit_threshold: number | null;
}

/** Shared validation + field-shaping for both createGoal and updateGoal. */
function buildGoalFields(
  goalType: "target" | "habit",
  measure: WritingMeasure,
  fields: Pick<CreateGoalInput, "targetAmount" | "startDate" | "endDate" | "habitPeriod" | "habitThreshold">
): GoalFieldValues | { error: string } {
  const base = { goal_type: goalType, measure };

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

  const fields = buildGoalFields(input.goalType, input.measure, input);
  if ("error" in fields) return fields;
  const details = buildGoalDetails(input);
  if ("error" in details) return details;

  const { data, error } = await supabase
    .from("writing_goals")
    .insert({ member_id: effectiveIdentity.memberId, project_id: input.projectId, ...fields, ...details })
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
    "measure"
    | "goalType"
    | "targetAmount"
    | "startDate"
    | "endDate"
    | "habitPeriod"
    | "habitThreshold"
    | "title"
    | "description"
    | "showOnProfile"
    | "isStarred"
  >
>;

export async function updateGoal(
  goalId: string,
  patch: UpdateGoalInput
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data: existing } = await supabase
    .from("writing_goals")
    .select("id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold")
    .eq("id", goalId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Goal not found" };
  }

  const goalType = patch.goalType ?? (existing.goal_type as "target" | "habit");
  const measure = patch.measure ?? (existing.measure as WritingMeasure);
  if (!WRITING_MEASURES.includes(measure)) return { error: "Invalid measure" };

  const fields = buildGoalFields(goalType, measure, {
    targetAmount: patch.targetAmount !== undefined ? patch.targetAmount : existing.target_amount ?? undefined,
    startDate: patch.startDate !== undefined ? patch.startDate : existing.start_date,
    endDate: patch.endDate !== undefined ? patch.endDate : existing.end_date,
    habitPeriod: patch.habitPeriod ?? (existing.habit_period as HabitPeriod | null) ?? undefined,
    habitThreshold: patch.habitThreshold !== undefined ? patch.habitThreshold : existing.habit_threshold,
  });
  if ("error" in fields) return fields;
  const details = buildGoalDetails(patch);
  if ("error" in details) return details;

  const { error } = await supabase
    .from("writing_goals")
    .update({ ...fields, ...details })
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
 * streak/progress forever, just removed from the active lists.
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

/** Archived goals for one project, any measure -- read-only display in the "Past goals" section. */
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

export async function toggleGoalVisibility(
  goalId: string,
  showOnProfile: boolean
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { error } = await supabase
    .from("writing_goals")
    .update({ show_on_profile: showOnProfile })
    .eq("id", goalId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
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

  const [{ data: entries }, { data: startingBalanceRow }] = await Promise.all([
    supabase
      .from("writing_progress_entries")
      .select("entry_date, mode, amount, created_at")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .eq("measure", measure),
    supabase
      .from("writing_project_starting_balances")
      .select("amount")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .eq("measure", measure)
      .maybeSingle(),
  ]);

  const series = computeCumulativeSeries(
    (entries ?? []).map((e) => ({
      entryDate: e.entry_date,
      createdAt: e.created_at,
      mode: e.mode as EntryMode,
      amount: e.amount,
    }))
  );

  const startingBalance = startingBalanceRow?.amount;
  return series.map((point) => ({ ...point, total: applyStartingBalance(point.total, startingBalance) }));
}

export interface ProfileWritingProject {
  id: string;
  title: string;
  /** The project's largest total (starting balance included), or null if nothing's logged yet. */
  headline: { measure: WritingMeasure; total: number } | null;
}

export type ProfileWritingGoal = GoalRow & { projectTitle: string };

/**
 * A member's "Show on profile" projects and goals, for their profile page. Read through the
 * get_profile_writing function: the writing tables are owner-only, so reading them as the viewer
 * would show nothing on anyone else's profile.
 */
export async function getProfileWriting(
  memberId: string
): Promise<{ projects: ProfileWritingProject[]; goals: ProfileWritingGoal[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_profile_writing", { p_member_id: memberId });
  if (error) console.error("getProfileWriting: get_profile_writing failed", error);

  const payload = (data ?? null) as {
    projects: { id: string; title: string }[];
    goals: (Omit<RawGoal, "is_starred" | "show_on_profile"> & { project_title: string })[];
    entries: RawEntry[];
    starting_balances: RawStartingBalance[];
  } | null;
  if (!payload) return { projects: [], goals: [] };

  const now = new Date();
  const entriesFor = (projectId: string) => payload.entries.filter((e) => e.project_id === projectId);

  const projects = payload.projects.map((project) => {
    const projectEntries = entriesFor(project.id);
    let headline: ProfileWritingProject["headline"] = null;
    for (const measure of WRITING_MEASURES) {
      const measureEntries = projectEntries.filter((e) => e.measure === measure);
      const startingBalance = payload.starting_balances.find(
        (b) => b.project_id === project.id && b.measure === measure
      )?.amount;
      if (measureEntries.length === 0 && startingBalance === undefined) continue;
      const total = applyStartingBalance(
        computeCumulativeTotal(
          measureEntries.map((e) => ({
            entryDate: e.entry_date,
            createdAt: e.created_at,
            mode: e.mode as EntryMode,
            amount: e.amount,
          }))
        ),
        startingBalance
      );
      if (!headline || total > headline.total) headline = { measure, total };
    }
    return { id: project.id, title: project.title, headline };
  });

  // Prickles-measure goals count attendance, which any member can already read.
  let attendance: PrickleAttendanceRow[] = [];
  if (payload.goals.some((g) => g.measure === "prickles")) {
    const tzPref = await getUserTimezonePreference();
    attendance = await fetchWritingPrickleAttendance(supabase, memberId, tzPref === "browser" ? ORG_TIMEZONE : tzPref);
  }

  const goals = payload.goals.map((g) => ({
    ...buildGoalRow({ ...g, is_starred: false, show_on_profile: true }, entriesFor(g.project_id), now, attendance),
    projectTitle: g.project_title,
  }));

  return { projects, goals };
}
