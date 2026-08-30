"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import {
  WRITING_MEASURES,
  computeCumulativeTotal,
  computeCumulativeSeries,
  computeGoalProgress,
  computeHabitGoalProgress,
  type WritingMeasure,
  type EntryMode,
  type HabitPeriod,
} from "@/lib/writing-projects";

const PHASES = ["planning", "drafting", "revising", "on_hold", "complete", "abandoned"] as const;
type Phase = (typeof PHASES)[number];

const HABIT_PERIODS: HabitPeriod[] = ["day", "week", "month"];

export interface WritingProjectRow {
  id: string;
  title: string;
  phase: Phase;
  createdAt: string;
  showOnProfile: boolean;
  totalsByMeasure: Partial<Record<WritingMeasure, number>>;
  goals: GoalRow[];
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
}

interface GoalRowBase {
  id: string;
  projectId: string;
  measure: WritingMeasure;
  isStarred: boolean;
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
export async function getMyProjects(): Promise<WritingProjectRow[]> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return [];
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: projects }, { data: entries }, { data: goals }] = await Promise.all([
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
      .select(
        "id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred"
      )
      .eq("member_id", effectiveIdentity.memberId),
  ]);

  return buildProjectRows(projects ?? [], entries ?? [], goals ?? []);
}

export async function getProject(
  projectId: string
): Promise<{ project: WritingProjectRow; entries: EntryRow[] } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const [{ data: projectRow }, { data: entryRows }, { data: goalRows }] = await Promise.all([
    supabase
      .from("writing_projects")
      .select("id, title, phase, created_at, show_on_profile")
      .eq("id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .single(),
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("writing_goals")
      .select(
        "id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred"
      )
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId),
  ]);

  if (!projectRow) return { error: "Project not found" };

  const [project] = buildProjectRows([projectRow], entryRows ?? [], goalRows ?? []);
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
}

function buildGoalRow(g: RawGoal, projectEntries: RawEntry[], now: Date): GoalRow {
  const measureEntries = projectEntries.filter((e) => e.measure === g.measure);
  const base = { id: g.id, projectId: g.project_id, measure: g.measure as WritingMeasure, isStarred: g.is_starred };

  if (g.goal_type === "habit") {
    const progress = computeHabitGoalProgress({
      entries: measureEntries.map((e) => ({ entryDate: e.entry_date, amount: e.amount })),
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
    entries: measureEntries.map((e) => ({
      entryDate: e.entry_date,
      createdAt: e.created_at,
      mode: e.mode as EntryMode,
      amount: e.amount,
    })),
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

function buildProjectRows(projects: RawProject[], entries: RawEntry[], goals: RawGoal[]): WritingProjectRow[] {
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
      .map((g) => buildGoalRow(g, projectEntries, now));

    return {
      id: project.id,
      title: project.title,
      phase: project.phase as Phase,
      createdAt: project.created_at,
      showOnProfile: project.show_on_profile,
      totalsByMeasure,
      goals: projectGoals,
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

  revalidatePath("/writing");
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

  revalidatePath(`/writing/${projectId}`);
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
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to log progress" };

  revalidatePath("/writing");
  revalidatePath(`/writing/${input.projectId}`);
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

  revalidatePath("/writing");
  revalidatePath(`/writing/${existing.project_id}`);
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

  revalidatePath("/writing");
  revalidatePath(`/writing/${existing.project_id}`);
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

  const insert: Record<string, unknown> = {
    member_id: effectiveIdentity.memberId,
    project_id: input.projectId,
    goal_type: input.goalType,
    measure: input.measure,
  };

  if (input.goalType === "habit") {
    if (!input.habitPeriod || !HABIT_PERIODS.includes(input.habitPeriod)) {
      return { error: "habitPeriod must be one of: " + HABIT_PERIODS.join(", ") };
    }
    insert.habit_period = input.habitPeriod;
    insert.habit_threshold = input.habitThreshold || null;
  } else {
    if (!input.targetAmount || input.targetAmount <= 0) return { error: "targetAmount must be greater than 0" };
    insert.target_amount = input.targetAmount;
    insert.start_date = input.startDate || null;
    insert.end_date = input.endDate || null;
  }

  const { data, error } = await supabase.from("writing_goals").insert(insert).select("id").single();

  if (error || !data) return { error: error?.message ?? "Failed to create goal" };

  revalidatePath("/writing");
  revalidatePath(`/writing/${input.projectId}`);
  revalidatePath("/dashboard");
  return { success: true, id: data.id };
}

export type UpdateGoalInput = Partial<
  Pick<CreateGoalInput, "measure" | "goalType" | "targetAmount" | "startDate" | "endDate" | "habitPeriod" | "habitThreshold">
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
    .select(
      "id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold"
    )
    .eq("id", goalId)
    .single();

  if (!existing || existing.member_id !== effectiveIdentity.memberId) {
    return { error: "Goal not found" };
  }

  const goalType = patch.goalType ?? (existing.goal_type as "target" | "habit");
  const measure = patch.measure ?? (existing.measure as WritingMeasure);
  if (!WRITING_MEASURES.includes(measure)) return { error: "Invalid measure" };

  const updates: Record<string, unknown> = { goal_type: goalType, measure };

  if (goalType === "habit") {
    const habitPeriod = patch.habitPeriod ?? (existing.habit_period as HabitPeriod | null);
    if (!habitPeriod || !HABIT_PERIODS.includes(habitPeriod)) {
      return { error: "habitPeriod must be one of: " + HABIT_PERIODS.join(", ") };
    }
    updates.habit_period = habitPeriod;
    updates.habit_threshold = patch.habitThreshold !== undefined ? patch.habitThreshold || null : existing.habit_threshold;
    updates.target_amount = null;
    updates.start_date = null;
    updates.end_date = null;
  } else {
    const targetAmount = patch.targetAmount !== undefined ? patch.targetAmount : existing.target_amount;
    if (!targetAmount || targetAmount <= 0) return { error: "targetAmount must be greater than 0" };
    updates.target_amount = targetAmount;
    updates.start_date = patch.startDate !== undefined ? patch.startDate || null : existing.start_date;
    updates.end_date = patch.endDate !== undefined ? patch.endDate || null : existing.end_date;
    updates.habit_period = null;
    updates.habit_threshold = null;
  }

  const { error } = await supabase
    .from("writing_goals")
    .update(updates)
    .eq("id", goalId)
    .eq("member_id", effectiveIdentity.memberId);

  if (error) return { error: error.message };

  revalidatePath("/writing");
  revalidatePath(`/writing/${existing.project_id}`);
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

  revalidatePath("/writing");
  revalidatePath(`/writing/${existing.project_id}`);
  revalidatePath("/dashboard");
  return { success: true };
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

  revalidatePath("/writing");
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
    .select(
      "id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred, writing_projects(title)"
    )
    .eq("member_id", effectiveIdentity.memberId)
    .eq("is_starred", true);

  if (!goals || goals.length === 0) return [];

  const projectIds = [...new Set(goals.map((g) => g.project_id))];
  const { data: entries } = await supabase
    .from("writing_progress_entries")
    .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at")
    .eq("member_id", effectiveIdentity.memberId)
    .in("project_id", projectIds);

  const now = new Date();

  return goals.map((g) => {
    const project = Array.isArray(g.writing_projects) ? g.writing_projects[0] : g.writing_projects;
    const projectEntries = (entries ?? []).filter((e) => e.project_id === g.project_id);
    return { ...buildGoalRow(g, projectEntries, now), projectTitle: project?.title ?? "Untitled project" };
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
