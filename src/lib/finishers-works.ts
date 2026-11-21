import { MILESTONE_TITLES, PUBLISHED_TITLE, type MilestoneKind } from "@/lib/finishers";
import { PROJECT_PHASES } from "@/lib/writing-projects";
import type { Milestone, ShownStepKind, ShownWorkStep } from "@/lib/data/milestones";

/**
 * Works (docs/product/FINISHERS.md). A milestone belongs to one work: a writing project and/or a Bookshelf book (a book that has
 * a project is the same work as that project), or neither with a short title the member wrote for a work that is not listed.
 * Plain module (no server imports) so the card and the actions share it.
 */

export const MAX_WORK_TITLE_LENGTH = 120;

/** What a milestone row says about its work. */
export type WorkRef = { projectId: string | null; bookId: string | null; title: string | null };

const squash = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

/**
 * The key that says two rows are about the same work, the same one the database's unique index uses: the project when there
 * is one, else the book, else the lower-cased title, else "" (a row from before works existed, which names none).
 */
export function workKey(work: WorkRef): string {
  if (work.projectId) return work.projectId;
  if (work.bookId) return work.bookId;
  const title = squash(work.title);
  return title ? `title:${title.toLowerCase()}` : "";
}

/** Reads the work a member names when they add a milestone: a project or a book of theirs, or else a title (required). */
export function parseWork(input: { projectId?: string | null; bookId?: string | null; title?: string | null }): WorkRef | { error: string } {
  const projectId = input.projectId || null;
  const bookId = input.bookId || null;
  if (projectId || bookId) return { projectId, bookId, title: null };
  const title = squash(input.title);
  if (!title) return { error: "Tell us which work this is: pick one of yours, or give it a title." };
  if (title.length > MAX_WORK_TITLE_LENGTH) return { error: `Please keep the title under ${MAX_WORK_TITLE_LENGTH} characters.` };
  return { projectId: null, bookId: null, title };
}

/** A project as the card needs it. */
export type CardProject = { id: string; title: string; phase: string };
/** A live Bookshelf book as the card needs it. */
export type CardBook = { id: string; title: string; projectId: string | null };

/** One work on the card, with the milestones stored for it. `published` is derived: it has a book on the Bookshelf. */
export type Work = {
  key: string;
  projectId: string | null;
  bookId: string | null;
  title: string | null;
  /** The project's phase, when the work is a project. */
  phase: string | null;
  published: boolean;
  milestones: Partial<Record<MilestoneKind, Milestone>>;
};

/** Past the drafting stage (revising and beyond), which is where milestones start to be true. Hibernating says nothing about it. */
export function isPastDrafting(phase: string | null): boolean {
  if (!phase || phase === "hibernating") return false;
  const phases = PROJECT_PHASES as readonly string[];
  return phases.indexOf(phase) > phases.indexOf("drafting");
}

/**
 * The member's works for the card: their projects and Bookshelf books, deduplicated (a book with a project is that project's
 * work), then any work only a milestone knows (a title they wrote, or a row from before works existed). Each carries its stored
 * milestones. Order: projects as given, then books, then the rest.
 */
export function buildWorks(projects: CardProject[], books: CardBook[], milestones: Milestone[]): Work[] {
  const works: Work[] = [];
  const byId = new Map<string, Work>();
  const add = (work: Work, ...ids: Array<string | null>) => {
    works.push(work);
    for (const id of ids) if (id) byId.set(id, work);
  };
  for (const p of projects) add({ key: p.id, projectId: p.id, bookId: null, title: p.title, phase: p.phase, published: false, milestones: {} }, p.id);
  for (const b of books) {
    const linked = b.projectId ? byId.get(b.projectId) : undefined;
    if (linked) {
      linked.bookId = b.id;
      linked.published = true;
      byId.set(b.id, linked);
    } else {
      add({ key: b.projectId ?? b.id, projectId: b.projectId, bookId: b.id, title: b.title, phase: null, published: true, milestones: {} }, b.id, b.projectId);
    }
  }
  const unlisted = new Map<string, Work>();
  for (const m of milestones) {
    let work = (m.projectId ? byId.get(m.projectId) : undefined) ?? (m.bookId ? byId.get(m.bookId) : undefined);
    if (!work) {
      const key = workKey(m);
      work = unlisted.get(key);
      if (!work) {
        work = { key, projectId: m.projectId, bookId: m.bookId, title: m.title, phase: null, published: false, milestones: {} };
        works.push(work);
        unlisted.set(key, work);
      }
    }
    work.milestones[m.kind] ??= m;
  }
  return works;
}

/** A work as a strip shows it: its name when the viewer may know it, and its steps in order (THE END, publish-ready, Published). */
export type ShownWork = { title: string | null; steps: ShownWorkStep[] };

const STEP_ORDER: readonly ShownStepKind[] = ["the_end", "publish_ready", "published"];

/**
 * Groups the rows of `member_works_shown_*` into works for a strip: works in their numbered order, each with one step per kind in the
 * order of the writer's journey (a work cannot have the same step twice: of two books under one project, the earliest date shows).
 */
export function groupShownWorks(steps: readonly ShownWorkStep[]): ShownWork[] {
  const byNo = new Map<number, ShownWork>();
  for (const step of steps) {
    const work = byNo.get(step.workNo) ?? { title: step.workTitle, steps: [] };
    byNo.set(step.workNo, work);
    if (!work.title && step.workTitle) work.title = step.workTitle;
    const have = work.steps.findIndex((s) => s.kind === step.kind);
    if (have === -1) work.steps.push(step);
    else if (step.achievedOn !== null && (work.steps[have].achievedOn === null || step.achievedOn < work.steps[have].achievedOn!)) work.steps[have] = step;
  }
  return [...byNo.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, work]) => ({ ...work, steps: [...work.steps].sort((a, b) => STEP_ORDER.indexOf(a.kind) - STEP_ORDER.indexOf(b.kind)) }));
}

/** Whether the card shows this work up front: it has a milestone, is on the Bookshelf, or is past the drafting stage. */
export const isFeaturedWork = (work: Work): boolean => Object.keys(work.milestones).length > 0 || work.published || isPastDrafting(work.phase);

/**
 * The titles a member has earned, in plain words, from the whole set (docs/product/WRITER_TITLES.md): each work counts once, at
 * its highest rung, only from a milestone they confirmed ("Author" only for a confirmed publish-ready work, never for a
 * manuscript that is not) or from a book on the Bookshelf (Published Author). Null when there is nothing to say.
 */
export function summarizeTitles(works: Work[]): string | null {
  const counts = { published: 0, publish_ready: 0, the_end: 0 };
  for (const w of works) {
    if (w.published) counts.published += 1;
    else if (w.milestones.publish_ready?.status === "confirmed") counts.publish_ready += 1;
    else if (w.milestones.the_end?.status === "confirmed") counts.the_end += 1;
  }
  const part = (title: string, n: number) => (n > 0 ? [`${title} of ${n} ${n === 1 ? "work" : "works"}`] : []);
  const parts = [...part(PUBLISHED_TITLE, counts.published), ...part(MILESTONE_TITLES.publish_ready, counts.publish_ready), ...part(MILESTONE_TITLES.the_end, counts.the_end)];
  return parts.length > 0 ? parts.join(" · ") : null;
}
