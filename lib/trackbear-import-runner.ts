import type { WritingRepository } from "@/lib/data/writing";
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
const COVER_CONCURRENCY = 4;
const UPDATE_CONCURRENCY = 50;

export interface TrackbearImportResult {
  created: { projects: number; entries: number; goals: number; startingBalances: number; covers: number };
  alreadyImported: { projects: number; entries: number; goals: number };
  /** Already-imported goals that got their TrackBear title/description/show-on-profile filled in. */
  updated: { goalDetails: number };
  issues: ImportIssue[];
}

/** Copies one TrackBear cover into Hub storage; returns the new public URL. Injected so tests don't hit the network. */
export type CoverCopier = (
  coverFilename: string,
  memberId: string
) => Promise<{ url: string; resizedFrom: string | null } | { error: string }>;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Runs a repository call, putting what was being done in front of the database's message. */
async function step<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadExistingImports(writing: WritingRepository, memberId: string): Promise<ExistingImports> {
  const [projects, entryExternalIds, goals] = await Promise.all([
    writing.importedProjects(memberId),
    writing.importedEntryExternalIds(memberId),
    writing.importedGoals(memberId),
  ]);
  return {
    projectIdsByExternalId: new Map(projects.map((p) => [p.external_id, p.id])),
    entryExternalIds: new Set(entryExternalIds),
    goalExternalIds: new Set(goals.map((g) => g.external_id)),
    goalExternalIdsMissingDetails: new Set(
      goals.filter((g) => g.title === null && g.description === null).map((g) => g.external_id)
    ),
  };
}

export async function runTrackbearImport(
  writing: WritingRepository,
  memberId: string,
  data: TrackbearData,
  copyCover: CoverCopier
): Promise<TrackbearImportResult> {
  const existing = await loadExistingImports(writing, memberId);
  const plan = planTrackbearImport(data, existing);
  const issues = [...plan.issues];
  const created = { projects: 0, entries: 0, goals: 0, startingBalances: 0, covers: 0 };

  // 1. Projects. Rows that already exist are skipped (ON CONFLICT DO NOTHING) to cover a
  // concurrent double-submit; the ones returned are only the ones this call actually inserted.
  const projectIds = new Map(existing.projectIdsByExternalId);
  const insertedProjectIds = new Set<string>();
  for (const batch of chunk(plan.newProjects, BATCH_SIZE)) {
    const rows = await step("Failed to create projects", () =>
      writing.importProjects(
        batch.map((p) => ({
          member_id: memberId,
          external_id: p.externalId,
          title: p.title,
          description: p.description,
          phase: p.phase,
          show_on_profile: p.showOnProfile,
          created_at: p.createdAt,
        }))
      )
    );
    for (const row of rows) {
      projectIds.set(row.external_id, row.id);
      insertedProjectIds.add(row.external_id);
    }
  }
  created.projects = insertedProjectIds.size;
  // Rows skipped by ON CONFLICT (a concurrent import won the race) still need their ids.
  if (insertedProjectIds.size < plan.newProjects.length) {
    const refreshed = await loadExistingImports(writing, memberId);
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
    await step("Failed to save starting balances", () => writing.importStartingBalances(balanceRows));
    created.startingBalances = balanceRows.length;
  }

  // 3. Progress entries -- batched, batches in parallel.
  const entryResults = await Promise.all(
    chunk(plan.newEntries, BATCH_SIZE).map((batch) =>
      step("Failed to save progress entries", () =>
        writing.importEntries(
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
          }))
        )
      )
    )
  );
  created.entries = entryResults.reduce((a, b) => a + b, 0);

  // 4. Goals
  for (const batch of chunk(plan.newGoals, BATCH_SIZE)) {
    created.goals += await step("Failed to save goals", () =>
      writing.importGoals(
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
          title: g.title,
          description: g.description,
          show_on_profile: g.showOnProfile,
          created_at: g.createdAt,
        }))
      )
    );
  }

  // 4b. Goals imported before Hub goals had titles/descriptions/show-on-profile. The repository
  // only touches goals with neither, so details the member has since added in Hub stay.
  const updated = { goalDetails: 0 };
  for (const batch of chunk(plan.goalDetailBackfills, UPDATE_CONCURRENCY)) {
    const counts = await Promise.all(
      batch.map((g) =>
        step("Failed to update goals", () =>
          writing.backfillGoalDetails(memberId, g.externalId, { title: g.title, description: g.description, show_on_profile: g.showOnProfile })
        )
      )
    );
    updated.goalDetails += counts.reduce((a, b) => a + b, 0);
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
        try {
          await writing.updateProject(memberId, projectIds.get(project.externalId)!, { cover_url: result.url });
        } catch (error) {
          issues.push({
            severity: "dropped",
            kind: "project",
            label: project.title,
            detail: `Cover: ${error instanceof Error ? error.message : String(error)}`,
          });
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

  return { created, alreadyImported: plan.alreadyImported, updated, issues };
}
