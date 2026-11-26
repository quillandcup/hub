import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonRead } from "@/lib/kajabi/comments-run";
import { runCommentsCapture } from "@/lib/kajabi/comments-run";
import { formatCommentsTotals } from "@/lib/kajabi/capture-totals";
import type { PageComments, RawComment } from "@/lib/kajabi/comments-capture";

type Stored = { course_kajabi_id: string; comment_key: string; parent_comment_key: string | null; author_name: string; posted_at: string | null; body: string; deleted_at: string | null };
const state = vi.hoisted(() => ({
  stored: new Map<string, unknown[]>(),
  upserts: [] as unknown[][],
  softDeletes: [] as { lesson: string; keys: string[] }[],
}));

vi.mock("@/lib/data/kajabi-courses", () => ({
  SupabaseKajabiCourseRepository: class {
    async liveQuizzes() {
      return [];
    }
    async lessonComments(lesson: string) {
      return state.stored.get(lesson) ?? [];
    }
    async upsertLessonComments(rows: unknown[]) {
      state.upserts.push(rows);
    }
    async softDeleteLessonComments(lesson: string, keys: string[]) {
      state.softDeletes.push({ lesson, keys });
    }
  },
}));
vi.mock("@/lib/kajabi/progress-run", () => ({ loadKnownLessonIds: async () => new Set(["L1", "L2", "L3"]) }));

const COURSE = "c1";
const stored = (key: string): Stored => ({ course_kajabi_id: COURSE, comment_key: key, parent_comment_key: null, author_name: "Ada Example", posted_at: null, body: `Body ${key}`, deleted_at: null });
const raw = (index: number, id: string, parentIndex: number | null = null): RawComment => ({
  index,
  parentIndex,
  name: "Ada Example",
  datetime: null,
  body: `Body ${id}`,
  idCandidates: [{ source: "data-comment", name: "", value: id }],
});
const page = (comments: RawComment[], over: Partial<PageComments> = {}): LessonRead => ({
  kind: "ok",
  page: { comments, total: comments.length, pendingControls: 0, iframes: 0, ...over },
  capped: false,
  presses: 0,
});

async function run(reads: Record<string, LessonRead>) {
  const logs: string[] = [];
  const summary = await runCommentsCapture({
    db: {} as never,
    courseKajabiId: COURSE,
    lessons: Object.keys(reads).map((id) => ({ lessonKajabiId: id, url: `/p/${id}` })),
    readLesson: async (l) => reads[l.lessonKajabiId],
    apply: true,
    timeZone: "America/New_York",
    concurrency: 1,
    delayMs: 0,
    sleep: async () => undefined,
    log: (l) => logs.push(l),
  });
  return { summary, logs };
}

beforeEach(() => {
  state.stored.clear();
  state.upserts.length = 0;
  state.softDeletes.length = 0;
});

describe("runCommentsCapture summary and warnings", () => {
  it("reports, per lesson and in total, what was seen and how many controls were pressed, with no names or text", async () => {
    const first = page([raw(0, "1"), raw(1, "2", 0)]);
    if (first.kind === "ok") first.presses = 3;
    const { summary, logs } = await run({ L1: first, L2: page([raw(0, "9")]) });
    expect(summary).toMatchObject({ lessonsCaptured: 2, lessonsWithComments: 2, comments: 3, replies: 1, presses: 3, warnings: [] });
    expect(summary.lessonReports).toEqual([
      { lessonKajabiId: "L1", comments: 2, replies: 1, presses: 3, declaredTotal: 2, warnings: [] },
      { lessonKajabiId: "L2", comments: 1, replies: 0, presses: 0, declaredTotal: 1, warnings: [] },
    ]);
    expect(logs).toContain("lesson L1: 2 comments (1 replies), 3 controls pressed, page total 2");
    expect(logs.join("\n")).not.toMatch(/Ada|Body/);
    const text = formatCommentsTotals(true, summary);
    expect(text).toContain("seen: 2 lessons in the posts list, 2 read, 2 with comments, 3 comments and replies (1 replies), 3 Show More or similar controls pressed");
    expect(text).toContain("warnings: 0 (none)");
  });

  it("warns when a comments list is on the page but no comment was read from it, and when a frame could hold them", async () => {
    const { summary, logs } = await run({ L1: page([], { total: null, iframes: 1 }) });
    expect(summary).toMatchObject({ lessonsEmptyList: 1, lessonsWithFrames: 1 });
    expect(logs.filter((l) => l.startsWith("WARNING: lesson L1"))).toHaveLength(2);
    expect(formatCommentsTotals(true, summary)).toContain("warnings: 2");
  });

  it("warns when the page says more comments than were read, and when a Show More style control is still there", async () => {
    const { summary } = await run({ L1: page([raw(0, "1")], { total: 5, pendingControls: 2 }) });
    expect(summary).toMatchObject({ lessonsMismatched: 1, lessonsPendingControls: 1 });
    expect(summary.warnings.join("\n")).toContain("the page says 5 comments, read 1");
    expect(summary.warnings.join("\n")).toContain("2 control(s) that would show more");
  });

  it("warns for a lesson with a comment box and no list when the page still prints a total, or has frames", async () => {
    const { summary } = await run({
      L1: { kind: "noList", hasCommentBox: true, declaredTotal: 4 },
      L2: { kind: "noList", hasCommentBox: true, declaredTotal: null, iframes: 2 },
      L3: { kind: "noList", hasCommentBox: true, declaredTotal: 0 },
    });
    expect(summary).toMatchObject({ lessonsNoComments: 3, lessonsEmptyList: 1, lessonsWithFrames: 1 });
    expect(summary.warnings).toHaveLength(2);
  });

  it("warns for a lesson cut off at the limit", async () => {
    const capped: LessonRead = { kind: "ok", page: { comments: [raw(0, "1")], total: null, pendingControls: 1, iframes: 0 }, capped: true };
    const { summary } = await run({ L1: capped });
    expect(summary.lessonsCapped).toBe(1);
    expect(summary.warnings[0]).toContain("stopped at the Show More limit");
  });
});

describe("a partial capture never marks live rows deleted", () => {
  const seed = () => state.stored.set("L1", [stored("1"), stored("2"), stored("3")]);

  it("removes a comment only when the page's own total says everything was read", async () => {
    seed();
    const { summary } = await run({ L1: page([raw(0, "1"), raw(1, "2")]) });
    expect(summary.rows.removed).toBe(1);
    expect(state.softDeletes).toEqual([{ lesson: "L1", keys: ["3"] }]);
    expect(summary.removalsHeld).toBe(0);
  });

  it("holds every removal when the page prints no total (a read that cannot show it is complete)", async () => {
    seed();
    const { summary, logs } = await run({ L1: page([raw(0, "1")], { total: null }) });
    expect(summary.rows.removed).toBe(0);
    expect(state.softDeletes).toEqual([{ lesson: "L1", keys: [] }]);
    expect(summary.removalsHeld).toBe(2);
    expect(logs.some((l) => l.includes("2 stored comment(s) were not seen again and were NOT marked removed"))).toBe(true);
  });

  it("holds every removal when the read came back empty, or fewer than the page's total, or a control is still on the page", async () => {
    seed();
    for (const p of [page([], { total: null }), page([raw(0, "1")], { total: 3 }), page([raw(0, "1")], { total: 1, pendingControls: 1 })]) {
      state.softDeletes.length = 0;
      const { summary } = await run({ L1: p });
      expect(summary.rows.removed).toBe(0);
      expect(state.softDeletes.every((s) => s.keys.length === 0)).toBe(true);
    }
  });
});
