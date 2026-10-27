import type { Db, Insert, Row } from "./db";
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
}
