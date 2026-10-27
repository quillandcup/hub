import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Stored rows, as the database has them; the twin keeps these. */
export type WritingProjectRow = Row<"writing_projects">;
export type WritingGoalRow = Row<"writing_goals">;
export type WritingEntryRow = Row<"writing_progress_entries">;

/** A project as a picker lists it. */
export interface ProjectChoice {
  id: string;
  title: string;
}

/** What a member logged, to be saved. `amount` is a change (`delta`) or a new total (`set_total`). */
export interface NewProgressEntry {
  memberId: string;
  projectId: string;
  entryDate: string;
  measure: string;
  mode: "delta" | "set_total";
  amount: number;
  prickleId?: string | null;
  note?: string | null;
  tags?: string[];
}

/** One line of a member's CSV export: an entry with its project's title. */
export interface ExportedEntry {
  entry_date: string;
  project_title: string | null;
  measure: string;
  mode: string;
  amount: number;
  note: string | null;
  tags: string[];
}

/**
 * Writing projects, the goals set on them and the progress entries members log (their own, scoped
 * by RLS for a member client). This first slice is what the dashboard, onboarding, the prickle
 * check-in, Slack's quick log and the CSV export need; the project/goal/entry editing in
 * `app/(member)/projects/actions.ts` follows. Every method throws on a database error.
 */
/** The columns of a goal the goal editor and the progress cards read. */
export type GoalColumns = Pick<
  WritingGoalRow,
  "id" | "project_id" | "goal_type" | "measure" | "target_amount" | "start_date" | "end_date" | "habit_period" | "habit_threshold" | "is_starred" | "title" | "description" | "show_on_profile"
>;

/** A goal with the member and the fields editing it starts from. */
export type GoalForEdit = Pick<WritingGoalRow, "id" | "project_id" | "member_id" | "goal_type" | "measure" | "target_amount" | "start_date" | "end_date" | "habit_period" | "habit_threshold">;

/** A starred goal with its project's title. */
export type StarredGoal = GoalColumns & { project_title: string | null };

/** An active goal on an active project, for the check-in and check-out DMs. */
export interface GoalCandidateRow {
  goal_id: string;
  member_id: string;
  project_id: string;
  project_title: string | null;
  measure: string;
}

const GOAL_COLUMNS = "id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, is_starred, title, description, show_on_profile";
const GOAL_PAGE = 1000;

const goalColumns = (g: WritingGoalRow): GoalColumns => ({
  id: g.id,
  project_id: g.project_id,
  goal_type: g.goal_type,
  measure: g.measure,
  target_amount: g.target_amount,
  start_date: g.start_date,
  end_date: g.end_date,
  habit_period: g.habit_period,
  habit_threshold: g.habit_threshold,
  is_starred: g.is_starred,
  title: g.title,
  description: g.description,
  show_on_profile: g.show_on_profile,
});

export interface WritingRepository {
  /** The member's projects that aren't archived, newest first. */
  activeProjects(memberId: string): Promise<ProjectChoice[]>;
  /** The id of the member's newest project that isn't archived, or null. */
  latestActiveProjectId(memberId: string): Promise<string | null>;
  /** Whether the project exists and is this member's. */
  ownsProject(memberId: string, projectId: string): Promise<boolean>;
  /** How many goals the member has set (archived ones included). */
  goalCount(memberId: string): Promise<number>;
  /** The measure of each goal that isn't archived, with its project (a goal can be project-less). */
  activeGoalMeasures(memberId: string): Promise<{ project_id: string | null; measure: string }[]>;
  /** The measures of the member's latest entries, newest first. */
  recentEntryMeasures(memberId: string, limit: number): Promise<{ project_id: string; measure: string }[]>;
  /** What the member logged against this prickle, in the order they logged it. */
  entriesForPrickle(memberId: string, prickleId: string): Promise<{ project_id: string; measure: string; mode: string; amount: number }[]>;
  /** The member's entries by date, with their project's title, optionally one project's. */
  exportEntries(memberId: string, options?: { projectId?: string }): Promise<ExportedEntry[]>;
  /** Saves an entry and returns its id. */
  addEntry(entry: NewProgressEntry): Promise<string>;

  // --- goals ---
  /** Saves a goal and returns its id. */
  createGoal(goal: Insert<"writing_goals">): Promise<string>;
  /** A goal by id (whoever's it is; the caller checks `member_id`), or null. */
  goalForEdit(goalId: string): Promise<GoalForEdit | null>;
  /** Changes the member's goal; a goal that isn't theirs is left alone. */
  updateGoal(memberId: string, goalId: string, patch: Update<"writing_goals">): Promise<void>;
  /** Deletes the member's goal; a goal that isn't theirs is left alone. */
  deleteGoal(memberId: string, goalId: string): Promise<void>;
  /** The member's archived goals on one project, oldest first. */
  archivedGoals(memberId: string, projectId: string): Promise<GoalColumns[]>;
  /** The member's starred goals that aren't archived, with their project's title, oldest first. */
  starredGoals(memberId: string): Promise<StarredGoal[]>;
  /** Every member's goal that isn't archived on a project that isn't, by goal id. */
  activeGoalCandidates(): Promise<GoalCandidateRow[]>;
}

export class SupabaseWritingRepository implements WritingRepository {
  constructor(private readonly db: Db) {}

  async activeProjects(memberId: string): Promise<ProjectChoice[]> {
    const { data, error } = await this.db
      .from("writing_projects")
      .select("id, title")
      .eq("member_id", memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async latestActiveProjectId(memberId: string) {
    const { data, error } = await this.db
      .from("writing_projects")
      .select("id")
      .eq("member_id", memberId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }

  async ownsProject(memberId: string, projectId: string) {
    const { data, error } = await this.db.from("writing_projects").select("id").eq("id", projectId).eq("member_id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  }

  async goalCount(memberId: string) {
    const { count, error } = await this.db.from("writing_goals").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async activeGoalMeasures(memberId: string) {
    const { data, error } = await this.db.from("writing_goals").select("project_id, measure").eq("member_id", memberId).is("archived_at", null);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async recentEntryMeasures(memberId: string, limit: number) {
    const { data, error } = await this.db
      .from("writing_progress_entries")
      .select("project_id, measure")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async entriesForPrickle(memberId: string, prickleId: string) {
    const { data, error } = await this.db
      .from("writing_progress_entries")
      .select("project_id, measure, mode, amount")
      .eq("member_id", memberId)
      .eq("prickle_id", prickleId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async exportEntries(memberId: string, { projectId }: { projectId?: string } = {}): Promise<ExportedEntry[]> {
    let query = this.db
      .from("writing_progress_entries")
      .select("entry_date, measure, mode, amount, note, tags, project:writing_projects(title)")
      .eq("member_id", memberId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((e) => {
      const project = Array.isArray(e.project) ? e.project[0] : e.project;
      return { entry_date: e.entry_date, project_title: project?.title ?? null, measure: e.measure, mode: e.mode, amount: e.amount, note: e.note, tags: e.tags };
    });
  }

  async addEntry(entry: NewProgressEntry) {
    const row: Insert<"writing_progress_entries"> = {
      member_id: entry.memberId,
      project_id: entry.projectId,
      entry_date: entry.entryDate,
      measure: entry.measure,
      mode: entry.mode,
      amount: entry.amount,
      prickle_id: entry.prickleId ?? null,
      note: entry.note ?? null,
      ...(entry.tags ? { tags: entry.tags } : {}),
    };
    const { data, error } = await this.db.from("writing_progress_entries").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  // --- goals ---
  async createGoal(goal: Insert<"writing_goals">) {
    const { data, error } = await this.db.from("writing_goals").insert(goal).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async goalForEdit(goalId: string): Promise<GoalForEdit | null> {
    const { data, error } = await this.db
      .from("writing_goals")
      .select("id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold")
      .eq("id", goalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateGoal(memberId: string, goalId: string, patch: Update<"writing_goals">) {
    const { error } = await this.db.from("writing_goals").update(patch).eq("id", goalId).eq("member_id", memberId);
    if (error) throw new Error(error.message);
  }

  async deleteGoal(memberId: string, goalId: string) {
    const { error } = await this.db.from("writing_goals").delete().eq("id", goalId).eq("member_id", memberId);
    if (error) throw new Error(error.message);
  }

  async archivedGoals(memberId: string, projectId: string): Promise<GoalColumns[]> {
    const { data, error } = await this.db
      .from("writing_goals")
      .select(GOAL_COLUMNS)
      .eq("project_id", projectId)
      .eq("member_id", memberId)
      .not("archived_at", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async starredGoals(memberId: string): Promise<StarredGoal[]> {
    const { data, error } = await this.db
      .from("writing_goals")
      .select(`${GOAL_COLUMNS}, project:writing_projects(title)`)
      .eq("member_id", memberId)
      .eq("is_starred", true)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(({ project, ...goal }) => {
      const p = Array.isArray(project) ? project[0] : project;
      return { ...goal, project_title: p?.title ?? null };
    });
  }

  async activeGoalCandidates(): Promise<GoalCandidateRow[]> {
    const out: GoalCandidateRow[] = [];
    for (let offset = 0; ; offset += GOAL_PAGE) {
      const { data, error } = await this.db
        .from("writing_goals")
        .select("id, member_id, project_id, measure, writing_projects!inner(title, archived_at)")
        .is("archived_at", null)
        .is("writing_projects.archived_at", null)
        .order("id")
        .range(offset, offset + GOAL_PAGE - 1);
      if (error) throw new Error(error.message);
      for (const g of data ?? []) {
        const p = Array.isArray(g.writing_projects) ? g.writing_projects[0] : g.writing_projects;
        out.push({ goal_id: g.id, member_id: g.member_id, project_id: g.project_id as string, project_title: p?.title ?? null, measure: g.measure });
      }
      if ((data?.length ?? 0) < GOAL_PAGE) return out;
    }
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryWritingRepository implements WritingRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private newestFirst<T extends { created_at: string; id: string }>(rows: T[]) {
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  }

  async activeProjects(memberId: string) {
    return this.newestFirst(this.data.writingProjects.filter((p) => p.member_id === memberId && !p.archived_at)).map(({ id, title }) => ({ id, title }));
  }

  async latestActiveProjectId(memberId: string) {
    return (await this.activeProjects(memberId))[0]?.id ?? null;
  }

  async ownsProject(memberId: string, projectId: string) {
    return this.data.writingProjects.some((p) => p.id === projectId && p.member_id === memberId);
  }

  async goalCount(memberId: string) {
    return this.data.writingGoals.filter((g) => g.member_id === memberId).length;
  }

  async activeGoalMeasures(memberId: string) {
    return this.data.writingGoals.filter((g) => g.member_id === memberId && !g.archived_at).map((g) => ({ project_id: g.project_id, measure: g.measure }));
  }

  async recentEntryMeasures(memberId: string, limit: number) {
    return this.newestFirst(this.data.writingEntries.filter((e) => e.member_id === memberId))
      .slice(0, limit)
      .map((e) => ({ project_id: e.project_id, measure: e.measure }));
  }

  async entriesForPrickle(memberId: string, prickleId: string) {
    return this.newestFirst(this.data.writingEntries.filter((e) => e.member_id === memberId && e.prickle_id === prickleId))
      .reverse()
      .map((e) => ({ project_id: e.project_id, measure: e.measure, mode: e.mode, amount: e.amount }));
  }

  async exportEntries(memberId: string, { projectId }: { projectId?: string } = {}) {
    return this.newestFirst(this.data.writingEntries.filter((e) => e.member_id === memberId && (!projectId || e.project_id === projectId)))
      .reverse()
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0))
      .map((e) => ({
        entry_date: e.entry_date,
        project_title: this.data.writingProjects.find((p) => p.id === e.project_id)?.title ?? null,
        measure: e.measure,
        mode: e.mode,
        amount: e.amount,
        note: e.note,
        tags: e.tags,
      }));
  }

  async addEntry(entry: NewProgressEntry) {
    // Strictly after every earlier one, like the database's clock, so "newest first" never ties.
    const latest = Math.max(0, ...this.data.writingEntries.map((e) => Date.parse(e.created_at)));
    const id = `wpe_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.data.writingEntries.push({
      id,
      member_id: entry.memberId,
      project_id: entry.projectId,
      entry_date: entry.entryDate,
      measure: entry.measure,
      mode: entry.mode,
      amount: entry.amount,
      prickle_id: entry.prickleId ?? null,
      note: entry.note ?? null,
      tags: entry.tags ?? [],
      external_id: null,
      created_at: new Date(Math.max(Date.now(), latest + 1)).toISOString(),
    });
    return id;
  }

  // --- goals ---
  private oldestFirst<T extends { created_at: string; id: string }>(rows: T[]) {
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }

  async createGoal(goal: Insert<"writing_goals">) {
    const id = `wgol_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.data.writingGoals.push({
      id,
      member_id: goal.member_id,
      project_id: goal.project_id ?? null,
      title: goal.title ?? null,
      description: goal.description ?? null,
      external_id: goal.external_id ?? null,
      goal_type: goal.goal_type ?? "target",
      habit_period: goal.habit_period ?? null,
      habit_threshold: goal.habit_threshold ?? null,
      is_starred: goal.is_starred ?? false,
      measure: goal.measure,
      show_on_profile: goal.show_on_profile ?? false,
      start_date: goal.start_date ?? null,
      end_date: goal.end_date ?? null,
      target_amount: goal.target_amount ?? null,
      archived_at: goal.archived_at ?? null,
      created_at: goal.created_at ?? new Date().toISOString(),
    });
    return id;
  }

  async goalForEdit(goalId: string) {
    const g = this.data.writingGoals.find((x) => x.id === goalId);
    if (!g) return null;
    const { id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold } = g;
    return { id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold };
  }

  async updateGoal(memberId: string, goalId: string, patch: Update<"writing_goals">) {
    for (const g of this.data.writingGoals) {
      if (g.id === goalId && g.member_id === memberId) Object.assign(g, patch);
    }
  }

  async deleteGoal(memberId: string, goalId: string) {
    this.data.writingGoals = this.data.writingGoals.filter((g) => !(g.id === goalId && g.member_id === memberId));
  }

  async archivedGoals(memberId: string, projectId: string) {
    return this.oldestFirst(this.data.writingGoals.filter((g) => g.member_id === memberId && g.project_id === projectId && g.archived_at)).map(goalColumns);
  }

  async starredGoals(memberId: string) {
    return this.oldestFirst(this.data.writingGoals.filter((g) => g.member_id === memberId && g.is_starred && !g.archived_at)).map((g) => ({
      ...goalColumns(g),
      project_title: this.data.writingProjects.find((p) => p.id === g.project_id)?.title ?? null,
    }));
  }

  async activeGoalCandidates() {
    const out: GoalCandidateRow[] = [];
    for (const g of [...this.data.writingGoals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (g.archived_at) continue;
      const project = this.data.writingProjects.find((p) => p.id === g.project_id);
      if (!project || project.archived_at) continue;
      out.push({ goal_id: g.id, member_id: g.member_id, project_id: project.id, project_title: project.title, measure: g.measure });
    }
    return out;
  }
}
