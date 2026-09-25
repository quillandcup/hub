import { unzipSync, strFromU8 } from "fflate";
import type { EntryMode, HabitPeriod, ProjectPhase, WritingMeasure } from "@/lib/writing-projects";

/**
 * TrackBear (trackbear.app) -> Hub writing-project importer: parsing + the pure mapping step.
 * The DB writes live in lib/trackbear-import-runner.ts.
 *
 * Input is TrackBear's own "Export your data" download (Settings -> Account): a .zip holding
 * trackbear-progress-data.json, which is TrackBear's raw model objects -- { tallies, projects,
 * targets, habits, tags } -- serialized as-is (see dispatchrabbi/trackbear
 * server/lib/models/export.ts). The loose CSVs in the same zip are derived views of that JSON,
 * so the JSON alone is the complete record. A bare .json upload is accepted too.
 *
 * TrackBear has no OAuth, and its API needs a member-created API key, so the export file is the
 * only way to import without asking members to provision credentials.
 *
 * Every TrackBear tally is stored as a delta: its "set total" checkbox is converted into a delta
 * server-side at log time, so tallies always import as mode='delta'. TrackBear time is in minutes,
 * same as Hub's time_minutes.
 */

export const TRACKBEAR_JSON_FILENAME = "trackbear-progress-data.json";
export const TRACKBEAR_ORIGIN = "https://trackbear.app";

export interface TrackbearTally {
  id: number;
  uuid: string;
  date: string;
  measure: string;
  count: number;
  note: string;
  workId: number;
  tagIds: number[];
  createdAt: string;
}

export interface TrackbearProject {
  id: number;
  uuid: string;
  title: string;
  description: string;
  phase: string;
  cover: string | null;
  startingBalance: Record<string, number>;
  starred: boolean;
  displayOnProfile: boolean;
  createdAt: string;
}

export interface TrackbearGoal {
  id: number;
  uuid: string;
  title: string;
  description: string;
  type: string;
  parameters: {
    threshold?: { measure: string; count: number } | null;
    cadence?: { unit: string; period: number } | null;
  };
  startDate: string | null;
  endDate: string | null;
  starred: boolean;
  displayOnProfile: boolean;
  workIds: number[];
  tagIds: number[];
  createdAt: string;
}

export interface TrackbearTag {
  id: number;
  name: string;
  color: string;
}

export interface TrackbearData {
  tallies: TrackbearTally[];
  projects: TrackbearProject[];
  targets: TrackbearGoal[];
  habits: TrackbearGoal[];
  tags: TrackbearTag[];
}

export const TRACKBEAR_MEASURE_MAP: Record<string, Exclude<WritingMeasure, "prickles">> = {
  word: "words",
  time: "time_minutes",
  page: "pages",
  chapter: "chapters",
  scene: "scenes",
  line: "lines",
};

export const TRACKBEAR_PHASE_MAP: Record<string, ProjectPhase> = {
  planning: "planning",
  outlining: "outlining",
  drafting: "drafting",
  revising: "revising",
  "on hold": "on_hold",
  finished: "complete",
  abandoned: "abandoned",
};

const HABIT_UNIT_MAP: Record<string, HabitPeriod> = { day: "day", week: "week", month: "month" };

export function trackbearExternalId(uuid: string): string {
  return `trackbear:${uuid}`;
}

export class TrackbearImportError extends Error {}

/** Accepts either TrackBear's export .zip or the trackbear-progress-data.json inside it. */
export function extractTrackbearExport(bytes: Uint8Array): TrackbearData {
  const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  let jsonText: string;
  if (isZip) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, { filter: (file) => file.name.endsWith(TRACKBEAR_JSON_FILENAME) });
    } catch {
      throw new TrackbearImportError("Couldn't open that .zip file.");
    }
    const entry = Object.values(files)[0];
    if (!entry) {
      throw new TrackbearImportError(
        `That .zip doesn't contain ${TRACKBEAR_JSON_FILENAME} -- is it TrackBear's "Export your data" download?`
      );
    }
    jsonText = strFromU8(entry);
  } else {
    jsonText = strFromU8(bytes);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new TrackbearImportError("That file isn't a TrackBear export (couldn't read it as a .zip or JSON).");
  }
  return validateTrackbearData(parsed);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateTrackbearData(parsed: unknown): TrackbearData {
  if (!isObject(parsed)) throw new TrackbearImportError("That file isn't a TrackBear export.");
  for (const key of ["tallies", "projects", "targets", "habits", "tags"] as const) {
    if (!Array.isArray(parsed[key])) {
      throw new TrackbearImportError(`That file isn't a TrackBear export (missing "${key}").`);
    }
  }
  const data = parsed as unknown as TrackbearData;

  const bad = (what: string, i: number) => new TrackbearImportError(`The export has a malformed ${what} (#${i + 1}).`);
  data.projects.forEach((p, i) => {
    if (!isObject(p) || typeof p.id !== "number" || typeof p.uuid !== "string" || typeof p.title !== "string") {
      throw bad("project", i);
    }
  });
  data.tallies.forEach((t, i) => {
    if (
      !isObject(t) ||
      typeof t.uuid !== "string" ||
      typeof t.workId !== "number" ||
      typeof t.count !== "number" ||
      typeof t.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(t.date)
    ) {
      throw bad("progress entry", i);
    }
  });
  [...data.targets, ...data.habits].forEach((g, i) => {
    if (!isObject(g) || typeof g.uuid !== "string" || !isObject(g.parameters) || !Array.isArray(g.workIds)) {
      throw bad("goal", i);
    }
  });
  data.tags.forEach((t, i) => {
    if (!isObject(t) || typeof t.id !== "number" || typeof t.name !== "string") throw bad("tag", i);
  });
  return data;
}

/** What's already in Hub from a previous import, so re-importing is idempotent. */
export interface ExistingImports {
  /** external_id -> Hub writing_projects.id */
  projectIdsByExternalId: Map<string, string>;
  entryExternalIds: Set<string>;
  goalExternalIds: Set<string>;
}

export interface PlannedProject {
  externalId: string;
  title: string;
  description: string | null;
  phase: ProjectPhase;
  showOnProfile: boolean;
  createdAt: string;
  /** TrackBear cover filename (served from TRACKBEAR_ORIGIN/uploads/covers/), copied by the runner. */
  coverFilename: string | null;
  startingBalances: { measure: Exclude<WritingMeasure, "prickles">; amount: number }[];
}

export interface PlannedEntry {
  externalId: string;
  projectExternalId: string;
  entryDate: string;
  measure: Exclude<WritingMeasure, "prickles">;
  mode: EntryMode;
  amount: number;
  note: string | null;
  tags: string[];
  createdAt: string;
}

export interface PlannedGoal {
  externalId: string;
  projectExternalId: string;
  goalType: "target" | "habit";
  measure: Exclude<WritingMeasure, "prickles">;
  targetAmount: number | null;
  startDate: string | null;
  endDate: string | null;
  habitPeriod: HabitPeriod | null;
  habitThreshold: number | null;
  isStarred: boolean;
  createdAt: string;
}

/**
 * - skipped: the whole record was not imported
 * - dropped: the record was imported, but some of its data has nowhere to go in Hub
 * - changed: imported, but transformed to fit Hub (e.g. a cover resized)
 */
export type ImportIssueSeverity = "skipped" | "dropped" | "changed";

export interface ImportIssue {
  severity: ImportIssueSeverity;
  kind: "project" | "entry" | "goal" | "tag";
  /** Human label for the record, e.g. the project or goal title. */
  label: string;
  detail: string;
}

export interface TrackbearImportPlan {
  /** Only projects not already imported. */
  newProjects: PlannedProject[];
  /** Every importable entry not already imported, whether its project is new or already in Hub. */
  newEntries: PlannedEntry[];
  newGoals: PlannedGoal[];
  alreadyImported: { projects: number; entries: number; goals: number };
  issues: ImportIssue[];
}

/** The same normalization logProgress applies to member-entered tags. */
function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

function goalLabel(goal: TrackbearGoal): string {
  return goal.title?.trim() || `Untitled ${goal.type}`;
}

export function planTrackbearImport(data: TrackbearData, existing: ExistingImports): TrackbearImportPlan {
  const issues: ImportIssue[] = [];
  const alreadyImported = { projects: 0, entries: 0, goals: 0 };

  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const tagsById = new Map(data.tags.map((t) => [t.id, t]));

  // --- Projects ---
  const newProjects: PlannedProject[] = [];
  for (const project of data.projects) {
    const externalId = trackbearExternalId(project.uuid);
    if (existing.projectIdsByExternalId.has(externalId)) {
      alreadyImported.projects++;
      continue;
    }
    const label = project.title.trim() || "Untitled project";

    let phase = TRACKBEAR_PHASE_MAP[project.phase];
    if (!phase) {
      phase = "drafting";
      issues.push({
        severity: "changed",
        kind: "project",
        label,
        detail: `Unrecognized TrackBear phase "${project.phase}"; imported as Drafting.`,
      });
    }

    const startingBalances: PlannedProject["startingBalances"] = [];
    for (const [tbMeasure, amount] of Object.entries(project.startingBalance ?? {})) {
      const measure = TRACKBEAR_MEASURE_MAP[tbMeasure];
      if (!amount) continue;
      if (!measure) {
        issues.push({
          severity: "dropped",
          kind: "project",
          label,
          detail: `Starting balance of ${amount} in unrecognized measure "${tbMeasure}".`,
        });
      } else if (amount < 0) {
        issues.push({
          severity: "dropped",
          kind: "project",
          label,
          detail: `Negative starting balance (${amount} ${measure}) -- Hub only allows starting balances of 0 or more.`,
        });
      } else {
        startingBalances.push({ measure, amount });
      }
    }

    if (project.starred) {
      issues.push({
        severity: "dropped",
        kind: "project",
        label,
        detail: "Starred flag -- Hub projects can't be starred.",
      });
    }

    newProjects.push({
      externalId,
      title: label,
      description: project.description?.trim() || null,
      phase,
      showOnProfile: !!project.displayOnProfile,
      createdAt: project.createdAt,
      coverFilename: project.cover || null,
      startingBalances,
    });
  }

  // --- Entries (TrackBear "tallies") ---
  const newEntries: PlannedEntry[] = [];
  for (const tally of data.tallies) {
    const externalId = trackbearExternalId(tally.uuid);
    if (existing.entryExternalIds.has(externalId)) {
      alreadyImported.entries++;
      continue;
    }
    const project = projectsById.get(tally.workId);
    const label = `${tally.date}${project ? ` · ${project.title}` : ""}`;
    if (!project) {
      issues.push({
        severity: "skipped",
        kind: "entry",
        label,
        detail: "Belongs to a project that isn't in the export (deleted in TrackBear?).",
      });
      continue;
    }
    const measure = TRACKBEAR_MEASURE_MAP[tally.measure];
    if (!measure) {
      issues.push({ severity: "skipped", kind: "entry", label, detail: `Unrecognized measure "${tally.measure}".` });
      continue;
    }
    const tags = [
      ...new Set(
        (tally.tagIds ?? [])
          .map((id) => tagsById.get(id)?.name)
          .filter((name): name is string => !!name)
          .map(normalizeTag)
          .filter(Boolean)
      ),
    ];
    newEntries.push({
      externalId,
      projectExternalId: trackbearExternalId(project.uuid),
      entryDate: tally.date,
      measure,
      mode: "delta",
      amount: tally.count,
      note: tally.note?.trim() || null,
      tags,
      createdAt: tally.createdAt,
    });
  }

  // --- Tags: Hub stores tags as plain labels on each entry, with no color ---
  const coloredTags = data.tags.filter((t) => t.color);
  if (coloredTags.length > 0) {
    issues.push({
      severity: "dropped",
      kind: "tag",
      label: coloredTags.map((t) => t.name).join(", "),
      detail: "Tag colors -- Hub tags are plain labels (the tag names themselves are kept on every entry).",
    });
  }
  const usedTagIds = new Set(data.tallies.flatMap((t) => t.tagIds ?? []));
  const unusedTags = data.tags.filter((t) => !usedTagIds.has(t.id));
  if (unusedTags.length > 0) {
    issues.push({
      severity: "skipped",
      kind: "tag",
      label: unusedTags.map((t) => t.name).join(", "),
      detail: "Not used on any progress entry -- Hub has no standalone tag list, so unused tags have nowhere to live.",
    });
  }

  // --- Goals (TrackBear "targets" and "habits") ---
  const newGoals: PlannedGoal[] = [];
  for (const goal of [...data.targets, ...data.habits]) {
    const externalId = trackbearExternalId(goal.uuid);
    if (existing.goalExternalIds.has(externalId)) {
      alreadyImported.goals++;
      continue;
    }
    const label = goalLabel(goal);
    const skip = (detail: string) => issues.push({ severity: "skipped", kind: "goal", label, detail });

    // Hub goals belong to exactly one project and count every entry on it.
    const workIds = goal.workIds ?? [];
    if (workIds.length === 0) {
      skip("Counts progress across all projects -- Hub goals belong to a single project.");
      continue;
    }
    if (workIds.length > 1) {
      skip(`Spans ${workIds.length} projects -- Hub goals belong to a single project.`);
      continue;
    }
    const project = projectsById.get(workIds[0]);
    if (!project) {
      skip("Its project isn't in the export (deleted in TrackBear?).");
      continue;
    }
    if ((goal.tagIds ?? []).length > 0) {
      const names = goal.tagIds.map((id) => tagsById.get(id)?.name ?? `#${id}`).join(", ");
      skip(`Only counts entries tagged ${names} -- Hub goals can't filter by tag.`);
      continue;
    }

    const threshold = goal.parameters?.threshold ?? null;
    const measure = threshold ? TRACKBEAR_MEASURE_MAP[threshold.measure] : undefined;
    const base = {
      externalId,
      projectExternalId: trackbearExternalId(project.uuid),
      isStarred: !!goal.starred,
      createdAt: goal.createdAt,
    };
    const dropped: string[] = [];

    if (goal.type === "target") {
      if (!threshold || !measure || !(threshold.count > 0)) {
        skip("Target has no valid amount/measure.");
        continue;
      }
      newGoals.push({
        ...base,
        goalType: "target",
        measure,
        targetAmount: threshold.count,
        startDate: goal.startDate || null,
        endDate: goal.endDate || null,
        habitPeriod: null,
        habitThreshold: null,
      });
    } else if (goal.type === "habit") {
      const cadence = goal.parameters?.cadence;
      const habitPeriod = cadence ? HABIT_UNIT_MAP[cadence.unit] : undefined;
      if (!cadence || !habitPeriod) {
        skip(`Repeats every ${cadence?.unit ?? "(unknown period)"} -- Hub habits are daily, weekly, or monthly.`);
        continue;
      }
      if (cadence.period !== 1) {
        skip(`Repeats every ${cadence.period} ${cadence.unit}s -- Hub habits repeat every single day, week, or month.`);
        continue;
      }
      if (!threshold || !measure) {
        skip("Counts any kind of progress (no measure) -- Hub habits track one measure.");
        continue;
      }
      if (goal.startDate || goal.endDate) {
        dropped.push(
          `Date range (${goal.startDate ?? "…"} to ${goal.endDate ?? "…"}) -- Hub habits run open-ended, so streaks count all of the project's entries.`
        );
      }
      newGoals.push({
        ...base,
        goalType: "habit",
        measure,
        targetAmount: null,
        startDate: null,
        endDate: null,
        habitPeriod,
        habitThreshold: threshold.count > 0 ? threshold.count : null,
      });
    } else {
      skip(`Unrecognized goal type "${goal.type}".`);
      continue;
    }

    if (goal.title?.trim()) dropped.push(`Title "${goal.title.trim()}" -- Hub goals don't have titles.`);
    if (goal.description?.trim()) dropped.push("Description -- Hub goals don't have descriptions.");
    if (goal.displayOnProfile) dropped.push("\"Show on profile\" -- Hub goals aren't shown on profiles.");
    for (const detail of dropped) issues.push({ severity: "dropped", kind: "goal", label, detail });
  }

  return { newProjects, newEntries, newGoals, alreadyImported, issues };
}
