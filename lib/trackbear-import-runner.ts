import type { SupabaseClient } from "@supabase/supabase-js";
import {
  planTrackbearImport,
  type ExistingImports,
  type ImportIssue,
  type TrackbearData,
} from "@/lib/trackbear-import";

/**
 * Writes a TrackBear export into a member's writing projects (planning/mapping lives in
 * lib/trackbear-import.ts). Idempotent via each table's external_id unique index: rows already
 * brought over are skipped, and a run that dies partway (timeout, network) is finished by simply
 * importing the same file again.
 */

const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const COVER_CONCURRENCY = 4;

export interface TrackbearImportResult {
  created: { projects: number; entries: number; goals: number; startingBalances: number; covers: number };
  alreadyImported: { projects: number; entries: number; goals: number };
  issues: ImportIssue[];
}

/** Copies one TrackBear cover into Hub storage; returns the new public URL. Injected so tests don't hit the network. */
export type CoverCopier = (
  coverFilename: string,
  memberId: string
) => Promise<{ url: string; resizedFrom: string | null } | { error: string }>;

async function selectAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function loadExistingImports(supabase: SupabaseClient, memberId: string): Promise<ExistingImports> {
  const [projects, entries, goals] = await Promise.all([
    selectAllPages<{ id: string; external_id: string }>((from, to) =>
      supabase
        .from("writing_projects")
        .select("id, external_id")
        .eq("member_id", memberId)
        .like("external_id", "trackbear:%")
        .order("id")
        .range(from, to)
    ),
    selectAllPages<{ external_id: string }>((from, to) =>
      supabase
        .from("writing_progress_entries")
        .select("external_id")
        .eq("member_id", memberId)
        .like("external_id", "trackbear:%")
        .order("id")
        .range(from, to)
    ),
    selectAllPages<{ external_id: string }>((from, to) =>
      supabase
        .from("writing_goals")
        .select("external_id")
        .eq("member_id", memberId)
        .like("external_id", "trackbear:%")
        .order("id")
        .range(from, to)
    ),
  ]);
  return {
    projectIdsByExternalId: new Map(projects.map((p) => [p.external_id, p.id])),
    entryExternalIds: new Set(entries.map((e) => e.external_id)),
    goalExternalIds: new Set(goals.map((g) => g.external_id)),
  };
}

export async function runTrackbearImport(
  supabase: SupabaseClient,
  memberId: string,
  data: TrackbearData,
  copyCover: CoverCopier
): Promise<TrackbearImportResult> {
  const existing = await loadExistingImports(supabase, memberId);
  const plan = planTrackbearImport(data, existing);
  const issues = [...plan.issues];
  const created = { projects: 0, entries: 0, goals: 0, startingBalances: 0, covers: 0 };

  // 1. Projects. ignoreDuplicates (ON CONFLICT DO NOTHING) covers a concurrent double-submit;
  // returned rows are only the ones this call actually inserted.
  const projectIds = new Map(existing.projectIdsByExternalId);
  const insertedProjectIds = new Set<string>();
  for (const batch of chunk(plan.newProjects, BATCH_SIZE)) {
    const { data: rows, error } = await supabase
      .from("writing_projects")
      .upsert(
        batch.map((p) => ({
          member_id: memberId,
          external_id: p.externalId,
          title: p.title,
          description: p.description,
          phase: p.phase,
          show_on_profile: p.showOnProfile,
          created_at: p.createdAt,
        })),
        { onConflict: "member_id,external_id", ignoreDuplicates: true }
      )
      .select("id, external_id");
    if (error) throw new Error(`Failed to create projects: ${error.message}`);
    for (const row of rows ?? []) {
      projectIds.set(row.external_id, row.id);
      insertedProjectIds.add(row.external_id);
    }
  }
  created.projects = insertedProjectIds.size;
  // Rows skipped by ON CONFLICT (a concurrent import won the race) still need their ids.
  if (insertedProjectIds.size < plan.newProjects.length) {
    const refreshed = await loadExistingImports(supabase, memberId);
    for (const [externalId, id] of refreshed.projectIdsByExternalId) projectIds.set(externalId, id);
  }

  // Starting balances + covers only for projects this run created -- an already-imported
  // project may have been edited in Hub since, and those edits win.
  const freshProjects = plan.newProjects.filter((p) => insertedProjectIds.has(p.externalId));

  // 2. Starting balances
  const balanceRows = freshProjects.flatMap((p) =>
    p.startingBalances.map((b) => ({
      project_id: projectIds.get(p.externalId)!,
      member_id: memberId,
      measure: b.measure,
      amount: b.amount,
    }))
  );
  if (balanceRows.length > 0) {
    const { error } = await supabase.from("writing_project_starting_balances").insert(balanceRows);
    if (error) throw new Error(`Failed to save starting balances: ${error.message}`);
    created.startingBalances = balanceRows.length;
  }

  // 3. Progress entries -- batched, batches in parallel.
  const entryResults = await Promise.all(
    chunk(plan.newEntries, BATCH_SIZE).map(async (batch) => {
      const { data: rows, error } = await supabase
        .from("writing_progress_entries")
        .upsert(
          batch.map((e) => ({
            member_id: memberId,
            project_id: projectIds.get(e.projectExternalId)!,
            external_id: e.externalId,
            entry_date: e.entryDate,
            measure: e.measure,
            mode: e.mode,
            amount: e.amount,
            note: e.note,
            tags: e.tags,
            created_at: e.createdAt,
          })),
          { onConflict: "member_id,external_id", ignoreDuplicates: true }
        )
        .select("id");
      if (error) throw new Error(`Failed to save progress entries: ${error.message}`);
      return rows?.length ?? 0;
    })
  );
  created.entries = entryResults.reduce((a, b) => a + b, 0);

  // 4. Goals
  for (const batch of chunk(plan.newGoals, BATCH_SIZE)) {
    const { data: rows, error } = await supabase
      .from("writing_goals")
      .upsert(
        batch.map((g) => ({
          member_id: memberId,
          project_id: projectIds.get(g.projectExternalId)!,
          external_id: g.externalId,
          goal_type: g.goalType,
          measure: g.measure,
          target_amount: g.targetAmount,
          start_date: g.startDate,
          end_date: g.endDate,
          habit_period: g.habitPeriod,
          habit_threshold: g.habitThreshold,
          is_starred: g.isStarred,
          created_at: g.createdAt,
        })),
        { onConflict: "member_id,external_id", ignoreDuplicates: true }
      )
      .select("id");
    if (error) throw new Error(`Failed to save goals: ${error.message}`);
    created.goals += rows?.length ?? 0;
  }

  // 5. Covers -- best-effort network copies, a few at a time; a failure is reported, not fatal.
  const withCovers = freshProjects.filter((p) => p.coverFilename);
  for (const batch of chunk(withCovers, COVER_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (project) => {
        const result = await copyCover(project.coverFilename!, memberId);
        if ("error" in result) {
          issues.push({ severity: "dropped", kind: "project", label: project.title, detail: `Cover: ${result.error}` });
          return;
        }
        const { error } = await supabase
          .from("writing_projects")
          .update({ cover_url: result.url })
          .eq("id", projectIds.get(project.externalId)!)
          .eq("member_id", memberId);
        if (error) {
          issues.push({ severity: "dropped", kind: "project", label: project.title, detail: `Cover: ${error.message}` });
          return;
        }
        created.covers++;
        if (result.resizedFrom) {
          issues.push({
            severity: "changed",
            kind: "project",
            label: project.title,
            detail: `Cover resized from ${result.resizedFrom} to Hub's 145×215 cover size.`,
          });
        }
      })
    );
  }

  return { created, alreadyImported: plan.alreadyImported, issues };
}
