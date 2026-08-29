"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import {
  WRITING_MEASURES,
  computeCumulativeTotal,
  computeGoalProgress,
  type WritingMeasure,
  type EntryMode,
} from "@/lib/writing-projects";

const PHASES = ["planning", "drafting", "revising", "on_hold", "complete", "abandoned"] as const;
type Phase = (typeof PHASES)[number];

export interface WritingProjectRow {
  id: string;
  title: string;
  phase: Phase;
  createdAt: string;
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
  createdAt: string;
}

export interface GoalRow {
  id: string;
  projectId: string;
  measure: WritingMeasure;
  targetAmount: number;
  startDate: string | null;
  endDate: string | null;
  isStarred: boolean;
  current: number;
  percent: number;
  parTarget: number | null;
  onPace: boolean | null;
}

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
      .select("id, title, phase, created_at")
      .eq("member_id", effectiveIdentity.memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, created_at")
      .eq("member_id", effectiveIdentity.memberId),
    supabase
      .from("writing_goals")
      .select("id, project_id, measure, target_amount, start_date, end_date, is_starred")
      .eq("member_id", effectiveIdentity.memberId)
      .eq("goal_type", "target"),
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
      .select("id, title, phase, created_at")
      .eq("id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .single(),
    supabase
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, created_at")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("writing_goals")
      .select("id, project_id, measure, target_amount, start_date, end_date, is_starred")
      .eq("project_id", projectId)
      .eq("member_id", effectiveIdentity.memberId)
      .eq("goal_type", "target"),
  ]);

  if (!projectRow) return { error: "Project not found" };

  const [{ project }] = buildProjectRows([projectRow], entryRows ?? [], goalRows ?? []).map((p) => ({
    project: p,
  }));

  const entries: EntryRow[] = (entryRows ?? []).map(toEntryRow);

  return { project, entries };
}

function buildProjectRows(
  projects: { id: string; title: string; phase: string; created_at: string }[],
  entries: {
    id: string;
    project_id: string;
    entry_date: string;
    measure: string;
    mode: string;
    amount: number;
    note: string | null;
    created_at: string;
  }[],
  goals: {
    id: string;
    project_id: string;
    measure: string;
    target_amount: number;
    start_date: string | null;
    end_date: string | null;
    is_starred: boolean;
  }[]
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

    const projectGoals: GoalRow[] = goals
      .filter((g) => g.project_id === project.id)
      .map((g) => {
        const measureEntries = projectEntries.filter((e) => e.measure === g.measure);
        const progress = computeGoalProgress({
          entries: measureEntries.map((e) => ({
            entryDate: e.entry_date,
            createdAt: e.created_at,
            mode: e.mode as EntryMode,
            amount: e.amount,
          })),
          targetAmount: g.target_amount,
          startDate: g.start_date,
          endDate: g.end_date,
          now,
        });
        return {
          id: g.id,
          projectId: g.project_id,
          measure: g.measure as WritingMeasure,
          targetAmount: g.target_amount,
          startDate: g.start_date,
          endDate: g.end_date,
          isStarred: g.is_starred,
          current: progress.current,
          percent: progress.percent,
          parTarget: progress.parTarget,
          onPace: progress.onPace,
        };
      });

    return {
      id: project.id,
      title: project.title,
      phase: project.phase as Phase,
      createdAt: project.created_at,
      totalsByMeasure,
      goals: projectGoals,
    };
  });
}

function toEntryRow(e: {
  id: string;
  project_id: string;
  entry_date: string;
  measure: string;
  mode: string;
  amount: number;
  note: string | null;
  created_at: string;
}): EntryRow {
  return {
    id: e.id,
    projectId: e.project_id,
    entryDate: e.entry_date,
    measure: e.measure as WritingMeasure,
    mode: e.mode as EntryMode,
    amount: e.amount,
    note: e.note,
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

export interface LogProgressInput {
  projectId: string;
  entryDate: string;
  measure: WritingMeasure;
  mode: EntryMode;
  amount: number;
  note?: string;
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
  Pick<LogProgressInput, "entryDate" | "measure" | "mode" | "amount" | "note">
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
  targetAmount: number;
  startDate?: string | null;
  endDate?: string | null;
}

export async function createGoal(
  input: CreateGoalInput
): Promise<{ success: true; id: string } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  if (!input.projectId) return { error: "projectId is required" };
  if (!WRITING_MEASURES.includes(input.measure)) return { error: "Invalid measure" };
  if (!input.targetAmount || input.targetAmount <= 0) return { error: "targetAmount must be greater than 0" };

  const ownershipError = await assertOwnsProject(supabase, effectiveIdentity.memberId, input.projectId);
  if (ownershipError) return { error: ownershipError };

  const { data, error } = await supabase
    .from("writing_goals")
    .insert({
      member_id: effectiveIdentity.memberId,
      project_id: input.projectId,
      goal_type: "target",
      measure: input.measure,
      target_amount: input.targetAmount,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create goal" };

  revalidatePath("/writing");
  revalidatePath(`/writing/${input.projectId}`);
  revalidatePath("/dashboard");
  return { success: true, id: data.id };
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
    .select("id, project_id, measure, target_amount, start_date, end_date, is_starred, writing_projects(title)")
    .eq("member_id", effectiveIdentity.memberId)
    .eq("goal_type", "target")
    .eq("is_starred", true);

  if (!goals || goals.length === 0) return [];

  const projectIds = [...new Set(goals.map((g) => g.project_id))];
  const { data: entries } = await supabase
    .from("writing_progress_entries")
    .select("project_id, entry_date, measure, mode, amount, created_at")
    .eq("member_id", effectiveIdentity.memberId)
    .in("project_id", projectIds);

  const now = new Date();

  return goals.map((g) => {
    const project = Array.isArray(g.writing_projects) ? g.writing_projects[0] : g.writing_projects;
    const measureEntries = (entries ?? []).filter(
      (e) => e.project_id === g.project_id && e.measure === g.measure
    );
    const progress = computeGoalProgress({
      entries: measureEntries.map((e) => ({
        entryDate: e.entry_date,
        createdAt: e.created_at,
        mode: e.mode as EntryMode,
        amount: e.amount,
      })),
      targetAmount: g.target_amount,
      startDate: g.start_date,
      endDate: g.end_date,
      now,
    });
    return {
      id: g.id,
      projectId: g.project_id,
      projectTitle: project?.title ?? "Untitled project",
      measure: g.measure as WritingMeasure,
      targetAmount: g.target_amount,
      startDate: g.start_date,
      endDate: g.end_date,
      isStarred: g.is_starred,
      current: progress.current,
      percent: progress.percent,
      parTarget: progress.parTarget,
      onPace: progress.onPace,
    };
  });
}
