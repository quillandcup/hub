import { PAST_PHASES, isPastPhase } from "@/lib/writing-projects";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Insert, Row, Update } from "./db";
import { inChunks } from "./query";
import type { InMemoryDataset } from "./in-memory";

/** Stored rows, as the database has them; the twin keeps these. */
// `deleted_at` is optional on the twin's rows so a fixture that predates soft delete still reads as live.
export type WritingProjectRow = Omit<Row<"writing_projects">, "deleted_at"> & { deleted_at?: string | null };
export type WritingGoalRow = Omit<Row<"writing_goals">, "deleted_at"> & { deleted_at?: string | null };
export type WritingEntryRow = Omit<Row<"writing_progress_entries">, "deleted_at"> & { deleted_at?: string | null };
export type WritingBalanceRow = Row<"writing_project_starting_balances">;

// --- projects and starting balances: shapes ---

/** A project with the columns the projects pages show. */
export type ProjectSummary = Pick<WritingProjectRow, "id" | "title" | "phase" | "created_at" | "show_on_profile" | "cover_url" | "description">;
/** An entry with the columns the project totals need. */
export type ProjectEntry = Pick<WritingEntryRow, "id" | "project_id" | "entry_date" | "measure" | "mode" | "amount" | "note" | "tags" | "created_at">;
/** The prickle an entry was logged against, with its type and host joined in. */
export interface EntryPrickle {
  id: string;
  start_time: string;
  host: { name: string | null; display_name: string | null } | null;
  type: { name: string | null } | null;
}
export type ProjectEntryDetail = ProjectEntry & { prickle_id: string | null; prickle: EntryPrickle | null };
export type ProjectGoal = GoalColumns;
export type StartingBalance = Pick<WritingBalanceRow, "project_id" | "measure" | "amount">;
export type ProjectPatch = Partial<Pick<WritingProjectRow, "title" | "description" | "cover_url" | "cover_asset_id" | "show_on_profile" | "phase">>;

const SUMMARY_COLUMNS = "id, title, phase, created_at, show_on_profile, cover_url, description";
const ENTRY_COLUMNS = "id, project_id, entry_date, measure, mode, amount, note, tags, created_at";
const IMPORT_PREFIX = "trackbear:%";

export type ImportedProject = Pick<WritingProjectRow, "id" | "title" | "description" | "phase" | "show_on_profile"> & {
  external_id: string;
  deleted: boolean;
};
export type ImportedEntry = Pick<WritingEntryRow, "project_id" | "entry_date" | "measure" | "mode" | "amount" | "note" | "tags"> & {
  external_id: string;
  deleted: boolean;
};
export type ImportedGoal = Pick<
  WritingGoalRow,
  | "project_id"
  | "goal_type"
  | "measure"
  | "target_amount"
  | "start_date"
  | "end_date"
  | "habit_period"
  | "habit_threshold"
  | "title"
  | "description"
  | "show_on_profile"
> & { external_id: string; deleted: boolean };

/** The fields of an imported entry the export decides. */
export type ImportedEntryPatch = Pick<
  Insert<"writing_progress_entries">,
  "member_id" | "external_id" | "project_id" | "entry_date" | "measure" | "mode" | "amount" | "note" | "tags"
>;
/** The fields of an imported goal the export decides; is_starred (the Hub dashboard pin) is the member's. */
export type ImportedGoalPatch = Pick<
  Update<"writing_goals">,
  | "project_id"
  | "goal_type"
  | "measure"
  | "target_amount"
  | "start_date"
  | "end_date"
  | "habit_period"
  | "habit_threshold"
  | "title"
  | "description"
  | "show_on_profile"
>;

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

// --- progress entries ---

/** Who an entry belongs to and where it sits, for the checks before editing or deleting it. */
export interface EntryOwner {
  id: string;
  project_id: string;
  member_id: string;
  prickle_id: string | null;
}

/** The columns of an entry that goal and total calculations read. */
export interface EntryColumns {
  id: string;
  project_id: string;
  entry_date: string;
  measure: string;
  mode: string;
  amount: number;
  note: string | null;
  tags: string[];
  created_at: string;
}

/** An entry logged against a prickle, with its project's title. */
export interface PrickleEntry extends EntryColumns {
  prickle_id: string | null;
  project_title: string;
}

/** What `updateEntry` changes; a key left out stays as it is. */
export interface EntryPatch {
  entryDate?: string;
  measure?: string;
  mode?: string;
  amount?: number;
  note?: string | null;
  tags?: string[];
  prickleId?: string | null;
}

/** An entry's member, prickle and project, for "already logged for this prickle" lookups. */
export interface LoggedAgainstPrickle {
  member_id: string;
  prickle_id: string;
  project_id: string;
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
  /** The member's projects that aren't archived or deleted, newest first (the picker's list, past phases included), at most `limit` of them. */
  activeProjects(memberId: string, options?: { limit?: number }): Promise<ProjectChoice[]>;
  /** Whether the project exists, is this member's and isn't deleted. */
  ownsProject(memberId: string, projectId: string): Promise<boolean>;
  /** Every member's projects whose cover is a link rather than a library image (for moving them in), by id. Paginated. */
  projectsWithLegacyCovers(): Promise<{ id: string; member_id: string; title: string; cover_url: string }[]>;
  /** The media library asset the member's project uses as its cover, or null (no cover, an older cover, or not theirs). */
  coverAssetOf(memberId: string, projectId: string): Promise<string | null>;
  /** How many goals the member has set (archived ones included). */
  goalCount(memberId: string): Promise<number>;
  /** The measure of each goal that isn't archived, with its project (a goal can be project-less). */
  activeGoalMeasures(memberId: string): Promise<{ project_id: string | null; measure: string }[]>;
  /** The measures of the member's latest entries, newest first, `limit` of them (repeats kept), optionally one project's. */
  recentEntryMeasures(memberId: string, limit: number, options?: { projectId?: string }): Promise<{ project_id: string; measure: string }[]>;
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

  // --- progress entries ---
  /** The entry's owner and place, or null when there is no such entry (or it isn't visible to this client). */
  findEntry(entryId: string): Promise<EntryOwner | null>;
  /** Changes the member's own entry. */
  updateEntry(memberId: string, entryId: string, patch: EntryPatch): Promise<void>;
  /** Deletes the member's own entry. */
  deleteEntry(memberId: string, entryId: string): Promise<void>;
  /** The member's entries linked to one prickle, with their project's title, in the order they were logged. */
  prickleEntries(memberId: string, prickleId: string): Promise<PrickleEntry[]>;
  /** The prickles the member linked an entry to since `since` (ISO, by when the entry was logged). */
  prickleIdsLoggedSince(memberId: string, since: string): Promise<Set<string>>;
  /** Every entry the member logged (all pages), in no particular order; with `projectIds`, only those projects' (an empty list gives none). */
  entries(memberId: string, options?: { projectIds?: string[] }): Promise<EntryColumns[]>;
  /** The dated amounts the member logged in one project for one measure (no particular order). */
  seriesEntries(memberId: string, projectId: string, measure: string): Promise<{ entry_date: string; mode: string; amount: number; created_at: string }[]>;
  /** Which of these members logged against which of these prickles, in which project; every row, past 1000. */
  loggedAgainstPrickles(memberIds: string[], prickleIds: string[]): Promise<LoggedAgainstPrickle[]>;


  // --- projects and starting balances ---

  /** The member's projects still going (not in a past phase), newest first, with the columns the projects pages show; with `past`, those in a past phase (hibernating) instead. */
  projectSummaries(memberId: string, options?: { past?: boolean }): Promise<ProjectSummary[]>;
  /** One of the member's projects (archived or not), or null when it isn't theirs, is deleted or doesn't exist. */
  projectSummary(memberId: string, projectId: string): Promise<ProjectSummary | null>;
  /** One project's entries, newest date first, each with the prickle it was logged against (type and host joined). */
  projectEntriesWithPrickles(memberId: string, projectId: string): Promise<ProjectEntryDetail[]>;
  /** The member's goals that aren't archived, optionally one project's. */
  projectGoals(memberId: string, projectId?: string): Promise<ProjectGoal[]>;
  /** The member's starting balances, optionally one project's. */
  startingBalances(memberId: string, projectId?: string): Promise<StartingBalance[]>;
  /** Creates a project and returns its id. */
  createProject(memberId: string, title: string, phase: string): Promise<string>;
  /** Changes the given fields of the member's project (a project that isn't theirs, or is deleted, is left alone). */
  updateProject(memberId: string, projectId: string, patch: ProjectPatch): Promise<void>;
  /**
   * Soft deletes the member's project together with its goals and entries, so none of them counts
   * toward totals, streaks or badges. Books and awards linked to it stay. Repeating it is harmless.
   */
  deleteProject(memberId: string, projectId: string): Promise<void>;
  /** Sets the starting balance of each `set` measure and removes those of the `clear` measures. */
  replaceStartingBalances(memberId: string, projectId: string, set: { measure: string; amount: number }[], clear: string[]): Promise<void>;

  // --- importing from another tracker (rows carry external ids, unique per member) ---

  /** The member's imported projects (external id starting `trackbear:`), deleted ones included. */
  importedProjects(memberId: string): Promise<ImportedProject[]>;
  /** The member's imported entries, deleted ones included. */
  importedEntries(memberId: string): Promise<ImportedEntry[]>;
  /** The member's imported goals, deleted ones included. */
  importedGoals(memberId: string): Promise<ImportedGoal[]>;
  /** Inserts projects, skipping ones whose (member, external id) exists; returns only those inserted. */
  importProjects(rows: Insert<"writing_projects">[]): Promise<{ id: string; external_id: string }[]>;
  /** Inserts starting balances. */
  importStartingBalances(rows: Insert<"writing_project_starting_balances">[]): Promise<void>;
  /** Inserts entries, skipping ones whose (member, external id) exists; returns how many were inserted. */
  importEntries(rows: Insert<"writing_progress_entries">[]): Promise<number>;
  /** Overwrites the imported entries that carry these external ids (all of one member's; rows for ones that don't exist are ignored, not inserted); returns how many changed. */
  overwriteImportedEntries(rows: ImportedEntryPatch[]): Promise<number>;
  /** Inserts goals, skipping ones whose (member, external id) exists; returns how many were inserted. */
  importGoals(rows: Insert<"writing_goals">[]): Promise<number>;
  /** Overwrites an imported goal's TrackBear-owned fields (its dashboard pin stays); returns how many rows changed (0 or 1). */
  overwriteImportedGoal(memberId: string, externalId: string, patch: ImportedGoalPatch): Promise<number>;
}

export class SupabaseWritingRepository implements WritingRepository {
  constructor(private readonly db: Db) {}

  async activeProjects(memberId: string, { limit }: { limit?: number } = {}): Promise<ProjectChoice[]> {
    let query = this.db
      .from("writing_projects")
      .select("id, title")
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (limit !== undefined) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async ownsProject(memberId: string, projectId: string) {
    const { data, error } = await this.db.from("writing_projects").select("id").eq("id", projectId).eq("member_id", memberId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  }

  async goalCount(memberId: string) {
    const { count, error } = await this.db.from("writing_goals").select("id", { count: "exact", head: true }).eq("member_id", memberId).is("deleted_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async activeGoalMeasures(memberId: string) {
    const { data, error } = await this.db.from("writing_goals").select("project_id, measure").eq("member_id", memberId).is("archived_at", null).is("deleted_at", null);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async recentEntryMeasures(memberId: string, limit: number, { projectId }: { projectId?: string } = {}) {
    let query = this.db.from("writing_progress_entries").select("project_id, measure").eq("member_id", memberId).is("deleted_at", null);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async exportEntries(memberId: string, { projectId }: { projectId?: string } = {}): Promise<ExportedEntry[]> {
    let query = this.db
      .from("writing_progress_entries")
      .select("entry_date, measure, mode, amount, note, tags, project:writing_projects(title)")
      .eq("member_id", memberId)
      .is("deleted_at", null)
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
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateGoal(memberId: string, goalId: string, patch: Update<"writing_goals">) {
    const { error } = await this.db.from("writing_goals").update(patch).eq("id", goalId).eq("member_id", memberId).is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async deleteGoal(memberId: string, goalId: string) {
    const { error } = await this.db
      .from("writing_goals")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", goalId)
      .eq("member_id", memberId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async archivedGoals(memberId: string, projectId: string): Promise<GoalColumns[]> {
    const { data, error } = await this.db
      .from("writing_goals")
      .select(GOAL_COLUMNS)
      .eq("project_id", projectId)
      .eq("member_id", memberId)
      .not("archived_at", "is", null)
      .is("deleted_at", null)
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
      .is("deleted_at", null)
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
        .select("id, member_id, project_id, measure, writing_projects!inner(title)")
        .is("archived_at", null)
        .is("deleted_at", null)
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

  // --- progress entries ---
  async findEntry(entryId: string) {
    const { data, error } = await this.db.from("writing_progress_entries").select("id, project_id, member_id, prickle_id").eq("id", entryId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateEntry(memberId: string, entryId: string, patch: EntryPatch) {
    const updates: Update<"writing_progress_entries"> = {};
    if (patch.entryDate !== undefined) updates.entry_date = patch.entryDate;
    if (patch.measure !== undefined) updates.measure = patch.measure;
    if (patch.mode !== undefined) updates.mode = patch.mode;
    if (patch.amount !== undefined) updates.amount = patch.amount;
    if (patch.note !== undefined) updates.note = patch.note;
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.prickleId !== undefined) updates.prickle_id = patch.prickleId;
    const { error } = await this.db.from("writing_progress_entries").update(updates).eq("id", entryId).eq("member_id", memberId).is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async deleteEntry(memberId: string, entryId: string) {
    const { error } = await this.db
      .from("writing_progress_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("member_id", memberId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async prickleEntries(memberId: string, prickleId: string): Promise<PrickleEntry[]> {
    const { data, error } = await this.db
      .from("writing_progress_entries")
      .select("id, project_id, entry_date, measure, mode, amount, note, tags, created_at, prickle_id, project:writing_projects!inner(title)")
      .eq("member_id", memberId)
      .eq("prickle_id", prickleId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(({ project, ...entry }) => ({ ...entry, project_title: (Array.isArray(project) ? project[0] : project)?.title ?? "" }));
  }

  async prickleIdsLoggedSince(memberId: string, since: string) {
    const { data, error } = await this.db
      .from("writing_progress_entries")
      .select("prickle_id")
      .eq("member_id", memberId)
      .not("prickle_id", "is", null)
      .is("deleted_at", null)
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((e) => e.prickle_id as string));
  }

  async entries(memberId: string, { projectIds }: { projectIds?: string[] } = {}) {
    if (projectIds?.length === 0) return [];
    return fetchAllRows<EntryColumns>((from, to) => {
      let query = this.db.from("writing_progress_entries").select(ENTRY_COLUMNS).eq("member_id", memberId).is("deleted_at", null);
      if (projectIds) query = query.in("project_id", projectIds);
      return query.order("id").range(from, to);
    });
  }

  async seriesEntries(memberId: string, projectId: string, measure: string) {
    return fetchAllRows<{ entry_date: string; mode: string; amount: number; created_at: string }>((from, to) =>
      this.db
        .from("writing_progress_entries")
        .select("entry_date, mode, amount, created_at")
        .eq("project_id", projectId)
        .eq("member_id", memberId)
        .eq("measure", measure)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    );
  }

  async loggedAgainstPrickles(memberIds: string[], prickleIds: string[]) {
    const rows = await fetchAllRows<{ member_id: string; prickle_id: string | null; project_id: string }>((from, to) =>
      this.db
        .from("writing_progress_entries")
        .select("member_id, prickle_id, project_id")
        .in("prickle_id", prickleIds)
        .in("member_id", memberIds)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    );
    return rows.map((r) => ({ member_id: r.member_id, prickle_id: r.prickle_id as string, project_id: r.project_id }));
  }

  // --- projects and starting balances ---

  async projectSummaries(memberId: string, { past = false }: { past?: boolean } = {}): Promise<ProjectSummary[]> {
    const query = this.db.from("writing_projects").select(SUMMARY_COLUMNS).eq("member_id", memberId);
    const { data, error } = await (past ? query.in("phase", [...PAST_PHASES]) : query.not("phase", "in", `(${PAST_PHASES.join(",")})`))
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async projectSummary(memberId: string, projectId: string): Promise<ProjectSummary | null> {
    const { data, error } = await this.db
      .from("writing_projects")
      .select(SUMMARY_COLUMNS)
      .eq("id", projectId)
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async projectEntriesWithPrickles(memberId: string, projectId: string): Promise<ProjectEntryDetail[]> {
    const rows = await fetchAllRows((from, to) =>
      this.db
        .from("writing_progress_entries")
        .select(`${ENTRY_COLUMNS}, prickle_id, prickle:prickles(id, start_time, host:prickle_host(name, display_name), prickle_types:type_id(name))`)
        .eq("project_id", projectId)
        .eq("member_id", memberId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    );
    const one = <T>(ref: T | T[] | null | undefined): T | null => (Array.isArray(ref) ? ref[0] : ref) ?? null;
    return rows.map(({ prickle, ...entry }) => {
      const p = one(prickle);
      return { ...entry, prickle: p ? { id: p.id, start_time: p.start_time, host: one(p.host), type: one(p.prickle_types) } : null };
    });
  }

  async projectGoals(memberId: string, projectId?: string): Promise<ProjectGoal[]> {
    return fetchAllRows<ProjectGoal>((from, to) => {
      let query = this.db.from("writing_goals").select(GOAL_COLUMNS).eq("member_id", memberId).is("archived_at", null).is("deleted_at", null);
      if (projectId) query = query.eq("project_id", projectId);
      return query.order("id").range(from, to);
    });
  }

  async startingBalances(memberId: string, projectId?: string): Promise<StartingBalance[]> {
    return fetchAllRows<StartingBalance>((from, to) => {
      let query = this.db.from("writing_project_starting_balances").select("project_id, measure, amount").eq("member_id", memberId);
      if (projectId) query = query.eq("project_id", projectId);
      return query.order("project_id").order("measure").range(from, to);
    });
  }

  async createProject(memberId: string, title: string, phase: string): Promise<string> {
    const { data, error } = await this.db.from("writing_projects").insert({ member_id: memberId, title, phase }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async projectsWithLegacyCovers() {
    type Row = { id: string; member_id: string; title: string; cover_url: string };
    return fetchAllRows<Row>(
      (from, to) =>
        this.db.from("writing_projects").select("id, member_id, title, cover_url").not("cover_url", "is", null).is("cover_asset_id", null).order("id").range(from, to)
    );
  }

  async coverAssetOf(memberId: string, projectId: string): Promise<string | null> {
    const { data, error } = await this.db.from("writing_projects").select("cover_asset_id").eq("id", projectId).eq("member_id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.cover_asset_id ?? null;
  }

  async updateProject(memberId: string, projectId: string, patch: ProjectPatch): Promise<void> {
    const { error } = await this.db.from("writing_projects").update(patch).eq("id", projectId).eq("member_id", memberId).is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async deleteProject(memberId: string, projectId: string): Promise<void> {
    // The children first: if one step fails the project is still live and the member can try again.
    const deletedAt = new Date().toISOString();
    for (const table of ["writing_progress_entries", "writing_goals"] as const) {
      const { error } = await this.db.from(table).update({ deleted_at: deletedAt }).eq("project_id", projectId).eq("member_id", memberId).is("deleted_at", null);
      if (error) throw new Error(error.message);
    }
    const { error } = await this.db.from("writing_projects").update({ deleted_at: deletedAt }).eq("id", projectId).eq("member_id", memberId).is("deleted_at", null);
    if (error) throw new Error(error.message);
  }

  async replaceStartingBalances(memberId: string, projectId: string, set: { measure: string; amount: number }[], clear: string[]): Promise<void> {
    if (set.length > 0) {
      const { error } = await this.db
        .from("writing_project_starting_balances")
        .upsert(set.map(({ measure, amount }) => ({ project_id: projectId, member_id: memberId, measure, amount })), { onConflict: "project_id,measure" });
      if (error) throw new Error(error.message);
    }
    if (clear.length > 0) {
      const { error } = await this.db
        .from("writing_project_starting_balances")
        .delete()
        .eq("project_id", projectId)
        .eq("member_id", memberId)
        .in("measure", clear);
      if (error) throw new Error(error.message);
    }
  }

  // --- importing from another tracker ---

  async importedProjects(memberId: string): Promise<ImportedProject[]> {
    const rows = await fetchAllRows<Pick<WritingProjectRow, "id" | "external_id" | "title" | "description" | "phase" | "show_on_profile" | "deleted_at">>((from, to) =>
      this.db
        .from("writing_projects")
        .select("id, external_id, title, description, phase, show_on_profile, deleted_at")
        .eq("member_id", memberId)
        .like("external_id", IMPORT_PREFIX)
        .order("id")
        .range(from, to),
    );
    return rows.map(({ external_id, deleted_at, ...r }) => ({ ...r, external_id: external_id!, deleted: !!deleted_at }));
  }

  async importedEntries(memberId: string): Promise<ImportedEntry[]> {
    const rows = await fetchAllRows<Pick<WritingEntryRow, "external_id" | "project_id" | "entry_date" | "measure" | "mode" | "amount" | "note" | "tags" | "deleted_at">>((from, to) =>
      this.db
        .from("writing_progress_entries")
        .select("external_id, project_id, entry_date, measure, mode, amount, note, tags, deleted_at")
        .eq("member_id", memberId)
        .like("external_id", IMPORT_PREFIX)
        .order("id")
        .range(from, to),
    );
    return rows.map(({ external_id, deleted_at, ...r }) => ({ ...r, external_id: external_id!, deleted: !!deleted_at }));
  }

  async importedGoals(memberId: string): Promise<ImportedGoal[]> {
    const rows = await fetchAllRows<
      Pick<WritingGoalRow, "external_id" | "project_id" | "goal_type" | "measure" | "target_amount" | "start_date" | "end_date" | "habit_period" | "habit_threshold" | "title" | "description" | "show_on_profile" | "deleted_at">
    >((from, to) =>
      this.db
        .from("writing_goals")
        .select("external_id, project_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold, title, description, show_on_profile, deleted_at")
        .eq("member_id", memberId)
        .like("external_id", IMPORT_PREFIX)
        .order("id")
        .range(from, to),
    );
    return rows.map(({ external_id, deleted_at, ...r }) => ({ ...r, external_id: external_id!, deleted: !!deleted_at }));
  }

  async importProjects(rows: Insert<"writing_projects">[]) {
    const { data, error } = await this.db
      .from("writing_projects")
      .upsert(rows, { onConflict: "member_id,external_id", ignoreDuplicates: true })
      .select("id, external_id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, external_id: r.external_id! }));
  }

  async importStartingBalances(rows: Insert<"writing_project_starting_balances">[]) {
    const { error } = await this.db.from("writing_project_starting_balances").insert(rows);
    if (error) throw new Error(error.message);
  }

  async importEntries(rows: Insert<"writing_progress_entries">[]) {
    const { data, error } = await this.db
      .from("writing_progress_entries")
      .upsert(rows, { onConflict: "member_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }

  async importGoals(rows: Insert<"writing_goals">[]) {
    const { data, error } = await this.db
      .from("writing_goals")
      .upsert(rows, { onConflict: "member_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }

  async overwriteImportedEntries(rows: ImportedEntryPatch[]) {
    if (rows.length === 0) return 0;
    // An upsert would insert a row whose external id is missing, so look up which exist first.
    const present = new Set(
      (
        await inChunks(
          rows.map((r) => r.external_id!),
          100,
          async (ids) => {
            const { data, error } = await this.db
              .from("writing_progress_entries")
              .select("external_id")
              .eq("member_id", rows[0].member_id)
              .in("external_id", ids);
            if (error) throw new Error(error.message);
            return data ?? [];
          }
        )
      ).map((r) => r.external_id)
    );
    const existing = rows.filter((r) => present.has(r.external_id!));
    if (existing.length === 0) return 0;
    // Only the listed columns are written on a conflict, so created_at, deleted_at and the like stay.
    const { data, error } = await this.db
      .from("writing_progress_entries")
      .upsert(existing, { onConflict: "member_id,external_id" })
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }

  async overwriteImportedGoal(memberId: string, externalId: string, patch: ImportedGoalPatch) {
    const { data, error } = await this.db
      .from("writing_goals")
      .update(patch)
      .eq("member_id", memberId)
      .eq("external_id", externalId)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryWritingRepository implements WritingRepository {
  constructor(private readonly data: InMemoryDataset) {}

  /** Rows a member deleted stay in the dataset, as in the database, and every read skips them. */
  private liveGoals() {
    return this.data.writingGoals.filter((g) => !g.deleted_at);
  }

  private liveEntries() {
    return this.data.writingEntries.filter((e) => !e.deleted_at);
  }

  private newestFirst<T extends { created_at: string; id: string }>(rows: T[]) {
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  }

  async activeProjects(memberId: string, { limit }: { limit?: number } = {}) {
    return this.newestFirst(this.data.writingProjects.filter((p) => p.member_id === memberId && !p.deleted_at))
      .slice(0, limit)
      .map(({ id, title }) => ({ id, title }));
  }

  async ownsProject(memberId: string, projectId: string) {
    return this.data.writingProjects.some((p) => p.id === projectId && p.member_id === memberId && !p.deleted_at);
  }

  async goalCount(memberId: string) {
    return this.liveGoals().filter((g) => g.member_id === memberId).length;
  }

  async activeGoalMeasures(memberId: string) {
    return this.liveGoals().filter((g) => g.member_id === memberId && !g.archived_at).map((g) => ({ project_id: g.project_id, measure: g.measure }));
  }

  async recentEntryMeasures(memberId: string, limit: number, { projectId }: { projectId?: string } = {}) {
    return this.newestFirst(this.liveEntries().filter((e) => e.member_id === memberId && (!projectId || e.project_id === projectId)))
      .slice(0, limit)
      .map((e) => ({ project_id: e.project_id, measure: e.measure }));
  }

  async exportEntries(memberId: string, { projectId }: { projectId?: string } = {}) {
    return this.newestFirst(this.liveEntries().filter((e) => e.member_id === memberId && (!projectId || e.project_id === projectId)))
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
      deleted_at: null,
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
      deleted_at: null,
      created_at: goal.created_at ?? new Date().toISOString(),
    });
    return id;
  }

  async goalForEdit(goalId: string) {
    const g = this.liveGoals().find((x) => x.id === goalId);
    if (!g) return null;
    const { id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold } = g;
    return { id, project_id, member_id, goal_type, measure, target_amount, start_date, end_date, habit_period, habit_threshold };
  }

  async updateGoal(memberId: string, goalId: string, patch: Update<"writing_goals">) {
    for (const g of this.liveGoals()) {
      if (g.id === goalId && g.member_id === memberId) Object.assign(g, patch);
    }
  }

  async deleteGoal(memberId: string, goalId: string) {
    for (const g of this.liveGoals()) {
      if (g.id === goalId && g.member_id === memberId) g.deleted_at = new Date().toISOString();
    }
  }

  async archivedGoals(memberId: string, projectId: string) {
    return this.oldestFirst(this.liveGoals().filter((g) => g.member_id === memberId && g.project_id === projectId && g.archived_at)).map(goalColumns);
  }

  async starredGoals(memberId: string) {
    return this.oldestFirst(this.liveGoals().filter((g) => g.member_id === memberId && g.is_starred && !g.archived_at)).map((g) => ({
      ...goalColumns(g),
      project_title: this.data.writingProjects.find((p) => p.id === g.project_id)?.title ?? null,
    }));
  }

  async activeGoalCandidates() {
    const out: GoalCandidateRow[] = [];
    for (const g of [...this.liveGoals()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (g.archived_at) continue;
      const project = this.data.writingProjects.find((p) => p.id === g.project_id);
      if (!project) continue;
      out.push({ goal_id: g.id, member_id: g.member_id, project_id: project.id, project_title: project.title, measure: g.measure });
    }
    return out;
  }

  // --- progress entries ---
  private columns(e: WritingEntryRow): EntryColumns {
    return { id: e.id, project_id: e.project_id, entry_date: e.entry_date, measure: e.measure, mode: e.mode, amount: e.amount, note: e.note, tags: [...e.tags], created_at: e.created_at };
  }

  async findEntry(entryId: string) {
    const e = this.liveEntries().find((x) => x.id === entryId);
    return e ? { id: e.id, project_id: e.project_id, member_id: e.member_id, prickle_id: e.prickle_id } : null;
  }

  async updateEntry(memberId: string, entryId: string, patch: EntryPatch) {
    const e = this.liveEntries().find((x) => x.id === entryId && x.member_id === memberId);
    if (!e) return;
    if (patch.entryDate !== undefined) e.entry_date = patch.entryDate;
    if (patch.measure !== undefined) e.measure = patch.measure;
    if (patch.mode !== undefined) e.mode = patch.mode;
    if (patch.amount !== undefined) e.amount = patch.amount;
    if (patch.note !== undefined) e.note = patch.note;
    if (patch.tags !== undefined) e.tags = patch.tags;
    if (patch.prickleId !== undefined) e.prickle_id = patch.prickleId;
  }

  async deleteEntry(memberId: string, entryId: string) {
    for (const e of this.liveEntries()) {
      if (e.id === entryId && e.member_id === memberId) e.deleted_at = new Date().toISOString();
    }
  }

  async prickleEntries(memberId: string, prickleId: string): Promise<PrickleEntry[]> {
    return this.newestFirst(this.liveEntries().filter((e) => e.member_id === memberId && e.prickle_id === prickleId))
      .reverse()
      .flatMap((e) => {
        const project = this.data.writingProjects.find((p) => p.id === e.project_id);
        return project ? [{ ...this.columns(e), prickle_id: e.prickle_id, project_title: project.title }] : [];
      });
  }

  async prickleIdsLoggedSince(memberId: string, since: string) {
    return new Set(this.liveEntries().filter((e) => e.member_id === memberId && e.prickle_id && e.created_at >= since).map((e) => e.prickle_id as string));
  }

  async entries(memberId: string, { projectIds }: { projectIds?: string[] } = {}) {
    return this.liveEntries()
      .filter((e) => e.member_id === memberId && (!projectIds || projectIds.includes(e.project_id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((e) => this.columns(e));
  }

  async seriesEntries(memberId: string, projectId: string, measure: string) {
    return this.liveEntries()
      .filter((e) => e.member_id === memberId && e.project_id === projectId && e.measure === measure)
      .map((e) => ({ entry_date: e.entry_date, mode: e.mode, amount: e.amount, created_at: e.created_at }));
  }

  async loggedAgainstPrickles(memberIds: string[], prickleIds: string[]) {
    return this.liveEntries()
      .filter((e) => e.prickle_id && prickleIds.includes(e.prickle_id) && memberIds.includes(e.member_id))
      .map((e) => ({ member_id: e.member_id, prickle_id: e.prickle_id as string, project_id: e.project_id }));
  }

  // --- projects and starting balances ---

  private newId(prefix: string) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }

  async projectSummaries(memberId: string, { past = false }: { past?: boolean } = {}): Promise<ProjectSummary[]> {
    return this.newestFirst(this.data.writingProjects.filter((p) => p.member_id === memberId && isPastPhase(p.phase) === past && !p.deleted_at)).map(summaryOf);
  }

  async projectSummary(memberId: string, projectId: string): Promise<ProjectSummary | null> {
    const project = this.data.writingProjects.find((p) => p.id === projectId && p.member_id === memberId && !p.deleted_at);
    return project ? summaryOf(project) : null;
  }

  async projectEntriesWithPrickles(memberId: string, projectId: string): Promise<ProjectEntryDetail[]> {
    return this.newestFirst(this.liveEntries().filter((e) => e.member_id === memberId && e.project_id === projectId))
      .sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0))
      .map((e) => {
        const prickle = e.prickle_id ? this.data.prickles.find((p) => p.id === e.prickle_id) : undefined;
        const host = prickle?.hostId ? this.data.members.find((m) => m.id === prickle.hostId) : undefined;
        const type = prickle?.typeId ? this.data.prickleTypes.find((t) => t.id === prickle.typeId) : undefined;
        return {
          ...entryOf(e),
          prickle_id: e.prickle_id,
          prickle: prickle
            ? {
                id: prickle.id,
                start_time: prickle.startTime,
                host: host ? { name: host.name, display_name: host.displayName ?? null } : null,
                type: type ? { name: type.name } : null,
              }
            : null,
        };
      });
  }

  async projectGoals(memberId: string, projectId?: string): Promise<ProjectGoal[]> {
    return this.liveGoals()
      .filter((g) => g.member_id === memberId && !g.archived_at && (!projectId || g.project_id === projectId))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((g) => ({
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
      }));
  }

  async startingBalances(memberId: string, projectId?: string): Promise<StartingBalance[]> {
    return this.data.writingBalances
      .filter((b) => b.member_id === memberId && (!projectId || b.project_id === projectId))
      .map(({ project_id, measure, amount }) => ({ project_id, measure, amount }))
      .sort((a, b) => (a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : a.measure < b.measure ? -1 : 1));
  }

  async createProject(memberId: string, title: string, phase: string): Promise<string> {
    const id = this.newId("wprj");
    this.data.writingProjects.push({
      id,
      member_id: memberId,
      title,
      phase,
      description: null,
      cover_asset_id: null,
      cover_url: null,
      external_id: null,
      show_on_profile: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  async projectsWithLegacyCovers() {
    return this.data.writingProjects
      .filter((p) => p.cover_url !== null && p.cover_asset_id === null)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((p) => ({ id: p.id, member_id: p.member_id, title: p.title, cover_url: p.cover_url as string }));
  }

  async coverAssetOf(memberId: string, projectId: string): Promise<string | null> {
    return this.data.writingProjects.find((p) => p.id === projectId && p.member_id === memberId)?.cover_asset_id ?? null;
  }

  async updateProject(memberId: string, projectId: string, patch: ProjectPatch): Promise<void> {
    const project = this.data.writingProjects.find((p) => p.id === projectId && p.member_id === memberId && !p.deleted_at);
    if (project) Object.assign(project, patch);
  }

  async deleteProject(memberId: string, projectId: string): Promise<void> {
    const deletedAt = new Date().toISOString();
    for (const row of [...this.data.writingEntries, ...this.data.writingGoals]) {
      if (row.project_id === projectId && row.member_id === memberId && !row.deleted_at) row.deleted_at = deletedAt;
    }
    const project = this.data.writingProjects.find((p) => p.id === projectId && p.member_id === memberId && !p.deleted_at);
    if (project) project.deleted_at = deletedAt;
  }

  async replaceStartingBalances(memberId: string, projectId: string, set: { measure: string; amount: number }[], clear: string[]): Promise<void> {
    for (const { measure, amount } of set) {
      const existing = this.data.writingBalances.find((b) => b.project_id === projectId && b.measure === measure);
      if (existing) existing.amount = amount;
      else this.data.writingBalances.push({ project_id: projectId, member_id: memberId, measure, amount });
    }
    this.data.writingBalances = this.data.writingBalances.filter((b) => !(b.project_id === projectId && b.member_id === memberId && clear.includes(b.measure)));
  }

  // --- importing from another tracker ---

  private imported<T extends { member_id: string; external_id: string | null }>(rows: T[], memberId: string) {
    return rows.filter((r) => r.member_id === memberId && r.external_id?.startsWith("trackbear:"));
  }

  /** The rows not already present for their member and external id, nor repeated earlier in the batch. */
  private fresh<T extends { member_id: string; external_id?: string | null }>(existing: { member_id: string; external_id: string | null }[], rows: T[]) {
    const seen = new Set(existing.filter((r) => r.external_id).map((r) => `${r.member_id}|${r.external_id}`));
    return rows.filter((r) => {
      const key = `${r.member_id}|${r.external_id}`;
      if (r.external_id && seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async importedProjects(memberId: string): Promise<ImportedProject[]> {
    return this.imported(this.data.writingProjects, memberId).map((p) => ({
      id: p.id,
      external_id: p.external_id!,
      title: p.title,
      description: p.description,
      phase: p.phase,
      show_on_profile: p.show_on_profile,
      deleted: !!p.deleted_at,
    }));
  }

  async importedEntries(memberId: string): Promise<ImportedEntry[]> {
    return this.imported(this.data.writingEntries, memberId).map((e) => ({
      external_id: e.external_id!,
      project_id: e.project_id,
      entry_date: e.entry_date,
      measure: e.measure,
      mode: e.mode,
      amount: e.amount,
      note: e.note,
      tags: e.tags,
      deleted: !!e.deleted_at,
    }));
  }

  async importedGoals(memberId: string): Promise<ImportedGoal[]> {
    return this.imported(this.data.writingGoals, memberId).map((g) => ({
      external_id: g.external_id!,
      project_id: g.project_id,
      goal_type: g.goal_type,
      measure: g.measure,
      target_amount: g.target_amount,
      start_date: g.start_date,
      end_date: g.end_date,
      habit_period: g.habit_period,
      habit_threshold: g.habit_threshold,
      title: g.title,
      description: g.description,
      show_on_profile: g.show_on_profile,
      deleted: !!g.deleted_at,
    }));
  }

  async importProjects(rows: Insert<"writing_projects">[]) {
    const created: { id: string; external_id: string }[] = [];
    for (const r of this.fresh(this.data.writingProjects, rows)) {
      const id = this.newId("wprj");
      this.data.writingProjects.push({
        id,
        member_id: r.member_id,
        title: r.title,
        phase: r.phase ?? "drafting",
        description: r.description ?? null,
        cover_asset_id: r.cover_asset_id ?? null,
        cover_url: r.cover_url ?? null,
        external_id: r.external_id ?? null,
        show_on_profile: r.show_on_profile ?? false,
        created_at: r.created_at ?? new Date().toISOString(),
      });
      if (r.external_id) created.push({ id, external_id: r.external_id });
    }
    return created;
  }

  async importStartingBalances(rows: Insert<"writing_project_starting_balances">[]) {
    for (const r of rows) {
      if (this.data.writingBalances.some((b) => b.project_id === r.project_id && b.measure === r.measure)) {
        throw new Error("duplicate key value violates unique constraint");
      }
      this.data.writingBalances.push({ project_id: r.project_id, member_id: r.member_id, measure: r.measure, amount: r.amount });
    }
  }

  async importEntries(rows: Insert<"writing_progress_entries">[]) {
    const fresh = this.fresh(this.data.writingEntries, rows);
    for (const r of fresh) {
      this.data.writingEntries.push({
        id: this.newId("wpe"),
        member_id: r.member_id,
        project_id: r.project_id,
        entry_date: r.entry_date,
        measure: r.measure,
        mode: r.mode,
        amount: r.amount,
        note: r.note ?? null,
        tags: r.tags ?? [],
        prickle_id: r.prickle_id ?? null,
        external_id: r.external_id ?? null,
        created_at: r.created_at ?? new Date().toISOString(),
      });
    }
    return fresh.length;
  }

  async importGoals(rows: Insert<"writing_goals">[]) {
    const fresh = this.fresh(this.data.writingGoals, rows);
    for (const r of fresh) {
      this.data.writingGoals.push({
        id: this.newId("wgol"),
        member_id: r.member_id,
        project_id: r.project_id ?? null,
        goal_type: r.goal_type ?? "target",
        measure: r.measure,
        target_amount: r.target_amount ?? null,
        start_date: r.start_date ?? null,
        end_date: r.end_date ?? null,
        habit_period: r.habit_period ?? null,
        habit_threshold: r.habit_threshold ?? null,
        is_starred: r.is_starred ?? false,
        title: r.title ?? null,
        description: r.description ?? null,
        show_on_profile: r.show_on_profile ?? false,
        external_id: r.external_id ?? null,
        archived_at: null,
        created_at: r.created_at ?? new Date().toISOString(),
      });
    }
    return fresh.length;
  }

  async overwriteImportedEntries(rows: ImportedEntryPatch[]) {
    let changed = 0;
    for (const r of rows) {
      const entry = this.data.writingEntries.find((e) => e.member_id === r.member_id && e.external_id === r.external_id);
      if (!entry) continue;
      Object.assign(entry, {
        project_id: r.project_id,
        entry_date: r.entry_date,
        measure: r.measure,
        mode: r.mode,
        amount: r.amount,
        note: r.note ?? null,
        tags: r.tags ?? [],
      });
      changed++;
    }
    return changed;
  }

  async overwriteImportedGoal(memberId: string, externalId: string, patch: ImportedGoalPatch) {
    const goal = this.data.writingGoals.find((g) => g.member_id === memberId && g.external_id === externalId && !g.deleted_at);
    if (!goal) return 0;
    Object.assign(goal, patch);
    return 1;
  }
}


const summaryOf = (p: WritingProjectRow): ProjectSummary => ({
  id: p.id,
  title: p.title,
  phase: p.phase,
  created_at: p.created_at,
  show_on_profile: p.show_on_profile,
  cover_url: p.cover_url,
  description: p.description,
});

const entryOf = (e: WritingEntryRow): ProjectEntry => ({
  id: e.id,
  project_id: e.project_id,
  entry_date: e.entry_date,
  measure: e.measure,
  mode: e.mode,
  amount: e.amount,
  note: e.note,
  tags: e.tags,
  created_at: e.created_at,
});
