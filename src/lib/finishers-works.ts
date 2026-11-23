import { reachedWhileMember, type MilestoneKind } from "@/lib/finishers";
import type { Milestone, ShownStepKind, ShownWorkStep } from "@/lib/data/milestones";
import type { StepPhoto } from "@/lib/milestone-photos";

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
export type CardBook = { id: string; title: string; projectId: string | null; /** The day it was published, for the rule that a book counts only if published while a member. */ publishedDate?: string | null; /** The photo of the member holding it (the Published step). */ photo?: StepPhoto | null };

/** One work on the card, with the milestones stored for it. `published` is derived: it has a book on the Bookshelf. */
export type Work = {
  key: string;
  projectId: string | null;
  bookId: string | null;
  title: string | null;
  /** The project's phase, when the work is a project. */
  phase: string | null;
  published: boolean;
  /** The "holding my book" photo of the work's Bookshelf book, for the Published step. */
  bookPhoto?: StepPhoto | null;
  milestones: Partial<Record<MilestoneKind, Milestone>>;
};

/**
 * The member's works for the card: their projects and Bookshelf books, deduplicated (a book with a project is that project's
 * work), then any work only a milestone knows (a title they wrote, or a row from before works existed). Each carries its stored
 * milestones. Order: projects as given, then books, then the rest.
 */
export function buildWorks(projects: CardProject[], books: CardBook[], milestones: Milestone[], firstJoinedAt: string | null = null): Work[] {
  const works: Work[] = [];
  const byId = new Map<string, Work>();
  const add = (work: Work, ...ids: Array<string | null>) => {
    works.push(work);
    for (const id of ids) if (id) byId.set(id, work);
  };
  for (const p of projects) add({ key: p.id, projectId: p.id, bookId: null, title: p.title, phase: p.phase, published: false, milestones: {} }, p.id);
  for (const b of books) {
    // A book published before the member joined is on the Bookshelf but is not the Published milestone (reachedWhileMember).
    const counts = reachedWhileMember(b.publishedDate ?? null, firstJoinedAt);
    const linked = b.projectId ? byId.get(b.projectId) : undefined;
    if (linked) {
      linked.bookId = b.id;
      linked.published ||= counts;
      linked.bookPhoto = b.photo ?? null;
      byId.set(b.id, linked);
    } else {
      add({ key: b.projectId ?? b.id, projectId: b.projectId, bookId: b.id, title: b.title, phase: null, published: counts, bookPhoto: b.photo ?? null, milestones: {} }, b.id, b.projectId);
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

/**
 * Drops the Published steps of books published before the member first joined (`reachedWhileMember`, the rule the badges use): the
 * book stays on the Bookshelf, but is not a milestone in the community. Milestones are left as they are. A member with no join date
 * keeps every step.
 */
export function stepsCountedWhileMember(steps: readonly ShownWorkStep[], firstJoinedAt: string | null): ShownWorkStep[] {
  return steps.filter((s) => s.kind !== "published" || reachedWhileMember(s.achievedOn, firstJoinedAt));
}

/** A work as a strip shows it: its name when the viewer may know it, and its steps in order (THE END, publish-ready, Published). */
export type ShownWork = { title: string | null; steps: ShownWorkStep[] };

const STEP_ORDER: readonly ShownStepKind[] = ["the_end", "publish_ready", "published"];

/**
 * Groups the rows of `member_works_pictured_*` into works for a strip: works in their numbered order, each with one step per kind in the
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

/** The work of one project, for its card and page: always there, with whatever milestones and book it has. */
export function workOfProject(works: readonly Work[], projectId: string): Work | undefined {
  return works.find((w) => w.projectId === projectId);
}

/**
 * "Other works": the works that are not one of the member's active projects and have something to show (a milestone, or a book on
 * the Bookshelf): books with no project, works added by title, rows from before works existed, and the works of projects put away.
 * A put-away project with nothing on it is left out.
 */
export function otherWorks(works: readonly Work[], activeProjectIds: ReadonlySet<string>): Work[] {
  return works.filter((w) => !(w.projectId && activeProjectIds.has(w.projectId)) && (Object.keys(w.milestones).length > 0 || w.published));
}

/**
 * The line at the top of My Writing: how many works there are and where each stands, as plain counts, no title words. Each work counts
 * once, at the highest step it has reached ("6 works · 1 published · 2 ready to publish · 3 finished"), only from a milestone the
 * member confirmed or a book on the Bookshelf, so "ready to publish" is never said of a manuscript that is not. This differs on
 * purpose from the badges, which count every step reached (a work that is published also counts as a Finisher and an Author), so
 * the line does not use the badge words. One function, so the owner's choice of highest step or all steps is one place to change.
 * Null when there is nothing to say.
 */
export function summarizeWorks(works: Work[]): string | null {
  const counts = { published: 0, publish_ready: 0, the_end: 0 };
  for (const w of works) {
    if (w.published) counts.published += 1;
    else if (w.milestones.publish_ready?.status === "confirmed") counts.publish_ready += 1;
    else if (w.milestones.the_end?.status === "confirmed") counts.the_end += 1;
  }
  const total = counts.published + counts.publish_ready + counts.the_end;
  if (total === 0) return null;
  const parts = [`${total} ${total === 1 ? "work" : "works"}`];
  if (counts.published > 0) parts.push(`${counts.published} published`);
  if (counts.publish_ready > 0) parts.push(`${counts.publish_ready} ready to publish`);
  if (counts.the_end > 0) parts.push(`${counts.the_end} finished`);
  return parts.join(" · ");
}
